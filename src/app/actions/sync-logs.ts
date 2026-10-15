'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { SHOPIFY_TOPIC_CATALOG } from '@/lib/shopify-topics'
import { supabase } from '@/lib/supabase'
import { processSingleMapping } from '@/lib/sync-engine'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'

async function getOrCreateDbUser() {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')

  const dbUser = await ensureDbUser(userId)
  return dbUser
}

// Shape of a sync_logs row as the list endpoints return it.
// The PostgREST select-string type parser cannot infer the lean column list,
// so rows are normalized through this interface at the return site instead
// of leaking the parser's error type to callers.
export interface SyncLogRow {
  id: string
  event: string | null
  status: string | null
  error_message: string | null
  store_id: string | null
  zid_entity_id: string | null
  odoo_model: string | null
  odoo_record_id: number | string | null
  field_mapping_id: string | null
  trigger_type: string | null
  created_at: string | null
  resolved_manually: boolean | null
  payload?: unknown
  field_mappings: { name: string } | null
}

// Entity → event names, shared by the workspace logs page. Platform is NOT a
// sync_logs column, so both the platform filter below and this entity filter
// resolve to event lists; when both are set PostgREST ANDs the two IN lists,
// which is exactly the platform∩entity intersection.
const ENTITY_EVENTS: Record<string, string[]> = {
  product: [
    'product.create', 'product.update', 'product.delete', 'product.publish',
    'product.created', 'product.updated', 'product.deleted', 'product.available',
    'product.quantity.low', 'product.channels.changed', 'product.review.added', 'product.review.updated',
    'products/create', 'products/update', 'products/delete',
  ],
  order: [
    'order.create', 'order.status.update', 'order.payment_status.update', 'order.reversed',
    'order.created', 'order.updated', 'order.status.updated', 'order.cancelled',
    'order.refunded', 'order.deleted', 'order.payment.updated', 'order.coupon.updated',
    'order.total.price.updated', 'order.products.updated', 'order.customer.updated',
    'order.shipping.address.updated',
    'order.shipment.creating', 'order.shipment.created', 'order.shipment.cancelled',
    'order.shipment.return.creating', 'order.shipment.return.created', 'order.shipment.return.cancelled',
    'orders/create', 'orders/updated', 'orders/cancelled', 'orders/fulfilled',
    'orders/paid', 'orders/partially_fulfilled', 'orders/edited', 'orders/delete',
  ],
  customer: [
    'customer.create', 'customer.update', 'customer.merchant.update',
    'customer.created', 'customer.updated', 'customer.login',
    'customers/create', 'customers/update', 'customers/delete',
  ],
  category: [
    'category.create', 'category.update', 'category.delete',
    'category.created', 'category.updated', 'category.deleted',
    'collections/create', 'collections/update', 'collections/delete',
  ],
}

