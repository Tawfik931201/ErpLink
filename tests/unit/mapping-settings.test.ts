import fs from 'fs'
import path from 'path'

import {
  getEffectiveStandardMappingSettings,
  normalizeSettingsStoreKey,
  resolveSettingsStoreKey,
} from '@/lib/mapping-settings'

/**
 * The ONE place that answers "which settings apply to THIS store?".
 *
 * Why this suite exists: `standard_mapping_settings` is keyed by
 * (workspace_id, store_type, store_id, entity_type), where store_id is the
 * merchant key and '' is the platform default. Two bugs were shipped by
 * readers that hand-rolled this lookup:
 *
 *   1. A bare `.eq(...).maybeSingle()` returned the FIRST row — the platform
 *      default — so a workspace with two stores applied store #1's page to
 *      store #2 (and threw PostgREST PGRST116 once a per-store row existed).
 *   2. `r.store_id === storeId` compared a TEXT column to whatever the caller
 *      held; a numeric caller never matched and silently fell back to ''.
 *
 * `getEffectiveStandardMappingSettings` is the choke point every engine reader
 * now goes through, so these tests pin: per-store-wins-over-default, the ''
 * fallback, the TEXT comparison, and the Zid store_id → merchant_id
 * translation. A fake client is injected (the module takes any `{ from }`),
 * so no database is touched.
 *
 * Source under test: src/lib/mapping-settings.ts
 */

type SettingsRow = {
  workspace_id: string
  store_type: string
  entity_type: string
  store_id: string
  settings: Record<string, unknown>
}

type TokenRow = { store_id?: string; merchant_id?: string }

/**
 * Minimal chainable stand-in for the Supabase builder, recording the query so
 * a test can assert the exact filter (`.in('store_id', [key, ''])`).
 */
function makeClient(opts: { settings?: SettingsRow[]; tokens?: TokenRow[] } = {}) {
  const settings = opts.settings ?? []
  const tokens = opts.tokens ?? []
  const calls: Array<{ table: string; filters: Record<string, unknown>; inValues?: unknown[] }> = []

  function from(table: string) {
    const filters: Record<string, unknown> = {}
    let inValues: unknown[] | undefined
    const record = { table, filters, inValues: undefined as unknown[] | undefined }
    calls.push(record)

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters[col] = val
        return builder
      },
      in: (col: string, vals: unknown[]) => {
        inValues = vals
        record.inValues = vals
        return builder
      },
      maybeSingle: async () => {
        if (table === 'merchant_tokens') {
          if (filters.store_id !== undefined) {
            const hit = tokens.find(t => String(t.store_id) === String(filters.store_id))
            return { data: hit ? { merchant_id: hit.merchant_id } : null, error: null }
          }
          if (filters.merchant_id !== undefined) {
            const hit = tokens.find(t => String(t.merchant_id) === String(filters.merchant_id))
            return { data: hit ? { merchant_id: hit.merchant_id } : null, error: null }
          }
          return { data: null, error: null }
        }
        return { data: null, error: null }
      },
      then: (onFulfilled: (v: unknown) => unknown) => {
        const allowed = inValues ?? null
        const data = settings.filter(
          r =>
            r.workspace_id === filters.workspace_id &&
            r.store_type === filters.store_type &&
            r.entity_type === filters.entity_type &&
            (allowed ? allowed.map(String).includes(String(r.store_id)) : true)
        )
        return Promise.resolve({ data, error: null }).then(onFulfilled)
      },
    }
    return builder
  }

  return { client: { from }, calls }
}

const row = (
  store_id: string,
  settings: Record<string, unknown>,
  over: Partial<SettingsRow> = {}
): SettingsRow => ({
  workspace_id: 'ws-1',
  store_type: 'zid',
  entity_type: 'products',
  store_id,
  settings,
  ...over,
})

