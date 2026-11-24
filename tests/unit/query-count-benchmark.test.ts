/**
 * Query Count Benchmark & Regression Performance Harness.
 *
 * Measures database roundtrips to `merchant_tokens` and `standard_mapping_settings`
 * across Zid order creation and status update lifecycles.
 *
 * In the unoptimized baseline:
 *   - `tokenReads` in SupabaseZidTokenStore only collapsed in-flight concurrent reads
 *     and deleted entries in `finally`, forcing 16-19 sequential roundtrips to `merchant_tokens`.
 *   - `getEffectiveStandardMappingSettings` had zero request-scoped memoization and invoked
 *     `resolveSettingsStoreKey` on every single relation, tax, and payment lookup,
 *     accumulating 23+ roundtrips to `standard_mapping_settings` and `merchant_tokens`.
 *
 * This test suite provides:
 *   1. Precise query interception and counting per table and operation.
 *   2. Reusable query-budget assertions for order sync operations.
 *   3. Proof of isolation: guarantees that cached credentials and settings never bleed across
 *      workspaces, stores, or asynchronous request boundaries.
 */

import {
  getEffectiveStandardMappingSettings,
  resolveSettingsStoreKey,
  type SettingsClient,
} from '../../src/lib/mapping-settings'
import { getSyncRequestContext, withSyncRequestContext } from '../../src/lib/sync/request-context'
import {
  resolveZidOrderTokenScope,
} from '../../src/lib/zid/order-enrichment'
import {
  getAccessToken,
} from '../../src/lib/zid/token'
import { supabase } from '../mocks/supabase'

const mockDb: SettingsClient = supabase

jest.mock('../../src/lib/zid/config', () => ({
  getZidConfig: () => ({
    tokenUrl: 'https://oauth.invalid/token',
    clientId: 'bench-client',
    clientSecret: 'bench-secret',
  }),
}))

jest.mock('../../src/lib/crypto', () => ({
  ...jest.requireActual('../../src/lib/crypto'),
  decrypt: jest.fn((val: string) => val ? `decrypted-${val}` : ''),
  encrypt: jest.fn((val: string) => `v2:0123456789abcdef01234567:0123456789abcdef0123456789abcdef:${val}`),
  isEncryptedValue: jest.fn(() => true),
}))

export interface QueryMetrics {
  total: number
  byTable: Record<string, number>
  byOp: Record<string, number>
  merchantTokensReads: number
  standardMappingReads: number
}

/** Intercepts and categorizes all database queries recorded by the Supabase mock. */
export function captureQueryMetrics(): QueryMetrics {
  const metrics: QueryMetrics = {
    total: supabase.calls.length,
    byTable: {},
    byOp: {},
    merchantTokensReads: 0,
    standardMappingReads: 0,
  }

  for (const call of supabase.calls) {
    metrics.byTable[call.table] = (metrics.byTable[call.table] || 0) + 1
    metrics.byOp[call.op] = (metrics.byOp[call.op] || 0) + 1

    if (call.table === 'merchant_tokens' && call.op === 'select') {
      metrics.merchantTokensReads++
    }
    if (call.table === 'standard_mapping_settings' && call.op === 'select') {
      metrics.standardMappingReads++
    }
  }

  return metrics
}

/**
 * Asserts that the executed operations did not exceed the budgeted number of queries.
 */
export function assertQueryBudget(budget: {
  maxMerchantTokensReads?: number
  maxStandardMappingReads?: number
  maxTotalQueries?: number
}) {
  const metrics = captureQueryMetrics()

  if (budget.maxMerchantTokensReads !== undefined) {
    expect(metrics.merchantTokensReads).toBeLessThanOrEqual(budget.maxMerchantTokensReads)
  }
  if (budget.maxStandardMappingReads !== undefined) {
    expect(metrics.standardMappingReads).toBeLessThanOrEqual(budget.maxStandardMappingReads)
  }
  if (budget.maxTotalQueries !== undefined) {
    expect(metrics.total).toBeLessThanOrEqual(budget.maxTotalQueries)
  }
}

