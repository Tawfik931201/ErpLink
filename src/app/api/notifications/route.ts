import { type NextRequest, NextResponse } from 'next/server'
import { getActiveUserId, getActiveWorkspaceId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { pushConfigured } from '@/lib/browser-push'

export const dynamic = 'force-dynamic'
const noStore = { 'Cache-Control': 'private, no-store' }
async function principal() {
  const [userId, workspaceId] = await Promise.all([getActiveUserId(), getActiveWorkspaceId()])
  return userId && workspaceId ? { userId, workspaceId } : null
}
function originAllowed(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  return !!origin && origin === req.nextUrl.origin
}
function validEndpoint(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048) return false
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (host === 'fcm.googleapis.com' || host === 'android.googleapis.com' ||
       host === 'updates.push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com') ||
       host === 'web.push.apple.com' || host.endsWith('.push.apple.com') ||
       host.endsWith('.notify.windows.com') || host.endsWith('.push.windows.com'))
  } catch { return false }
}
export async function GET() {
  const p = await principal()
  if (!p) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore })
  const [notifications, devices] = await Promise.all([
    supabase.from('app_notifications').select('id,title,body,href,status,event,created_at')
      .eq('workspace_id', p.workspaceId).order('created_at', { ascending: false }).limit(30),
    supabase.from('browser_push_subscriptions').select('id,endpoint,enabled').eq('workspace_id', p.workspaceId).eq('user_id', p.userId).eq('enabled', true),
  ])
  if (notifications.error || devices.error) return NextResponse.json({ error: 'Notification storage unavailable' }, { status: 503, headers: noStore })
  return NextResponse.json({
    notifications: notifications.data ?? [],
    workspaceId: p.workspaceId,
    endpoints: (devices.data ?? []).map(d => d.endpoint),
    vapidPublicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? '',
    pushReady: pushConfigured(),
    subscriptionCount: (devices.data ?? []).length,
  }, { headers: noStore })
}
export async function POST(req: NextRequest) {
  if (!originAllowed(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  const p = await principal()
  if (!p) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!pushConfigured())
    return NextResponse.json({ error: 'Web Push is not configured' }, { status: 503 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!validEndpoint(body?.endpoint) || typeof body?.keys?.p256dh !== 'string' || typeof body?.keys?.auth !== 'string' ||
      body.keys.p256dh.length > 200 || body.keys.auth.length > 100)
    return NextResponse.json({ error: 'Invalid push subscription' }, { status: 400 })
  const { error } = await supabase.from('browser_push_subscriptions').upsert({
    workspace_id: p.workspaceId, user_id: p.userId, endpoint: body.endpoint,
    p256dh: body.keys.p256dh, auth: body.keys.auth, enabled: true,
  }, { onConflict: 'workspace_id,user_id,endpoint' })
  return error ? NextResponse.json({ error: 'Unable to save subscription' }, { status: 503 }) : NextResponse.json({ ok: true })
}
export async function DELETE(req: NextRequest) {
  if (!originAllowed(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  const p = await principal()
  if (!p) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!validEndpoint(body?.endpoint)) return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 })
  const { error } = await supabase.from('browser_push_subscriptions').delete()
    .eq('workspace_id', p.workspaceId).eq('user_id', p.userId).eq('endpoint', body.endpoint)
  return error ? NextResponse.json({ error: 'Unable to disable push' }, { status: 503 }) : NextResponse.json({ ok: true })
}
