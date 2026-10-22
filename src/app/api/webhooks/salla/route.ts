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
 * Reliability: the durable receipt is written by `enqueueWebhookEvent` BEFORE
 * the queue insert (it writes `webhook_inbox` itself), and a 2xx is only
 * returned after that lands — a failed durable write returns 503 so Salla
 * retries and the row stays recoverable. Queue processing happens in the
 * background runner, never inside this request.
 *
 * Security: Salla signs natively (`x-salla-signature`, HMAC-SHA256 of the raw
 * body), but the Portal secret was never set on the host — which made this route
 * return 500 before parsing anything and lost every delivery. Ingress is
 * therefore dual-path; see src/lib/salla/webhook-auth.ts for the full story.
 * Unauthenticated legacy deliveries are accepted but never trusted for the
 * destructive uninstall branch. Re-register every store via
 * POST /api/admin/salla-webhooks/refresh.
 */
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

import { recordAudit } from '@/lib/audit-logs'
import { checkUnauthenticatedIngressLimit } from '@/lib/ingress-admission'
import { rateLimitKeyFromHeaders } from '@/lib/rate-limit'
import {
  verifySallaWebhookAuth,
  sallaWebhookCredentialFingerprint,
} from '@/lib/salla/webhook-auth'
import { SALLA_DEFAULT_WEBHOOK_EVENTS } from '@/lib/salla-client'
import { supabase } from '@/lib/supabase'
import { isWebhookEventEnabled } from '@/lib/webhook-gate'
import { logWebhookSkip } from '@/lib/webhook-skip-log'
import {
  isStrictWebhookAuth,
  isWebhookBodyTooLarge,
  MAX_WEBHOOK_BODY_BYTES,
} from '@/lib/webhook-strict'

/**
 * Deliveries that carried no verifiable credential, i.e. from a subscription
 * created before the derived header existed. Logged sparsely: this counter is
 * the signal for "stores still need re-registering", so it must not stay silent,
 * but a busy store would otherwise flood the log.
 */
let legacyUnauthenticatedDeliveries = 0

function reportLegacyDelivery(storeIdHint: string | null) {
  legacyUnauthenticatedDeliveries += 1
  const count = legacyUnauthenticatedDeliveries
  if (count <= 3 || count % 50 === 0) {
    console.warn(
      `[Salla Webhook] Unauthenticated delivery #${count} (subscription predates the derived header). Accepted, but app.uninstalled is refused. Re-register webhooks: POST /api/admin/salla-webhooks/refresh`,
      { storeIdHint }
    )
  }
  // العدّاد الدائم: نسخة الذاكرة تُصفَّر عند إعادة التشغيل، فإشارة "صفر ⇒ أغلق
  // النافذة" يجب أن تأتي من webhook_legacy_counters لا من هنا.
  void import('@/lib/legacy-delivery-counter')
    .then(({ incrementLegacyDelivery }) => incrementLegacyDelivery('salla', storeIdHint ?? undefined))
    .catch(() => {})
}

/**
 * Deliveries dropped as "too old to apply", counted for the same reason: a
 * climbing counter means Salla is delivering late enough that `STALE_EVENT_MAX_AGE_MS`
 * is discarding real changes, which is a tuning decision, not something to discover
 * by noticing missing products.
 */
let staleSkippedDeliveries = 0

// Events older than this are ignored (Salla redeliveries arriving late must
// not overwrite newer state applied after them). See step 5 for what happens to
// the payload — it is saved, not discarded.
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

/**
 * Best-effort webhook delivery id for idempotency (header or payload).
 *
 * ⚠️ `payload.uuid` is deliberately NOT accepted. In Salla's envelope it is the
 * **entity** id (the order/product), not the delivery id, so keying dedup on it
 * makes every later update of the same record look like a duplicate and drops
 * real changes — the exact bug AGENTS.md records for Zid's old `payload.uuid`
 * key. Only true delivery markers are read here; when none is present the
 * canonical `enqueueWebhookEvent` falls back to a content fingerprint, which
 * still collapses an exact redelivery while letting genuine updates through.
 */
