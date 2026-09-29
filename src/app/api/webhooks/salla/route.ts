/**
 * POST /api/webhooks/salla
 *
 * Receives real-time webhook events from Salla:
 *   - product.created / product.updated / product.deleted / product.publish / ...
 *   - order.created / order.updated / order.status.updated / order.cancelled / ...
 *   - customer.created / customer.updated / customer.login
 *   - category.created / category.updated / category.deleted
 *   - store.branch.* / abandoned.cart.* / app.uninstalled
 *
 * Bulk design: this handler does ONLY cheap checks + one indexed DB
 * read/write, then returns 200 immediately. Salla retries on timeout, so any
 * Salla API enrichment or heavy I/O here would cause duplicate storms.
 * Thin payloads are enriched later inside the background queue worker
 * (see processWebhookEvent in sync-engine.ts).
 *
 * Security: Salla includes an HMAC-SHA256 signature in the x-salla-signature header.
 */
import crypto from 'crypto'

import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

import { recordAudit } from '@/lib/audit-logs'
import { SALLA_DEFAULT_WEBHOOK_EVENTS } from '@/lib/salla-client'
import { supabase } from '@/lib/supabase'
import { isWebhookEventEnabled } from '@/lib/webhook-gate'

// Events older than this are ignored (Salla redeliveries arriving late must
// not overwrite newer state applied after them).
const STALE_EVENT_MAX_AGE_MS = 15 * 60 * 1000

/**
 * Salla sends `merchant` as a number in most events, but as an object
 * `{ id: ... }` in some app-lifecycle events. Accept number|string|object.
 */
function extractSallaMerchantId(payload: any): string {
  const m = payload?.merchant ?? payload?.merchant_id ?? payload?.store_id ?? payload?.data?.merchant_id
  if (m === null || m === undefined || m === '') return ''
  if (typeof m === 'object') {
    const id = (m as any).id ?? (m as any).merchant_id ?? (m as any).store_id
    return id === null || id === undefined ? '' : String(id)
  }
  return String(m)
}

/** Best-effort webhook delivery id for idempotency (header or payload). */
function extractSallaWebhookId(payload: any, getHeader: (name: string) => string | null): string {
  const fromHeader =
    getHeader('x-salla-webhook-id') ??
    getHeader('x-salla-delivery-id') ??
    ''
  if (fromHeader) return fromHeader
  return String(
    payload?.uuid ?? payload?.webhook_id ?? payload?.delivery_id ?? payload?.event_id ?? ''
  )
}

function verifySallaSignature(body: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false
  try {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function buildDedupKey(merchantId: string, event: string, webhookId: string): string {
  return `salla:${merchantId}:${event}:${webhookId}`
}

/** Best-effort metric (count + last_at). Never throws — table may not exist yet. */
async function recordSallaWebhookMetric(storeId: string, event: string): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('webhook_metrics')
      .select('count')
      .eq('store_id', storeId)
      .eq('event', event)
      .eq('platform', 'salla')
      .maybeSingle()
    await supabase.from('webhook_metrics').upsert(
      {
        store_id: storeId,
        event,
        platform: 'salla',
        count: (existing?.count ?? 0) + 1,
        last_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'store_id,event,platform' }
    )
  } catch {
    // Best-effort only (migration 20260910 may not be applied yet).
  }
}