describe('normalizeSettingsStoreKey', () => {
  it('maps null/undefined to the platform default', () => {
    expect(normalizeSettingsStoreKey(undefined)).toBe('')
    expect(normalizeSettingsStoreKey(null)).toBe('')
  })

  it('stringifies numbers and trims strings so a numeric caller cannot miss a TEXT column', () => {
    expect(normalizeSettingsStoreKey(3236165)).toBe('3236165')
    expect(normalizeSettingsStoreKey('  3236165 ')).toBe('3236165')
  })

  it('leaves an empty string as the default', () => {
    expect(normalizeSettingsStoreKey('')).toBe('')
  })
})

describe('resolveSettingsStoreKey', () => {
  it('returns an empty key (the default) for an empty key without querying', async () => {
    const { client, calls } = makeClient()
    expect(await resolveSettingsStoreKey(client, 'zid', '')).toBe('')
    expect(calls).toHaveLength(0)
  })

  it('leaves salla/shopify keys untouched (already merchant / shop domain)', async () => {
    const { client, calls } = makeClient()
    expect(await resolveSettingsStoreKey(client, 'salla', '2147022192')).toBe('2147022192')
    expect(await resolveSettingsStoreKey(client, 'shopify', 'x.myshopify.com')).toBe('x.myshopify.com')
    expect(calls).toHaveLength(0)
  })

  it('leaves a non-numeric zid key untouched', async () => {
    const { client } = makeClient({ tokens: [{ store_id: '3172448', merchant_id: '3236165' }] })
    expect(await resolveSettingsStoreKey(client, 'zid', 'abc')).toBe('abc')
  })

  it('translates a Zid numeric store_id to its merchant_id', async () => {
    const { client } = makeClient({ tokens: [{ store_id: '3172448', merchant_id: '3236165' }] })
    expect(await resolveSettingsStoreKey(client, 'zid', '3172448')).toBe('3236165')
    // A numeric caller is stringified before the lookup.
    expect(await resolveSettingsStoreKey(client, 'zid', 3172448)).toBe('3236165')
  })

  it('is idempotent for a key that is already a merchant_id', async () => {
    const { client } = makeClient({ tokens: [{ store_id: '3172448', merchant_id: '3236165' }] })
    // store_id lookup misses, merchant_id lookup hits → same value back.
    expect(await resolveSettingsStoreKey(client, 'zid', '3236165')).toBe('3236165')
  })

  it('falls back to the original key when the token is unknown', async () => {
    const { client } = makeClient({ tokens: [] })
    expect(await resolveSettingsStoreKey(client, 'zid', '9999999')).toBe('9999999')
  })
})

