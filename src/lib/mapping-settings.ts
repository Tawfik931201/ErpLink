/**
 * Standard-Mapping settings — the ONE place that answers "which settings apply
 * to THIS store?".
 *
 * `standard_mapping_settings` is keyed by
 *   (workspace_id, store_type, store_id, entity_type)
 * where `store_id` is the merchant key: `merchant_id` for zid/salla and
 * `shop_domain` for shopify. The empty string `''` is the platform default.
 *
 * Every reader must resolve the effective row for the store it is syncing:
 * per-store row first, `''` only as a fallback. A bare
 * `.eq('workspace_id', ...).eq('store_type', ...).eq('entity_type', ...)`
 * silently returns the FIRST row — the platform default — so a workspace with
 * two connected stores applies store #1's page to store #2. Worse, `.maybeSingle()`
 * on that query throws (PostgREST PGRST116, "contains N rows") once both the
 * default and a per-store row exist, and the caller swallows it into defaults.
 *
 * Two conventions this module fixes across the engine:
 *   1. `store_id` is TEXT. Compare with `String(...)` on both sides — a numeric
 *      caller (`r.store_id === storeId`) never matches and always falls back.
 *   2. Zid deliveries may carry the numeric `store_id`; the settings row is
 *      keyed by `merchant_id`. `resolveSettingsStoreKey` translates it via the
 *      token row.
 *
 * The client is injected (any thin `{ from(table) }` wrapper) so this file has
 * no dependency on which Supabase client a module happens to hold, and so the
 * resolution logic is unit-testable without a database.
 */

// The literal members give editor autocomplete; the last arm keeps the type
// open so a new platform does not require a code change here. Deliberately
// `Record<never, never>` rather than `{}` (which the lint rule bans).
export type MappingStoreType = 'zid' | 'salla' | 'shopify' | (string & Record<never, never>)

/** Minimal shape of the Supabase client used here — anything query-builder-like. */
export interface SettingsClient {
  from: (table: string) => any
}

/**
 * Canonical string form of a store key. `undefined`/`null` → `''` (the platform
 * default), numbers are stringified so a numeric caller cannot miss a TEXT
 * column, and surrounding whitespace is trimmed.
 */
export function normalizeSettingsStoreKey(storeKey?: string | number | null): string {
  if (storeKey === undefined || storeKey === null) return ''
  return String(storeKey).trim()
}

/**
 * Translate a delivery's store key to the key the settings rows use.
 *
 * Only Zid needs it: its deliveries identify the store by the numeric
 * `store_id`, while the Mapping Center writes rows under `merchant_id`.
 * Salla/Shopify already arrive keyed by merchant / shop domain.
 */
export async function resolveSettingsStoreKey(
  client: SettingsClient,
  storeType: MappingStoreType,
  storeKey?: string | number | null
): Promise<string> {
  const key = normalizeSettingsStoreKey(storeKey)
  if (!key) return ''
  if (storeType !== 'zid') return key
  if (!/^\d+$/.test(key)) return key

  try {
    // store_id first, then merchant_id — a single `.or(...)` can match two
    // different rows and make `maybeSingle` fail or pick arbitrarily.
    const byStore = await client
      .from('merchant_tokens')
      .select('merchant_id')
      .eq('store_id', key)
      .maybeSingle()
    const byStoreMerchant = (byStore?.data as { merchant_id?: unknown } | null)?.merchant_id
    if (!byStore?.error && byStoreMerchant) return String(byStoreMerchant)

    const byMerchant = await client
      .from('merchant_tokens')
      .select('merchant_id')
      .eq('merchant_id', key)
      .maybeSingle()
    const merchant = (byMerchant?.data as { merchant_id?: unknown } | null)?.merchant_id
    return merchant ? String(merchant) : key
  } catch {
    return key
  }
}

/**
 * Effective settings object for one store + entity: the per-store row when it
 * exists, otherwise the platform default (`''`), otherwise `null`.
 */
export async function getEffectiveStandardMappingSettings(
  client: SettingsClient,
  workspaceId: string,
  storeType: MappingStoreType,
  entityType: string,
  storeKey?: string | number | null
): Promise<Record<string, any> | null> {
  if (!workspaceId) return null
  // Resolve first: a Zid delivery may carry the numeric store_id while the row
  // is keyed by merchant_id. Idempotent for a key that is already a merchant.
  const key = await resolveSettingsStoreKey(client, storeType, storeKey)

  const { data, error } = await client
    .from('standard_mapping_settings')
    .select('store_id, settings')
    .eq('workspace_id', workspaceId)
    .eq('store_type', storeType)
    .eq('entity_type', entityType)
    .in('store_id', key ? [key, ''] : [''])

  if (error) throw error

  const rows = (data ?? []) as Array<{ store_id: string; settings: unknown }>
  const hit =
    rows.find((r) => (r.store_id || '') === key) ??
    rows.find((r) => (r.store_id || '') === '')
  return (hit?.settings as Record<string, any>) || null
}
