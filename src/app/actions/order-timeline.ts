'use server'

import { auth } from '@clerk/nextjs/server'

import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser } from '@/lib/users'

export type TimelineEntry = {
  id: string
  event: string
  status: string
  created_at: string
  error_message?: string
  odoo_record_id?: number
  odoo_model?: string
}

export type OrderDetail = {
  orderId: string
  customer?: { name?: string; email?: string; phone?: string }
  items?: Array<{ name?: string; sku?: string; qty?: number; price?: number; total?: number }>
  totals?: { subtotal?: number; shipping?: number; discount?: number; total?: number; currency?: string }
  status?: string
  paymentMethod?: string
  notes?: string
  createdAt?: string
  platform?: string
}

export async function getOrderDetail(zidEntityId: string, storeId?: string): Promise<{ success: boolean; detail?: OrderDetail; error?: string }> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, detail: undefined }

    let query = supabase
      .from('sync_logs')
      .select('payload, event, store_id')
      .eq('workspace_id', user.active_workspace_id)
      .eq('zid_entity_id', zidEntityId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (storeId) query = query.eq('store_id', storeId)

    const { data, error } = await query
    if (error) throw error
    if (!data || data.length === 0) return { success: true, detail: undefined }

    const log = data[0]
    const payload = (log.payload || {}) as Record<string, any>
    const platform = log.event?.startsWith('orders/') ? 'Shopify' : log.store_id?.includes('salla') ? 'Salla' : 'Zid'

    const customer = payload.customer
      ? { name: String(payload.customer.name || payload.customer.first_name || ''), email: String(payload.customer.email || ''), phone: String(payload.customer.phone || payload.customer.mobile || '') }
      : payload.billing_address
        ? { name: String(payload.billing_address.name || ''), email: String(payload.email || ''), phone: String(payload.billing_address.phone || '') }
        : undefined

    const items: OrderDetail['items'] = []
    const productCandidates = [payload.products, payload.items, payload.line_items, payload.order_items]
    for (const arr of productCandidates) {
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && typeof item === 'object') {
            items.push({
              name: String(item.name || item.product_name || item.title || ''),
              sku: String(item.sku || item.default_code || item.product_id || ''),
              qty: Number(item.quantity || item.qty || 1),
              price: Number(item.price || item.unit_price || item.price_unit || 0),
              total: Number(item.total || item.subtotal || (Number(item.price || 0) * Number(item.quantity || 1)) || 0),
            })
          }
        }
        if (items.length > 0) break
      }
    }

    const amountData = payload.amounts || payload.total_details || payload
    const detail: OrderDetail = {
      orderId: zidEntityId,
      customer: customer && (customer.name || customer.email) ? customer : undefined,
      items: items.length > 0 ? items : undefined,
      totals: {
        subtotal: Number(amountData.subtotal || amountData.sub_total || amountData.total_untaxed || 0),
        shipping: Number(amountData.shipping_cost || payload.shipping_cost || payload.shipping?.price || 0),
        discount: Number(amountData.discount || amountData.discount_amount || 0),
        total: Number(amountData.total || amountData.total_price || amountData.order_total || amountData.amount_total || 0),
        currency: String(payload.currency || amountData.currency || payload.amounts?.currency || 'SAR'),
      },
      status: String(payload.status || payload.order_status || payload.order?.status || ''),
      paymentMethod: String(payload.payment_method?.title || payload.payment_gateway?.title || payload.payment_method || ''),
      notes: String(payload.notes || payload.customer_notes || payload.note || payload.shipping?.notes || ''),
      createdAt: String(payload.created_at || payload.date_order || payload.createdAt || ''),
      platform,
    }

    return { success: true, detail }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function getOrderTimeline(zidEntityId: string, storeId?: string) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, entries: [] }

    let query = supabase
      .from('sync_logs')
      .select('id, event, status, created_at, error_message, odoo_record_id, odoo_model')
      .eq('workspace_id', user.active_workspace_id)
      .eq('zid_entity_id', zidEntityId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (storeId) query = query.eq('store_id', storeId)

    const { data, error } = await query
    if (error) throw error

    return { success: true, entries: (data || []) as TimelineEntry[] }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export type ErrorGroup = { error_message: string; count: number; sample_event: string; sample_date: string }

export async function getErrorSummary(platformFilter?: string): Promise<{ success: boolean; groups: ErrorGroup[]; error?: string }> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, groups: [] }

    const MAX_DATA = 10000
    let query = supabase
      .from('sync_logs')
      .select('error_message, event, created_at')
      .eq('workspace_id', user.active_workspace_id)
      .eq('status', 'failed')
      .not('error_message', 'is', null)
      .neq('error_message', '')
      .limit(MAX_DATA)

    if (platformFilter && platformFilter !== 'all') {
      if (platformFilter === 'Zid') query = query.eq('store_id', 'zid')
      else if (platformFilter === 'Shopify') query = query.like('event', 'orders/%')
      else if (platformFilter === 'Salla') {
        const sallaEvents = ['order.created', 'order.updated', 'order.status.update', 'order.status.updated', 'order.cancelled', 'order.delivered', 'order.payment_status.update', 'order.refunded', 'order.reversed']
        query = query.in('event', sallaEvents)
      }
    }

    const { data, error } = await query
    if (error) throw error
    if (!data || data.length === 0) return { success: true, groups: [] }

    const groups: Record<string, { count: number; sample_event: string; sample_date: string }> = {}
    for (const row of data) {
      const msg = (row.error_message || '').slice(0, 200)
      if (!msg) continue
      if (!groups[msg]) groups[msg] = { count: 0, sample_event: row.event || '', sample_date: row.created_at || '' }
      groups[msg].count++
      if ((row.created_at || '') > groups[msg].sample_date) { groups[msg].sample_date = row.created_at || ''; groups[msg].sample_event = row.event || '' }
    }

    return {
      success: true,
      groups: Object.entries(groups)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 50)
        .map(([error_message, g]) => ({ error_message, ...g })),
    }
  } catch (error: any) {
    return { success: false, groups: [], error: error.message }
  }
}

