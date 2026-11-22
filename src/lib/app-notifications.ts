import { supabase } from '@/lib/supabase'
import { pushConfigured, sendBrowserPush } from '@/lib/browser-push'
import { publishAppNotification } from '@/lib/app-notification-events'

export type NotificationStatus = 'received' | 'success' | 'failed' | 'skipped'
export function notificationCategory(event: string): string {
  const name = event.toLowerCase()
  if (name.includes('order') || name.includes('sale') || name.includes('return')) return 'orders'
  if (name.includes('product')) return 'products'
  if (name.includes('categor')) return 'categories'
  if (name.includes('customer')) return 'customers'
  if (name.includes('stock') || name.includes('inventory')) return 'stock'
  return 'other'
}
function safeText(value: unknown, limit = 120): string {
  return String(value ?? '').replace(/[\\r\\n]/g, ' ').slice(0, limit)
}
function platformLabel(platform?: string): string {
  const p = (platform || '').toLowerCase()
  if (p.includes('zid')) return 'زد'
  if (p.includes('salla')) return 'سلة'
  if (p.includes('shopify')) return 'شوبيفاي'
  if (p.includes('odoo')) return 'أودو'
  return 'المتجر'
}

function formatCurrency(curr?: string | null): string {
  if (!curr) return 'ر.س'
  const c = curr.trim().toUpperCase()
  if (c === 'SAR') return 'ر.س'
  return curr.trim()
}

export type NotificationDetails = {
  orderNumber?: string | number | null
  customerName?: string | null
  customerPhone?: string | null
  totalAmount?: string | number | null
  currency?: string | null
  productName?: string | null
  productSku?: string | null
  categoryName?: string | null
  stockQuantity?: string | number | null
  storeRecordId?: string | number | null
}

export type RecordAppNotificationInput = {
  workspaceId: string
  platform: string
  event: string
  eventKey: string
  status: NotificationStatus
  reference?: string | null
  odooRecordId?: number | string | null
  details?: NotificationDetails
  payload?: Record<string, unknown>
  errorMessage?: string | null
  title?: string
  body?: string
}

