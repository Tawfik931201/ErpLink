/**
 * odoo_entity_links — durable store→Odoo record links.
 *
 * Problem: after a store webhook (e.g. Salla `order.created`) creates a
 * record in Odoo (sale.order #42), a LATER event (`order.updated` days
 * later) must target that same record. `sync_logs` cannot serve this:
 * success rows are purged after 72h (cleanupExpiredLogs) and its lookup is
 * not store-scoped, so two stores of one workspace with the same order
 * number collide. See supabase/migrations/20261011_odoo_entity_links.sql.
 *
 * Key (never global, always fully scoped):
 *   (workspace_id, platform, store_id, odoo_model, store_entity_id)
 * store_id is the merchant_id (zid/salla) or shop_domain (shopify).
 *
 * Reads are validated by the caller (the engine re-checks the Odoo record
 * still exists via client.search), so a stale link is harmless and rows are
 * permanent — no TTL cache, no in-memory state (a restart must not lose
 * links; there is no Redis on this host).
 *
 * DB access goes through `supabase` from `@/lib/supabase` (service role),
 * the same path every server action uses — and the one the Jest mock
 * replaces, so tests assert on `supabase.calls` without touching a database.
 */

import { supabase } from '@/lib/supabase'

export type EntityLinkPlatform = 'zid' | 'salla' | 'shopify'

export const ENTITY_LINK_PLATFORMS: readonly EntityLinkPlatform[] = ['zid', 'salla', 'shopify']

/**
 * Reserved platform-side field a merchant picks as the match field in
 * Custom Mapping to mean "the Odoo id saved for this record".
 * It never exists in a real webhook payload — the engine intercepts it and
 * resolves it from `odoo_entity_links` instead. Exported from here so the
 * platform field catalogues and the engine cannot drift apart (a unit test
 * pins that every sale.order catalogue carries exactly this value).
 */
export const STORED_ODOO_ID_FIELD = '__odoo_record_id'

export interface EntityLinkKey {
  workspaceId: string
  platform: EntityLinkPlatform
  /** merchant_id (zid/salla) or shop_domain (shopify). */
  storeId: string
  odooModel: string
  /** The store-side entity id (order/product/customer number). */
  storeEntityId: string
}

/** Pure: stable human-readable key for logs. Not a DB key. */
export function buildEntityLinkKey(link: EntityLinkKey): string {
  return `${link.platform}:${link.storeId}:${link.odooModel}:${link.storeEntityId}`
}

/** Pure: entity_type bucket for an Odoo model (mirrors the SQL backfill). */
export function inferEntityType(odooModel: string): string {
  switch (odooModel) {
    case 'sale.order':
      return 'orders'
    case 'product.template':
    case 'product.product':
      return 'products'
    case 'res.partner':
      return 'customers'
    case 'product.category':
      return 'categories'
    case 'account.move':
      return 'invoices'
    default:
      return 'records'
  }
}

function isValidLinkInput(
  link: EntityLinkKey,
  odooRecordId: unknown
): odooRecordId is number {
  if (!link.workspaceId || !link.storeId || !link.odooModel || !link.storeEntityId) return false
  if (!(ENTITY_LINK_PLATFORMS as readonly string[]).includes(link.platform)) return false
  const id = Number(odooRecordId)
  return Number.isInteger(id) && id > 0
}

/**
 * Remember (or refresh) the link store-entity → Odoo record.
 * Best-effort by design: a link-write failure must never fail the sync
 * itself. Never throws — returns false when skipped or failed.
 */
export async function upsertEntityLink(
  link: EntityLinkKey,
  odooRecordId: number | string
): Promise<boolean> {
  try {
    if (!isValidLinkInput(link, odooRecordId)) return false
    const id = Number(odooRecordId)
    const { error } = await supabase.from('odoo_entity_links').upsert(
      {
        workspace_id: link.workspaceId,
        platform: link.platform,
        store_id: link.storeId,
        entity_type: inferEntityType(link.odooModel),
        store_entity_id: String(link.storeEntityId),
        odoo_model: link.odooModel,
        odoo_record_id: id,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'workspace_id,platform,store_id,odoo_model,store_entity_id',
      }
    )
    if (error) {
      console.warn(`[EntityLinks] upsert failed for ${buildEntityLinkKey(link)}:`, error.message?.slice(0, 150))
      return false
    }
    return true
  } catch (err) {
    console.warn(`[EntityLinks] upsert exception for ${buildEntityLinkKey(link)}:`, err instanceof Error ? err.message.slice(0, 150) : err)
    return false
  }
}

/**
 * Resolve the saved Odoo id for a store entity, fully scoped.
 * Returns null when there is no link OR when the input is not fully
 * scoped — an unscoped lookup would risk returning another store's record,
 * so it refuses instead of guessing. Never throws.
 */
export async function resolveEntityLinkId(link: EntityLinkKey): Promise<number | null> {
  try {
    if (!link.workspaceId || !link.storeId || !link.odooModel || !link.storeEntityId) return null
    if (!(ENTITY_LINK_PLATFORMS as readonly string[]).includes(link.platform)) return null
    const { data, error } = await supabase
      .from('odoo_entity_links')
      .select('odoo_record_id')
      .eq('workspace_id', link.workspaceId)
      .eq('platform', link.platform)
      .eq('store_id', link.storeId)
      .eq('odoo_model', link.odooModel)
      .eq('store_entity_id', String(link.storeEntityId))
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    const id = Number((data as { odoo_record_id: unknown }).odoo_record_id)
    return Number.isInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}