export type WebhookHealth = { platform: string; last_event: string | null; event_count_24h: number; is_healthy: boolean }

export async function getWebhookHealth(): Promise<{ success: boolean; health: WebhookHealth[]; error?: string }> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, health: [] }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('sync_logs')
      .select('event, store_id, created_at')
      .eq('workspace_id', user.active_workspace_id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) throw error

    const platforms: Record<string, { last_event: string | null; count: number }> = {
      Zid: { last_event: null, count: 0 },
      Salla: { last_event: null, count: 0 },
      Shopify: { last_event: null, count: 0 },
    }

    const platformKeys: Record<string, string> = { zid: 'Zid', salla: 'Salla', shopify: 'Shopify' }

    for (const row of data || []) {
      let rawPlatform = 'zid'
      const ev = (row.event || '').toLowerCase()
      if (ev.startsWith('shopify:') || ev.includes('/')) rawPlatform = 'shopify'
      else if (ev.includes('salla') || ev.endsWith('.created') || ev.includes('.status.') || ev.endsWith('.cancelled') || ev.endsWith('.refunded')) rawPlatform = 'salla'

      const platform = platformKeys[rawPlatform] || 'Zid'
      if (!platforms[platform]) platforms[platform] = { last_event: null, count: 0 }
      platforms[platform].count++
      if (!platforms[platform].last_event || (row.created_at || '') > platforms[platform].last_event!) {
        platforms[platform].last_event = row.created_at || null
      }
    }

    const oneHourAgo = Date.now() - 60 * 60 * 1000
    const health: WebhookHealth[] = Object.entries(platforms).map(([platform, p]) => ({
      platform,
      last_event: p.last_event,
      event_count_24h: p.count,
      is_healthy: p.last_event !== null && new Date(p.last_event).getTime() > oneHourAgo,
    }))

    return { success: true, health }
  } catch (error: any) {
    return { success: false, health: [], error: error.message }
  }
}
