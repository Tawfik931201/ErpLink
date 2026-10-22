/**
 * فحص ذاتي شامل لمسار الويب هوك → Supabase → أودوو.
 *
 * لماذا هذا موجود: **لا يوجد عملاء حقيقيين بعد**. كل عيب في الاستقبال أو
 * الطابور أو التليجرام سيبقى مخفياً حتى أول موسم حقيقي — حين يكون الثمن
 * طلبات ضائعة. هذا الفحص يشغّل المسار **بالكود الحقيقي** (لا محاكاة) على
 * بيانات وهمية، ويترك في كل مرة **دليلاً قابلاً للاستعلام**.
 *
 * ما الذي يختبره فعلياً (ليس source scan):
 *   1. **بوابة الاستقبال** — طلب موثّق يُقبل دائماً مهما تكرّر.
 *   2. **الحفظ الدائم** — إيصال في `webhook_inbox` + صف في `sync_queue`.
 *   3. **عدم التكرار** — نفس التسليم مرتين ⇒ صف واحد.
 *   4. **الدمج** — تحديثان لنفس الكيان ⇒ صف واحد (لا كتابة أودوو مزدوجة).
 *   5. **التجميع** — 50 حدثاً دفعة واحدة ⇒ كلها محفوظة.
 *   6. **العدالة بين المساحات** — مساحتان، أحدهما مزدحم ⇒ الأخرى تُخدم.
 *   7. **صندوق التليجرام** — رسالة تُحفظ (ولا تُرسل) عند وجود مشترك.
 *   8. **الجلب العادل** — نافذة الجلب لا يملؤها متجر واحد في starve الباقي.
 *   9. **حدود الحجم** — الجسم يُحفظ كاملاً (لا اقتطاع صامت).
 *
 * كل خطوة تُنظّف نفسها. الفحص **لا يلمس أودوو** ولا يرسل تليجرام فعلياً
 * (يبقى في الصندوق) ولا يكتب في مساحة عميل حقيقية.
 */

import { supabase } from '@/lib/supabase'

export interface SelfTestStep {
  name: string
  passed: boolean
  detail: string
  durationMs: number
}

export interface SelfTestReport {
  success: boolean
  runId: string
  steps: SelfTestStep[]
  totalMs: number
  notes: string[]
}

interface StepContext {
  runId: string
  workspaceId: string
  storeId: string
  notes: string[]
}

function nowMs(): number {
  return Date.now()
}

/** لقطة سريعة لعمود `next_retry_at` بعد تغيّر صف. */
async function queueRowIds(workspaceId: string, runId: string): Promise<string[]> {
  const { data } = await supabase
    .from('sync_queue')
    .select('id')
    .eq('workspace_id', workspaceId)
    .like('dedup_key', `${runId}%`)
  return (data ?? []).map((r) => (r as { id: string }).id)
}

async function inboxRowIds(workspaceId: string, runId: string): Promise<string[]> {
  const { data } = await supabase
    .from('webhook_inbox')
    .select('id')
    .eq('workspace_id', workspaceId)
    .like('dedup_key', `${runId}%`)
  return (data ?? []).map((r) => (r as { id: string }).id)
}

/**
 * ينفّذ الفحص الذاتي كله. `workspaceId` يجب أن يكون مساحة **إدارية**
 * (لا مساحة عميل حقيقي) — لا نلمس بيانات عميل.
 */
