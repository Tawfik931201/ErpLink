import { auth } from '@clerk/nextjs/server'
import { NextResponse, type NextRequest } from 'next/server'
import { getActiveWorkspaceId } from '@/lib/auth'
import { accessibleWorkspaceId } from '@/lib/workspace-access'
import { supabase } from '@/lib/supabase'
import { isAllowedPushEndpoint } from '@/lib/browser-web-push'

export const runtime = 'nodejs'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  if (!workspaceId || !(await accessibleWorkspaceId(userId, workspaceId))) {
    return NextResponse.json({ error: 'Workspace denied' }, { status: 403 })
  }
  return NextResponse.json({
    publicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY || null,
    workspaceId,
    userId,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  if (!workspaceId || !(await accessibleWorkspaceId(userId, workspaceId))) {
    return NextResponse.json({ error: 'Workspace denied' }, { status: 403 })
  }
  let data: any
  try { data = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { endpoint, keys } = data || {}
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || !isAllowedPushEndpoint(endpoint) ||
      typeof keys?.p256dh !== 'string' || !/^[A-Za-z0-9_-]{80,100}$/.test(keys.p256dh) ||
      typeof keys?.auth !== 'string' || !/^[A-Za-z0-9_-]{20,30}$/.test(keys.auth)) {
    return NextResponse.json({ error: 'Invalid push subscription' }, { status: 400 })
  }
  // A subscription endpoint identifies one browser device. Rebind to the authenticated
  // workspace on re-login; do not allow old tenant to continue receiving its alerts.
  const { error } = await supabase.from('browser_push_subscriptions').upsert({
    endpoint, p256dh: keys.p256dh, auth_secret: keys.auth,
    user_id: userId, workspace_id: workspaceId,
    updated_at: new Date().toISOString(),
    last_scanned_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' })
  if (error) {
    console.error('[push] subscription upsert failed', error.code)
    return NextResponse.json({ error: 'Subscription storage unavailable' }, { status: 503 })
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE(request: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let data: any
  try { data = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof data?.endpoint !== 'string') return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 })
  const { error } = await supabase.from('browser_push_subscriptions')
    .delete().eq('user_id', userId).eq('endpoint', data.endpoint)
  if (error) return NextResponse.json({ error: 'Unsubscribe failed' }, { status: 503 })
  return NextResponse.json({ ok: true })
}
