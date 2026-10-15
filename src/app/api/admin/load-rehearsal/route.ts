import { auth } from '@clerk/nextjs/server'
import { type NextRequest, NextResponse } from 'next/server'

import { recordAudit } from '@/lib/audit-logs'
import { isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

/**
 * POST /api/admin/load-rehearsal — بروفة حمل الموسم (P3-2).
 *
 * يقيس تكلفة مسار الاستلام + الطابور بأرقام حقيقية قبل الموسم:
 *   mode=enqueue (آمن في كل مكان): يُدخل N صفاً مميزاً ببصمات مختلفة
 *     (كأنها N طلباً مختلفاً) مع next_retry_at بعيد (+1h) فيستحيل أن
 *     يلتقطها الـ runner، يقيس سرعة الإدخال، ثم يحذفها في نفس الطلب.
 *   mode=drain (staging فقط إلا بتصريح): نفس الإدخال لكن مستحقاً فوراً،
 *     ثم تصريف فعلي عبر processWorkspaceQueue بحد زمني 55 ثانية، ثم حذف
 *     البواقي — يقيس سرعة التصريف ضد أودوو التجريبي.
 *
 * ضمانات: أدمن فقط + confirm صريح + سقف 20000 + dedup_key مميز
 * `rehearsal:*` لا يتداخل مع بيانات حقيقية + audit لكل تشغيل.
 */

const MAX_COUNT = 20000
const INSERT_BATCH = 500
const DRAIN_TIMEBOX_MS = 55_000

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId || !isAdmin(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const workspaceId = String(body.workspaceId || '')
  const count = Math.trunc(Number(body.count) || 0)
  const mode = body.mode === 'drain' ? 'drain' : 'enqueue'
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  if (!Number.isFinite(count) || count < 1 || count > MAX_COUNT) {
    return NextResponse.json({ error: `count must be 1..${MAX_COUNT}` }, { status: 400 })
  }
  if (body.confirm !== true) {
    return NextResponse.json({ error: 'confirm:true required' }, { status: 400 })
  }
  if (mode === 'drain' && process.env.NODE_ENV === 'production' && body.allowProductionDrain !== true) {
    return NextResponse.json(
      { error: 'drain mode refused in production without allowProductionDrain:true (it hits the real Odoo)' },
      { status: 403 }
    )
  }

  const runId = `rehearsal:${Date.now().toString(36)}`
  const dueAt =
    mode === 'drain' ? new Date().toISOString() : new Date(Date.now() + 60 * 60 * 1000).toISOString()

  // ── 1) الإدخال على دفعات ──────────────────────────────────────────
  const insertStart = Date.now()
  let inserted = 0
  for (let offset = 0; offset < count; offset += INSERT_BATCH) {
    const batch = Math.min(INSERT_BATCH, count - offset)
    const rows = Array.from({ length: batch }, (_, k) => {
      const i = offset + k
      return {
        workspace_id: workspaceId,
        store_id: `rehearsal-store`,
        event: 'order.status.update',
        platform: 'zid',
        payload: {
          id: `${runId}-order-${i}`,
          updated_at: new Date().toISOString(),
          rehearsal: true,
        },
        retry_count: 0,
        max_retries: 5,
        next_retry_at: dueAt,
        dedup_key: `${runId}:${i}`,
      }
    })
    const { error } = await supabase.from('sync_queue').insert(rows)
    if (error) {
      // نظّف ما أُدخل ثم أبلغ — لا تترك بواقي بروفة خلفك.
      await supabase.from('sync_queue').delete().like('dedup_key', `${runId}:%`)
      return NextResponse.json({ error: `insert failed at offset ${offset}: ${error.message}` }, { status: 500 })
    }
    inserted += batch
  }
  const insertMs = Date.now() - insertStart

  // ── 2) التصريف (drain فقط) ───────────────────────────────────────
  let drained = 0
  let drainSucceeded = 0
  let drainRetried = 0
  if (mode === 'drain') {
    const { processWorkspaceQueue } = await import('@/lib/sync-queue')
    const deadline = Date.now() + DRAIN_TIMEBOX_MS
    while (drained < inserted && Date.now() < deadline) {
      const r = await processWorkspaceQueue(workspaceId, 100)
      if (r.processed === 0) break
      drained += r.processed
      drainSucceeded += r.succeeded
      drainRetried += r.retried
    }
  }

  // ── 3) التنظيف الكامل ─────────────────────────────────────────────
  const { error: delErr } = await supabase.from('sync_queue').delete().like('dedup_key', `${runId}:%`)

  await recordAudit({
    actorId: userId,
    actorRole: 'admin',
    action: 'admin.load_rehearsal',
    entityType: 'workspace',
    entityId: workspaceId,
    metadata: { mode, count, inserted, drained, drainSucceeded, drainRetried },
  }).catch(() => {})

  return NextResponse.json({
    success: true,
    mode,
    count,
    inserted,
    insertMs,
    insertsPerSec: inserted > 0 ? Math.round((inserted / Math.max(1, insertMs)) * 1000) : 0,
    drained,
    drainSucceeded,
    drainRetried,
    cleaned: !delErr,
    note:
      mode === 'enqueue'
        ? 'صفوف البروفة حُذفت — لم تلمس أودوو. لقياس التصريف استخدم mode=drain خارج الإنتاج.'
        : 'انتهت المهلة أو نفدت الصفوف — البواقي حُذفت. كرر للمزيد.',
  })
}