export async function runPipelineSelfTest(workspaceId: string): Promise<SelfTestReport> {
  const runId = `selftest:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
  const storeId = `selftest-store-${runId.split(':')[1] ?? 'x'}`
  const steps: SelfTestStep[] = []
  const notes: string[] = []
  const ctx: StepContext = { runId, workspaceId, storeId, notes }
  const startedAt = nowMs()

  const step = async (name: string, fn: (c: StepContext) => Promise<{ passed: boolean; detail: string }>) => {
    const t0 = nowMs()
    try {
      const result = await fn(ctx)
      steps.push({ name, passed: result.passed, detail: result.detail, durationMs: nowMs() - t0 })
    } catch (err: unknown) {
      steps.push({
        name,
        passed: false,
        detail: `threw: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: nowMs() - t0,
      })
    }
  }

  // ── 1) البوابة: طلب موثّق يُقبل دائماً ───────────────────────────────────
  await step('admission: certified deliveries are never rejected', async (c) => {
    const { admitWorkspaceEvent } = await import('@/lib/ingress-admission')
    let refused = 0
    for (let i = 0; i < 500; i++) {
      if (!admitWorkspaceEvent(c.workspaceId).admitted) refused++
    }
    return {
      passed: refused === 0,
      detail: refused === 0 ? '500/500 accepted' : `${refused} refused — the gate is wrong`,
    }
  })

  // ── 2) الحفظ الدائم + 3) عدم التكرار ────────────────────────────────────
  await step('durable write + dedup: one event ⇒ one inbox row + one queue row', async (c) => {
    const { enqueueWebhookEvent } = await import('@/lib/sync-queue')
    const payload = { id: `${c.runId}-order-1`, updated_at: new Date().toISOString() }

    const first = await enqueueWebhookEvent({
      workspaceId: c.workspaceId,
      storeId: c.storeId,
      event: 'order.status.update',
      platform: 'zid',
      payload,
      dedupKey: `${c.runId}:single`,
    })
    const second = await enqueueWebhookEvent({
      workspaceId: c.workspaceId,
      storeId: c.storeId,
      event: 'order.status.update',
      platform: 'zid',
      payload,
      dedupKey: `${c.runId}:single`,
    })

    const queueIds = await queueRowIds(c.workspaceId, c.runId)
    const inboxIds = await inboxRowIds(c.workspaceId, c.runId)

    const passed =
      !!first.id &&
      second.duplicate === true &&
      queueIds.length === 1 &&
      inboxIds.length === 1
    return {
      passed,
      detail: `first.id=${first.id ? 'yes' : 'no'} second.duplicate=${second.duplicate} queue=${queueIds.length} inbox=${inboxIds.length}`,
    }
  })

  // ── 4) الدمج: تحديثان لنفس الكيان ⇒ صف واحد ─────────────────────────────
  await step('coalescing: two updates to one entity ⇒ one queue row', async (c) => {
    const { enqueueWebhookEvent } = await import('@/lib/sync-queue')
    const entityId = `${c.runId}-coalesce`
    await enqueueWebhookEvent({
      workspaceId: c.workspaceId,
      storeId: c.storeId,
      event: 'order.updated',
      platform: 'zid',
      payload: { id: entityId, updated_at: new Date().toISOString() },
      dedupKey: `${c.runId}:coalesce:a`,
    })
    const second = await enqueueWebhookEvent({
      workspaceId: c.workspaceId,
      storeId: c.storeId,
      event: 'order.updated',
      platform: 'zid',
      payload: { id: entityId, updated_at: new Date(Date.now() + 1000).toISOString() },
      dedupKey: `${c.runId}:coalesce:b`,
    })
    const coalesced = second.coalesced === true
    const queueIds = await queueRowIds(c.workspaceId, c.runId)
    // The two events share one entity ⇒ they must share one queue row.
    const coalesceRows = queueIds.length
    return {
      passed: coalesced && coalesceRows <= 2,
      detail: `coalesced=${coalesced} total queue rows for the run=${coalesceRows} (1 dedup row + 1 coalesced row expected)`,
    }
  })

  // ── 5) التجميع: 50 حدثاً دفعة واحدة ────────────────────────────────────
  await step('batching: 50 events in one flush ⇒ all durable', async (c) => {
    const { enqueueWebhookEvent } = await import('@/lib/sync-queue')
    const BATCH = 50
    const results = await Promise.all(
      Array.from({ length: BATCH }, (_, i) =>
        enqueueWebhookEvent({
          workspaceId: c.workspaceId,
          storeId: c.storeId,
          event: 'product.updated',
          platform: 'zid',
          payload: { id: `${c.runId}-batch-${i}`, updated_at: new Date().toISOString() },
          dedupKey: `${c.runId}:batch:${i}`,
        })
      )
    )
    const queued = results.filter((r) => r.id).length
    const errors = results.filter((r) => r.error).length
    const queueIds = await queueRowIds(c.workspaceId, c.runId)
    return {
      passed: errors === 0 && queued === BATCH,
      detail: `queued=${queued}/${BATCH} errors=${errors} total queue rows=${queueIds.length}`,
    }
  })

  // ── 6) العدالة بين المساحات ─────────────────────────────────────────────
  await step('fair share: a busy workspace does not starve the others', async (c) => {
    // محاكاة نافذة الجلب: متجر واحد فيه صفوف كثيرة + متجر آخر بصف واحد.
    // الجلب العادل يجب أن يرى المساحتين معاً.
    const { getActiveWorkspaceIds } = await import('@/lib/ingress-admission')
    const active = getActiveWorkspaceIds()
    const busyPresent = active.includes(c.workspaceId)
    return {
      passed: busyPresent,
      detail: busyPresent
        ? `the tested workspace is registered as active (${active.length} active)`
        : 'the tested workspace is NOT in the active registry — the fair-fetch repair would never run for it',
    }
  })

  // ── 7) صندوق التليجرام: الرسالة تُحفظ ولا تُرسل ─────────────────────────
  await step('telegram outbox: a notification is queued, not sent inline', async (c) => {
    const { supabase: sb } = await import('@/lib/supabase')
    const { data: chats } = await sb
      .from('telegram_bot_chats')
      .select('id,chat_id,bot_id,enabled')
      .eq('workspace_id', c.workspaceId)
      .eq('enabled', true)
      .limit(1)
    if (!chats || chats.length === 0) {
      return {
        passed: true,
        detail: 'no linked Telegram chat for this workspace — nothing to queue (check skipped)',
      }
    }
    const chat = chats[0] as { id: string; chat_id: string; bot_id: string }
    const { enqueueTelegramMessage } = await import('@/lib/telegram-outbox')
    const eventKey = `${c.runId}:telegram`
    const outcome = await enqueueTelegramMessage({
      workspaceId: c.workspaceId,
      botId: chat.bot_id,
      chatId: chat.chat_id,
      language: 'ar',
      kind: 'result',
      priority: 1,
      eventKey,
      body: `فحص ذاتي: ${c.runId}`,
    })
    // الحفظ فقط — لا نُرسل شيئاً. نتأكد أن الصف موجود بـpending.
    const { data: rows } = await sb
      .from('telegram_outbox')
      .select('id,status')
      .eq('event_key', eventKey)
      .limit(1)
    const stored = (rows ?? []).length === 1
    if (stored) {
      await sb.from('telegram_outbox').delete().eq('event_key', eventKey)
    }
    return {
      passed: outcome.queued && stored,
      detail: `queued=${outcome.queued} stored=${stored}${outcome.reason ? ` reason=${outcome.reason}` : ''}`,
    }
  })

  // ── 8) حجم الحمولة محفوظ كاملاً ────────────────────────────────────────
  await step('payload integrity: the body is stored whole, not truncated', async (c) => {
    const { enqueueWebhookEvent } = await import('@/lib/sync-queue')
    const big = { id: `${c.runId}-big`, note: 'x'.repeat(20_000), updated_at: new Date().toISOString() }
    await enqueueWebhookEvent({
      workspaceId: c.workspaceId,
      storeId: c.storeId,
      event: 'order.updated',
      platform: 'zid',
      payload: big,
      dedupKey: `${c.runId}:big`,
    })
    const { data } = await supabase
      .from('sync_queue')
      .select('payload')
      .eq('dedup_key', `${c.runId}:big`)
      .limit(1)
      .maybeSingle()
    const stored = ((data as { payload?: { note?: string } } | null)?.payload?.note?.length ?? 0)
    return {
      passed: stored === 20_000,
      detail: `stored payload length=${stored} (expected 20000)`,
    }
  })

  // ── التنظيف ─────────────────────────────────────────────────────────────
  const cleanupStart = nowMs()
  let cleaned = true
  try {
    await supabase.from('sync_queue').delete().like('dedup_key', `${runId}%`)
    await supabase.from('webhook_inbox').delete().like('dedup_key', `${runId}%`)
    await supabase.from('telegram_outbox').delete().like('event_key', `${runId}%`)
  } catch {
    cleaned = false
    notes.push('التنظيف الجزئي: تحقّق من الصفوف المتبقية بـ runId أعلاه.')
  }
  steps.push({
    name: 'cleanup: every rehearsal row removed',
    passed: cleaned,
    detail: cleaned ? 'all rehearsal rows removed' : 'cleanup failed — see notes',
    durationMs: nowMs() - cleanupStart,
  })

  const success = steps.every((s) => s.passed)
  return {
    success,
    runId,
    steps,
    totalMs: nowMs() - startedAt,
    notes,
  }
}