function extractSallaWebhookId(payload: any, getHeader: (name: string) => string | null): string {
  const fromHeader =
    getHeader('x-salla-webhook-id') ??
    getHeader('x-salla-delivery-id') ??
    ''
  if (fromHeader) return fromHeader
  return String(
    payload?.webhook_id ?? payload?.delivery_id ?? payload?.event_id ?? ''
  )
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
  // In development, ensure the background queue runner is running so a webhook
  // is observable without waiting for an external scheduler.
  if (process.env.NODE_ENV !== 'production') {
    import('@/lib/sync-queue-runner').then(({ startSyncQueueRunner }) => {
      startSyncQueueRunner()
    }).catch(() => {})
  }

  const rawBody = await req.text()
  const headersList = await headers()
  const getHeader = (name: string) => headersList.get(name)

  // ── 0. حد الاستقبال (للمجهولين فقط) + حارس حجم الجسم ─────────────────────
  // الطلب الموقّع (x-salla-signature أو السر المشتق) لا يخضع لحد الـIP:
  // حد 120/دقيقة كان يحوّل عملاء الموسم إلى ضياع صامت (429 ⇒ سلة لا تعيد
  // الإرسال بعد 4xx). الموثّق يمرّ ببوابة الاستقبال التي تؤجّل ولا ترفض.
  const credentialPresented =
    !!headersList.get('x-salla-signature') ||
    !!headersList.get('x-erplink-webhook-secret') ||
    !!headersList.get('authorization')
  const unauthLimit = checkUnauthenticatedIngressLimit({
    scope: 'salla',
    credentialPresented,
    bucketKey: rateLimitKeyFromHeaders(getHeader, 'salla-webhook'),
  })
  if (!unauthLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  if (isWebhookBodyTooLarge(rawBody)) {
    return NextResponse.json(
      { error: `Payload too large (max ${MAX_WEBHOOK_BODY_BYTES} bytes)` },
      { status: 413 }
    )
  }

  // ── 1. Ingress auth (before any parsing or DB I/O) ─────────────────────────
  // Dual-path: Salla's native `x-salla-signature` HMAC when the host holds the
  // Portal secret, otherwise the credential derived from ENCRYPTION_KEY that
  // registration attaches per subscription. Both compared with `secretMatches`
  // (constant time) — see src/lib/salla/webhook-auth.ts.
  const authResult = verifySallaWebhookAuth(rawBody, getHeader)
  const isUnauthenticated = authResult.status === 'legacy' || authResult.status === 'unconfigured'

  if (authResult.status === 'unconfigured' && process.env.NODE_ENV === 'production') {
    // Unreachable in production: crypto.ts throws at boot without ENCRYPTION_KEY.
    // Serving unauthenticated webhooks would let anyone inject events into any
    // linked store, so fail closed rather than degrade silently.
    console.error(
      '[Salla Webhook] Security Alert: no webhook credential is derivable in production (ENCRYPTION_KEY missing).'
    )
    return NextResponse.json(
      { error: 'Webhook auth not configured on server', message_ar: 'لم يتم تكوين مصادقة الويب هوك في بيئة الإنتاج.' },
      { status: 500 }
    )
  }

  if (authResult.status === 'invalid') {
    console.warn('[Salla Webhook] Credential verification failed', {
      method: authResult.method,
      credential: sallaWebhookCredentialFingerprint(),
      hasHeader: true,
    })
    return NextResponse.json(
      { error: 'Invalid signature', message_ar: 'توقيع الويب هوك غير صالح.' },
      { status: 401 }
    )
  }

  if (isUnauthenticated) {
    // STRICT_WEBHOOK_AUTH=true closes the migration window (see
    // src/lib/webhook-strict.ts): reject instead of accept+count. Keep it
    // unset while testing over temporary (ngrok) URLs.
    if (isStrictWebhookAuth()) {
      return NextResponse.json(
        { error: 'Unauthorized: webhook not re-registered', message_ar: 'الويب هوك غير مسجل بالمفتاح الجديد.' },
        { status: 401 }
      )
    }
    reportLegacyDelivery(req.nextUrl.searchParams.get('store_id'))
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    // جسم غير قابل للتحليل: لا merchant ولا event لاستنتاجهما، لكن التسليم
    // يُحفظ كيتيم (workspace_id = null) بدل أن يضيع بصمت. الرد يبقى 400، فلا
    // تعيد سالا الإرسال — الصناديق اليتيمة للقراءة اليدوية/الإعادة الإدارية.
    console.error('[Salla Webhook] Invalid JSON body — saved as orphan receipt')
    const { recordOrphanReceipt } = await import('@/lib/webhook-inbox')
    const { fingerprintPayload } = await import('@/lib/sync-queue')
    const stored = await recordOrphanReceipt({
      platform: 'salla',
      storeId: '',
      event: 'invalid_json',
      dedupKey: `salla:malformed:${fingerprintPayload({ raw: rawBody })}`,
      payload: { raw: rawBody.slice(0, 8000) },
    })
    if (!stored.ok) {
      return NextResponse.json(
        { received: false, processed: false, error: stored.error ?? 'orphan_store_failed' },
        { status: 503 }
      )
    }
    return NextResponse.json(
      { error: 'Invalid JSON', message_ar: 'بيانات الويب هوك غير صالحة.' },
      { status: 400 }
    )
  }

  const event = String(payload.event ?? payload.topic ?? '')
  const merchantId = extractSallaMerchantId(payload)
  const data = payload.data ?? {}
  const webhookId = extractSallaWebhookId(payload, getHeader)

  // ── 1b. Upstream data guard: broken order lines never reach the queue ────
  if (event.startsWith('order.') && data && typeof data === 'object' && 'items' in (data as Record<string, unknown>)) {
    const { validateOrderLines } = await import('@/lib/platform-validation')
    const check = validateOrderLines((data as Record<string, unknown>).items)
    if (!check.ok) {
      // الحدث يُحفظ كيتيم (بلا workspace) بدل أن يضيع — استثناء صلاحية
      // القائمة يعود للإدارة بطابعه، والرد يبقى 400 حتى لا تعيد سالا الإرسال.
      console.error('[Salla Webhook] invalid order lines — saved as orphan receipt', { event, merchantId, detail: check.error })
      const { recordOrphanReceipt } = await import('@/lib/webhook-inbox')
      const { fingerprintPayload } = await import('@/lib/sync-queue')
      const stored = await recordOrphanReceipt({
        platform: 'salla',
        storeId: merchantId,
        event,
        dedupKey: `salla:invalid-lines:${merchantId}:${event}:${
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
        { received: true, processed: false, reason: 'invalid_payload', detail: check.error },
        { status: 400 }
      )
    }
  }

  // ── 2. Missing merchant early-return ──────────────────────────────────────
  if (!merchantId) {
    // بلا merchant لا يوجد مستأجر لحفظ يسند إليه، لكن التسليم يحفظ كيتيم
    // (workspace_id = null) — لا 400 نهائي على حدث قد يكون حقيقياً.
    console.error('[Salla Webhook] missing merchant id — saved as orphan receipt', { event })
    const { recordOrphanReceipt } = await import('@/lib/webhook-inbox')
    const { fingerprintPayload } = await import('@/lib/sync-queue')
    const stored = await recordOrphanReceipt({
      platform: 'salla',
      storeId: '',
      event: event || 'missing_event',
      dedupKey: `salla:no-merchant:${event}:${webhookId || fingerprintPayload(data as Record<string, unknown>)}`,
      payload: data as Record<string, unknown>,
    })
    if (!stored.ok) {
      return NextResponse.json(
        { received: false, processed: false, error: stored.error ?? 'orphan_store_failed' },
        { status: 503 }
      )
    }
    return NextResponse.json(
      { error: 'Merchant ID not found in payload', message_ar: 'تعذر التعرف على المتجر في بيانات الويب هوك.' },
      { status: 400 }
    )
  }

  // ── 3. App uninstalled → clean the token + pending jobs, fast 200 ─────────
  // Must run BEFORE the token lookup so orphaned stores are removed even if
  // sync settings would otherwise 404/skip.
  if (event === 'app.uninstalled') {
    // This branch deletes the merchant's tokens — the one irreversible thing a
    // webhook can do. An unauthenticated caller who knows a merchant id could
    // therefore unlink a paying customer, so it is refused outright until the
    // store's subscriptions carry the derived header.
    if (isUnauthenticated) {
      console.error('[Salla Webhook] Refusing unauthenticated app.uninstalled', { merchantId, event })
      return NextResponse.json({
        received: true,
        processed: false,
        reason: 'unauthenticated_uninstall',
      })
    }
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
  // Deliberately NOT enqueued: re-running a late redelivery would push an old
  // price/status back into Odoo over newer state.
  //
  // But "deliberately not enqueued" must not mean "thrown away": reconcileZidOrders
  // has no Salla peer, so no periodic sweep would ever recover a genuinely late
  // event. It is written to `webhook_inbox` with a null `workspace_id`, which
  // `drainWebhookInbox` excludes by query (`.not('workspace_id','is',null)`) —
  // durable and recoverable by hand, yet unable to regress the store on its own.
  const createdAtRaw = payload.created_at ?? payload.timestamp
  if (createdAtRaw) {
    const { parseSallaTimestampMs } = await import('@/lib/salla/webhook-auth')
    const createdMs = parseSallaTimestampMs(createdAtRaw)
    if (Number.isFinite(createdMs) && Date.now() - createdMs > STALE_EVENT_MAX_AGE_MS) {
      const ageMinutes = Math.round((Date.now() - createdMs) / 60000)
      staleSkippedDeliveries += 1
      if (staleSkippedDeliveries <= 3 || staleSkippedDeliveries % 50 === 0) {
        console.warn(
          `[Salla Webhook] stale delivery #${staleSkippedDeliveries}: ${event} for merchant ${merchantId} is ${ageMinutes}min old (>${STALE_EVENT_MAX_AGE_MS / 60000}min). Not enqueued (would regress newer state) but saved in webhook_inbox without a workspace_id for manual recovery. If this counter climbs, raise STALE_EVENT_MAX_AGE_MS.`
        )
      }
      const { recordWebhookReceipt } = await import('@/lib/webhook-inbox')
      const { fingerprintPayload } = await import('@/lib/sync-queue')
      const stored = await recordWebhookReceipt({
        platform: 'salla',
        storeId: merchantId,
        workspaceId: null,
        event,
        dedupKey: `salla:stale:${merchantId}:${event}:${
          webhookId || fingerprintPayload(data as Record<string, unknown>)
        }`,
        payload: data as Record<string, unknown>,
      })
      // Even here a failed durable write must not answer 2xx — this delivery is
      // the only remaining copy, and 503 is what makes Salla redeliver it.
      if (!stored.ok) {
        return NextResponse.json(
          { received: false, processed: false, error: stored.error ?? 'stale_store_failed' },
          { status: 503 }
        )
      }
      return NextResponse.json({
        received: true,
        processed: false,
        queued: false,
        reason: 'stale',
        savedForRecovery: true,
      })
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
  const { allowed, reason } = await isWebhookEventEnabled(sallaToken.workspace_id, 'salla', event, merchantId)

  if (!allowed) {
    // الرد يبقى 200 كما هو، لكن القرار يُوثَّق في sync_logs بدل الصمت —
    // إعداد مقفول يسكت إشعارات متجر كامل دون أن يدري أحد.
    await logWebhookSkip({
      workspaceId: sallaToken.workspace_id,
      platform: 'salla',
      event,
      storeId: merchantId,
      reason: 'disabled_in_settings',
      detail: reason,
      payload: (data ?? {}) as Record<string, unknown>,
    })
    return NextResponse.json({ received: true, processed: false, reason: 'disabled_in_settings', detail: reason })
  }

  // ── 8. الاستلام الدائم ثم الإدراج في الطابور ─────────────────────────────
  // `enqueueWebhookEvent` هو المسار الوحيد الحصري (نفسه الذي يستخدمه زد):
  //   1) يكتب `webhook_inbox` **قبل** الإدراج في الطابور (203-208 في sync-queue)،
  //   2) يبني dedup_key ذرّياً: delivery id إن وُجد، وإلا بصمة المحتوى،
  //   3) يدمج الدفعات لنفس الكيان في صف معلّق واحد،
  //   4) يستخدم max_retries الموحّد (5) لا 3.
  //
  // ⚠️ كان هذا المسار يكتب `dedup_key = null` حين لا يوجد delivery id، فتفقد
  // حماية التكرار وتبقى كل نسخة مكرّرة كعمل منفصل. لمّا لا ترسل سالا delivery
  // id بشكل موثوق، المفتاح الآن مشتق من البصمة: إعادة إرسال نفس الرسالة تُدمج،
  // والتحديث الحقيقي يحمل `updated_at` مختلفاً ⇒ بصمة مختلفة ⇒ يُعالَج.
  const { enqueueWebhookEvent } = await import('@/lib/sync-queue')

  // ختم تصنيف المصادقة على payload للتسليمات غير المصادقة فقط (legacy).
  // محرك المزامنة يقرأه ليُجبر إعادة القراءة من API سالا (API يفوز) لهذه
  // التسليمات بدل الدمج الحالي التي يفوز فيه جسم الحدث — فيصبح المتصل غير
  // المصادق محفزاً فقط، لا مصدراً للقيم. التسليمات المصادقة سلوكها كما هو.
  // يُحذف الختم قبل وصول البيانات لمحرك الكتابة حتى لا يدخل في أي تحويل.
  const sallaPayload: Record<string, unknown> = {
    ...(data as Record<string, unknown>),
    ...(webhookId ? { salla_webhook_id: webhookId } : {}),
    ...(isUnauthenticated ? { salla_auth: authResult.status } : {}),
  }

  const enqueued = await enqueueWebhookEvent({
    workspaceId: sallaToken.workspace_id,
    storeId: merchantId,
    event,
    platform: 'salla',
    // NO Salla API enrichment here — thin payloads are completed inside the
    // background worker (see processWebhookEvent in sync-engine.ts). Salla
    // retries on timeout, so any enrichment in this request duplicates work.
    payload: sallaPayload,
  })

  // تخزين دائم غير مكتمل ⇒ 503 لتعيد سالا الإرسال. الحدث محفوظ في
  // webhook_inbox في كل الأحوال، لكن الرد غير 2xx هو خط الدفاع الثاني.
  if (enqueued.error) {
    console.error('[Salla Webhook] durable enqueue failed:', {
      event,
      merchantId,
      error: enqueued.error,
    })
    return NextResponse.json(
      { received: false, processed: false, error: 'durable_storage_failed' },
      { status: 503 }
    )
  }

  if (enqueued.id) {
    // تنبيه الوصول نارٍ وانسى (P1-1): لا يُنتظر فلا يؤخر الرد، ويُرسل عند
    // الإدراج الطازج فقط — الدمج/التكرار ليس طلباً جديداً.
    import('@/lib/telegram-notifier')
      .then(({ notifyOrderArrival }) =>
        notifyOrderArrival({
          workspaceId: sallaToken.workspace_id,
          platform: 'salla',
          event,
          storeId: merchantId,
          payload: (data ?? {}) as Record<string, unknown>,
          eventKey: enqueued.id ? `queue:${enqueued.id}` : null,
        })
      )
      .catch(() => {})
  }

  await recordSallaWebhookMetric(merchantId, event)

  // لا تشغيل للطابور داخل الطلب في الإنتاج إطلاقاً: على استضافة مشتركة
  // (Hostinger) هذا يعني تنفيذ مزامنة كاملة داخل طلب الويب هوك، وهو أكبر مصدر
  // للضغط على السيرفر. المعالجة عبر العدّاد الداخلي / أو /api/cron/sync-queue.
  // في التطوير المحلي فقط: شغّل دورة واحدة في الخلفية فوراً لتجربة المزامنة بلا انتظار.
  if (!enqueued.duplicate && !enqueued.coalesced && process.env.NODE_ENV !== 'production') {
    import('@/lib/sync-queue-runner').then(({ runSyncQueueOnce }) => {
      runSyncQueueOnce().catch((err) => console.warn('[Salla Webhook] immediate dev queue drain error:', err))
    }).catch(() => {})
  }

  return NextResponse.json({
    received: true,
    queued: !enqueued.duplicate,
    coalesced: enqueued.coalesced,
  })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Salla webhook endpoint is ready.',
    events: SALLA_DEFAULT_WEBHOOK_EVENTS,
  })
}
