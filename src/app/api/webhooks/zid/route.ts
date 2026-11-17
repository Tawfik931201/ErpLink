/**
 * POST /api/webhooks/zid — مستقبل ويب هوك زد.
 *
 * المسار canonical للربط: /api/zid/connect + /api/zid/callback
 * (المسار القديم /api/auth/zid/* مجرد shim يعيد التوجيه — لا منطق مكرر).
 *
 * سياسة الأداء: تحقق خفيف → استخراج event/store → فحص الإعدادات →
 * enqueue فقط في الطابور المركزي → رد 200 فوري. لا مزامنة داخل الطلب،
 * لا setInterval هنا (المعالجة عبر /api/cron/sync-queue).
 *
 * Security: Zid signs nothing — see src/lib/zid/webhook-auth.ts for the full
 * story. Its one documented inbound mechanism is HTTP Basic, configured per
 * webhook at creation time, so a webhook registered before that existed keeps
 * delivering unsigned. Those legacy deliveries are accepted (a hard reject
 * would silently kill every store's sync) but never trusted for the
 * destructive uninstall branch. Re-register every store via
 * POST /api/admin/zid-webhooks/refresh.
 */
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

import { withDurableWebhookResponse } from '@/lib/durable-webhook-response'
import { checkUnauthenticatedIngressLimit } from '@/lib/ingress-admission'
import { rateLimitKeyFromHeaders } from '@/lib/rate-limit'
import { supabase } from '@/lib/supabase'
import { ttlCache } from '@/lib/ttl-cache'
import { isWebhookEventEnabled } from '@/lib/webhook-gate'
import { logWebhookSkip } from '@/lib/webhook-skip-log'
import { isStrictWebhookAuth, isWebhookBodyTooLarge, MAX_WEBHOOK_BODY_BYTES } from '@/lib/webhook-strict'
import { normalizeZidStoreId } from '@/lib/zid/store-identity'
import {
  verifyZidWebhookAuthorization,
  zidWebhookCredentialFingerprint,
} from '@/lib/zid/webhook-auth'

/**
 * Deliveries that arrived without Basic Auth, i.e. from a webhook created
 * before the credential existed. Logged sparsely: this counter is the signal
 * for "stores still need re-registering", so it must not stay silent, but a
 * busy store would otherwise flood the log.
 */
let legacyUnauthenticatedDeliveries = 0

function reportLegacyDelivery(storeIdHint: string | null) {
  legacyUnauthenticatedDeliveries += 1
  const count = legacyUnauthenticatedDeliveries
  if (count <= 3 || count % 50 === 0) {
    console.warn(
      `[Zid Webhook] Unauthenticated delivery #${count} (webhook predates Basic Auth). Accepted, but app.uninstalled is refused. Re-register webhooks: POST /api/admin/zid-webhooks/refresh`,
      { storeIdHint }
    )
  }
  // العدّاد الدائم: نسخة الذاكرة تُصفَّر عند إعادة التشغيل، فإشارة "صفر ⇒ أغلق
  // النافذة" يجب أن تأتي من webhook_legacy_counters لا من هنا.
  void import('@/lib/legacy-delivery-counter')
    .then(({ incrementLegacyDelivery }) => incrementLegacyDelivery('zid', storeIdHint ?? undefined))
    .catch(() => {})
}

function isUninstallEvent(event: string): boolean {
  const n = event.toLowerCase().replace(/[._\-/]/g, '')
  return n.includes('uninstall')
}

