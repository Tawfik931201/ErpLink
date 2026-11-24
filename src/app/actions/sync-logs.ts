'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { isOdooArchiveEnabled, readArchive } from '@/lib/central-odoo-archive'
import { validateExecutionTarget, withErpTarget } from '@/lib/erp-execution-target'
import { SHOPIFY_TOPIC_CATALOG } from '@/lib/shopify-topics'
import { supabase } from '@/lib/supabase'
import { processSingleMapping, processWebhookEvent } from '@/lib/sync-engine'
import { syncLogSearchFilter } from '@/lib/sync-log-search'
import type { FieldMappingRow } from '@/lib/sync-types'
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
export type StorePlatform = 'zid' | 'salla' | 'shopify'

export interface SyncLogRow {
  id: string
  event: string | null
  status: string | null
  error_message: string | null
  store_id: string | null
  zid_entity_id: string | null
  // Resolved per record (token tables, scoped by workspace) — sync_logs has no
  // platform column, so the list ignores it and only the detail page shows it.
  platform?: StorePlatform | null
  odoo_model: string | null
  odoo_record_id: number | string | null
  field_mapping_id: string | null
  trigger_type: string | null
  created_at: string | null
  resolved_manually: boolean | null
  payload?: unknown
  field_mappings: { name: string } | null
}

