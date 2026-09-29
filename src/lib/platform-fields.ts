/**
 * The single source of truth for "which Odoo column holds the store-side ID".
 *
 * Every platform has a `current` column (`x_<platform>_id`) and a `legacy`
 * column (`<platform>_id`) used by Odoo instances that predate the rename.
 * Resolution order is always `current` first, then `legacy`, then nothing.
 *
 * This module exists because that table was inlined into ~15 places across
 * three engines, each copy slightly different. Only call sites that were
 * provably identical were routed here — see the "deliberately not unified"
 * notes in `sync-engine.ts` and `erpnext-engine.ts` before "simplifying"
 * anything else, because several of those copies differ on purpose.
 *
 * Adding a platform is a one-line change to PLATFORM_ID_FIELDS.
 */

export type PlatformKey = 'zid' | 'salla' | 'shopify'

export const PLATFORM_ID_FIELDS = {
  zid: { current: 'x_zid_id', legacy: 'zid_id' },
  salla: { current: 'x_salla_id', legacy: 'salla_id' },
  shopify: { current: 'x_shopify_id', legacy: 'shopify_id' },
} as const satisfies Record<PlatformKey, { current: string; legacy: string }>

/** Declaration order is load-bearing: see `allPlatformIdFieldNames`. */
const PLATFORM_ORDER: readonly PlatformKey[] = ['zid', 'salla', 'shopify']

/** The preferred column. Use when the caller needs one name, no fallback. */
export function platformIdField(platform: PlatformKey): string {
  return PLATFORM_ID_FIELDS[platform].current
}

/** The pre-rename column. Only useful as an explicit second choice. */
export function platformLegacyIdField(platform: PlatformKey): string {
  return PLATFORM_ID_FIELDS[platform].legacy
}

/** `[current, legacy]` — both candidates, in resolution order. */
export function platformIdFieldNames(platform: PlatformKey): readonly [string, string] {
  const { current, legacy } = PLATFORM_ID_FIELDS[platform]
  return [current, legacy]
}

/**
 * Every platform's pair, flattened: `['x_zid_id','zid_id','x_salla_id',
 * 'salla_id','x_shopify_id','shopify_id']`. This is the exact literal that was
 * duplicated at the two call sites, so membership tests behave identically.
 */
export function allPlatformIdFieldNames(): string[] {
  return PLATFORM_ORDER.flatMap(platformIdFieldNames)
}

/**
 * Narrows a loosely-typed platform string (DB rows, request payloads) to a
 * PlatformKey.
 *
 * The `'zid'` default is deliberate and load-bearing: call sites that stored
 * `platform: string` resolved `salla ? x_salla_id : shopify ? x_shopify_id :
 * x_zid_id`, so any unrecognised or empty value already resolved to the Zid
 * column. Returning `undefined` here instead would make those callers fail to
 * match anything, which is a behaviour change.
 */
export function toPlatformKey(value: string | null | undefined): PlatformKey {
  return value === 'salla' || value === 'shopify' ? value : 'zid'
}

/**
 * Anything with a `has()` lookup. `fetchFieldMeta` returns a
 * `Map<string, OdooFieldMeta>` while the ERPNext helper returns a
 * `Set<string>`; both are accepted so no call site has to copy or convert.
 */
export interface FieldPresence {
  has(key: string): boolean
}

/**
 * Resolves to `current` when the Odoo instance has it, else `legacy`, else
 * `undefined` so the caller can skip. Replaces the `if (has(x_...)) ... else
 * if (has(...))` chains.
 */
export function pickExistingIdField(
  fields: FieldPresence,
  platform: PlatformKey
): string | undefined {
  const { current, legacy } = PLATFORM_ID_FIELDS[platform]
  if (fields.has(current)) return current
  if (fields.has(legacy)) return legacy
  return undefined
}