async function handlePost(req: NextRequest) {
  // In development, ensure the background queue runner is running
  if (process.env.NODE_ENV !== 'production') {
    import('@/lib/sync-queue-runner').then(({ startSyncQueueRunner }) => {
      startSyncQueueRunner()
    }).catch(() => {})
  }

  const rawBody = await req.text()
  const headersList = await headers()
  const getHeader = (name: string) => headersList.get(name)

  // ── حد الاستقبال: للمجهولين فقط ───────────────────────────────────────────
  // الطلب الموثّق (Basic) لا يخضع لحد الـIP إطلاقاً: الاعتماد نفسه هو
  // الحماية، والحد كان يحوّل عملاء الموسم إلى **ضياع صامت** (429 ⇒ المنصات
  // لا تعيد الإرسال بعد 4xx). الطلب الموثّق يمرّ ببوابة الاستقبال
  // (`ingress-admission.ts`) التي لا ترفض بل تأجّل.
  const credentialPresented = !!headersList.get('authorization')
  const unauthLimit = checkUnauthenticatedIngressLimit({
    scope: 'zid',
    credentialPresented,
    bucketKey: rateLimitKeyFromHeaders(getHeader, 'zid-webhook'),
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

  // ── Ingress auth ─────────────────────────────────────────────
  // Zid sends no signature; the only mechanism it supports is the Basic
  // credential attached to each webhook at creation time. Compared with
  // `secretMatches` (constant time) against a credential derived from
  // ENCRYPTION_KEY — see src/lib/zid/webhook-auth.ts.
  const authResult = verifyZidWebhookAuthorization(headersList.get('authorization'))
  const isUnauthenticated = authResult.status === 'legacy' || authResult.status === 'unconfigured'

  if (authResult.status === 'unconfigured' && process.env.NODE_ENV === 'production') {
    // Unreachable in production: crypto.ts throws at boot without ENCRYPTION_KEY.
    // Serving unauthenticated webhooks would let anyone inject events into any
    // linked store, so fail closed rather than degrade silently.
    console.error(
      '[Zid Webhook] Security Alert: no webhook credential is derivable in production (ENCRYPTION_KEY missing).'
    )
    return NextResponse.json(
      { error: 'Webhook auth not configured on server', message_ar: 'لم يتم تكوين مصادقة الويب هوك في بيئة الإنتاج.' },
      { status: 500 }
    )
  }

  if (authResult.status === 'invalid') {
    console.warn('[Zid Webhook] Authorization verification failed', {
      credential: zidWebhookCredentialFingerprint(),
      hasHeader: true,
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (isUnauthenticated) {
    // STRICT_WEBHOOK_AUTH=true closes the migration window (see
    // src/lib/webhook-strict.ts). Keep unset while testing over ngrok.
    if (isStrictWebhookAuth()) {
      return NextResponse.json(
        { error: 'Unauthorized: webhook not re-registered' },
        { status: 401 }
      )
    }
    reportLegacyDelivery(req.nextUrl.searchParams.get('store_id'))
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    // جسم غير قابل للتحليل: لا store_id ولا event لاستنتاجهما، لكن التسليم
    // يُحفظ كيتيم (workspace_id = null) بدل أن يضيع بصمت. الرد يبقى 400، فلا
    // تعيد زد الإرسال — الصناديق اليتيمة للقراءة اليدوية/الإعادة الإدارية.
    console.error('[Zid Webhook] Invalid JSON body — saved as orphan receipt')
    const { recordOrphanReceipt } = await import('@/lib/webhook-inbox')
    const { fingerprintPayload } = await import('@/lib/sync-queue')
    const stored = await recordOrphanReceipt({
      platform: 'zid',
      storeId: '',
      event: 'invalid_json',
      dedupKey: `zid:malformed:${fingerprintPayload({ raw: rawBody })}`,
      payload: { raw: rawBody.slice(0, 8000) },
    })
    if (!stored.ok) {
      return NextResponse.json(
        { received: false, processed: false, error: stored.error ?? 'orphan_store_failed' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // ── Determine event type — in order of priority ───────────────────────────
  // Priority 1: Query parameter ?event=product.created
  const queryEvent = req.nextUrl.searchParams.get('event') ?? ''

  // Priority 2: Zid event header (X-Zid-Topic, X-Zid-Event, X-Zid-Hook-Event, etc.)
  const headerEvent =
    headersList.get('webhook-event') ??
    headersList.get('webhook-topic') ??
    headersList.get('webhook-resource-event') ??
    headersList.get('x-zid-topic') ??
    headersList.get('x-zid-event') ??
    headersList.get('x-zid-hook-event') ??
    headersList.get('x-zid-event-type') ??
    ''

  // Priority 3: Infer from payload content
  // Zid sends product data directly — no event field in body!
  function inferEventFromPayload(p: any): string {
    const target = p.data && typeof p.data === 'object' ? p.data : p
    // 0. Check explicit event / topic / action in body if present
    const explicitEvent =
      p.event_name ||
      p.event ||
      p.topic ||
      p.action ||
      target.event_name ||
      target.event ||
      target.topic ||
      target.action
    if (typeof explicitEvent === 'string') {
      const lower = explicitEvent.toLowerCase()
      if (lower.startsWith('app.market.subscription.') || lower.startsWith('subscription.')) {
        return lower
      }
      if (lower.includes('uninstall')) return 'app.uninstalled'
      if (lower.includes('category.delete') || lower.includes('category_delete') || lower.includes('category.deleted') || lower.includes('category_deleted')) {
        return 'category.deleted'
      }
      if (lower.includes('category.create') || lower.includes('category_create') || lower.includes('category.created') || lower.includes('category_created')) {
        return 'category.created'
      }
      if (lower.includes('category.update') || lower.includes('category_update') || lower.includes('category.updated') || lower.includes('category_updated')) {
        return 'category.updated'
      }
      if (lower.includes('product.delete') || lower.includes('product_delete') || lower.includes('product.deleted') || lower.includes('product_deleted')) {
        return 'product.deleted'
      }
      if (lower.includes('product.create') || lower.includes('product_create') || lower.includes('product.created') || lower.includes('product_created')) {
        return 'product.created'
      }
      if (lower.includes('product.update') || lower.includes('product_update') || lower.includes('product.updated') || lower.includes('product_updated')) {
        return 'product.updated'
      }
      if (lower.includes('order.cancel') || lower.includes('order_cancel') || lower.includes('order.cancelled') || lower.includes('order_cancelled')) {
        return 'order.cancelled'
      }
      if (lower.includes('order.create') || lower.includes('order_create') || lower.includes('order.created') || lower.includes('order_created')) {
        return 'order.created'
      }
      if (lower.includes('order.status') || lower.includes('order_status') || lower.includes('order.update') || lower.includes('order_update')) {
        return 'order.updated'
      }
      if (lower.includes('customer.create') || lower.includes('customer_create') || lower.includes('customer.created') || lower.includes('customer_created')) {
        return 'customer.created'
      }
      if (lower.includes('customer.update') || lower.includes('customer_update') || lower.includes('customer.updated') || lower.includes('customer_updated')) {
        return 'customer.updated'
      }
    }

    // Check for delete signals first
    const isDeleted = target.deleted_at || target.is_deleted || target.deleted === true || target.deleted === '1' || target.deleted === 1
      || target.active === false || target.active === 'false' || target.active === 0
      || target.status === 'deleted' || target.status === 'inactive' || target.status === 'trashed'
      || target.status === 'archived' || target.available === false || target.action === 'delete'
    if (isDeleted) {
      if (target.sku !== undefined || target.sale_price !== undefined || target.product_class !== undefined) return 'product.deleted'
      if (target.order_number !== undefined) return 'order.cancelled'
      if (target.email !== undefined || target.type === 'individual' || target.type === 'business') return 'customer.deleted'
      if (
        target.slug !== undefined ||
        target.parent_id !== undefined ||
        target.category_id !== undefined ||
        target.category_uuid !== undefined ||
        target.id !== undefined ||
        (target.name && (typeof target.name === 'object' || typeof target.name === 'string'))
      ) return 'category.deleted'
      return 'unknown'
    }
    // Product events
    if (target.sku !== undefined || target.sale_price !== undefined || target.product_class !== undefined) {
      if (target.created_at && target.updated_at) {
        const created = new Date(target.created_at).getTime()
        const updated = new Date(target.updated_at).getTime()
        const diffMs = Math.abs(updated - created)
        return diffMs < 5_000 ? 'product.created' : 'product.updated'
      }
      if (target.created_at) return 'product.created'
      if (target.updated_at) return 'product.updated'
      return 'product.created'
    }
    // Order events
    if (target.order_number !== undefined || target.total_price !== undefined || target.order_total !== undefined) {
      if (target.created_at && target.updated_at) {
        const created = new Date(target.created_at).getTime()
        const updated = new Date(target.updated_at).getTime()
        const diffMs = Math.abs(updated - created)
        return diffMs < 5_000 ? 'order.created' : 'order.updated'
      }
      if (target.order_status === 'canceled' || target.order_status === 'cancelled') return 'order.cancelled'
      if (target.order_status === 'delivered') return 'order.delivered'
      return 'order.created'
    }
    // Customer events
    if (target.email !== undefined || target.mobile !== undefined || target.type === 'individual' || target.type === 'business') {
      if (target.created_at && target.updated_at) {
        const created = new Date(target.created_at).getTime()
        const updated = new Date(target.updated_at).getTime()
        const diffMs = Math.abs(updated - created)
        return diffMs < 5_000 ? 'customer.created' : 'customer.updated'
      }
      if (target.created_at) return 'customer.created'
      if (target.updated_at) return 'customer.updated'
      return 'customer.created'
    }
    // Category events — Zid category payloads have `id` + `name` (often {ar,en})
    // + optional `parent_id` + `slug`/`description`/`image`. No sku/order_number/email.
    // Also accept Zid's `category_id` / `category_uuid` prefixed fields.
    const hasCategoryShape =
      (target.name && (typeof target.name === 'object' || typeof target.name === 'string')) ||
      target.category_id !== undefined ||
      target.category_uuid !== undefined ||
      (target.id !== undefined && target.sku === undefined && target.order_number === undefined && target.email === undefined)
    if (hasCategoryShape) {
      if (target.created_at && target.updated_at) {
        const created = new Date(target.created_at).getTime()
        const updated = new Date(target.updated_at).getTime()
        const diffMs = Math.abs(updated - created)
        return diffMs < 5_000 ? 'category.created' : 'category.updated'
      }
      if (target.created_at) return 'category.created'
      if (target.updated_at) return 'category.updated'

      return 'category.created'
    }
    return 'unknown'
  }

  function extractStoreId(p: any): number {
    const target = p.data && typeof p.data === 'object' ? p.data : p
    const rawStoreId =
      p.store_id ??
      p.storeId ??
      p.merchant_id ??
      p.merchantId ??
      target.store_id ??
      target.storeId ??
      target.merchant_id ??
      target.merchantId ??
      p.store?.id ??
      p.store?.store_id ??
      target.store?.id ??
      target.store?.store_id ??
      p.merchant?.store_id ??
      p.merchant?.id ??
      target.merchant?.store_id ??
      target.merchant?.id ??
      req.nextUrl.searchParams.get('store_id') ??
      req.nextUrl.searchParams.get('storeId') ??
      req.nextUrl.searchParams.get('merchant_id') ??
      headersList.get('x-store-id') ??
      headersList.get('store-id') ??
      headersList.get('store_id') ??
      headersList.get('x-merchant-id') ??
      0

    const parsed = Number(rawStoreId)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const payloadInferred = inferEventFromPayload(payload)
  // Priority 1: Query param (?event=category.create)
  // Priority 2: Header event
  // Priority 3: Payload inference
  const event: string = queryEvent || headerEvent || payloadInferred || 'unknown'

  // ── Extract store_id and product data ─────────────────────────────────────
  let store_id = extractStoreId(payload)

  if (store_id === 0) {
    // التخمين من الصف الوحيد في merchant_tokens يُقبل فقط للتسليمات **المصادقة**
    // (Basic Auth). للمتصل غير المصادق، تحويل جسمه بلا store_id إلى مساحة عمل
    // عبر صف الـtoken الوحيد يعزّز عملياً استغلالاً بلا مصادقة — بعد التسجيل
    // الجديد يمرّ التخمين للتسليمات المصادقة كما كان.
    if (!isUnauthenticated) {
      try {
        const { data: tokens } = await supabase
          .from('merchant_tokens')
          .select('store_id')
        if (tokens && tokens.length === 1) {
          store_id = Number((tokens[0] as { store_id: unknown }).store_id) || 0
        } else if (tokens && tokens.length > 1) {
          // SECURITY: never guess the store from the "latest" token when multiple
          // stores exist — that could sync one tenant's data into another tenant's ERP.
          console.warn(
            `[Zid Webhook] store_id missing and ${tokens.length} merchant tokens exist — refusing to guess.`
          )
        }
      } catch {
        // غير قاتل — يُرد 400 أدناه عند غياب store_id (عدا uninstall).
      }
    } else {
      console.warn('[Zid Webhook] store_id missing on unauthenticated delivery — guess refused.')
    }
  }

  // ── توحيد هوية المتجر ────────────────────────────────────────────────────
  // الـURL المحمول من الويب هوك يحمل معرف المالك (merchant_id) بينما جسم
  // الأحداث يحمل معرف المتجر (store_id) أو لا يحمل شيئاً. استخدام القيمتين
  // كهويتين مختلفتين سجّل صفوف sync_logs بـ store_id مختلف عن مفتاح البحث
  // عند التحديث/الحذف اللاحق (خصوصاً أحداثاً بلا store_id في الجسم مثل
  // product.delete)، فردّ "No matching record" رغم وجود السجل.
  // الحل: أي قيمة معروفة تُحلّ إلى الـ store_id الفعلي للصف قبل أي استخدام.
  store_id = await normalizeZidStoreId(store_id)

  // ── App uninstalled → fast 200 + clean the token (before any other lookup) ──
  if (isUninstallEvent(event)) {
    // This branch deletes the merchant's tokens — the one irreversible thing a
    // webhook can do. An unauthenticated caller who knows a store_id could
    // therefore unlink a paying customer, so it is refused outright until the
    // store's webhooks carry the Basic credential.
    if (isUnauthenticated) {
      console.error('[Zid Webhook] Refusing unauthenticated app.uninstalled', { store_id, event })
      return NextResponse.json({
        received: true,
        processed: false,
        reason: 'unauthenticated_uninstall',
      })
    }
    const storeStr = store_id ? String(store_id) : ''
    if (storeStr) {
      try {
        // نفس قاعدة resolveZidTokenRow: store_id أولاً ثم merchant_id.
        // الـOR الواحد قد يطابق صفين مختلفتين ويفشل `maybeSingle` — وفي
        // الحذف هذه ليست مسألة أمان فقط بل صوابية (حذف المتجر الصحيح).
        const tokenRow = await resolveZidTokenRow(storeStr, 'merchant_id,store_id')
        const merchantId = (tokenRow as { merchant_id?: string } | null)?.merchant_id
        if (merchantId) {
          const { unregisterAllZidWebhooks } = await import('@/lib/zid/webhooks')
          await unregisterAllZidWebhooks(merchantId).catch(() => {})
          await supabase.from('merchant_tokens').delete().eq('merchant_id', merchantId)
        } else {
          await supabase.from('merchant_tokens').delete().eq('store_id', storeStr)
        }
        const { handleZidSubscriptionWebhook } = await import('@/lib/zid/subscription-webhook')
        await handleZidSubscriptionWebhook('app.market.subscription.suspended', store_id, payload).catch(() => {})
        const { recordAudit } = await import('@/lib/audit-logs')
        await recordAudit({
          actorId: storeStr,
          actorRole: 'system',
          action: 'zid.app_uninstalled',
          entityType: 'zid_store',
          entityId: storeStr,
        }).catch(() => {})
      } catch {
        // best-effort — نرد 200 دائماً.
      }
    }
    return NextResponse.json({ received: true, processed: true, reason: 'app_uninstalled' })
  }

  // Zid sends event data nested inside a "data" field
  const data: Record<string, unknown> = (payload.data && typeof payload.data === 'object') ? payload.data : payload

  // ختم تصنيف المصادقة على payload للتسليمات غير المصادقة فقط (legacy).
  // محرك المزامنة يقرأه ويحذفه فيقلب اتجاه الدمج إلى "API يفوز" لهذه
  // التسليمات — المتصل غير المصادق يبقى محفزاً فقط، لا مصدراً للقيم.
  if (isUnauthenticated) {
    Object.assign(data, { zid_auth: authResult.status })
  }

  // Upstream guard: broken order lines never reach the queue.
  if (event.startsWith('order') && data && typeof data === 'object' && 'items' in data) {
    const { validateOrderLines } = await import('@/lib/platform-validation')
    const check = validateOrderLines((data as Record<string, unknown>).items)
    if (!check.ok) {
      // الحدث يُحفظ كيتيم (بلا workspace) بدل أن يضيع — استثناء صلاحية
      // القائمة يعود للإدارة بطابعه، والرد يبقى 400 حتى لا تعيد زد الإرسال.
      console.error('[Zid Webhook] invalid order lines — saved as orphan receipt', { event, store_id, detail: check.error })
      const { recordOrphanReceipt } = await import('@/lib/webhook-inbox')
      const { extractDeliveryId, fingerprintPayload } = await import('@/lib/sync-queue')
      const stored = await recordOrphanReceipt({
        platform: 'zid',
        storeId: String(store_id),
        event,
        dedupKey: `zid:invalid-lines:${store_id}:${event}:${
          extractDeliveryId(data) || fingerprintPayload(data as Record<string, unknown>)
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

  if (!store_id) {
    // بلا store_id لا يوجد مستأجر لحفظ يسند إليه، لكن التسليم يحفظ كيتيم
    // (workspace_id = null) — لا 400 نهائي على حدث قد يكون حقيقياً.
    console.warn('[Zid Webhook] store_id missing — refusing to guess across tenants; saved as orphan receipt.')
    const { recordOrphanReceipt } = await import('@/lib/webhook-inbox')
    const { extractDeliveryId, fingerprintPayload } = await import('@/lib/sync-queue')
    const stored = await recordOrphanReceipt({
      platform: 'zid',
      storeId: '',
      event: event || 'unknown_event',
      dedupKey: `zid:no-store:${event}:${extractDeliveryId(data) || fingerprintPayload(data)}`,
      payload: data,
    })
    if (!stored.ok) {
      return NextResponse.json(
        { received: false, processed: false, error: stored.error ?? 'orphan_store_failed' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: 'Missing store_id' }, { status: 400 })
  }
  if (event === 'unknown') {
    // الرد 200 يبقى كما هو (زد لا تعيد بعد 2xx)، لكن الحدث لم يكن بلا أثر:
    // يُحفظ كيتيم فضلاً عن توثيق القرار في sync_logs إن عرفنا مساحة العمل.
    console.warn('[Zid Webhook] Could not determine event type — register webhook URL with ?event=<name>. Saved as orphan receipt.')
    const { recordOrphanReceipt } = await import('@/lib/webhook-inbox')
    const { extractDeliveryId, fingerprintPayload } = await import('@/lib/sync-queue')
    const stored = await recordOrphanReceipt({
      platform: 'zid',
      storeId: String(store_id),
      event: 'unknown_event',
      dedupKey: `zid:unknown:${store_id}:${extractDeliveryId(data) || fingerprintPayload(data)}`,
      payload: data,
    })
    if (!stored.ok) {
      return NextResponse.json(
        { received: false, processed: false, error: stored.error ?? 'orphan_store_failed' },
        { status: 503 }
      )
    }
    return NextResponse.json({ received: true, processed: false, reason: 'unknown_event' })
  }

  // ── Route events to handlers (enqueue فقط — رد فوري بعد الحفظ الدائم) ───────
  // البث لـSSE يتم فقط للأحداث المفعّلة (داخل كل handler بعد فحص الإعدادات).
  let handlerResult: HandlerResult = 'enqueued'
  try {
    switch (event) {
      case 'app.market.subscription.active':
      case 'app.market.subscription.renew':
      case 'app.market.subscription.upgrade':
      case 'app.market.subscription.suspended':
      case 'app.market.subscription.expired':
      case 'app.market.subscription.refunded':
      case 'app.market.subscription.warning':
      case 'subscription.active':
      case 'subscription.renew':
      case 'subscription.upgrade':
      case 'subscription.suspended':
      case 'subscription.expired':
      case 'subscription.refunded':
      case 'subscription.warning': {
        const { handleZidSubscriptionWebhook } = await import('@/lib/zid/subscription-webhook')
        const subResult = await handleZidSubscriptionWebhook(event, store_id, payload)
        return NextResponse.json({
          received: true,
          processed: subResult.success,
          action: subResult.action,
          subscription_id: subResult.subscriptionId,
          zid_subscription_id: subResult.zidSubscriptionId,
          message: subResult.message,
        })
      }

      case 'order.create':
      case 'order.created':
      case 'order_create':
      case 'order_created':
      case 'order.status.update':
      case 'order_status_update':
      case 'order.updated':
      case 'order.delivered':
      case 'order.cancelled':
      case 'order.payment_status.update':
      case 'order_payment_status_update':
        handlerResult = await handleOrderEvent(event, store_id, data)
        break

      case 'abandoned_cart.created':
      case 'abandoned_cart_created':
      case 'abandoned_cart.completed':
      case 'abandoned_cart_completed':
        handlerResult = await handleAbandonedCartEvent(event, store_id, data)
        break

      case 'product.create':
      case 'product.created':
      case 'product_create':
      case 'product_created':
      case 'product.update':
      case 'product.updated':
      case 'product_update':
      case 'product_updated':
      case 'product.delete':
      case 'product.deleted':
      case 'product_delete':
      case 'product_deleted':
      case 'product.publish':
      case 'product.published':
      case 'product_publish':
      case 'product_published':
      case 'product.stock.create':
      case 'product.stock.update':
      case 'product.stock.delete':
        handlerResult = await handleProductEvent(event, store_id, data)
        break

      case 'customer.create':
      case 'customer.created':
      case 'customer_create':
      case 'customer_created':
      case 'customer.update':
      case 'customer.updated':
      case 'customer_update':
      case 'customer_updated':
      case 'customer.merchant.update':
      case 'customer.merchant.updated':
      case 'customer.login':
        handlerResult = await handleCustomerEvent(event, store_id, data)
        break

      case 'category.create':
      case 'category.created':
      case 'category_create':
      case 'category_created':
      case 'category.update':
      case 'category.updated':
      case 'category_update':
      case 'category_updated':
      case 'category.delete':
      case 'category.deleted':
      case 'category_delete':
      case 'category_deleted':
        handlerResult = await handleCategoryEvent(event, store_id, data)
        break

      case 'location.create':
      case 'location.created':
      case 'location.update':
      case 'location.updated':
      case 'location.delete':
      case 'location.deleted':
      case 'location.stock.update':
        // Legacy location/stock event names (removed from ZID_EVENT_MAP — Zid
        // never sends them). Route to product handler for backward compat.
        handlerResult = await handleProductEvent(event, store_id, data)
        break

      default:
        // حدث مجهول: الرد 200 يبقى كما هو (زد لا تعيد بعد 2xx)، لكن best-effort
        // نحاول توثيقه في sync_logs إن عرفنا مساحة العمل — بلا أثر يضيع بصمت.
        try {
          const wsId =
            typeof store_id === 'number' ? await findMerchantWorkspaceId(store_id) : null
          if (wsId) {
            await logWebhookSkip({
              workspaceId: wsId,
              platform: 'zid',
              event,
              storeId: String(store_id),
              reason: 'unhandled_event',
              payload: (data ?? {}) as Record<string, unknown>,
            })
          }
        } catch {
          // التوثيق best-effort فقط.
        }
        return NextResponse.json({ received: true, processed: false, reason: 'unhandled_event' })
    }
  } catch (err) {
    console.error('[Zid Webhook] handler error', { event, store_id, err })
    // 503 وليس 200: الاستثناء يعني أن التخزين الدائم لم يكتمل. replying 200
    // هنا كان يعني فقدان الطلب نهائياً لأن زد لا تعيد الإرسال بعد 200.
    return NextResponse.json(
      { received: false, processed: false, error: 'handler_failed' },
      { status: 503 }
    )
  }

  // تخزين دائم غير مكتمل → 503 لتعيد زد الإرسال. الحدث محفوظ في
  // webhook_inbox في كل الأحوال، لكن الرد غير 2xx هو خط الدفاع الثاني.
  if (handlerResult === 'error') {
    return NextResponse.json(
      { received: false, processed: false, error: 'durable_storage_failed' },
      { status: 503 }
    )
  }
  if (handlerResult === 'no_workspace') {
    // لا يوجد ربط متجر لهذا الـstore — لا نخمّن المستأجر (تفادي خلط العملاء).
    //
    // كان يُعاد 422 هنا، أي رفض نهائي: زد لا تعيد الإرسال بعد 4xx، فكان
    // الحدث يضيع. الآن نحفظه في صندوق الاستلام كـ«orphan» ونعيد 202:
    // المتجر يتوقف عن الإرسال بلا فائدة، والحدث يبقى محفوظاً قابلاً
    // للاسترداد فور ربط المتجر (والتسوية الدورية تغطّي بياناته).
    console.error('[Zid Webhook] no workspace bound to store — event stored as orphan', {
      event,
      store_id,
    })
    const { recordOrphanReceipt } = await import('@/lib/webhook-inbox')
    const { extractDeliveryId, fingerprintPayload } = await import('@/lib/sync-queue')
    const stored = await recordOrphanReceipt({
      platform: 'zid',
      storeId: String(store_id),
      event,
      dedupKey: `zid:orphan:${store_id}:${event}:${
        extractDeliveryId(data) || fingerprintPayload(data as Record<string, unknown>)
      }`,
      payload: data as Record<string, unknown>,
    })
    if (!stored.ok) {
      // فشل الحفظ الدائم → نطلب إعادة الإرسال بدل الرد 202.
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

  // لا تشغيل للطابور داخل مسار الطلب إطلاقاً في الإنتاج (المعالجة عبر cron خارجي).
  // في التطوير المحلي فقط: شغّل دورة واحدة في الخلفية فوراً لاختبار التزامن بلا انتظار.
  if (handlerResult === 'enqueued' && process.env.NODE_ENV !== 'production') {
    import('@/lib/sync-queue-runner').then(({ runSyncQueueOnce }) => {
      runSyncQueueOnce().catch((err) => console.warn('[Zid Webhook] immediate dev queue drain error:', err))
    }).catch(() => {})
  }

  return NextResponse.json({ received: true, queued: handlerResult === 'enqueued' })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Zid webhook endpoint is ready.',
    events: [
      'order.create', 'order.status.update', 'product.create', 'product.update', 'customer.create',
      'category.create', 'category.update', 'category.delete',
    ],
  })
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * نتيجة معالج الحدث.
 * `error` تعني «لم يُحفظ بشكل دائم» → يرد المسار بـ 503 فتعيد زد الإرسال.
 * `skipped` تعني قراراً مقصوداً (معطّل من الإعدادات) → رد 200 طبيعي.
 */
type HandlerResult = 'enqueued' | 'deferred' | 'skipped' | 'no_workspace' | 'error'

async function findMerchantWorkspaceId(storeId: number): Promise<string | null> {
  const storeStr = String(storeId)
  return ttlCache.get(
    `zid:workspace:${storeStr}`,
    60_000,
    async () => {
      const row = await resolveZidTokenRow(storeStr, 'workspace_id')
      return (row as { workspace_id?: string } | null)?.workspace_id ?? null
    }
  )
}

/**
 * مطابقة صف الربط في زد: store_id أولاً ثم merchant_id كخيار ثانٍ.
 * كان يُستخدم `.or(store_id.eq.X,merchant_id.eq.X)` في شرط واحد: لو كان أحد
 * المستاجرين يحمل رقماً يساوي store_id متاجر أخرى، تطابق الصفان في OR واحدة
 * و `maybeSingle` يُرفض أو يعيّن الأول عشوائياً. التسلسل يلغي الغموض:
 * هوية الكيان أولاً (store_id)، وهوية المالك (merchant_id) احتياط فقط
 * للتسليمات القديمة التي تحمل المعرّف المالك. تُرمى أخطاء الاستعلام للمُنادي.
 */
async function resolveZidTokenRow(
  storeStr: string,
  columns: string
): Promise<Record<string, unknown> | null> {
  const byStore = await supabase
    .from('merchant_tokens')
    .select(columns)
    .eq('store_id', storeStr)
    .maybeSingle()
  if (byStore.error) throw byStore.error
  if (byStore.data) return byStore.data as unknown as Record<string, unknown>
  const byMerchant = await supabase
    .from('merchant_tokens')
    .select(columns)
    .eq('merchant_id', storeStr)
    .maybeSingle()
  if (byMerchant.error) throw byMerchant.error
  return (byMerchant.data as unknown as Record<string, unknown>) ?? null
}

async function handleOrderEvent(
  event: string,
  storeId: number,
  data: Record<string, unknown>
): Promise<HandlerResult> {
  const workspaceId = await findMerchantWorkspaceId(storeId)

  if (!workspaceId) {
    console.warn('[Zid Webhook] Merchant token not found for order event', { storeId })
    return 'no_workspace'
  }

  const { allowed, reason } = await isWebhookEventEnabled(workspaceId, 'zid', event, String(storeId))
  if (!allowed) {
    console.info('[Zid Webhook] Order event disabled by settings', { storeId, event, reason })
    await logWebhookSkip({
      workspaceId,
      platform: 'zid',
      event,
      storeId: String(storeId),
      reason: 'disabled_in_settings',
      detail: reason,
      payload: data,
    })
    return 'skipped'
  }

  const { enqueueWebhookEvent } = await import('@/lib/sync-queue')
  const queued = await enqueueWebhookEvent({
    acceptBeforeErp: true,
    workspaceId,
    storeId: String(storeId),
    event,
    platform: 'zid',
    payload: data,
  })
  if (queued.error) {
    console.error('[Zid Webhook] durable enqueue failed:', { event, storeId, error: queued.error })
    return 'error'
  }
  if (queued.id) {
    // تنبيه الوصول نارٍ وانسى (P1-1): لا يُنتظر فلا يؤخر الرد، ويُرسل عند
    // الإدراج الطازج فقط — الدمج/التكرار ليس طلباً جديداً.
    import('@/lib/telegram-notifier')
      .then(({ notifyOrderArrival }) =>
        notifyOrderArrival({
          workspaceId,
          platform: 'zid',
          event,
          storeId: String(storeId),
          payload: data,
          eventKey: queued.id ? `queue:${queued.id}` : null,
        })
      )
      .catch(() => {})
  }
  return queued.deferred ? 'deferred' : 'enqueued'
}

async function handleProductEvent(
  event: string,
  storeId: number,
  data: Record<string, unknown>
): Promise<HandlerResult> {
  const workspaceId = await findMerchantWorkspaceId(storeId)

  if (!workspaceId) {
    console.warn('[Zid Webhook] Merchant token not found for product event', { storeId })
    return 'no_workspace'
  }

  const { allowed, reason } = await isWebhookEventEnabled(workspaceId, 'zid', event, String(storeId))
  if (!allowed) {
    console.info('[Zid Webhook] Product event disabled by settings', { storeId, event, reason })
    await logWebhookSkip({
      workspaceId,
      platform: 'zid',
      event,
      storeId: String(storeId),
      reason: 'disabled_in_settings',
      detail: reason,
      payload: data,
    })
    return 'skipped'
  }

  // Zid can deliver product.publish before product.create. Defer only publish
  // events briefly so a later create can be processed first by the queue's
  // existing product-family dependency ordering. Keep durable receipts and
  // the existing missing-create retry as a fallback for longer delays.
  const { enqueueWebhookEvent, coalesceWindowMs } = await import('@/lib/sync-queue')
  const isPublish = /^product[._]publish(?:ed)?$/i.test(event)
  const nextRetryAt = isPublish
    ? new Date(Date.now() + Math.max(30_000, coalesceWindowMs())).toISOString()
    : undefined
  const queued = await enqueueWebhookEvent({
    acceptBeforeErp: true,
    workspaceId,
    storeId: String(storeId),
    event,
    platform: 'zid',
    payload: data,
    nextRetryAt,
  })
  if (queued.error) {
    console.error('[Zid Webhook] durable enqueue failed:', { event, storeId, error: queued.error })
    return 'error'
  }
  if (queued.id) {
    // تنبيه الوصول نارٍ وانسى (P1-1): لا يُنتظر فلا يؤخر الرد، ويُرسل عند
    // الإدراج الطازج فقط — الدمج/التكرار ليس طلباً جديداً.
    import('@/lib/telegram-notifier')
      .then(({ notifyOrderArrival }) =>
        notifyOrderArrival({
          workspaceId,
          platform: 'zid',
          event,
          storeId: String(storeId),
          payload: data,
          eventKey: queued.id ? `queue:${queued.id}` : null,
        })
      )
      .catch(() => {})
  }
  return queued.deferred ? 'deferred' : 'enqueued'
}

async function handleCustomerEvent(
  event: string,
  storeId: number,
  data: Record<string, unknown>
): Promise<HandlerResult> {
  const workspaceId = await findMerchantWorkspaceId(storeId)

  if (!workspaceId) {
    console.warn('[Zid Webhook] Merchant token not found for customer event', { storeId })
    return 'no_workspace'
  }

  const { allowed, reason } = await isWebhookEventEnabled(workspaceId, 'zid', event, String(storeId))
  if (!allowed) {
    console.info('[Zid Webhook] Customer event disabled by settings', { storeId, event, reason })
    await logWebhookSkip({
      workspaceId,
      platform: 'zid',
      event,
      storeId: String(storeId),
      reason: 'disabled_in_settings',
      detail: reason,
      payload: data,
    })
    return 'skipped'
  }

  const { enqueueWebhookEvent } = await import('@/lib/sync-queue')
  const queued = await enqueueWebhookEvent({
    acceptBeforeErp: true,
    workspaceId,
    storeId: String(storeId),
    event,
    platform: 'zid',
    payload: data,
  })
  if (queued.error) {
    console.error('[Zid Webhook] durable enqueue failed:', { event, storeId, error: queued.error })
    return 'error'
  }
  if (queued.id) {
    // تنبيه الوصول نارٍ وانسى (P1-1): لا يُنتظر فلا يؤخر الرد، ويُرسل عند
    // الإدراج الطازج فقط — الدمج/التكرار ليس طلباً جديداً.
    import('@/lib/telegram-notifier')
      .then(({ notifyOrderArrival }) =>
        notifyOrderArrival({
          workspaceId,
          platform: 'zid',
          event,
          storeId: String(storeId),
          payload: data,
          eventKey: queued.id ? `queue:${queued.id}` : null,
        })
      )
      .catch(() => {})
  }
  return queued.deferred ? 'deferred' : 'enqueued'
}

async function handleCategoryEvent(
  event: string,
  storeId: number,
  data: Record<string, unknown>
): Promise<HandlerResult> {
  const workspaceId = await findMerchantWorkspaceId(storeId)

  if (!workspaceId) {
    console.warn('[Zid Webhook] Merchant token not found for category event', { storeId })
    return 'no_workspace'
  }

  const { allowed, reason } = await isWebhookEventEnabled(workspaceId, 'zid', event, String(storeId))
  if (!allowed) {
    console.info('[Zid Webhook] Category event disabled by settings', { storeId, event, reason })
    await logWebhookSkip({
      workspaceId,
      platform: 'zid',
      event,
      storeId: String(storeId),
      reason: 'disabled_in_settings',
      detail: reason,
      payload: data,
    })
    return 'skipped'
  }

  try {
    const { enqueueWebhookEvent } = await import('@/lib/sync-queue')
    const queued = await enqueueWebhookEvent({
      acceptBeforeErp: true,
      workspaceId,
      storeId: String(storeId),
      event,
      platform: 'zid',
      payload: data,
    })
    if (queued.error) {
      console.error('[Zid Webhook] durable enqueue failed:', { event, storeId, error: queued.error })
      return 'error'
    }
    if (queued.id) {
    // تنبيه الوصول نارٍ وانسى (P1-1): لا يُنتظر فلا يؤخر الرد، ويُرسل عند
    // الإدراج الطازج فقط — الدمج/التكرار ليس طلباً جديداً.
    import('@/lib/telegram-notifier')
      .then(({ notifyOrderArrival }) =>
        notifyOrderArrival({
          workspaceId,
          platform: 'zid',
          event,
          storeId: String(storeId),
          payload: data,
          eventKey: queued.id ? `queue:${queued.id}` : null,
        })
      )
      .catch(() => {})
  }
  return queued.deferred ? 'deferred' : 'enqueued'
  } catch (err) {
    console.error('[Zid Webhook] Failed to enqueue category event', err)
    return 'error'
  }
}

/**
 * Abandoned carts: previously fell into UNHANDLED and were lost.
 * Now enqueued so the sync engine can turn them into a quotation/lead
 * (or just log them) when the merchant enables the event in settings.
 */
async function handleAbandonedCartEvent(
  event: string,
  storeId: number,
  data: Record<string, unknown>
): Promise<HandlerResult> {
  const workspaceId = await findMerchantWorkspaceId(storeId)

  if (!workspaceId) {
    console.warn('[Zid Webhook] Merchant token not found for abandoned-cart event', { storeId })
    return 'no_workspace'
  }

  const { allowed, reason } = await isWebhookEventEnabled(workspaceId, 'zid', event, String(storeId))
  if (!allowed) {
    console.info('[Zid Webhook] Abandoned cart event disabled by settings', { storeId, event, reason })
    await logWebhookSkip({
      workspaceId,
      platform: 'zid',
      event,
      storeId: String(storeId),
      reason: 'disabled_in_settings',
      detail: reason,
      payload: data,
    })
    return 'skipped'
  }

  const { enqueueWebhookEvent } = await import('@/lib/sync-queue')
  const queued = await enqueueWebhookEvent({
    acceptBeforeErp: true,
    workspaceId,
    storeId: String(storeId),
    event,
    platform: 'zid',
    payload: data,
  })
  if (queued.error) {
    console.error('[Zid Webhook] durable enqueue failed:', { event, storeId, error: queued.error })
    return 'error'
  }
  if (queued.id) {
    // تنبيه الوصول نارٍ وانسى (P1-1): لا يُنتظر فلا يؤخر الرد، ويُرسل عند
    // الإدراج الطازج فقط — الدمج/التكرار ليس طلباً جديداً.
    import('@/lib/telegram-notifier')
      .then(({ notifyOrderArrival }) =>
        notifyOrderArrival({
          workspaceId,
          platform: 'zid',
          event,
          storeId: String(storeId),
          payload: data,
          eventKey: queued.id ? `queue:${queued.id}` : null,
        })
      )
      .catch(() => {})
  }
  return queued.deferred ? 'deferred' : 'enqueued'
}

export async function POST(req: NextRequest) {
  return withDurableWebhookResponse('zid', req, handlePost)
}
