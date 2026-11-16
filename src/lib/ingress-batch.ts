/**
 * مجمّع الكتابة عند الاستقبال — يحوّل 5 عمليات قاعدة بيانات لكل حدث إلى
 * عمليتين لكل **دفعة**.
 *
 * التكلفة قبل (لكل حدث): INSERT إيصال + SELECT تكرار + SELECT دمج +
 * INSERT طابور + UPDATE تسوية = **5 عمليات**، و2 منها تكتبان الحمولة
 * كاملة (JSONB) ⇒ في ذروة 2000/دقيقة = **167 عملية/ثانية** و67 كتابة
 * حمولة/ثانية. هذا هو الحاجز الحقيقي أمام استقبال آلاف الطلبات.
 *
 * بعد: في الهدوء صفٌّ واحد ⇒ نفس التكلفة تماماً (لا تغيير سلوكي). تحت
 * الضغط: الدفعة (حتى 50 حدثاً) تُكتب بـ 3 عمليات فقط.
 *
 * ⚠️ قاعدة أساسية: **لا يُرسل الرد 2xx قبل الحفظ الدائم**. لذلك الطلب
 * ينتظر اكتمال التفريغ (حتى 150 مللي) — وهذا مقبول: المنصات (زد/سلة/
 * شوبيفاي) مهلة retry واسعة.
 *
 * ⚠️ مسار أودوو **لا يُجمَّع**: Automated Action في أودوو **لا يعيد
 * الإرسال** بعد خطأ، فكل كتابة تتم فوراً (بلا انتظار) — الأمان أهم من
 * الأداء هناك.
 */

/** أقصى عدد أحداث في الدفعة الواحدة. */
const MAX_BATCH = 50

/** أقصى انتظار قبل تفريغ الدفعة (مللي ثانية). */
const FLUSH_DELAY_MS = 150

export interface ReceiptRow {
  awaitingErp?: boolean
  erpConnectionId?: string
  connectionGeneration?: string
  dedupKey: string
  platform: string
  storeId: string
  workspaceId: string
  event: string
  payload: Record<string, unknown>
}

export interface ReceiptOutcome {
  ok: boolean
  duplicate: boolean
  id?: string
  error?: string
}

export interface QueueRow {
  workspace_id: string
  store_id: string
  event: string
  platform: string
  payload: Record<string, unknown>
  retry_count: number
  max_retries: number
  next_retry_at: string
  dedup_key?: string
}

export interface QueueOutcome {
  ok: boolean
  duplicate: boolean
  id?: string
  error?: string
}

// ─── الإدراج الفعلي (سطر واحد أو دفعة) ─────────────────────────────────────

async function insertReceiptsViaSupabase(rows: ReceiptRow[]): Promise<ReceiptOutcome[]> {
  const { supabase } = await import('./supabase')
  const payload = rows.map((row) => ({
    platform: row.platform,
    store_id: row.storeId,
    workspace_id: row.workspaceId,
    event: row.event,
    dedup_key: row.dedupKey,
    payload: row.payload,
    status: 'pending',
    awaiting_erp: row.awaitingErp ?? false,
    erp_connection_id: row.erpConnectionId ?? null,
    connection_generation: row.connectionGeneration ?? null,
  }))

  if (rows.length === 1) {
    const { data, error } = await supabase.from('webhook_inbox').insert(payload[0]).select('id').maybeSingle()
    if (!error && data) return [{ ok: true, duplicate: false, id: (data as { id: string }).id }]
    const code = (error as { code?: string } | null)?.code
    if (code === '23505') return [{ ok: true, duplicate: true }]
    return [{ ok: false, duplicate: false, error: error?.message?.slice(0, 200) ?? 'inbox_insert_failed' }]
  }

  const { data, error } = await supabase.from('webhook_inbox').insert(payload).select('id')
  if (!error && data) {
    const ids = data as Array<{ id: string }>
    return rows.map((_, index) => ({ ok: true, duplicate: false, id: ids[index]?.id }))
  }
  const code = (error as { code?: string } | null)?.code
  if (code === '23505') {
    // تكرار في الدفعة ⇒ نُعيد الإدراج صفاً صفاً لمعرفة مكرّر من جديد
    // (التكرار حميد — لا خطأ، ولا يُسقط الحدث).
    const results: ReceiptOutcome[] = []
    for (const row of rows) {
      const single = await insertReceiptsViaSupabase([row])
      results.push(single[0])
    }
    return results
  }
  const message = error?.message?.slice(0, 200) ?? 'inbox_insert_failed'
  return rows.map(() => ({ ok: false, duplicate: false, error: message }))
}