export function buildHumanNotification(input: RecordAppNotificationInput): { title: string; body: string } {
  const store = platformLabel(input.platform)
  const cat = notificationCategory(input.event)
  const ev = (input.event || '').toLowerCase()
  const d: any = input.payload || {}
  const details = input.details || {}

  let orderNum = details.orderNumber
  if (!orderNum) {
    orderNum = d.order_number || d.code || d.order_id || d.reference || (cat === 'orders' ? (d.id || input.reference) : null)
  }
  const orderNumStr = orderNum ? String(orderNum) : ''

  let custName = details.customerName
  if (!custName) {
    const cust = d.customer || {}
    custName = cust.name || [cust.first_name, cust.last_name].filter(Boolean).join(' ') || d.customer_name || d.shipping?.address?.name || null
  }
  const custNameStr = custName ? safeText(custName, 50) : ''

  let amount = details.totalAmount
  if (amount == null && cat === 'orders') {
    amount = d.order_total || d.total || d.grand_total || d.total_amount
  }
  const curr = formatCurrency(details.currency || d.currency || d.currency_code)

  let prodName = details.productName
  if (!prodName && cat === 'products') {
    const prod = (d.product && typeof d.product === 'object') ? d.product : d
    prodName = prod.name?.ar || prod.name?.en || prod.name || prod.title || d.name?.ar || d.name?.en || d.name || d.title || null
  }
  const prodNameStr = prodName ? safeText(prodName, 60) : ''

  let sku = details.productSku
  if (!sku && cat === 'products') {
    const prod = (d.product && typeof d.product === 'object') ? d.product : d
    sku = prod.sku || prod.code || prod.barcode || d.sku || d.code || d.barcode || null
  }
  const skuStr = sku ? safeText(sku, 40) : ''

  const storeProdId = details.storeRecordId || details.orderNumber || (cat === 'products' ? (d.product?.id || d.id || input.reference) : null)
  const storeProdIdStr = storeProdId ? String(storeProdId) : ''

  const odooIdStr = input.odooRecordId != null ? String(input.odooRecordId) : ''

  // 1. Orders Category (الطلبات)
  if (cat === 'orders') {
    if (input.status === 'received') {
      const title = orderNumStr ? `🛒 طلب جديد #${orderNumStr}` : `🛒 طلب جديد من ${store}`
      const parts = [`وصل طلب جديد من ${store}`]
      if (custNameStr) parts.push(`العميل: ${custNameStr}`)
      if (amount != null && String(amount) !== '') parts.push(`المبلغ: ${amount} ${curr}`)
      return { title, body: parts.join(' · ') }
    }
    if (input.status === 'success') {
      const title = orderNumStr ? `✅ تم تسجيل الطلب #${orderNumStr} في أودو` : `✅ تم تسجيل الطلب في أودو بنجاح`
      const parts = []
      if (odooIdStr) parts.push(`رقم أودو: #${odooIdStr}`)
      if (orderNumStr) parts.push(`رقم ${store}: #${orderNumStr}`)
      if (custNameStr) parts.push(`العميل: ${custNameStr}`)
      if (amount != null && String(amount) !== '') parts.push(`الإجمالي: ${amount} ${curr}`)
      return { title, body: parts.join(' · ') || 'تمت مزامنة بيانات الطلب مع أودو بنجاح' }
    }
    if (input.status === 'failed') {
      const title = orderNumStr ? `⚠️ تعذر تسجيل الطلب #${orderNumStr} في أودو` : `⚠️ تعذر مزامنة الطلب في أودو`
      const reason = input.errorMessage ? safeText(input.errorMessage, 100) : 'يرجى مراجعة سجل المزامنة'
      return { title, body: `الطلب: #${orderNumStr || '—'} · السبب: ${reason}` }
    }
    return {
      title: orderNumStr ? `⏭️ تم تخطي الطلب #${orderNumStr}` : `⏭️ تم تخطي مزامنة الطلب`,
      body: `الطلب: #${orderNumStr || '—'} مطابق لقواعد التخطي المحددة`,
    }
  }

  // 2. Products Category (المنتجات)
  if (cat === 'products') {
    const isUpdate = ev.includes('update') || ev.includes('edit') || ev.includes('modify')
    if (input.status === 'received') {
      const title = `🏷️ منتج جديد من ${store}`
      const parts = []
      if (prodNameStr) parts.push(prodNameStr)
      if (skuStr) parts.push(`كود (SKU): ${skuStr}`)
      if (storeProdIdStr) parts.push(`رقم ${store}: #${storeProdIdStr}`)
      return { title, body: parts.join(' · ') || `وصل تحديث منتج من ${store}` }
    }
    if (input.status === 'success') {
      const title = isUpdate ? `🏷️ تم تحديث المنتج في أودو` : `🏷️ تم إضافة منتج جديد في أودو`
      const parts = []
      if (prodNameStr) parts.push(prodNameStr)
      if (odooIdStr) parts.push(`رقم أودو: #${odooIdStr}`)
      if (storeProdIdStr) parts.push(`رقم ${store}: #${storeProdIdStr}`)
      if (skuStr) parts.push(`كود (SKU): ${skuStr}`)
      return { title, body: parts.join(' · ') || 'تمت مزامنة بيانات المنتج مع أودو بنجاح' }
    }
    if (input.status === 'failed') {
      const title = `⚠️ تعذر مزامنة المنتج في أودو`
      const parts = []
      if (prodNameStr) parts.push(prodNameStr)
      if (storeProdIdStr) parts.push(`رقم ${store}: #${storeProdIdStr}`)
      if (input.errorMessage) parts.push(`السبب: ${safeText(input.errorMessage, 80)}`)
      return { title, body: parts.join(' · ') || 'فشلت عملية المزامنة مع أودو' }
    }
    return {
      title: `⏭️ تم تخطي مزامنة المنتج`,
      body: prodNameStr ? `${prodNameStr} · مطابق لقواعد التخطي` : 'تم تخطي مزامنة المنتج',
    }
  }

  // 3. Stock Category (المخزون)
  if (cat === 'stock') {
    if (input.status === 'success') {
      return {
        title: `🔄 تم تحديث المخزون في ${store}`,
        body: prodNameStr || skuStr ? `${prodNameStr || ''} ${skuStr ? '(' + skuStr + ')' : ''} · تم تحديث الكمية في ${store} بنجاح` : `تم تحديث كميات المخزون مع ${store} بنجاح`,
      }
    }
    if (input.status === 'failed') {
      return {
        title: `⚠️ تعذر تحديث المخزون في ${store}`,
        body: `فشلت مزامنة كميات المخزون مع المتجر`,
      }
    }
  }

  // 4. Customers Category (العملاء)
  if (cat === 'customers') {
    if (input.status === 'success') {
      return {
        title: `👤 تم تسجيل العميل في أودو`,
        body: `${custNameStr || 'عميل جديد'} ${odooIdStr ? '· رقم أودو: #' + odooIdStr : ''}`,
      }
    }
    if (input.status === 'failed') {
      return {
        title: `⚠️ تعذر مزامنة العميل في أودو`,
        body: `${custNameStr || 'العميل'} · يرجى مراجعة سجل المزامنة`,
      }
    }
  }

  // 5. Categories Category (التصنيفات)
  if (cat === 'categories') {
    const catName = safeText(details.categoryName || d.name?.ar || d.name || input.reference || '', 50)
    if (input.status === 'success') {
      return {
        title: `🗂️ تم مزامنة التصنيف في أودو`,
        body: `${catName || 'تصنيف'} ${odooIdStr ? '· رقم أودو: #' + odooIdStr : ''}`,
      }
    }
    if (input.status === 'failed') {
      return {
        title: `⚠️ تعذر مزامنة التصنيف في أودو`,
        body: `${catName || 'التصنيف'} · فشلت المزامنة مع أودو`,
      }
    }
  }

  // Fallback for other events
  const defaultTitles: Record<NotificationStatus, string> = {
    received: `وصل حدث جديد من ${store}`,
    success: `تمت المزامنة مع أودو بنجاح`,
    failed: `فشلت المزامنة مع أودو`,
    skipped: `تم تخطي المزامنة`,
  }
  return {
    title: defaultTitles[input.status] || 'إشعار من النظام',
    body: input.reference ? `#${input.reference} · ${store}` : `تمت معالجة العملية بنجاح`,
  }
}