export async function getSyncLogs(params: {
  mappingId?: string
  status?: string
  limit?: number
  offset?: number
  platform?: string
  /** Multi-store: filter to these store keys (merchant_id / shop_domain / zid store_id). */
  storeIds?: string[]
  eventFilter?: string
  entity?: string
  entityId?: string
  lean?: boolean
}) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, logs: [], totalCount: 0 }
    }

    // NOTE: no per-fetch purge here — the queue runner already purges hourly
    // (maybeCleanup) plus every drain. A background DELETE on every list view
    // only adds write contention to the read path.

    // Lean list mode (workspace logs page): explicit columns WITHOUT the heavy
    // `payload` JSON, so listing stays fast. Full mode keeps `*` for the
    // mapping-center modal, which renders the expandable payload view.
    const baseSelect = params.lean
      ? 'id,event,status,error_message,store_id,zid_entity_id,odoo_model,odoo_record_id,field_mapping_id,trigger_type,created_at,resolved_manually,field_mappings(name)'
      : '*, field_mappings(name)'

    // We want to fetch the logs and join with field_mappings if possible to get mapping names.
    // If field_mappings table has name, we can select it.
    let query = supabase
      .from('sync_logs')
      .select(baseSelect, { count: 'exact' })
      .eq('workspace_id', user.active_workspace_id)
      .order('created_at', { ascending: false })

    if (params.mappingId && params.mappingId !== 'all') {
      if (params.mappingId === 'none') {
        return { success: true, logs: [], totalCount: 0 }
      }
      const mappingIds = params.mappingId.split(',')
      if (mappingIds.length > 0) {
        query = query.in('field_mapping_id', mappingIds)
      }
    }

    if (params.platform && params.platform !== 'all') {
      // Single source of truth (src/lib/shopify-topics.ts) — a hardcoded subset
      // silently hides logs (collections/*, customers/delete, carts, inventory,
      // refunds…) from the platform filter.
      const shopifyEvents: string[] = [...SHOPIFY_TOPIC_CATALOG]

      const sallaEvents = [
        // Products
        'product.created', 'product.updated', 'product.deleted', 'product.available',
        'product.quantity.low', 'product.channels.changed', 'product.review.added', 'product.review.updated',
        // Orders
        'order.created', 'order.updated', 'order.status.updated', 'order.cancelled',
        'order.refunded', 'order.deleted', 'order.payment.updated', 'order.coupon.updated',
        'order.total.price.updated', 'order.products.updated', 'order.customer.updated',
        'order.shipping.address.updated',
        // Shipments
        'order.shipment.creating', 'order.shipment.created', 'order.shipment.cancelled',
        'order.shipment.return.creating', 'order.shipment.return.created', 'order.shipment.return.cancelled',
        // Customers
        'customer.created', 'customer.updated', 'customer.login',
        // Categories
        'category.created', 'category.updated', 'category.deleted',
        // Branches
        'store.branch.created', 'store.branch.updated', 'store.branch.deleted',
        // Store
        'store.settings.updated',
        // Carts
        'abandoned.cart', 'abandoned.cart.update', 'abandoned.cart.purchased',
        // Coupons
        'coupon.applied', 'coupon.applied.v2',
        // Brands
        'brand.created', 'brand.updated', 'brand.deleted',
        // Special Offers
        'special.offer.created', 'special.offer.updated', 'special.offer.deleted',
        // App events
        'app.installed', 'app.updated', 'app.uninstalled', 'app.store.authorize',
        'app.trial.started', 'app.trial.expired', 'app.subscription.started', 'app.settings.updated',
      ]

      const zidEvents = [
        'product.create', 'product.update', 'product.delete', 'product.publish',
        'order.create', 'order.status.update', 'order.payment_status.update',
        'customer.create', 'customer.update', 'customer.merchant.update',
        'category.create', 'category.update', 'category.delete',
        'cart.abandoned'
      ]

      const platforms = params.platform.split(',')
      const allowedEvents: string[] = []

      if (platforms.includes('salla')) {
        allowedEvents.push(...sallaEvents)
      }
      if (platforms.includes('zid')) {
        allowedEvents.push(...zidEvents)
      }
      if (platforms.includes('shopify')) {
        allowedEvents.push(...shopifyEvents)
      }

      if (platforms.includes('none') || allowedEvents.length === 0) {
        query = query.eq('id', '00000000-0000-0000-0000-000000000000')
      } else {
        query = query.in('event', allowedEvents)
      }
    }
    
    if (params.storeIds && params.storeIds.length > 0) {
      // Direct store filter (workspace logs page): sync_logs.store_id holds
      // the merchant key (merchant_id / shop_domain / zid store_id) per row.
      query = query.in('store_id', params.storeIds)
    }

    if (params.eventFilter) {
      const entityEvents: Record<string, string[]> = {
        category: [
          'category.create', 'category.update', 'category.delete',
          'category.created', 'category.updated', 'category.deleted',
          'collections/create', 'collections/update', 'collections/delete',
        ],
      }
      const filters = params.eventFilter.split(',')
      const matchedEvents: string[] = []
      for (const f of filters) {
        const events = entityEvents[f.trim()]
        if (events) matchedEvents.push(...events)
      }
      if (matchedEvents.length > 0) {
        query = query.in('event', matchedEvents)
      }
    }

    if (params.entity && params.entity !== 'all') {
      const entityEvents = ENTITY_EVENTS[params.entity]
      if (entityEvents) {
        query = query.in('event', entityEvents)
      }
    }

    if (params.entityId && params.entityId.trim() !== '') {
      // Exact match on the store-side entity id — served by the
      // idx_sync_logs_match(workspace_id, zid_entity_id, ...) prefix.
      query = query.eq('zid_entity_id', params.entityId.trim())
    }

    if (params.status && params.status !== 'all') {
      // Boolean-based branches (resolved_manually column) — every branch is a
      // plain btree predicate served by idx_sync_logs_workspace_status_created
      // or the partial resolved index. No ilike text scans anywhere.
      // NOTE: a top-level .or() is ANDed with the other filters by PostgREST,
      // so all wanted statuses must live inside ONE or() call.
      const selectedTypes = params.status.split(',')
      const wantSuccess = selectedTypes.includes('success')
      const wantManual = selectedTypes.includes('manual')
      const wantFailed = selectedTypes.includes('failed')
      const wantSkipped = selectedTypes.includes('skipped')

      const branches: string[] = []
      if (wantSuccess && wantManual) {
        branches.push('status.eq.success')
      } else {
        if (wantSuccess) branches.push('and(status.eq.success,resolved_manually.eq.false)')
        if (wantManual) branches.push('resolved_manually.eq.true')
      }
      if (wantFailed) branches.push('status.eq.failed')
      if (wantSkipped) branches.push('status.eq.skipped')

      if (branches.length > 0 && branches.length < 4) {
        query = query.or(branches.join(','))
      } else if (branches.length === 0) {
        // If nothing is selected, force query to return no results
        query = query.eq('id', '00000000-0000-0000-0000-000000000000')
      }
    }

    const limit = params.limit || 20
    const offset = params.offset || 0
    query = query.range(offset, offset + limit - 1)

    const { data: logs, count, error } = await query

    if (error) throw new Error('Failed to query sync logs: ' + error.message)

    return {
      success: true,
      logs: (logs || []) as unknown as SyncLogRow[],
      totalCount: count || 0
    }
  } catch (error: any) {
    console.error('[Sync Logs Action] getSyncLogs failed:', error)
    return { success: false, error: error.message || 'Failed to fetch sync logs' }
  }
}

