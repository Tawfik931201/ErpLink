import { auth } from '@clerk/nextjs/server'
import { NextResponse, type NextRequest } from 'next/server'
import { getActiveWorkspaceId } from '@/lib/auth'
import { accessibleWorkspaceId } from '@/lib/workspace-access'
import { supabase } from '@/lib/supabase'

/** Cache-first feed: browser keeps read/unread history in IndexedDB.
 * Queries existing durable receipts, not a separate notifications table.
 * Requires active Clerk user + verified workspace membership.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  if (!workspaceId || !(await accessibleWorkspaceId(userId, workspaceId))) {
    return NextResponse.json({ error: 'Workspace denied' }, { status: 403 })
  }
  const raw = req.nextUrl.searchParams.get('after')
  const since = raw && Number.isFinite(Date.parse(raw)) &&
    Date.now() - Date.parse(raw) < 7 * 86400000 && Date.parse(raw) < Date.now() + 60000
    ? new Date(raw).toISOString()
    : new Date(Date.now() - 24 * 3600000).toISOString()

  const { data, error } = await supabase.from('webhook_inbox')
    .select('id,created_at,event,store_id,payload')
    .eq('workspace_id', workspaceId).eq('platform', 'zid')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) return NextResponse.json({ error: 'Feed unavailable' }, { status: 503 })
  const items = (data || []).filter(row => /^(order|product)[._]/i.test(row.event || ''))
    .map(row => {
      const p = (row.payload && typeof row.payload === 'object') ? row.payload as Record<string, unknown> : {}
      const id = String(p.order_number ?? p.code ?? p.id ?? '')
      const created = /(?:create|created)$/i.test(row.event)
      const order = /^order/i.test(row.event)
      return {
        id: row.id,
        workspaceId, userId,
        event: row.event, createdAt: row.created_at,
        title: order
          ? (created ? 'طلب جديد من زد' : 'تحديث طلب من زد')
          : (created ? 'منتج جديد من زد' : 'تحديث منتج من زد'),
        body: id ? `المعرف: ${id.slice(0, 64)}` : `المتجر: ${String(row.store_id).slice(0, 30)}`,
        url: '/ar-sa/app/logs',
      }
    })
  return NextResponse.json({ workspaceId, userId, items }, { headers: { 'Cache-Control': 'private, no-store' } })
}