async function insertQueueRowsViaSupabase(rows: QueueRow[]): Promise<QueueOutcome[]> {
  const { supabase } = await import('./supabase')
  const payload = rows.map((row) => ({ ...row }))

  if (rows.length === 1) {
    const { data, error } = await supabase.from('sync_queue').insert(payload[0]).select('id').maybeSingle()
    if (!error && data) return [{ ok: true, duplicate: false, id: (data as { id: string }).id }]
    const code = (error as { code?: string } | null)?.code
    if (code === '23505') return [{ ok: true, duplicate: true }]
    if (code === '42703') {
      // عمود dedup_key غير موجود (ترحيل غير مطبَّق) — نعيد بدونه.
      const withoutKey = { ...payload[0] }
      delete (withoutKey as Record<string, unknown>).dedup_key
      const { data: retryData, error: retryErr } = await supabase
        .from('sync_queue')
        .insert(withoutKey)
        .select('id')
        .maybeSingle()
      if (!retryErr && retryData) {
        return [{ ok: true, duplicate: false, id: (retryData as { id: string }).id }]
      }
      return [{ ok: false, duplicate: false, error: retryErr?.message?.slice(0, 200) ?? 'queue_insert_failed' }]
    }
    return [{ ok: false, duplicate: false, error: error?.message?.slice(0, 200) ?? 'queue_insert_failed' }]
  }

  const { data, error } = await supabase.from('sync_queue').insert(payload).select('id')
  if (!error && data) {
    const ids = data as Array<{ id: string }>
    return rows.map((_, index) => ({ ok: true, duplicate: false, id: ids[index]?.id }))
  }
  const code = (error as { code?: string } | null)?.code
  if (code === '23505' || code === '42703') {
    const results: QueueOutcome[] = []
    for (const row of rows) {
      if (code === '23505') {
        const single = await insertQueueRowsViaSupabase([row])
        results.push(single[0])
        continue
      }
      const withoutKey = { ...row }
      delete (withoutKey as Record<string, unknown>).dedup_key
      const { data: retryData, error: retryErr } = await supabase
        .from('sync_queue')
        .insert(withoutKey)
        .select('id')
        .maybeSingle()
      if (!retryErr && retryData) {
        results.push({ ok: true, duplicate: false, id: (retryData as { id: string }).id })
      } else {
        results.push({ ok: false, duplicate: false, error: retryErr?.message?.slice(0, 200) ?? 'queue_insert_failed' })
      }
    }
    return results
  }
  const message = error?.message?.slice(0, 200) ?? 'queue_insert_failed'
  return rows.map(() => ({ ok: false, duplicate: false, error: message }))
}

// ─── الدفعة المشتركة ────────────────────────────────────────────────────────

interface PendingRequest {
  row: unknown
  resolve: (outcome: unknown) => void
}

interface PendingBatch {
  requests: PendingRequest[]
  timer: ReturnType<typeof setTimeout> | null
}

const receiptBatch: PendingBatch = { requests: [], timer: null }
const queueBatch: PendingBatch = { requests: [], timer: null }

function scheduleFlush(state: PendingBatch, flush: () => void): void {
  if (state.timer) return
  state.timer = setTimeout(() => {
    state.timer = null
    flush()
  }, FLUSH_DELAY_MS)
  if (typeof state.timer.unref === 'function') state.timer.unref()
}

/**
 * يكتب إيصالات الاستلام دفعة واحدة.
 *
 * الفهرس الجزئي `uq_webhook_inbox_dedup` (pending فقط) هو الضمان الذرّي:
 * تكرار ⇒ 23505. عند فشل الدفعة بسبب 23505 نُعيد الإدراج صفاً صفاً
 * لنعرف أيّها مكرّر (التكرار حميد — لا خطأ).
 *
 * كل نداء يُرجع **نتيجته وحدها** — كل طلب له وعد خاص به.
 */