describe('getEffectiveStandardMappingSettings', () => {
  it('prefers the per-store row over the platform default', async () => {
    const { client } = makeClient({
      settings: [row('', { mode: 'default' }), row('3236165', { mode: 'store' })],
    })
    const s = await getEffectiveStandardMappingSettings(client, 'ws-1', 'zid', 'products', '3236165')
    expect(s).toEqual({ mode: 'store' })
  })

  it('falls back to the platform default when the store has no row', async () => {
    const { client } = makeClient({ settings: [row('', { mode: 'default' })] })
    const s = await getEffectiveStandardMappingSettings(client, 'ws-1', 'zid', 'products', '9999999')
    expect(s).toEqual({ mode: 'default' })
  })

  it('returns null when neither the store nor the default has a row', async () => {
    const { client } = makeClient({ settings: [] })
    expect(await getEffectiveStandardMappingSettings(client, 'ws-1', 'zid', 'products', '3236165')).toBeNull()
  })

  it('returns the default row for an empty store key', async () => {
    const { client } = makeClient({ settings: [row('', { mode: 'default' }), row('3236165', { mode: 'store' })] })
    const s = await getEffectiveStandardMappingSettings(client, 'ws-1', 'zid', 'products', '')
    expect(s).toEqual({ mode: 'default' })
  })

  it('matches a TEXT store_id when the caller holds a number', async () => {
    const { client } = makeClient({ settings: [row('', { mode: 'default' }), row('3236165', { mode: 'store' })] })
    const s = await getEffectiveStandardMappingSettings(client, 'ws-1', 'zid', 'products', 3236165)
    expect(s).toEqual({ mode: 'store' })
  })

  it('scopes the query to the store key AND the default (never a bare maybeSingle)', async () => {
    const { client, calls } = makeClient({ settings: [row('', { mode: 'default' })] })
    await getEffectiveStandardMappingSettings(client, 'ws-1', 'zid', 'products', '3236165')
    const q = calls.find(c => c.table === 'standard_mapping_settings')!
    expect(q.filters).toMatchObject({ workspace_id: 'ws-1', store_type: 'zid', entity_type: 'products' })
    expect(q.inValues).toEqual(['3236165', ''])
  })

  it('scopes to the default only when the store key is empty', async () => {
    const { client, calls } = makeClient({ settings: [row('', { mode: 'default' })] })
    await getEffectiveStandardMappingSettings(client, 'ws-1', 'salla', 'orders', '')
    const q = calls.find(c => c.table === 'standard_mapping_settings')!
    expect(q.inValues).toEqual([''])
  })

  it('resolves a Zid numeric store_id to the merchant row before matching', async () => {
    const { client } = makeClient({
      tokens: [{ store_id: '3172448', merchant_id: '3236165' }],
      settings: [row('', { mode: 'default' }), row('3236165', { mode: 'store' })],
    })
    // Caller only knows the numeric store_id; the merchant row must still win.
    const s = await getEffectiveStandardMappingSettings(client, 'ws-1', 'zid', 'products', '3172448')
    expect(s).toEqual({ mode: 'store' })
  })

  it('does not consult merchant_tokens for non-zid platforms', async () => {
    const { client, calls } = makeClient({
      settings: [row('2147022192', { mode: 'salla' }, { store_type: 'salla' })],
    })
    await getEffectiveStandardMappingSettings(client, 'ws-1', 'salla', 'products', '2147022192')
    expect(calls.some(c => c.table === 'merchant_tokens')).toBe(false)
  })
})

/**
 * Source-level pin: no call site may hand-roll an unscoped
 * `standard_mapping_settings` READ again.
 *
 * This is the guard that would have caught every one of the shipped defects —
 * the engine reads that used a bare `.maybeSingle()`, the stock-sync loaders,
 * and src/app/api/webhooks/odoo/route.ts, which read the table with a bare
 * `.maybeSingle()`, discarded the PGRST116 error (only `data` was destructured)
 * and silently dropped the configured match field on ERP → Zid.
 *
 * It is a scan rather than a unit test on purpose: the bug lives in how each
 * call site *chains* its query, and by definition there is no shared function
 * to call — the whole point is that callers must go through
 * `getEffectiveStandardMappingSettings` instead.
 */