/** A valid UUID that no row carries: how "match nothing" is expressed. */
const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'

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
  /**
   * Instant text search on the logs list (`/app/logs`). Matched as a
   * case-insensitive substring on the columns the list can show: `event`,
   * `zid_entity_id`, `odoo_model` and `store_id`.
   */
  search?: string
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
    // `payload` JSON **and without `error_message`**, so listing stays fast.
    // `error_message` can hold a multi-KB stack trace / raw platform response,
    // which is exactly the weight the list does not need — the opened record
    // (`getSyncLogById`) carries it. Full mode keeps `*` for the mapping-center
    // modal, which renders the expandable payload view.
    const baseSelect = params.lean
      ? 'id,event,status,store_id,zid_entity_id,odoo_model,odoo_record_id,field_mapping_id,trigger_type,created_at,resolved_manually,field_mappings(name)'
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
        query = query.eq('id', NO_MATCH_ID)
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

    if (params.search && params.search.trim() !== '') {
      // Instant search box: exact substring match on the generated search_text
      // column (trigram GIN index). Avoids PostgREST or() parser issues with
      // % wildcards. Matches PayloadViewer behaviour: exact substring on
      // concatenated payload + all text fields.
      const searchFilter = syncLogSearchFilter(params.search)

      if (searchFilter.kind === 'empty') {
        // Input was only punctuation: nothing can match it. Returning the whole
        // workspace would look like the search was ignored.
        query = query.eq('id', NO_MATCH_ID)
      } else if (searchFilter.kind === 'match') {
        query = query.filter(searchFilter.column, searchFilter.operator, searchFilter.value)
      }
    }

    if (params.status && params.status !== 'all') {
      // Boolean-based branches (resolved_manually column) — every branch is a
      // plain btree predicate served by idx_sync_logs_workspace_status_created
      // or the partial resolved index. No ilike text scans anywhere.
      const selectedTypes = params.status.split(',')
      const wantSuccess = selectedTypes.includes('success')
      const wantManual = selectedTypes.includes('manual')
      const wantFailed = selectedTypes.includes('failed')
      const wantSkipped = selectedTypes.includes('skipped')
      const wanted = [wantSuccess, wantManual, wantFailed, wantSkipped].filter(Boolean).length

      if (wanted === 0) {
        // If nothing is selected, force query to return no results
        query = query.eq('id', NO_MATCH_ID)
      } else if (wanted === 1) {
        // The logs list only ever asks for one status at a time (the stat chips),
        // so the common case is expressed as plain ANDed predicates. That keeps
        // the search box able to use the single top-level `or` for itself
        // instead of racing a second one — PostgREST's `or` machinery is the
        // one filter shape that is easy to get subtly wrong.
        if (wantSuccess) query = query.eq('status', 'success').eq('resolved_manually', false)
        else if (wantManual) query = query.eq('resolved_manually', true)
        else if (wantFailed) query = query.eq('status', 'failed')
        else query = query.eq('status', 'skipped')
      } else if (wanted < 4) {
        // Multi-status selection only comes from the mapping-center modal, which
        // has no search box. A top-level `.or()` is ANDed with the other
        // filters, so all wanted statuses must live inside ONE call.
        const branches: string[] = []
        if (wantSuccess && wantManual) {
          branches.push('status.eq.success')
        } else {
          if (wantSuccess) branches.push('and(status.eq.success,resolved_manually.eq.false)')
          if (wantManual) branches.push('resolved_manually.eq.true')
        }
        if (wantFailed) branches.push('status.eq.failed')
        if (wantSkipped) branches.push('status.eq.skipped')
        query = query.or(branches.join(','))
      }
      // wanted === 4 means "all statuses" — no predicate at all.
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

// sync_logs has no platform column: `store_id` carries the merchant key, so the
// platform is whatever token table owns that key in this workspace. Shopify is
// a shop domain (has a dot), Zid keys on merchant_id/store_id, Salla on
// merchant_id. Unknown stays null — the UI then shows a neutral label instead
// of guessing a store name.
async function resolveLogPlatform(
  storeId: string | null,
  workspaceId: string
): Promise<StorePlatform | null> {
  if (!storeId) return null
  if (storeId.includes('.')) return 'shopify'

  const key = storeId.replace(/[(),]/g, '')
  if (!key) return null

  const [zid, salla] = await Promise.all([
    supabase
      .from('merchant_tokens')
      .select('merchant_id')
      .eq('workspace_id', workspaceId)
      .or(`merchant_id.eq.${key},store_id.eq.${key}`)
      .limit(1),
    supabase
      .from('salla_tokens')
      .select('merchant_id')
      .eq('workspace_id', workspaceId)
      .eq('merchant_id', key)
      .limit(1),
  ])

  if ((zid.data?.length ?? 0) > 0) return 'zid'
  if ((salla.data?.length ?? 0) > 0) return 'salla'
  return null
}

// Single-row detail fetch (Odoo-style form view): full row WITH the heavy
// `payload` JSON. The list stays lean; only the opened record pays for it.
export async function getSyncLogById(logId: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    // Historical detail reads prefer the copied administrative Odoo archive.
    // The workspace is always derived from the authenticated session, never
    // from the caller, preventing cross-tenant access to centralized records.
    if (isOdooArchiveEnabled()) {
      try {
        const archived = await readArchive<{
          x_source_uuid: string
          x_event_type: string | false
          x_status: string | false
          x_store_id: string | false
          x_platform: string | false
          x_details: string | false
          x_source_created_at: string | false
        }>('event', [
          ['x_source_uuid', '=', logId],
          ['x_source_table', '=', 'sync_logs'],
          ['x_workspace_uuid', '=', user.active_workspace_id],
        ], ['x_source_uuid','x_event_type','x_status','x_store_id','x_platform',
            'x_details','x_source_created_at'], { limit: 1 })
        if (archived.length) {
          const entry = archived[0]
          let details: Record<string, unknown> = {}
          try { details = JSON.parse(entry.x_details || '{}') } catch {}
          const archiveLog: SyncLogRow = {
            id: entry.x_source_uuid,
            event: entry.x_event_type || null,
            status: entry.x_status || null,
            store_id: entry.x_store_id || null,
            platform: (entry.x_platform || null) as StorePlatform | null,
            error_message: typeof details.error === 'string' ? details.error : null,
            payload: details.payload ?? null,
            zid_entity_id: null,
            odoo_model: typeof details.odoo_model === 'string' ? details.odoo_model : null,
            odoo_record_id: typeof details.odoo_record_id === 'number' ? details.odoo_record_id : null,
            field_mapping_id: null,
            trigger_type: null,
            resolved_manually: null,
            created_at: entry.x_source_created_at
              ? new Date(entry.x_source_created_at.replace(' ', 'T') + 'Z').toISOString()
              : null,
            field_mappings: null,
          }
          return { success: true, log: archiveLog }
        }
      } catch (archiveError) {
        console.warn('[logs] central Odoo detail read failed; using Supabase fallback:', archiveError)
      }
    }

    const { data: log, error } = await supabase
      .from('sync_logs')
      .select('*, field_mappings(name)')
      .eq('id', logId)
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (error) throw new Error('Failed to fetch log: ' + error.message)
    if (!log) throw new Error('Sync log not found')

    const row = log as unknown as SyncLogRow
    const platform = await resolveLogPlatform(row.store_id, user.active_workspace_id)

    return { success: true, log: { ...row, platform } }
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
      .select('id,event,store_id,payload,field_mapping_id,erp_connection_id,connection_generation,platform')
      .eq('id', logId)
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (logErr) throw new Error('Failed to fetch log: ' + logErr.message)
    if (!log) throw new Error('Sync log not found')

    if (!log.event) {
      throw new Error('لا يوجد نوع حدث مسجل لهذا السجل (Log does not contain an event type)')
    }
    if (!log.erp_connection_id || !log.connection_generation) throw new Error('Legacy sync log has no pinned ERP target; controlled reconciliation is required before retry')
    const retryPlatform = log.platform || await resolveLogPlatform(log.store_id, user.active_workspace_id)
    if (retryPlatform !== 'zid' && retryPlatform !== 'salla' && retryPlatform !== 'shopify') throw new Error('Cannot verify retry store platform')
    const retryTarget = { erpConnectionId: log.erp_connection_id, connectionGeneration: log.connection_generation }
    await validateExecutionTarget(user.active_workspace_id, retryPlatform, log.store_id || '', retryTarget)

    const payload = (log.payload && typeof log.payload === 'object' && !Array.isArray(log.payload))
      ? (log.payload as Record<string, unknown>)
      : {}

    // 2. Fetch field mapping (only if field_mapping_id is a valid UUID)
    const isUuid =
      typeof log.field_mapping_id === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(log.field_mapping_id)

    let mapping: FieldMappingRow | null = null
    if (isUuid) {
      const { data: mappingData, error: mapErr } = await supabase
        .from('field_mappings')
        .select('*')
        .eq('id', log.field_mapping_id)
        .eq('workspace_id', user.active_workspace_id)
        .maybeSingle()

      if (mapErr) {
        console.warn('[Sync Logs Action] Failed to fetch field mapping:', mapErr.message)
      } else if (mappingData) {
        mapping = mappingData as unknown as FieldMappingRow
      }
    }

    let status: string
    let message: string
    let isFailed = false

    if (mapping) {
      // 3a. Re-run custom mapping
      const result = await withErpTarget({ ...retryTarget, workspaceId: user.active_workspace_id, platform: retryPlatform, storeId: log.store_id || '', eventId: logId }, () => processSingleMapping(
        mapping,
        log.event,
        log.store_id || '',
        payload,
        'manual', // triggerType
        logId, // existingLogId
        retryPlatform
      ))

      status = result.status
      message = result.message || ''
      isFailed = result.status === 'failed'
    } else {
      // 3b. Standard Mapping (preset / webhook event fallback where field_mapping_id is null or mapping was removed)
      const retryStartTime = new Date(Date.now() - 2000).toISOString()
      const result = await processWebhookEvent(
        log.event,
        log.store_id || '',
        payload,
        retryPlatform,
        true, // isQueueExecution
        user.active_workspace_id,
        logId,
        retryTarget
      )

      if (!result.records || result.records.length === 0) {
        throw new Error('لم يتم العثور على مطابقة مفعّلة أو إعدادات قياسية لهذا الحدث (No active mapping or standard settings found for this event)')
      }

      const firstFailed = result.records.find((r) => r.status === 'failed')
      const primaryRecord = firstFailed || result.records.find((r) => r.status === 'success') || result.records[0]

      isFailed = primaryRecord.status === 'failed'
      status = primaryRecord.status
      message = primaryRecord.message || (isFailed ? 'فشلت المزامنة' : 'تمت المزامنة بنجاح')

      // Update the existing log in place so the opened record view (/app/logs/[id]) reflects the new result
      await supabase
        .from('sync_logs')
        .update({
          status: primaryRecord.status,
          error_message: isFailed ? (primaryRecord.message || 'فشلت المزامنة') : null,
          odoo_record_id: primaryRecord.odooRecordId ?? (primaryRecord as any).odoo_record_id ?? null,
          odoo_model: primaryRecord.model || undefined,
          trigger_type: 'manual',
          resolved_manually: false,
        })
        .eq('id', logId)
        .eq('workspace_id', user.active_workspace_id)

      // Clean up duplicate new row inserted by processWebhookEvent if present
      try {
        const { data: newLogs } = await supabase
          .from('sync_logs')
          .select('id')
          .eq('workspace_id', user.active_workspace_id)
          .eq('store_id', log.store_id)
          .eq('event', log.event)
          .gte('created_at', retryStartTime)
          .neq('id', logId)
          .order('created_at', { ascending: false })
          .limit(1)

        if (newLogs && newLogs.length > 0) {
          await supabase
            .from('sync_logs')
            .delete()
            .eq('id', newLogs[0].id)
            .eq('workspace_id', user.active_workspace_id)
        }
      } catch {
        // Cleanup is best effort
      }
    }

    revalidatePath('/app/mapping-center')
    revalidatePath('/app/logs')

    if (isFailed) {
      return {
        success: false,
        status,
        error: message || 'فشلت إعادة الإرسال (Retry sync failed)',
      }
    }

    return {
      success: true,
      status,
      message: message || 'تمت إعادة معالجة المزامنة بنجاح (Sync retry completed)',
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