export function insertReceipts(rows: ReceiptRow[]): Promise<ReceiptOutcome[]> {
  if (rows.length === 0) return Promise.resolve([])
  // صف واحد: بلا تجميع — نفس تكلفة اليوم تماماً.
  if (rows.length === 1) {
    return insertReceiptsViaSupabase(rows).catch(() => [{ ok: false, duplicate: false, error: 'inbox_transport_failed' }])
  }
  return Promise.all(rows.map((row) => new Promise<ReceiptOutcome>((resolve) => {
    receiptBatch.requests.push({
      row,
      resolve: (outcome: unknown) => resolve(outcome as ReceiptOutcome),
    })
    const flush = () => {
      const batch = receiptBatch.requests.splice(0, MAX_BATCH)
      if (batch.length === 0) return
      void insertReceiptsViaSupabase(batch.map((r) => r.row as ReceiptRow)).then((outcomes) => {
        batch.forEach((request, index) => request.resolve(outcomes[index]))
      }).catch(() => {
        batch.forEach((request) => request.resolve({ ok: false, duplicate: false, error: 'inbox_transport_failed' }))
      })
      // بقيت صفوف؟ نُفرّغها فوراً (لا ننتظر حدثاً جديداً).
      if (receiptBatch.requests.length > 0) scheduleFlush(receiptBatch, flush)
    }
    scheduleFlush(receiptBatch, flush)
  })))
}

/**
 * يكتب صفوف الطابور دفعة واحدة.
 */
export function insertQueueRows(rows: QueueRow[]): Promise<QueueOutcome[]> {
  if (rows.length === 0) return Promise.resolve([])
  if (rows.length === 1) {
    return insertQueueRowsViaSupabase(rows).catch(() => [{ ok: false, duplicate: false, error: 'queue_transport_failed' }])
  }
  return Promise.all(rows.map((row) => new Promise<QueueOutcome>((resolve) => {
    queueBatch.requests.push({
      row,
      resolve: (outcome: unknown) => resolve(outcome as QueueOutcome),
    })
    const flush = () => {
      const batch = queueBatch.requests.splice(0, MAX_BATCH)
      if (batch.length === 0) return
      void insertQueueRowsViaSupabase(batch.map((r) => r.row as QueueRow)).then((outcomes) => {
        batch.forEach((request, index) => request.resolve(outcomes[index]))
      }).catch(() => {
        batch.forEach((request) => request.resolve({ ok: false, duplicate: false, error: 'queue_transport_failed' }))
      })
      if (queueBatch.requests.length > 0) scheduleFlush(queueBatch, flush)
    }
    scheduleFlush(queueBatch, flush)
  })))
}

/**
 * تسوية إيصالات دفعة واحدة: UPDATE واحد لكل دفعة.
 *
 * نفس دلالات `completeWebhookReceipt` (فردياً) لكن بعملية واحدة. الفشل
 * غير قاتل: الإيصال يبقى `pending` ⇒ مسار الإنقاذ (drain) يعيد دفعه،
 * و`dedup_key` يمنع التكرار ⇒ لا ضياع ولا تنفيذ مزدوج.
 */
export async function settleReceipts(dedupKeys: string[]): Promise<void> {
  const keys = dedupKeys.filter(Boolean)
  if (keys.length === 0) return
  try {
    const { supabase } = await import('./supabase')
    await supabase
      .from('webhook_inbox')
      .update({ status: 'done', processed_at: new Date().toISOString() })
      .eq('status', 'pending')
      .in('dedup_key', keys)
  } catch {
    // التسوية فاشلة ⇒ الإيصال يبقى `pending` ⇒ مسار الإنقاذ يعيد دفعه.
  }
}

/** تصفير الحالة — للاختبارات فقط. */
export function resetIngressBatches(): void {
  receiptBatch.requests = []
  queueBatch.requests = []
  if (receiptBatch.timer) {
    clearTimeout(receiptBatch.timer)
    receiptBatch.timer = null
  }
  if (queueBatch.timer) {
    clearTimeout(queueBatch.timer)
    queueBatch.timer = null
  }
}
