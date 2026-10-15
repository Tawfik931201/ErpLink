import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import { isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import {
  MAX_CONCURRENT_PER_WORKSPACE,
  SYNC_QUEUE_CONCURRENCY,
  SYNC_QUEUE_DEFAULT_BATCH,
  SYNC_QUEUE_MAX_RETRIES,
  getCircuitBreakerState,
  getSyncQueueMetrics,
  isSeasonMode,
} from '@/lib/sync-queue'

/**
 * GET /api/admin/queue-health — قائمة تحقق ما قبل الموسم (P0-2).
 *
 * يجيب عن ثلاثة أسئلة في استدعاء واحد:
 *   1. هل Runner يعمل؟ (SYNC_QUEUE_SELF_RUNNER في الإنتاج)
 *   2. هل ترحيلا الموثوقية مطبقان؟ (الجداول + عمود dedup_key)
 *   3. ما عمق الطابور الآن؟ (معلق / مجمد / يتيم / ميت + عمر أقدم معلق)
 *
 * Read-only تماماً: لا يكتب شيئاً ولا يشغّل دورة. مخصص للأدمن فقط.
 */

interface TableCheck {
  ok: boolean
  error?: string
}

async function checkTable(table: string, columns?: string): Promise<TableCheck> {
  try {
    const { error } = await supabase
      .from(table)
      .select(columns ?? 'id')
      .limit(1)
    if (error) {
      const code = (error as { code?: string }).code ?? ''
      // 42P01 = جدول غير موجود، 42703 = عمود غير موجود (ترحيل ناقص)
      return { ok: false, error: `${code || 'error'}: ${error.message?.slice(0, 120)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 120) : 'check_failed' }
  }
}

async function countRows(
  table: string,
  filter?: (q: any) => any
): Promise<number | null> {
  try {
    let q: any = supabase.from(table).select('id', { count: 'exact', head: true })
    if (filter) q = filter(q)
    const { count, error } = await q
    if (error) return null
    return typeof count === 'number' ? count : null
  } catch {
    return null
  }
}

export async function GET() {
  const { userId } = await auth()
  if (!userId || !isAdmin(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const isProduction = process.env.NODE_ENV === 'production'
  const selfRunner = process.env.SYNC_QUEUE_SELF_RUNNER === 'true'
  const pollMs = Number(process.env.SYNC_QUEUE_POLL_INTERVAL_MS) || 30_000
  const reconcileMs = Number(process.env.SYNC_RECONCILE_INTERVAL_MS) || 600_000

  // ── ترحيلا الموثوقية ──────────────────────────────────────────────
  const inbox = await checkTable('webhook_inbox')
  const queueDedup = await checkTable('sync_queue', 'dedup_key')
  const inboxDedup = await checkTable('webhook_inbox', 'dedup_key')
  const dead = await checkTable('sync_queue_dead')
  const reconcileState = await checkTable('sync_reconcile_state')
  const migrationsOk =
    inbox.ok && queueDedup.ok && inboxDedup.ok && dead.ok && reconcileState.ok

  // ── عمق الطابور ──────────────────────────────────────────────────
  const [pending, frozen, orphans, deadCount, skipped24h] = await Promise.all([
    countRows('sync_queue', (q: any) => q.not('next_retry_at', 'is', null)),
    countRows('sync_queue', (q: any) => q.is('next_retry_at', null)),
    countRows('webhook_inbox', (q: any) => q.eq('status', 'pending').is('workspace_id', null)),
    countRows('sync_queue_dead'),
    countRows('sync_logs', (q: any) =>
      q
        .eq('status', 'skipped')
        .eq('trigger_type', 'webhook-ingress')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    ),
  ])

  let oldestPendingAgeSec: number | null = null
  try {
    const { data } = await supabase
      .from('sync_queue')
      .select('next_retry_at')
      .not('next_retry_at', 'is', null)
      .order('next_retry_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const ts = (data as { next_retry_at?: string } | null)?.next_retry_at
    if (ts) oldestPendingAgeSec = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000))
  } catch {
    oldestPendingAgeSec = null
  }

  const runnerOk = !isProduction || selfRunner
  const ready = runnerOk && migrationsOk

  return NextResponse.json({
    success: true,
    ready,
    timestamp: new Date().toISOString(),
    runner: {
      ok: runnerOk,
      selfRunner,
      nodeEnv: process.env.NODE_ENV ?? 'development',
      pollIntervalSec: Math.round(pollMs / 1000),
      reconcileIntervalMin: Math.round(reconcileMs / 60000),
      concurrency: SYNC_QUEUE_CONCURRENCY,
      batchSize: SYNC_QUEUE_DEFAULT_BATCH,
      maxPerWorkspace: MAX_CONCURRENT_PER_WORKSPACE,
      maxRetries: SYNC_QUEUE_MAX_RETRIES,
      seasonMode: isSeasonMode(),
      circuitBreakerThreshold: Number(process.env.SYNC_CB_THRESHOLD) || 10,
      circuitBreakerCooldownMin: Number(process.env.SYNC_CB_COOLDOWN_MIN) || 15,
    },
    migrations: {
      ok: migrationsOk,
      webhook_inbox: inbox,
      sync_queue_dedup_key: queueDedup,
      webhook_inbox_dedup_key: inboxDedup,
      sync_queue_dead: dead,
      sync_reconcile_state: reconcileState,
    },
    depth: {
      pending,
      frozen,
      orphans,
      deadLetter: deadCount,
      ingressSkipped24h: skipped24h,
      oldestPendingAgeSec,
    },
    ingressRateLimit: {
      perSenderPerMinute: 120,
      note: 'سقف الاستقبال لكل مرسِل — تأكد أن زد/سلة لا تشترك في عنوان إرسال واحد وقت الذروة',
    },
    circuitBreakers: getCircuitBreakerState(),
    metrics: getSyncQueueMetrics(),
  })
}