// Single-row detail fetch (Odoo-style form view): full row WITH the heavy
// `payload` JSON. The list stays lean; only the opened record pays for it.
export async function getSyncLogById(logId: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    const { data: log, error } = await supabase
      .from('sync_logs')
      .select('*, field_mappings(name)')
      .eq('id', logId)
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (error) throw new Error('Failed to fetch log: ' + error.message)
    if (!log) throw new Error('Sync log not found')

    return { success: true, log: log as unknown as SyncLogRow }
  } catch (error: any) {
    console.error('[Sync Logs Action] getSyncLogById failed:', error)
    return { success: false, error: error.message || 'Failed to fetch sync log' }
  }
}

export async function getSyncLogStats() {  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, stats: { total: 0, success: 0, failed: 0, manual: 0, skipped: 0 } }
    }

    // Head-only counts (no rows transferred) in a single parallel batch.
    // `manual` = rows the merchant marked as resolved by hand (boolean flag).
    // Every count is a plain btree predicate — no ilike text scans.
    const ws = user.active_workspace_id
    const base = () =>
      supabase.from('sync_logs').select('id', { count: 'exact', head: true }).eq('workspace_id', ws)

    const [total, success, failed, manual, skipped] = await Promise.all([
      base(),
      base().eq('status', 'success').eq('resolved_manually', false),
      base().eq('status', 'failed'),
      base().eq('resolved_manually', true),
      base().eq('status', 'skipped'),
    ])

    for (const r of [total, success, failed, manual, skipped]) {
      if (r.error) throw new Error('Failed to count sync logs: ' + r.error.message)
    }

    return {
      success: true,
      stats: {
        total: total.count || 0,
        success: success.count || 0,
        failed: failed.count || 0,
        manual: manual.count || 0,
        skipped: skipped.count || 0,
      },
    }
  } catch (error: any) {
    console.error('[Sync Logs Action] getSyncLogStats failed:', error)
    return { success: false, error: error.message || 'Failed to fetch sync stats' }
  }
}

export async function retrySyncLog(logId: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    // 1. Fetch log — lean columns only (the fields re-run below needs).
    const { data: log, error: logErr } = await supabase
      .from('sync_logs')
      .select('id,event,store_id,payload,field_mapping_id')
      .eq('id', logId)
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (logErr) throw new Error('Failed to fetch log: ' + logErr.message)
    if (!log) throw new Error('Sync log not found')

    // 2. Fetch field mapping
    const { data: mapping, error: mapErr } = await supabase
      .from('field_mappings')
      .select('*')
      .eq('id', log.field_mapping_id)
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (mapErr) throw new Error('Failed to fetch field mapping: ' + mapErr.message)
    if (!mapping) throw new Error('المطابقة الخاصة بهذا السجل تم حذفها ولا يمكن إعادة إرسالها (Associated field mapping was deleted)')

    // 3. Re-run mapping
    const result = await processSingleMapping(
      mapping,
      log.event,
      log.store_id,
      log.payload || {},
      'manual', // triggerType
      logId // existingLogId
    )

    revalidatePath('/app/mapping-center')
    revalidatePath('/app/logs')

    return {
      success: true,
      status: result.status,
      message: result.message || 'تمت إعادة معالجة المزامنة بنجاح (Sync retry completed)'
    }
  } catch (error: any) {
    console.error('[Sync Logs Action] retrySyncLog failed:', error)
    return { success: false, error: error.message || 'Failed to retry sync' }
  }
}

export async function resolveLogManually(logId: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    const { error } = await supabase
      .from('sync_logs')
      .update({
        status: 'success',
        error_message: 'Resolved manually in Odoo / تم الحل يدويًا في أودو',
        trigger_type: 'manual',
        resolved_manually: true
      })
      .eq('id', logId)
      .eq('workspace_id', user.active_workspace_id)
      .select()
      .maybeSingle()

    if (error) {
      throw new Error('Failed to resolve log: ' + error.message)
    }

    revalidatePath('/app/mapping-center')
    revalidatePath('/app/logs')

    return {
      success: true,
      message: 'تم تعيين السجل كمحلول يدويًا بنجاح (Log marked as manually resolved)'
    }
  } catch (error: any) {
    console.error('[Sync Logs Action] resolveLogManually failed:', error)
    return { success: false, error: error.message || 'Failed to resolve log manually' }
  }
}