export async function POST(req: NextRequest) {
  // لا setInterval هنا — المعالجة عبر GET /api/cron/sync-queue بمجدول خارجي.
  const rawBody = await req.text()
  const headersList = headers()
  const getHeader = (name: string) => headersList.get(name)
  const signature = getHeader('x-salla-signature') ?? getHeader('salla-signature') ?? ''
  const webhookSecret = process.env.SALLA_WEBHOOK_SECRET ?? ''

  // ── 1. Signature early-return (before any parsing or DB I/O) ─────────────
  if (webhookSecret) {
    if (!verifySallaSignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json(
        { error: 'Invalid signature', message_ar: 'توقيع الويب هوك غير صالح. تحقق من SALLA_WEBHOOK_SECRET.' },
        { status: 401 }
      )
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[Salla Webhook] Security Alert: SALLA_WEBHOOK_SECRET is not configured in production.')
    return NextResponse.json(
      { error: 'Webhook secret not configured on server', message_ar: 'لم يتم تكوين المفتاح السري للويب هوك في بيئة الإنتاج.' },
      { status: 500 }
    )
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON', message_ar: 'بيانات الويب هوك غير صالحة.' },
      { status: 400 }
    )
  }

  const event = String(payload.event ?? payload.topic ?? '')
  const merchantId = extractSallaMerchantId(payload)
  const data = payload.data ?? {}
  const webhookId = extractSallaWebhookId(payload, getHeader)

  // ── 2. Missing merchant early-return ──────────────────────────────────────
  if (!merchantId) {
    return NextResponse.json(
      { error: 'Merchant ID not found in payload', message_ar: 'تعذر التعرف على المتجر في بيانات الويب هوك.' },
      { status: 400 }
    )
  }

  // ── 3. App uninstalled → clean the token + pending jobs, fast 200 ─────────
  // Must run BEFORE the token lookup so orphaned stores are removed even if
  // sync settings would otherwise 404/skip.
  if (event === 'app.uninstalled') {
    await supabase.from('salla_tokens').delete().eq('merchant_id', merchantId)
    // Drop pending Salla jobs so the runner stops retrying a dead token.
    await supabase.from('sync_queue').delete().eq('store_id', merchantId).eq('platform', 'salla')
    await recordAudit({
      actorId: merchantId,
      actorRole: 'system',
      action: 'salla.app_uninstalled',
      entityType: 'salla_store',
      entityId: merchantId,
    }).catch(() => {})
    return NextResponse.json({ received: true, processed: true, reason: 'app_uninstalled' })
  }

  // ── 4. Missing/empty event early-return ───────────────────────────────────
  if (!event) {
    return NextResponse.json({ received: true, processed: false, reason: 'missing_event' })
  }

  // ── 5. Stale delivery early-return (late redelivery must not regress state)
  const createdAtRaw = payload.created_at ?? payload.timestamp
  if (createdAtRaw) {
    const createdMs = new Date(String(createdAtRaw)).getTime()
    if (Number.isFinite(createdMs) && Date.now() - createdMs > STALE_EVENT_MAX_AGE_MS) {
      return NextResponse.json({ received: true, processed: false, reason: 'stale' })
    }
  }

  // ── 6. Store-connected early-return (minimal column select) ───────────────
  const { data: sallaToken, error: tokenErr } = await supabase
    .from('salla_tokens')
    .select('workspace_id')
    .eq('merchant_id', merchantId)
    .maybeSingle()

  if (tokenErr || !sallaToken?.workspace_id) {
    // لا يوجد ربط متجر لهذا الـmerchant — لا نخمّن المستأجر.
    //
    // كان يُعاد 404 هنا، أي رفض نهائي: سالا تعيد 3 محاولات ثم تتوقف، فيضيع
    // الحدث. الآن نحفظه في صندوق الاستلام كـ«orphan» ونعيد 202: المتجر يتوقف
    // عن الإرسال بلا فائدة، والحدث يبقى محفوظاً قابلاً للاسترداد فور ربط
    // المتجر. نفس سلوك مسار زد.
    console.error('[Salla Webhook] no workspace bound to merchant — event stored as orphan', {
      event,
      merchantId,
    })
    const { recordOrphanReceipt } = await import('@/lib/webhook-inbox')
    const { fingerprintPayload } = await import('@/lib/sync-queue')
    const stored = await recordOrphanReceipt({
      platform: 'salla',
      storeId: merchantId,
      event,
      dedupKey: `salla:orphan:${merchantId}:${event}:${
        webhookId || fingerprintPayload(data as Record<string, unknown>)
      }`,
      payload: data as Record<string, unknown>,
    })
    if (!stored.ok) {
      return NextResponse.json(
        { received: false, processed: false, error: stored.error ?? 'orphan_store_failed' },
        { status: 503 }
      )
    }
    return NextResponse.json(
      { received: true, processed: false, queued: false, reason: 'store_not_linked' },
      { status: 202 }
    )
  }

  // ── 7. Disabled-event early-return (Standard Mapping settings gate) ────────
  const { allowed, reason } = await isWebhookEventEnabled(sallaToken.workspace_id, 'salla', event)

  if (!allowed) {
    return NextResponse.json({ received: true, processed: false, reason: 'disabled_in_settings', detail: reason })
  }

  // ── 8. الاستلام الدائم أولاً (webhook_inbox) ──────────────────────────────
  // يُكتب الحدث قبل أي معالجة. إن فشل نرد 503 فتعيد سالا الإرسال (3 مرات)
  // والأهم: يبقى في صندوق الاستلام ليُعاد دفعه من cron.
  const dedupKey = webhookId ? buildDedupKey(merchantId, event, webhookId) : null
  const { recordWebhookReceipt, completeWebhookReceipt } = await import('@/lib/webhook-inbox')
  const receipt = await recordWebhookReceipt({
    platform: 'salla',
    storeId: merchantId,
    workspaceId: sallaToken.workspace_id,
    event,
    dedupKey,
    payload: (webhookId ? { ...(data as Record<string, any>), salla_webhook_id: webhookId } : data) as Record<string, unknown>,
  })
  if (!receipt.ok) {
    console.error('[Salla Webhook] inbox write failed:', receipt.error)
    return NextResponse.json(
      { received: false, processed: false, error: 'durable_storage_failed' },
      { status: 503 }
    )
  }
  if (receipt.duplicate) {
    return NextResponse.json({ received: true, processed: false, reason: 'duplicate' })
  }

  // ── 9. Idempotency: same delivery must never create a duplicate job ───────
  // dedup_key has a partial UNIQUE index, so concurrent double-deliveries
  // collapse even if both pass the check below — the loser gets a 23505
  // conflict which we translate to `duplicate`.
  if (dedupKey) {
    const { data: dup, error: dupErr } = await supabase
      .from('sync_queue')
      .select('id')
      .eq('dedup_key', dedupKey)
      .limit(1)
      .maybeSingle()
    if (dup) {
      if (dedupKey) void completeWebhookReceipt(dedupKey).catch(() => {})
      return NextResponse.json({ received: true, processed: false, reason: 'duplicate' })
    }
    // Pre-migration fallback (no dedup_key column yet): legacy payload check.
    if (dupErr) {
      const { data: legacyDup } = await supabase
        .from('sync_queue')
        .select('id')
        .eq('store_id', merchantId)
        .eq('event', event)
        .contains('payload', { salla_webhook_id: webhookId })
        .limit(1)
        .maybeSingle()
      if (legacyDup) {
        if (dedupKey) void completeWebhookReceipt(dedupKey).catch(() => {})
        return NextResponse.json({ received: true, processed: false, reason: 'duplicate' })
      }
    }
  }

  // ── 10. Coalescing: collapse bursts for the same entity into one job ───────
  // If a pending job already exists for this store+event+entity, merge the
  // newest payload into it instead of enqueueing N jobs. The row keeps its
  // FIRST dedup_key: a redelivery of a merged (superseded) id then either
  // merges again (still pending → no duplicate) or re-applies identical data
  // (already processed → harmless, never a stale overwrite).
  const entityId = data && typeof data === 'object' && data.id !== undefined && data.id !== null
    ? String(data.id)
    : ''
  if (entityId) {
    const { data: recent } = await supabase
      .from('sync_queue')
      .select('id, payload, next_retry_at')
      .eq('store_id', merchantId)
      .eq('event', event)
      .eq('platform', 'salla')
      .order('created_at', { ascending: false })
      .limit(10)
    const pending = (recent || []).find(
      (row: any) =>
        row?.next_retry_at !== null &&
        row?.payload &&
        typeof row.payload === 'object' &&
        String((row.payload as any).id ?? '') === entityId
    ) as any
    if (pending) {
      const prevPayload = (pending.payload as Record<string, any>) || {}
      const merged = {
        ...prevPayload,
        ...(data as Record<string, any>),
        // Keep the FIRST delivery id for idempotency (see comment above).
        salla_webhook_id: prevPayload.salla_webhook_id ?? (webhookId || undefined),
        salla_coalesced_count: Number(prevPayload.salla_coalesced_count ?? 1) + 1,
      }
      await supabase
        .from('sync_queue')
        .update({ payload: merged, updated_at: new Date().toISOString() })
        .eq('id', pending.id)
  await recordSallaWebhookMetric(merchantId, event)
  if (dedupKey) void completeWebhookReceipt(dedupKey).catch(() => {})
      return NextResponse.json({ received: true, queued: true, coalesced: true })
    }
  }

  // ── 11. Enqueue raw payload only (NO Salla API enrichment here) ───────────
  const baseRow: Record<string, any> = {
    workspace_id: sallaToken.workspace_id,
    store_id: merchantId,
    event,
    platform: 'salla',
    payload: webhookId ? { ...(data as Record<string, any>), salla_webhook_id: webhookId } : data,
    retry_count: 0,
    max_retries: 3,
    next_retry_at: new Date().toISOString(),
  }
  if (dedupKey) baseRow.dedup_key = dedupKey

  const { error: insertErr } = await supabase.from('sync_queue').insert(baseRow)
  if (insertErr) {
    // Race loser: another worker inserted the same delivery concurrently.
    if ((insertErr as any).code === '23505') {
      return NextResponse.json({ received: true, processed: false, reason: 'duplicate' })
    }
    // Migration not applied yet (no dedup_key column) → retry without it.
    if ((insertErr as any).code === '42703' && dedupKey) {
      const retryRow = { ...baseRow }
      delete retryRow.dedup_key
      const { error: retryErr } = await supabase.from('sync_queue').insert(retryRow)
      if (retryErr) {
        console.error('[Salla Webhook] durable enqueue failed:', retryErr.message)
        return NextResponse.json(
          { received: false, processed: false, error: 'durable_storage_failed' },
          { status: 503 }
        )
      }
    } else {
      console.error('[Salla Webhook] durable enqueue failed:', insertErr.message)
      return NextResponse.json(
        { received: false, processed: false, error: 'durable_storage_failed' },
        { status: 503 }
      )
    }
  }

  await recordSallaWebhookMetric(merchantId, event)
  if (dedupKey) void completeWebhookReceipt(dedupKey).catch(() => {})

  // لا تشغيل الطابور داخل الطلب إطلاقاً: على استضافة مشتركة (Hostinger) هذا
  // يعني تنفيذ مزامنة كاملة داخل طلب الويب هوك، وهو أكبر مصدر للضغط على
  // السيرفر. المعالجة كلها عبر /api/cron/sync-queue كل دقيقة.
  return NextResponse.json({ received: true, queued: true })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Salla webhook endpoint is ready.',
    events: SALLA_DEFAULT_WEBHOOK_EVENTS,
  })
}