/**
 * Notification persistence is best-effort and completely outside the Odoo write path.
 * The webhook receipt/queue remain authoritative even if push infrastructure fails.
 */
export async function recordAppNotification(input: RecordAppNotificationInput): Promise<void> {
  if (!input.workspaceId || !input.eventKey) return
  const cat = notificationCategory(input.event)
  if (cat === 'other') return

  const formatted = buildHumanNotification(input)
  const title = input.title ? safeText(input.title, 120) : formatted.title
  const body = input.body ? safeText(input.body, 240) : formatted.body

  const { data, error } = await supabase.from('app_notifications').insert({
    workspace_id: input.workspaceId,
    platform: safeText(input.platform, 20),
    event: safeText(input.event, 80),
    event_key: safeText(input.eventKey, 250),
    status: input.status,
    title,
    body,
    href: input.status === 'received' ? '/app/queue' : '/app/logs',
  }).select('id,title,body,href,status,event,created_at').maybeSingle()
  if (error || !data?.id) {
    if (error?.code !== '23505') console.warn('[Notifications] Event persistence unavailable:', error?.code ?? 'no_id')
    return
  }
  // Broadcast immediately to active in-app tabs on this Node process. This is
  // in-memory SSE, not Supabase Realtime and not another database operation.
  publishAppNotification(input.workspaceId, data as {
    id: string; title: string; body: string; href: string;
    status: string; event: string; created_at: string
  })

  // Durable fanout; every delivery has unique notification/subscription identity.
  const { data: devices, error: devicesError } = await supabase.from('browser_push_subscriptions')
    .select('id').eq('workspace_id', input.workspaceId).eq('enabled', true).limit(100)
  if (devicesError || !devices?.length) return
  const rows = devices.map(device => ({ notification_id: data.id, subscription_id: device.id }))
  const { error: fanoutError } = await supabase.from('browser_push_deliveries').upsert(rows, { onConflict: 'notification_id,subscription_id', ignoreDuplicates: true })
  if (fanoutError) console.warn('[Notifications] Push fanout unavailable:', fanoutError.code)
  else if (pushConfigured()) void drainBrowserPush().catch(() => {})
}

let busy = false
/** Bounded, non-overlapping sender. Never invoked from Odoo processing. */
export async function drainBrowserPush(limit = 20): Promise<number> {
  if (busy || !pushConfigured()) return 0
  busy = true
  try {
    const { data, error } = await supabase.from('browser_push_deliveries')
      .select('id,attempts,notification:app_notifications(title,body,href,event_key),subscription:browser_push_subscriptions(id,endpoint,p256dh,auth,enabled)')
      .eq('status', 'pending')
      .lte('next_attempt_at', new Date().toISOString())
      .order('next_attempt_at', { ascending: true })
      .limit(Math.max(1, Math.min(limit, 50)))
    if (error) { console.warn('[Notifications] Push query unavailable:', error.code); return 0 }
    let done = 0
    for (const item of data ?? []) {
      const entry = item as any
      const n = Array.isArray(entry.notification) ? entry.notification[0] : entry.notification
      const s = Array.isArray(entry.subscription) ? entry.subscription[0] : entry.subscription
      let failed = ''
      let gone = false
      try {
        if (!n || !s || !s.enabled) gone = true
        else ({ gone } = await sendBrowserPush(s, { title: n.title, body: n.body, href: n.href, tag: n.event_key }))
      } catch (e) {
        failed = e instanceof Error ? e.message.slice(0, 160) : 'Delivery failed'
      }
      const attempts = Number(entry.attempts ?? 0) + 1
      const status = gone || !failed ? 'sent' : attempts >= 5 ? 'failed' : 'pending'
      const next = new Date(Date.now() + Math.min(3600000, Math.pow(2, attempts) * 30000)).toISOString()
      await supabase.from('browser_push_deliveries').update({ status, attempts, last_error: failed || null, next_attempt_at: next }).eq('id', entry.id).eq('status', 'pending')
      if (gone && s?.id) await supabase.from('browser_push_subscriptions').update({ enabled: false }).eq('id', s.id)
      done++
    }
    return done
  } finally { busy = false }
}