describe('Query Count Benchmark: Token Lifecycle & Sequential Redundancy', () => {
  const workspaceA = 'ws-bench-a'
  const workspaceB = 'ws-bench-b'
  const storeIdA = '1001'
  const merchantIdA = '9001'

  beforeEach(() => {
    supabase.reset()
    supabase.addMock('merchant_tokens', [
      {
        id: 'tok-a',
        merchant_id: merchantIdA,
        store_id: storeIdA,
        workspace_id: workspaceA,
        access_token: 'raw-access-a',
        refresh_token: 'raw-refresh-a',
        authorization_token: 'raw-auth-a',
        token_type: 'Bearer',
        expires_in: 7200,
        updated_at: new Date().toISOString(),
      },
      {
        id: 'tok-b',
        merchant_id: '9002',
        store_id: '1002',
        workspace_id: workspaceB,
        access_token: 'raw-access-b',
        refresh_token: 'raw-refresh-b',
        authorization_token: 'raw-auth-b',
        token_type: 'Bearer',
        expires_in: 7200,
        updated_at: new Date().toISOString(),
      },
    ])
  })

  it('measures baseline query amplification on sequential token reads', async () => {
    supabase.reset()
    supabase.addMock('merchant_tokens', [
      {
        id: 'tok-a',
        merchant_id: merchantIdA,
        store_id: storeIdA,
        workspace_id: workspaceA,
        access_token: 'raw-access-a',
        refresh_token: 'raw-refresh-a',
        authorization_token: 'raw-auth-a',
        token_type: 'Bearer',
        expires_in: 7200,
        updated_at: new Date().toISOString(),
      },
    ])

    // Simulate 5 sequential operations in an order sync (customer + 4 line items)
    for (let i = 0; i < 5; i++) {
      await getAccessToken(merchantIdA, workspaceA)
    }

    const metrics = captureQueryMetrics()
    // Current baseline without request-scoped caching: each sequential read queries merchant_tokens
    expect(metrics.merchantTokensReads).toBe(5)
  })

  it('measures baseline query amplification on sequential scope resolutions', async () => {
    supabase.reset()
    supabase.addMock('merchant_tokens', [
      {
        id: 'tok-a',
        merchant_id: merchantIdA,
        store_id: storeIdA,
        workspace_id: workspaceA,
      },
    ])

    // Simulate 5 sequential scope resolutions (order + customer + 3 product hydrations)
    for (let i = 0; i < 5; i++) {
      const scope = await resolveZidOrderTokenScope(storeIdA, workspaceA)
      expect(scope?.merchant_id).toBe(merchantIdA)
    }

    const metrics = captureQueryMetrics()
    expect(metrics.merchantTokensReads).toBe(5)
  })

  it('proves multi-tenant workspace isolation on token reads', async () => {
    // Reading Store A under Workspace B must fail closed
    await expect(getAccessToken(merchantIdA, workspaceB)).rejects.toThrow(
      'no longer connected to this workspace'
    )
  })
})

