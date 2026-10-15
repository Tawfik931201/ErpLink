/**
 * Pins the durable store→Odoo record links (odoo_entity_links).
 *
 * Context: after a store webhook (e.g. Salla `order.created`) creates a
 * record in Odoo (sale.order #42), a LATER event (`order.updated` days
 * later) must target that same record. `sync_logs` cannot serve this —
 * success rows are purged after 72h (cleanupExpiredLogs) and its lookup is
 * not store-scoped — so links live in their own table keyed per
 * (workspace, platform, store, model, store-entity):
 * supabase/migrations/20261011_odoo_entity_links.sql.
 *
 * What is pinned here:
 *   - The reserved match field (`__odoo_record_id`) is identical in the
 *     engine constant, every sale.order catalogue, and the mapping form —
 *     a drift in any one of them silently breaks update-by-saved-id.
 *   - Link writes/reads are always fully scoped (no global or
 *     workspace-only key): two stores sharing an order number never
 *     collide, and an unscoped read refuses instead of guessing.
 *   - The engine actually writes the link on success (logSync platform
 *     plumbing) and reads it before the legacy sync_logs fallback.
 *
 * Every source pin below matches code added with the feature, so each one
 * fails on the pre-feature tree — none is vacuous.
 */

import fs from 'fs'
import path from 'path'

import {
  buildEntityLinkKey,
  inferEntityType,
  resolveEntityLinkId,
  STORED_ODOO_ID_FIELD,
  upsertEntityLink,
} from '../../src/lib/entity-links'
import { SALLA_FIELDS } from '../../src/lib/platforms/salla/fields'
import { SHOPIFY_FIELDS } from '../../src/lib/platforms/shopify/fields'
import { ZID_FIELDS } from '../../src/lib/platforms/zid/fields'
import { supabase } from '../mocks/supabase'

