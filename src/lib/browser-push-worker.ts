import { supabase } from '@/lib/supabase'
import { pushConfigured, sendBrowserPush } from '@/lib/browser-web-push'

type Sub = {
  id: string; user_id: string; workspace_id: string;
  endpoint: string; p256dh: string; auth_secret: string;
  last_scanned_at: string; last_receipt_id: string | null
}
type Receipt = {
  id: string; received_at: string; event: string;
  payload: Record<string, unknown> | null; store_id: string
}

/** Called by existing authenticated cron, not the Zid webhook request.
 * Durable per-device (timestamp, receipt id) cursor limits DB storage to subscriptions.
 * If network send fails, cursor is not advanced so that the next cron retries.
 */
export async function runBrowserPushOnce(): Promise<{ checked: number; sent: number; errors: number }> {
  const result = { checked: 0, sent: 0, errors: 0 }
  if (!pushConfigured()) return result
  const { data: subscriptions, error } = await supabase.from('browser_push_subscriptions')
    .select('id,user_id,workspace_id,endpoint,p256dh,auth_secret,last_scanned_at,last_receipt_id')
    .order('updated_at', { ascending: true })
    .limit(25)
  if (error) {
    console.error('[push] subscriptions load failed', error.code)
    return { ...result, errors: 1 }
  }
  for (const sub of (subscriptions || []) as Sub[]) {
    result.checked++
    // Revoked membership must stop delivery immediately, not only on browser logout.
    const { accessibleWorkspaceId } = await import('@/lib/workspace-access')
    if (!(await accessibleWorkspaceId(sub.user_id, sub.workspace_id))) {
      await supabase.from('browser_push_subscriptions').delete().eq('id', sub.id)
      continue
    }
    const filter = sub.last_receipt_id
      ? `received_at.gt.${sub.last_scanned_at},and(received_at.eq.${sub.last_scanned_at},id.gt.${sub.last_receipt_id})`
      : `received_at.gt.${sub.last_scanned_at}`
    const { data: events, error: eventError } = await supabase.from('webhook_inbox')
      .select('id,received_at,event,payload,store_id')
      .eq('workspace_id', sub.workspace_id).eq('platform', 'zid')
      .or(filter)
      .order('received_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(15)
    if (eventError) {
      console.error('[push] inbox scan failed', eventError.code)
      result.errors++
      continue
    }
    for (const item of (events || []) as Receipt[]) {
      // Not every webhook generates a toast. Still advance cursor for non-notifiable events.
      const notify = /^(order|product)[._]/i.test(item.event || '')
      if (notify) {
        const payload = item.payload && typeof item.payload === 'object' ? item.payload : {}
        const identifier = String(payload.order_number ?? payload.code ?? payload.id ?? '').slice(0, 64)
        const order = /^order/i.test(item.event)
        const created = /(?:create|created)$/i.test(item.event)
        try {
          const status = await sendBrowserPush(sub, {
            id: item.id, userId: sub.user_id, workspaceId: sub.workspace_id,
            title: order
              ? (created ? 'طلب جديد من زد' : 'تحديث طلب من زد')
              : (created ? 'منتج جديد من زد' : 'تحديث منتج من زد'),
            body: identifier ? `المعرف: ${identifier}` : 'حدث جديد من زد',
            event: item.event, createdAt: item.received_at,
            url: '/ar-sa/app/logs',
          })
          if (status === 'gone') {
            await supabase.from('browser_push_subscriptions').delete().eq('id', sub.id)
            break
          }
          result.sent++
        } catch (err) {
          console.error('[push] provider delivery failed', {
            workspaceId: sub.workspace_id,
            error: err instanceof Error ? err.message : 'unknown',
          })
          result.errors++
          break
        }
      }
      const { error: cursorError } = await supabase.from('browser_push_subscriptions')
        .update({
          last_scanned_at: item.received_at, last_receipt_id: item.id,
          updated_at: new Date().toISOString(),
        }).eq('id', sub.id)
      if (cursorError) { result.errors++; break }
    }
  }
  return result
}