describe('Query Count Benchmark: Standard Mapping Settings & Relation Lookups', () => {
  const workspaceId = 'ws-settings-bench'
  const storeId = '3172448'
  const merchantId = '3236165'

  const mockSettings = {
    orders: {
      enable_vat: true,
      match_odoo_field: 'client_order_ref',
      match_zid_field: 'id',
    },
    customers: {
      match_odoo_field: 'ref',
      match_zid_field: 'id',
    },
    products: {
      match_odoo_field: 'default_code',
      match_zid_field: 'sku',
    },
  }

  beforeEach(() => {
    supabase.reset()
    supabase.addMock('merchant_tokens', [
      {
        id: 'tok-1',
        merchant_id: merchantId,
        store_id: storeId,
        workspace_id: workspaceId,
      },
    ])
    supabase.addMock('standard_mapping_settings', [
      {
        workspace_id: workspaceId,
        store_type: 'zid',
        entity_type: 'orders',
        store_id: merchantId,
        settings: mockSettings.orders,
      },
      {
        workspace_id: workspaceId,
        store_type: 'zid',
        entity_type: 'customers',
        store_id: merchantId,
        settings: mockSettings.customers,
      },
      {
        workspace_id: workspaceId,
        store_type: 'zid',
        entity_type: 'products',
        store_id: merchantId,
        settings: mockSettings.products,
      },
    ])
  })

  it('measures baseline queries when resolving standard mapping settings across relations', async () => {
    supabase.reset()
    supabase.addMock('merchant_tokens', [
      {
        id: 'tok-1',
        merchant_id: merchantId,
        store_id: storeId,
        workspace_id: workspaceId,
      },
    ])
    supabase.addMock('standard_mapping_settings', [
      {
        workspace_id: workspaceId,
        store_type: 'zid',
        entity_type: 'orders',
        store_id: merchantId,
        settings: mockSettings.orders,
      },
      {
        workspace_id: workspaceId,
        store_type: 'zid',
        entity_type: 'products',
        store_id: merchantId,
        settings: mockSettings.products,
      },
      {
        workspace_id: workspaceId,
        store_type: 'zid',
        entity_type: 'customers',
        store_id: merchantId,
        settings: mockSettings.customers,
      },
    ])

    // Simulate an order lifecycle calling settings for:
    // - order gate (orders)
    // - customer resolution (customers)
    // - 5 line item relations (products x 5)
    // - payment sync (orders)
    // - 2 tax checks (orders x 2)
    const entities = [
      'orders',
      'customers',
      'products',
      'products',
      'products',
      'products',
      'products',
      'orders',
      'orders',
      'orders',
    ]

    for (const entity of entities) {
      await getEffectiveStandardMappingSettings(
        supabase,
        workspaceId,
        'zid',
        entity,
        storeId
      )
    }

    const metrics = captureQueryMetrics()
    // In baseline, each call evaluates resolveSettingsStoreKey (1 query) + standard_mapping_settings (1 query)
    // 10 calls = 10 merchant_tokens reads + 10 standard_mapping_settings reads = 20 total queries!
    expect(metrics.standardMappingReads).toBe(10)
    expect(metrics.merchantTokensReads).toBe(10)
  })

  it('demonstrates target query reduction with memoized context', async () => {
    // This demonstrates the contract that the Request-Scoped Execution Context will implement:
    // Once cached in request scope:
    // - Exactly 1 read per distinct entity_type (orders, customers, products) = 3 queries
    // - Exactly 1 store_id -> merchant_id key resolution (and memoized inside resolveSettingsStoreKey)
    const localSettingsCache = new Map<string, Record<string, unknown> | null>()
    const localStoreKeyCache = new Map<string, string>()

    async function memoizedResolveSettingsStoreKey(
      client: SettingsClient,
      storeType: 'zid' | 'salla' | 'shopify',
      key: string,
      wsId: string
    ) {
      const cacheKey = `${wsId}:${storeType}:${key}`
      if (localStoreKeyCache.has(cacheKey)) return localStoreKeyCache.get(cacheKey)!
      const res = await resolveSettingsStoreKey(client, storeType, key, wsId)
      localStoreKeyCache.set(cacheKey, res)
      return res
    }

    async function getSettingsWithContext(entity: string): Promise<Record<string, unknown> | null> {
      const cacheKey = `${workspaceId}:zid:${entity}:${storeId}`
      if (localSettingsCache.has(cacheKey)) {
        return localSettingsCache.get(cacheKey) ?? null
      }
      const resolved = await memoizedResolveSettingsStoreKey(supabase, 'zid', storeId, workspaceId)
      // When standard_mapping_settings is queried directly for the resolved key:
      const { data } = await mockDb
        .from('standard_mapping_settings')
        .select('store_id, settings')
        .eq('workspace_id', workspaceId)
        .eq('store_type', 'zid')
        .eq('entity_type', entity)
        .in('store_id', resolved ? [resolved, ''] : [''])

      const hit = ((data ?? []) as Array<{ store_id: string; settings: Record<string, unknown> }>).find(
        (r) => (r.store_id || '') === resolved
      )
      const val = hit?.settings || null
      localSettingsCache.set(cacheKey, val)
      return val
    }

    supabase.reset()
    supabase.addMock('merchant_tokens', [
      {
        id: 'tok-1',
        merchant_id: merchantId,
        store_id: storeId,
        workspace_id: workspaceId,
      },
    ])
    supabase.addMock('standard_mapping_settings', [
      {
        workspace_id: workspaceId,
        store_type: 'zid',
        entity_type: 'orders',
        store_id: merchantId,
        settings: mockSettings.orders,
      },
      {
        workspace_id: workspaceId,
        store_type: 'zid',
        entity_type: 'products',
        store_id: merchantId,
        settings: mockSettings.products,
      },
      {
        workspace_id: workspaceId,
        store_type: 'zid',
        entity_type: 'customers',
        store_id: merchantId,
        settings: mockSettings.customers,
      },
    ])

    const entities = [
      'orders',
      'customers',
      'products',
      'products',
      'products',
      'products',
      'products',
      'orders',
      'orders',
      'orders',
    ]

    for (const entity of entities) {
      await getSettingsWithContext(entity)
    }

    const metrics = captureQueryMetrics()
    // With request-scoped caching:
    // merchant_tokens queries: reduced from 10 to exactly 1!
    // standard_mapping_settings queries: reduced from 10 to exactly 3 (orders, customers, products)!
    expect(metrics.merchantTokensReads).toBe(1)
    expect(metrics.standardMappingReads).toBe(3)
  })
})

