import {
  allPlatformIdFieldNames,
  PLATFORM_ID_FIELDS,
  pickExistingIdField,
  platformIdField,
  platformIdFieldNames,
  platformLegacyIdField,
  toPlatformKey,
  type PlatformKey,
} from '@/lib/platform-fields'

/**
 * Stage 1 of the platform code split. These accessors replace inlined
 * `x_<platform>_id` / `<platform>_id` tables that were copy-pasted into ~15
 * places across three engines.
 *
 * The tests exist for two reasons, not one:
 *
 *  1. The table itself is trivial, but it is the *resolution order* that the
 *     sync engine depends on to avoid creating duplicate Odoo records.
 *     `current` must always win over `legacy`; inverted, an Odoo instance with
 *     both columns would re-match the wrong one and duplicate products.
 *
 *  2. Each accessor's contract differs, and call sites were only routed here
 *     where the contract matched exactly. `platformIdField` has no fallback,
 *     `platformIdFieldNames` returns both, `pickExistingIdField` may return
 *     undefined. A caller that expects one and gets another silently stops
 *     matching records, so the boundaries are pinned.
 *
 * Source under test: src/lib/platform-fields.ts
 */

const PLATFORMS: readonly PlatformKey[] = ['zid', 'salla', 'shopify']

describe('PLATFORM_ID_FIELDS', () => {
  it('pins the exact column names — renaming a column is a data migration', () => {
    expect(PLATFORM_ID_FIELDS).toEqual({
      zid: { current: 'x_zid_id', legacy: 'zid_id' },
      salla: { current: 'x_salla_id', legacy: 'salla_id' },
      shopify: { current: 'x_shopify_id', legacy: 'shopify_id' },
    })
  })

  it('uses the x_ prefix for current and the bare name for legacy', () => {
    for (const platform of PLATFORMS) {
      const { current, legacy } = PLATFORM_ID_FIELDS[platform]
      expect(current).toBe(`x_${platform}_id`)
      expect(legacy).toBe(`${platform}_id`)
    }
  })

  it('keeps current and legacy distinct for every platform', () => {
    for (const platform of PLATFORMS) {
      const { current, legacy } = PLATFORM_ID_FIELDS[platform]
      expect(current).not.toBe(legacy)
    }
  })
})

describe('platformIdField', () => {
  it('returns the current column', () => {
    expect(platformIdField('zid')).toBe('x_zid_id')
    expect(platformIdField('salla')).toBe('x_salla_id')
    expect(platformIdField('shopify')).toBe('x_shopify_id')
  })

  it('never returns a legacy column — it has no fallback by contract', () => {
    // Callers converted to this helper are the ones that deliberately have no
    // legacy path (e.g. the BoM component lookup). Returning `legacy` here
    // would change which column gets read.
    for (const platform of PLATFORMS) {
      expect(platformIdField(platform)).not.toBe(platformLegacyIdField(platform))
    }
  })
})

describe('platformLegacyIdField', () => {
  it('returns the pre-rename column', () => {
    expect(platformLegacyIdField('zid')).toBe('zid_id')
    expect(platformLegacyIdField('salla')).toBe('salla_id')
    expect(platformLegacyIdField('shopify')).toBe('shopify_id')
  })
})

describe('platformIdFieldNames', () => {
  it('returns [current, legacy] in resolution order', () => {
    expect(platformIdFieldNames('zid')).toEqual(['x_zid_id', 'zid_id'])
    expect(platformIdFieldNames('salla')).toEqual(['x_salla_id', 'salla_id'])
    expect(platformIdFieldNames('shopify')).toEqual(['x_shopify_id', 'shopify_id'])
  })

  it('always leads with the current column', () => {
    for (const platform of PLATFORMS) {
      expect(platformIdFieldNames(platform)[0]).toBe(platformIdField(platform))
      expect(platformIdFieldNames(platform)[1]).toBe(platformLegacyIdField(platform))
    }
  })
})

describe('allPlatformIdFieldNames', () => {
  it('reproduces the literal it replaced, in the same order', () => {
    // The two call sites did `list.includes(field)`, so the multiset must
    // match exactly. Order is preserved anyway because the literal was
    // per-platform pairs in this sequence.
    expect(allPlatformIdFieldNames()).toEqual([
      'x_zid_id',
      'zid_id',
      'x_salla_id',
      'salla_id',
      'x_shopify_id',
      'shopify_id',
    ])
  })

  it('has no duplicates and covers every platform', () => {
    const all = allPlatformIdFieldNames()
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(PLATFORMS.length * 2)
  })

  it('contains both columns of every platform', () => {
    const all = allPlatformIdFieldNames()
    for (const platform of PLATFORMS) {
      expect(all).toContain(platformIdField(platform))
      expect(all).toContain(platformLegacyIdField(platform))
    }
  })
})

