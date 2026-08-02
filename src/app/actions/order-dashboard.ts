'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser } from '@/lib/users'

const ZID_ORDER_EVENTS = ['order.status.update', 'order.payment_status.update', 'order.reversed']
const SALLA_ORDER_EVENTS = ['order.created', 'order.updated', 'order.status.updated', 'order.cancelled', 'order.delivered', 'order.refunded']
const SHOPIFY_ORDER_EVENTS = ['orders/create', 'orders/updated', 'orders/cancelled', 'orders/fulfilled', 'orders/paid', 'orders/partially_fulfilled', 'orders/edited', 'orders/delete']
const ORDER_EVENTS = [...ZID_ORDER_EVENTS, ...SALLA_ORDER_EVENTS, ...SHOPIFY_ORDER_EVENTS]

export async function getOrderSyncStats() {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, stats: null }

    // Count unique orders (by zid_entity_id) instead of raw events
    // An order is "success" if all its events succeeded, "failed" if any failed, "skipped" if all skipped
    const { data, error } = await supabase
      .from('sync_logs')
      .select('zid_entity_id, status')
      .eq('workspace_id', user.active_workspace_id)
      .in('event', ORDER_EVENTS)
      .not('zid_entity_id', 'is', null)

    if (error) throw error

    // Track per-order status: 'success' | 'failed' | 'skipped'
    const orderStatuses = new Map<string, string>()
    for (const row of data || []) {
      if (!row.zid_entity_id) continue
      const existing = orderStatuses.get(row.zid_entity_id)
      // Worst status wins: failed > skipped > success
      if (!existing || row.status === 'failed' || (row.status === 'skipped' && existing === 'success')) {
        orderStatuses.set(row.zid_entity_id, row.status)
      }
    }

    // Get most recent activity timestamp
    const { data: lastEvent } = await supabase
      .from('sync_logs')
      .select('created_at')
      .eq('workspace_id', user.active_workspace_id)
      .in('event', ORDER_EVENTS)
      .order('created_at', { ascending: false })
      .limit(1)

    const stats = { total: 0, success: 0, failed: 0, skipped: 0, total_events: data?.length || 0, last_activity: lastEvent?.[0]?.created_at || null }
    for (const status of orderStatuses.values()) {
      stats.total++
      if (status === 'success') stats.success++
      else if (status === 'failed') stats.failed++
      else if (status === 'skipped') stats.skipped++
    }

    return { success: true, stats }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function getOrderSyncLogs(params: {
  status?: string
  platform?: string
  searchQuery?: string
  limit?: number
  offset?: number
}) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, logs: [], totalCount: 0 }

    const odooUrl = (process.env.ODOO_URL || '').replace(/\/$/, '')

    let query = supabase
      .from('sync_logs')
      .select('*', { count: 'exact' })
      .eq('workspace_id', user.active_workspace_id)
      .in('event', ORDER_EVENTS)
      .order('created_at', { ascending: false })

    if (params.status && params.status !== 'all') {
      query = query.eq('status', params.status)
    }

    // Filter by platform via event name patterns
    if (params.platform && params.platform !== 'all') {
      if (params.platform === 'shopify') {
        query = query.in('event', SHOPIFY_ORDER_EVENTS)
      } else if (params.platform === 'salla') {
        query = query.in('event', SALLA_ORDER_EVENTS)
      } else if (params.platform === 'zid') {
        query = query.in('event', ZID_ORDER_EVENTS)
      }
    }

    // Search by zid_entity_id (Order ID)
    if (params.searchQuery) {
      query = query.ilike('zid_entity_id', `%${params.searchQuery}%`)
    }

    const limit = params.limit || 20
    const offset = params.offset || 0
    query = query.range(offset, offset + limit - 1)

    const { data: logs, count, error } = await query
    if (error) throw error

    return { success: true, logs: logs || [], totalCount: count || 0, odooUrl: odooUrl || undefined }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function retryOrderSync(logId: string) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const { data: log, error: logErr } = await supabase
      .from('sync_logs')
      .select('*')
      .eq('id', logId)
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (logErr) throw new Error('Failed to fetch log')
    if (!log) throw new Error('Sync log not found')

    const { data: mapping, error: mapErr } = await supabase
      .from('field_mappings')
      .select('*')
      .eq('id', log.field_mapping_id)
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (mapErr) throw new Error('Failed to fetch mapping')
    if (!mapping) throw new Error('المطابقة الخاصة بهذا السجل تم حذفها')

    const { processSingleMapping } = await import('@/lib/sync-engine')
    await processSingleMapping(mapping, log.event, log.store_id, log.payload || {}, 'manual', logId)

    revalidatePath('/dashboard/mapping-center/orders')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