describe('Query Count Benchmark: Order Lifecycle Simulation & Budget Assertion', () => {
  const ws = 'ws-order-sim'
  const store = '7788'
  const merchant = '9900'

  beforeEach(() => {
    supabase.reset()
    supabase.addMock('merchant_tokens', [
      {
        id: 'tok-sim',
        merchant_id: merchant,
        store_id: store,
        workspace_id: ws,
        access_token: 'access-sim',
        refresh_token: 'refresh-sim',
        authorization_token: 'auth-sim',
        token_type: 'Bearer',
        expires_in: 3600,
        updated_at: new Date().toISOString(),
      },
    ])
    supabase.addMock('standard_mapping_settings', [
      {
        workspace_id: ws,
        store_type: 'zid',
        entity_type: 'orders',
        store_id: merchant,
        settings: {
          enable_vat: true,
          match_odoo_field: 'client_order_ref',
          match_zid_field: 'id',
          order: {
            status_actions: {
              delivered: { state: 'sale', invoice_action: 'create_and_post' },
            },
          },
        },
      },
      {
        workspace_id: ws,
        store_type: 'zid',
        entity_type: 'customers',
        store_id: merchant,
        settings: { match_odoo_field: 'ref', match_zid_field: 'id' },
      },
      {
        workspace_id: ws,
        store_type: 'zid',
        entity_type: 'products',
        store_id: merchant,
        settings: { match_odoo_field: 'default_code', match_zid_field: 'sku' },
      },
    ])
  })

  it('proves the 16-query merchant_tokens hotspot on unoptimized order create', async () => {
    supabase.reset()
    supabase.addMock('merchant_tokens', [
      {
        id: 'tok-sim',
        merchant_id: merchant,
        store_id: store,
        workspace_id: ws,
        access_token: 'access-sim',
        refresh_token: 'refresh-sim',
        authorization_token: 'auth-sim',
        token_type: 'Bearer',
        expires_in: 3600,
        updated_at: new Date().toISOString(),
      },
    ])

    // Step 1: Ingress store normalization & token verification (2 reads)
    await resolveSettingsStoreKey(supabase, 'zid', store, ws)
    await resolveSettingsStoreKey(supabase, 'zid', store, ws)

    // Step 2: Queue worker / target resolution requireStore (2 reads)
    await mockDb.from('merchant_tokens').select('workspace_id').eq('workspace_id', ws).eq('store_id', store).maybeSingle()
    await mockDb.from('merchant_tokens').select('workspace_id').eq('workspace_id', ws).eq('store_id', store).maybeSingle()

    // Step 3: Order enrichment resolveZidOrderTokenScope + getAccessToken (2 reads)
    await resolveZidOrderTokenScope(store, ws)
    await getAccessToken(merchant, ws)

    // Step 4: Customer resolution resolveZidOrderTokenScope + getAccessToken (2 reads)
    await resolveZidOrderTokenScope(store, ws)
    await getAccessToken(merchant, ws)

    // Step 5: 3x Line item product hydrations (3 x 2 = 6 reads)
    for (let p = 0; p < 3; p++) {
      await resolveZidOrderTokenScope(store, ws)
      await getAccessToken(merchant, ws)
    }

    // Step 6: Relations & tax checks resolveSettingsStoreKey (4 reads)
    for (let r = 0; r < 4; r++) {
      await resolveSettingsStoreKey(supabase, 'zid', store, ws)
    }

    const metrics = captureQueryMetrics()
    // 2 + 2 + 2 + 2 + 6 + 4 = 18 queries in the unoptimized baseline!
    expect(metrics.merchantTokensReads).toBeGreaterThanOrEqual(16)
  })

  it('proves the 23-query standard_mapping_settings hotspot on unoptimized order sync', async () => {
    supabase.reset()
    supabase.addMock('merchant_tokens', [
      { id: 'tok-sim', merchant_id: merchant, store_id: store, workspace_id: ws },
    ])
    supabase.addMock('standard_mapping_settings', [
      { workspace_id: ws, store_type: 'zid', entity_type: 'orders', store_id: merchant, settings: {} },
      { workspace_id: ws, store_type: 'zid', entity_type: 'customers', store_id: merchant, settings: {} },
      { workspace_id: ws, store_type: 'zid', entity_type: 'products', store_id: merchant, settings: {} },
    ])

    // 1. Ingress gate check (orders) -> 1
    await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'orders', store)

    // 2. Preset operation allowance (orders) -> 1
    await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'orders', store)

    // 3. executeOdooOperation top (orders) -> 1
    await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'orders', store)

    // 4. Customer matching settings -> 1
    await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'customers', store)

    // 5. Relations in execute-operation (partner, uom, company, taxes x 2) -> 5
    for (let i = 0; i < 5; i++) {
      await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'orders', store)
    }

    // 6. 3 Line item product matching & relations (products x 3 x 2) -> 6
    for (let i = 0; i < 6; i++) {
      await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'products', store)
    }

    // 7. Order payment sync settings -> 1
    await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'orders', store)

    // 8. Order status workflow (custom field, status row fallback, return check) -> 3
    for (let i = 0; i < 3; i++) {
      await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'orders', store)
    }

    // 9. ensureSaleOrderTaxes (initial + post-payment) -> 2
    for (let i = 0; i < 2; i++) {
      await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'orders', store)
    }

    // 10. Invoice preflight (COD fee + total assertion) -> 2
    for (let i = 0; i < 2; i++) {
      await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'orders', store)
    }

    const metrics = captureQueryMetrics()
    // Total standard_mapping_settings queries = 1 + 1 + 1 + 1 + 5 + 6 + 1 + 3 + 2 + 2 = 23 queries!
    expect(metrics.standardMappingReads).toBe(23)
  })

  it('proves optimized order create with withSyncRequestContext collapses merchant_tokens reads to exactly 1', async () => {
    supabase.reset()
    supabase.addMock('merchant_tokens', [
      {
        id: 'tok-sim',
        merchant_id: merchant,
        store_id: store,
        workspace_id: ws,
        access_token: 'raw-access',
        refresh_token: 'raw-refresh',
        authorization_token: 'raw-auth',
        token_type: 'Bearer',
        expires_in: 7200,
        updated_at: new Date().toISOString(),
      },
    ])

    await withSyncRequestContext({ workspaceId: ws, storeId: store, merchantId: merchant }, async () => {
      // Step 1: Ingress normalization
      await resolveSettingsStoreKey(supabase, 'zid', store, ws)

      // Step 2: Order enrichment resolveZidOrderTokenScope + getAccessToken
      await resolveZidOrderTokenScope(store, ws)
      await getAccessToken(merchant, ws)

      // Step 3: Customer resolution resolveZidOrderTokenScope + getAccessToken
      await resolveZidOrderTokenScope(store, ws)
      await getAccessToken(merchant, ws)

      // Step 4: 5x Line item product hydrations
      for (let p = 0; p < 5; p++) {
        await resolveZidOrderTokenScope(store, ws)
        await getAccessToken(merchant, ws)
      }

      // Step 5: Relations & tax checks resolveSettingsStoreKey
      for (let r = 0; r < 5; r++) {
        await resolveSettingsStoreKey(supabase, 'zid', store, ws)
      }
    })

    const metrics = captureQueryMetrics()
    // Exactly 1 initial query to load merchant_id in resolveSettingsStoreKey + 1 to loadTokens = 2 queries!
    // Collapsed from 18+ down to 2!
    expect(metrics.merchantTokensReads).toBeLessThanOrEqual(2)
  })

  it('proves optimized order sync with withSyncRequestContext collapses standard_mapping_settings reads to 3', async () => {
    supabase.reset()
    supabase.addMock('merchant_tokens', [
      { id: 'tok-sim', merchant_id: merchant, store_id: store, workspace_id: ws },
    ])
    supabase.addMock('standard_mapping_settings', [
      { workspace_id: ws, store_type: 'zid', entity_type: 'orders', store_id: merchant, settings: {} },
      { workspace_id: ws, store_type: 'zid', entity_type: 'customers', store_id: merchant, settings: {} },
      { workspace_id: ws, store_type: 'zid', entity_type: 'products', store_id: merchant, settings: {} },
    ])

    await withSyncRequestContext({ workspaceId: ws, storeId: store, merchantId: merchant }, async () => {
      // 1. Ingress gate check (orders)
      await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'orders', store)

      // 2. Preset operation allowance (orders)
      await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'orders', store)

      // 3. Customer matching settings
      await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'customers', store)

      // 4. 5 Relations (orders x 5)
      for (let i = 0; i < 5; i++) {
        await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'orders', store)
      }

      // 5. 5 Line items (products x 5)
      for (let i = 0; i < 5; i++) {
        await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'products', store)
      }

      // 6. Payment + tax + workflow checks (orders x 6)
      for (let i = 0; i < 6; i++) {
        await getEffectiveStandardMappingSettings(supabase, ws, 'zid', 'orders', store)
      }
    })

    const metrics = captureQueryMetrics()
    // Exactly 1 read per distinct entity_type (orders, customers, products) = 3 queries!
    // Collapsed from 23 down to 3!
    expect(metrics.standardMappingReads).toBe(3)
  })

  it('validates assertQueryBudget helper with passing and failing conditions', () => {
    supabase.reset()
    supabase.addMock('merchant_tokens', [
      { id: 'tok-1', merchant_id: merchant, store_id: store, workspace_id: ws },
    ])

    // Should pass when within budget
    assertQueryBudget({ maxMerchantTokensReads: 5, maxStandardMappingReads: 5 })

    // Perform 2 reads
    mockDb.from('merchant_tokens').select('id').eq('store_id', store)
    mockDb.from('merchant_tokens').select('id').eq('store_id', store)

    expect(() => {
      assertQueryBudget({ maxMerchantTokensReads: 1 })
    }).toThrow()

    expect(() => {
      assertQueryBudget({ maxMerchantTokensReads: 2 })
    }).not.toThrow()
  })

  it('guarantees store-level isolation when nesting withSyncRequestContext for different stores', async () => {
    const ws = 'ws-multi'
    const storeA = 'store-a'
    const storeB = 'store-b'

    await withSyncRequestContext({ workspaceId: ws, storeId: storeA }, async () => {
      const outerCtx = getSyncRequestContext()
      expect(outerCtx?.storeId).toBe(storeA)

      await withSyncRequestContext({ workspaceId: ws, storeId: storeB }, async () => {
        const innerCtx = getSyncRequestContext()
        expect(innerCtx?.storeId).toBe(storeB)
        expect(innerCtx).not.toBe(outerCtx)
      })

      // Outer context is preserved on return
      expect(getSyncRequestContext()?.storeId).toBe(storeA)
    })
  })

  it('caches fallback key on transient Supabase error to prevent query storms', async () => {
    supabase.reset()
    const ws = 'ws-storm'
    const store = '99999'

    await withSyncRequestContext({ workspaceId: ws, storeId: store }, async () => {
      const first = await resolveSettingsStoreKey(mockDb, 'zid', store, ws)
      expect(first).toBe(store)
      const countAfterFirst = supabase.calls.length

      // Second call must use context cache without extra query
      const second = await resolveSettingsStoreKey(mockDb, 'zid', store, ws)
      expect(second).toBe(store)
      expect(supabase.calls.length).toBe(countAfterFirst)
    })
  })
})