const SRC_DIR = path.join(process.cwd(), 'src')
const FROM_SETTINGS = /\.from\(\s*['"]standard_mapping_settings['"]\s*\)/g

/**
 * The chained-call window for one `.from(...)`: everything up to the first line
 * that is not a continuation (does not start with `.`). The codebase omits
 * semicolons, so a newline boundary is the only reliable end of the chain.
 */
function settingsChainAt(source: string, index: number): string {
  const rest = source.slice(index)
  const boundary = rest.search(/\n(?!\s*\.)/)
  return boundary === -1 ? rest : rest.slice(0, boundary)
}

/**
 * Documented exceptions — reads that deliberately span EVERY store of a
 * workspace rather than resolving one store's row. Keep this list short.
 */
const UNSCOPED_READ_ALLOWLIST: Array<{ file: string; anchor: string; because: string }> = [
  {
    file: 'inventory-sync-settings.ts',
    anchor: 'sync_enabled === true',
    because:
      'isInventorySyncActive() ORs across every store row by design: a store may enable its own push while the platform default stays off.',
  },
]

function collectSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

function findUnscopedSettingsReads(sources: Array<{ file: string; source: string }>) {
  const found: Array<{ file: string; chain: string }> = []
  for (const { file, source } of sources) {
    const relative = path.relative(SRC_DIR, file).split(path.sep).join('/')
    for (const match of source.matchAll(FROM_SETTINGS)) {
      const chain = settingsChainAt(source, match.index!)
      // Only reads are the leak class. Upserts/updates name their key (or target
      // a primary key) explicitly, so they cannot silently return store #1.
      if (!/\.select\(/.test(chain)) continue
      if (/store_id/.test(chain)) continue
      const wide = source.slice(match.index!, match.index! + 700)
      const allowed = UNSCOPED_READ_ALLOWLIST.find(
        (a) => relative.endsWith(a.file) && wide.includes(a.anchor)
      )
      if (allowed) continue
      found.push({ file: relative, chain: chain.replace(/\s+/g, ' ').trim() })
    }
  }
  return found
}

describe('the unscoped-read scanner itself (these pins are not vacuous)', () => {
  const asSources = (source: string, file = 'x.ts') => [{ file: path.join(SRC_DIR, file), source }]

  it('flags a bare unscoped read', () => {
    const bare = [
      'const { data } = await supabase',
      "  .from('standard_mapping_settings')",
      "  .select('settings')",
      '  .eq(\'workspace_id\', workspaceId)',
      "  .eq('store_type', 'zid')",
      "  .eq('entity_type', 'products')",
      '  .maybeSingle()',
      '',
    ].join('\n')
    expect(findUnscopedSettingsReads(asSources(bare))).toHaveLength(1)
  })

  it('accepts a store-scoped read', () => {
    const scoped = [
      'const { data } = await supabase',
      "  .from('standard_mapping_settings')",
      "  .select('store_id, settings')",
      '  .eq(\'workspace_id\', workspaceId)',
      "  .eq('store_type', 'zid')",
      "  .eq('entity_type', 'products')",
      "  .in('store_id', [storeId, ''])",
      '',
    ].join('\n')
    expect(findUnscopedSettingsReads(asSources(scoped))).toEqual([])
  })

  it('ignores upserts and updates (not the leak class)', () => {
    const write = [
      'await supabase',
      "  .from('standard_mapping_settings')",
      '  .update({ settings })',
      "  .eq('id', existing.id)",
      '',
    ].join('\n')
    expect(findUnscopedSettingsReads(asSources(write))).toEqual([])
  })

  it('honours the documented any-store allowlist', () => {
    const anyStore = [
      "const { data } = await supabase",
      "  .from('standard_mapping_settings')",
      "  .select('settings')",
      "  .eq('workspace_id', workspaceId)",
      "  .eq('store_type', storeType)",
      "  .eq('entity_type', 'products')",
      'return (data ?? []).some(r => r.sync_enabled === true)',
      '',
    ].join('\n')
    expect(findUnscopedSettingsReads(asSources(anyStore, 'inventory-sync-settings.ts'))).toEqual([])
    // …and the same source under any other file is a violation.
    expect(findUnscopedSettingsReads(asSources(anyStore, 'other.ts'))).toHaveLength(1)
  })
})

describe('every standard_mapping_settings read in src is store-scoped', () => {
  const sources = collectSourceFiles(SRC_DIR).map((file) => ({
    file,
    source: fs.readFileSync(file, 'utf8'),
  }))

  it('actually scans the real reader call sites', () => {
    let reads = 0
    for (const { source } of sources) {
      for (const match of source.matchAll(FROM_SETTINGS)) {
        if (/\.select\(/.test(settingsChainAt(source, match.index!))) reads++
      }
    }
    // The floor is deliberately below the real count: it exists only to fail if
    // the scan degrades into matching nothing.
    expect(reads).toBeGreaterThanOrEqual(8)
  })

  it('has no unscoped reader', () => {
    expect(findUnscopedSettingsReads(sources)).toEqual([])
  })

  it('the Odoo ingress route delegates instead of hand-rolling the read', () => {
    const route = fs.readFileSync(
      path.join(SRC_DIR, 'app/api/webhooks/odoo/route.ts'),
      'utf8'
    )
    expect(route).not.toMatch(FROM_SETTINGS)
    expect(route).toMatch(/getEffectiveStandardMappingSettings\(/)
  })
})
