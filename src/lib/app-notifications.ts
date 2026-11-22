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
/**
 * Notification persistence is best-effort and completely outside the Odoo write path.
 * The webhook receipt/queue remain authoritative even if push infrastructure fails.
 */
export async function recordAppNotification(input: {
  workspaceId: string; platform: string; event: string; eventKey: string;
  status: NotificationStatus; reference?: string | null
}): Promise<void> {
  if (!input.workspaceId || !input.eventKey) return
  const cat = notificationCategory(input.event)
  if (cat === 'other') return
  const names: Record<string,string> = { orders: 'طلب', products: 'منتج', categories: 'تصنيف', customers: 'عميل', stock: 'مخزون' }
  const titles: Record<NotificationStatus,string> = {
    received: 'وصل حدث جديد من المتجر',
    success: 'تمت المزامنة بنجاح',
    failed: 'فشلت المزامنة مع أودوو',
    skipped: 'تم تخطي المزامنة',
  }
  const { data, error } = await supabase.from('app_notifications').insert({
    workspace_id: input.workspaceId,
    platform: safeText(input.platform, 20),
    event: safeText(input.event, 80),
    event_key: safeText(input.eventKey, 250),
    status: input.status,
    title: titles[input.status],
    body: names[cat] + (input.reference ? ' #' + safeText(input.reference, 50) : '') + ' · ' + safeText(input.event, 80),
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
