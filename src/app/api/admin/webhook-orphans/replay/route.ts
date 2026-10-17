import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import { isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { enqueueWebhookEvent } from '@/lib/sync-queue'

/**
 * POST /api/admin/webhook-orphans/replay — re-enqueue orphan webhook receipts.
 *
 * Orphans are receipts saved with a null `workspace_id` because the store was
 * not linked at delivery time (deliberate no-guess policy). `drainWebhookInbox`
 * excludes them by design — they would never be picked up automatically, and
 * before this route they had no recovery path at all except hand-edited SQL.
 *
 * Rules:
 *  - The store must be linked NOW for its receipts to be resolved. Receipts
 *    whose store is still unlinked stay pending (counted in the report).
 *  - Uninstall-shaped events and sentinel events (invalid_json, unknown_event)
 *    are never replayed — uninstall deletes the merchant's tokens, and the
 *    sentinel shapes carry nothing a queue job can act upon.
 *  - Resolution is one indexed read per platform; the run is sequential and
 *    capped (default 25/interface batch) on shared hosting.
 */
type OrphanRow = {
  id: string
  platform: string
  store_id: string
  event: string
  dedup_key: string | null
  payload: Record<string, unknown>
}

const REPLAY_BATCH_LIMIT = 25
const SKIPPED_EVENTS = new Set(['invalid_json', 'unknown_event'])

function isUninstallEvent(event: string): boolean {
  return event.toLowerCase().replace(/[._\-/]/g, '').includes('uninstall')
}

async function resolveWorkspaceId(platform: string, storeId: string): Promise<string | null> {
  if (!storeId) return null
  if (platform === 'shopify') {
    const { data } = await supabase
      .from('shopify_tokens')
      .select('workspace_id')
      .eq('shop_domain', storeId)
      .maybeSingle()
    return ((data as { workspace_id?: string | null } | null)?.workspace_id) ?? null
  }
  if (platform === 'salla') {
    const { data } = await supabase
      .from('salla_tokens')
      .select('workspace_id')
      .eq('merchant_id', storeId)
      .maybeSingle()
    return ((data as { workspace_id?: string | null } | null)?.workspace_id) ?? null
  }
  // zid — store_id first (entity identity), merchant_id as fallback; a single
  // OR would match two rows for an ambiguous numeric id and `maybeSingle`
  // silently drops one of them.
  const byStore = await supabase
    .from('merchant_tokens')
    .select('workspace_id')
    .eq('store_id', storeId)
    .maybeSingle()
  if (!byStore.error && byStore.data) return byStore.data.workspace_id ?? null
  const { data } = await supabase
    .from('merchant_tokens')
    .select('workspace_id')
    .eq('merchant_id', storeId)
    .maybeSingle()
  return ((data as { workspace_id?: string | null } | null)?.workspace_id) ?? null
}

async function settleReceipt(id: string): Promise<void> {
  await supabase
    .from('webhook_inbox')
    .update({ status: 'done', processed_at: new Date().toISOString() })
    .eq('id', id)
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId || !isAdmin(userId)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  let limit = 25
  try {
    const body = (await req.json()) as { limit?: number }
    if (Number.isFinite(body?.limit)) {
      limit = Math.min(100, Math.max(1, Math.trunc(Number(body.limit)) || 25))
    }
  } catch {
    // جسم فارغ/غير صالح — الافتراضي.
  }

  const { data, error } = await supabase
    .from('webhook_inbox')
    .select('id,platform,store_id,event,dedup_key,payload')
    .eq('status', 'pending')
    .is('workspace_id', null)
    .order('received_at', { ascending: true })
    .limit(Math.max(limit, REPLAY_BATCH_LIMIT))

  if (error) {
    return NextResponse.json({ error: `Failed to list orphans: ${error.message}` }, { status: 500 })
  }

  const rows = (data ?? []) as OrphanRow[]
  let replayed = 0
  let duplicate = 0
  let unlinked = 0
  let skipped = 0
  let failed = 0

  for (const row of rows.slice(0, limit)) {
    if (isUninstallEvent(row.event) || SKIPPED_EVENTS.has(row.event)) {
      skipped += 1
      continue
    }
    const workspaceId = await resolveWorkspaceId(row.platform, row.store_id)
    if (!workspaceId) {
      unlinked += 1
      continue
    }
    const queued = await enqueueWebhookEvent({
      workspaceId,
      storeId: row.store_id,
      event: row.event,
      platform: row.platform as 'zid' | 'salla' | 'shopify',
      payload: row.payload,
      dedupKey: row.dedup_key ?? undefined,
    })
    if (queued.error) {
      failed += 1
      continue
    }
    replayed += 1
    if (queued.duplicate) duplicate += 1
    await settleReceipt(row.id)
  }

  return NextResponse.json({
    replayed,
    duplicate,
    unlinked,
    skipped,
    failed,
    scanned: rows.length,
  })
}

export async function GET() {
  const { userId } = await auth()
  if (!userId || !isAdmin(userId)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }
  const { countOrphanReceipts } = await import('@/lib/webhook-inbox')
  const orphans = await countOrphanReceipts()
  return NextResponse.json({
    orphans,
    message: 'POST /api/admin/webhook-orphans/replay to re-enqueue orphan receipts.',
  })
}