describe('toPlatformKey', () => {
  it('passes through the three known platforms', () => {
    expect(toPlatformKey('zid')).toBe('zid')
    expect(toPlatformKey('salla')).toBe('salla')
    expect(toPlatformKey('shopify')).toBe('shopify')
  })

  it('defaults unknown, empty and missing values to zid', () => {
    // Matches the historical `salla ? … : shopify ? … : 'x_zid_id'` ternary.
    // Returning undefined would silently stop those callers matching records.
    expect(toPlatformKey('woocommerce')).toBe('zid')
    expect(toPlatformKey('')).toBe('zid')
    expect(toPlatformKey(null)).toBe('zid')
    expect(toPlatformKey(undefined)).toBe('zid')
  })

  it('is case-sensitive, as the ternary was', () => {
    expect(toPlatformKey('Salla')).toBe('zid')
    expect(toPlatformKey('SHOPIFY')).toBe('zid')
  })

  it('composes with platformIdField to reproduce the old default', () => {
    expect(platformIdField(toPlatformKey('salla'))).toBe('x_salla_id')
    expect(platformIdField(toPlatformKey('shopify'))).toBe('x_shopify_id')
    expect(platformIdField(toPlatformKey('anything-else'))).toBe('x_zid_id')
  })
})

describe('pickExistingIdField', () => {
  it('prefers current when the instance has it', () => {
    const fields = new Set(['x_zid_id', 'zid_id'])
    expect(pickExistingIdField(fields, 'zid')).toBe('x_zid_id')
  })

  it('falls back to legacy when current is absent', () => {
    expect(pickExistingIdField(new Set(['zid_id']), 'zid')).toBe('zid_id')
  })

  it('returns undefined when the instance has neither', () => {
    // The caller then skips the search entirely. Returning a name that does
    // not exist would make Odoo raise instead of quietly moving on.
    expect(pickExistingIdField(new Set(['name']), 'zid')).toBeUndefined()
    expect(pickExistingIdField(new Set([]), 'shopify')).toBeUndefined()
  })

  it('ignores the other platforms’ columns', () => {
    // A res.partner with only x_salla_id must not be searched for a Zid id.
    expect(pickExistingIdField(new Set(['x_salla_id', 'salla_id']), 'zid')).toBeUndefined()
    expect(pickExistingIdField(new Set(['x_zid_id', 'zid_id']), 'salla')).toBeUndefined()
  })

  it('never returns a field that is absent from the set', () => {
    const fields = new Set(['name', 'x_shopify_id'])
    const picked = pickExistingIdField(fields, 'shopify')
    expect(picked).toBeDefined()
    expect(fields.has(picked!)).toBe(true)
  })

  it('agrees with platformIdFieldNames ordering for every combination', () => {
    // Exhausts the 4 meaningful presence states: both / current only /
    // legacy only / neither.
    for (const platform of PLATFORMS) {
      const [current, legacy] = platformIdFieldNames(platform)
      const other = PLATFORMS.filter((p) => p !== platform).flatMap((p) => platformIdFieldNames(p))

      const both = new Set([current, legacy])
      const currentOnly = new Set([current])
      const legacyOnly = new Set([legacy])
      const neither = new Set([...other, 'name'])

      expect(pickExistingIdField(both, platform)).toBe(current)
      expect(pickExistingIdField(currentOnly, platform)).toBe(current)
      expect(pickExistingIdField(legacyOnly, platform)).toBe(legacy)
      expect(pickExistingIdField(neither, platform)).toBeUndefined()
    }
  })

  it('accepts a Map as well as a Set, because fetchFieldMeta returns one', () => {
    // Regression guard: an earlier signature took ReadonlySet<string> only and
    // broke both sync-engine call sites, which pass a Map<string, meta>.
    const asMap = new Map<string, unknown>([
      ['x_zid_id', { ttype: 'char' }],
      ['zid_id', { ttype: 'char' }],
    ])
    expect(pickExistingIdField(asMap, 'zid')).toBe('x_zid_id')
    expect(pickExistingIdField(new Map([['name', {}]]), 'zid')).toBeUndefined()
  })

  it('accepts a readonly set so callers need not copy', () => {
    const readonly: ReadonlySet<string> = new Set(['x_salla_id'])
    expect(pickExistingIdField(readonly, 'salla')).toBe('x_salla_id')
  })
})