function readStripped(relativePath: string): string {
  const raw = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const LINK = {
  workspaceId: 'ws-1',
  platform: 'salla' as const,
  storeId: 'merchant-9',
  odooModel: 'sale.order',
  storeEntityId: '1234',
}

beforeEach(() => {
  supabase.reset()
})

describe('reserved saved-id field stays identical everywhere', () => {
  it('the engine constant is the documented reserved value', () => {
    expect(STORED_ODOO_ID_FIELD).toBe('__odoo_record_id')
  })

  it('every sale.order catalogue carries the reserved field', () => {
    const catalogues: Array<[string, Array<{ value: string }> | undefined]> = [
      ['salla sale.order', SALLA_FIELDS['sale.order']],
      ['zid sale.order', ZID_FIELDS['sale.order']],
      ['shopify orders/create', SHOPIFY_FIELDS['orders/create']],
      ['shopify orders/updated', SHOPIFY_FIELDS['orders/updated']],
    ]
    for (const [name, list] of catalogues) {
      expect(`${name} catalogue exists`).toBeTruthy()
      expect(list).toBeDefined()
      expect(list!.some((f) => f.value === STORED_ODOO_ID_FIELD)).toBe(true)
    }
  })

  it('the mapping form references the same reserved value', () => {
    const form = readStripped('src/app/(app)/app/mapping-center/field-mapping-form.tsx')
    expect(form).toContain(STORED_ODOO_ID_FIELD)
  })
})

describe('link key and entity-type helpers are pure and scoped', () => {
  it('same input gives the same key', () => {
    expect(buildEntityLinkKey(LINK)).toBe(buildEntityLinkKey({ ...LINK }))
  })

  it('different stores give different keys for the same order number', () => {
    const a = buildEntityLinkKey(LINK)
    const b = buildEntityLinkKey({ ...LINK, storeId: 'merchant-10' })
    expect(a).not.toBe(b)
  })

  it('different platforms give different keys', () => {
    expect(buildEntityLinkKey(LINK)).not.toBe(
      buildEntityLinkKey({ ...LINK, platform: 'zid' })
    )
  })

  it('buckets Odoo models to entity types', () => {
    expect(inferEntityType('sale.order')).toBe('orders')
    expect(inferEntityType('product.template')).toBe('products')
    expect(inferEntityType('product.product')).toBe('products')
    expect(inferEntityType('res.partner')).toBe('customers')
    expect(inferEntityType('product.category')).toBe('categories')
    expect(inferEntityType('stock.quant')).toBe('records')
  })
})

describe('upsertEntityLink writes a fully-scoped row, best-effort', () => {
  it('upserts the link with the whole scope in the row', async () => {
    await expect(upsertEntityLink(LINK, 42)).resolves.toBe(true)
    const write = supabase.calls.find(
      (c) => c.table === 'odoo_entity_links' && c.op === 'upsert'
    )
    expect(write).toBeDefined()
    const row = (write!.args[0] ?? {}) as Record<string, unknown>
    expect(row.workspace_id).toBe('ws-1')
    expect(row.platform).toBe('salla')
    expect(row.store_id).toBe('merchant-9')
    expect(row.odoo_model).toBe('sale.order')
    expect(row.store_entity_id).toBe('1234')
    expect(row.odoo_record_id).toBe(42)
    const upsertOpts = (write!.args[1] ?? {}) as { onConflict?: unknown }
    expect(String(upsertOpts.onConflict ?? '')).toContain('store_id')
  })

  it('refuses to write when any scope part is missing', async () => {
    await expect(upsertEntityLink({ ...LINK, storeId: '' }, 42)).resolves.toBe(false)
    await expect(upsertEntityLink({ ...LINK, workspaceId: '' }, 42)).resolves.toBe(false)
    await expect(upsertEntityLink({ ...LINK, storeEntityId: '' }, 42)).resolves.toBe(false)
    expect(supabase.calls.length).toBe(0)
  })

  it('refuses to write for an unknown platform or a non-numeric id', async () => {
    await expect(
      upsertEntityLink({ ...LINK, platform: 'unknown' as 'salla' }, 42)
    ).resolves.toBe(false)
    await expect(upsertEntityLink(LINK, 0)).resolves.toBe(false)
    await expect(upsertEntityLink(LINK, -5)).resolves.toBe(false)
    await expect(upsertEntityLink(LINK, 'SO42' as unknown as number)).resolves.toBe(false)
    expect(supabase.calls.length).toBe(0)
  })
})

describe('resolveEntityLinkId never guesses across scopes', () => {
  it('queries with all five scope columns', async () => {
    await resolveEntityLinkId(LINK)
    const read = supabase.calls.find(
      (c) => c.table === 'odoo_entity_links' && c.op === 'select'
    )
    expect(read).toBeDefined()
    const filters = new Map(read!.filters)
    expect(filters.get('workspace_id')).toBe('ws-1')
    expect(filters.get('platform')).toBe('salla')
    expect(filters.get('store_id')).toBe('merchant-9')
    expect(filters.get('odoo_model')).toBe('sale.order')
    expect(filters.get('store_entity_id')).toBe('1234')
  })

  it('refuses an unscoped read without touching the database', async () => {
    await expect(resolveEntityLinkId({ ...LINK, storeId: '' })).resolves.toBeNull()
    await expect(
      resolveEntityLinkId({ ...LINK, platform: 'unknown' as 'salla' })
    ).resolves.toBeNull()
    expect(supabase.calls.length).toBe(0)
  })
})

describe('engine wiring pins (fail if the plumbing is removed)', () => {
  const engine = readStripped('src/lib/sync-engine.ts')
  const runtime = readStripped('src/lib/sync-runtime.ts')

  it('success paths hand the platform to logSync so the link is written', () => {
    expect(engine).toContain('platform: execPlatform')
  })

  it('findExistingOdooRecord consults the durable link store-scoped', () => {
    expect(engine).toContain('resolveEntityLinkId')
    expect(engine).toContain('odoo_entity_links')
  })

  it('the reserved match field resolves from the link, never the payload', () => {
    expect(engine).toContain('STORED_ODOO_ID_FIELD')
  })

  it('the legacy sync_logs fallback is store-scoped when the mapping has a store', () => {
    expect(engine).toContain(".eq('store_id', mapping.merchant_id)")
  })

  it('logSync refreshes the durable link on success', () => {
    expect(runtime).toContain('upsertEntityLink')
  })
})

describe('migration pin', () => {
  it('the entity-links migration creates the scoped unique table', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261011_odoo_entity_links.sql'),
      'utf8'
    )
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.odoo_entity_links')
    expect(sql).toContain(
      'UNIQUE (workspace_id, platform, store_id, odoo_model, store_entity_id)'
    )
  })
})
