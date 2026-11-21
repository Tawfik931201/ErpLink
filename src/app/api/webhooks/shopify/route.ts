import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

import { recordAudit } from '@/lib/audit-logs'
import { withDurableWebhookResponse } from '@/lib/durable-webhook-response'
import { resolveEventOperation } from '@/lib/event-operation'
import { checkUnauthenticatedIngressLimit } from '@/lib/ingress-admission'
import { rateLimitKeyFromHeaders } from '@/lib/rate-limit'
import {
  SHOPIFY_GDPR_TOPICS,
  SHOPIFY_TOPIC_CATALOG,
  extractShopifyEntityId,
  extractShopifyUpdatedAtMs,
  isShopifyUpdateTopic,
  isValidShopDomain,
  verifyShopifySignature,
} from '@/lib/shopify-client'
import { supabase } from '@/lib/supabase'
import { enqueueWebhookEvent, fingerprintPayload } from '@/lib/sync-queue'
import { ttlCache } from '@/lib/ttl-cache'
import { isWebhookEventEnabled } from '@/lib/webhook-gate'
import { logWebhookSkip } from '@/lib/webhook-skip-log'
import { isWebhookBodyTooLarge, MAX_WEBHOOK_BODY_BYTES } from '@/lib/webhook-strict'

const GDPR_TOPICS: readonly string[] = SHOPIFY_GDPR_TOPICS
const KNOWN_TOPICS: ReadonlySet<string> = new Set([
  ...(SHOPIFY_TOPIC_CATALOG as readonly string[]),
  'app/uninstalled',
  ...(SHOPIFY_GDPR_TOPICS as readonly string[]),
  'app/scopes_update',
])

async function handlePost(req: NextRequest) {
  const rawBody = await req.text()
  const headersList = await headers()
  const getHeader = (name: string) => headersList.get(name)

  // حد الاستقبال: للمجهولين فقط. Shopify توقّع دائماً (x-shopify-hmac-sha256)،
  // فكل طلب حقيقي موثّق ولا يخضع لحد الـIP — حد 120/دقيقة كان يحوّل عملاء
  // الموسم إلى ضياع صامت (429 ⇒ Shopify لا يعيد الإرسال بعد 4xx).
  const credentialPresented = !!headersList.get('x-shopify-hmac-sha256')
  const unauthLimit = checkUnauthenticatedIngressLimit({
    scope: 'shopify',
    credentialPresented,
    bucketKey: rateLimitKeyFromHeaders(getHeader, 'shopify-webhook'),
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

  const signature = (headersList.get('x-shopify-hmac-sha256') ?? '').trim()
  const shopDomain = (headersList.get('x-shopify-shop-domain') ?? '').trim().toLowerCase()
  const topic = (headersList.get('x-shopify-topic') ?? '').trim()
  const webhookId = (headersList.get('x-shopify-webhook-id') ?? '').trim()
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET || ''

  // ── تحقق HMAC (header) قبل أي عمل ثقيل — 401 عند الفشل ───────────────
  if (webhookSecret) {
    if (!signature || !verifyShopifySignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[Shopify Webhook] Security Alert: SHOPIFY_WEBHOOK_SECRET / SHOPIFY_CLIENT_SECRET is not configured in production.')
    return NextResponse.json({ error: 'Webhook secret not configured on server' }, { status: 500 })
  }

  // early-returns خفيفة: نطاق + موضوع
  if (!shopDomain || !isValidShopDomain(shopDomain)) {
    return NextResponse.json({ error: 'Missing or invalid shop domain header' }, { status: 400 })
  }
  if (!topic) {
    return NextResponse.json({ error: 'Missing topic header' }, { status: 400 })
  }

  // App uninstalled → تنظيف التوكن + أوامر الطابور اليتيمة ثم 200 فوري
  if (topic === 'app/uninstalled') {
    await supabase.from('shopify_tokens').delete().eq('shop_domain', shopDomain)
    // best-effort: لا تُعالَج أحداث معلقة لمتجر محذوف
    try {
      await supabase.from('sync_queue').delete().eq('store_id', shopDomain).eq('platform', 'shopify')
    } catch {
      // تجاهل — التنظيف غير قاتل
    }
    await recordAudit({
      actorId: shopDomain,
      actorRole: 'system',
      action: 'shopify.app_uninstalled',
      entityType: 'shopify_store',
      entityId: shopDomain,
    }).catch(() => {})
    return NextResponse.json({ received: true, processed: true, reason: 'app_uninstalled' })
  }

  // ── GDPR الإلزامية: 200 خلال 5 ثوانٍ، audit فقط، بلا مزامنة ──────────
  if ((GDPR_TOPICS as readonly string[]).includes(topic)) {
    await recordAudit({
      actorId: shopDomain,
      actorRole: 'system',
      action: `shopify.${topic.replace('/', '.')}`,
      entityType: 'shopify_store',
      entityId: shopDomain,
      metadata: { topic },
    }).catch(() => {})
    return NextResponse.json({ received: true, processed: true, reason: 'gdpr_ack' })
  }

  // ── Scopes update → تحديث عمود scopes ────────────────────────────────
  if (topic === 'app/scopes_update') {
    try {
      let parsed: any = {}
      try {
        parsed = JSON.parse(rawBody)
      } catch {
        parsed = {}
      }
      const scopes: string[] | null = Array.isArray(parsed?.current)
        ? parsed.current.map((s: any) => (typeof s === 'string' ? s : s?.handle)).filter(Boolean)
        : null
      if (scopes) {
        await supabase.from('shopify_tokens').update({ scopes: scopes.join(',') }).eq('shop_domain', shopDomain)
      }
    } catch {
      // non-fatal
    }
    await recordAudit({
      actorId: shopDomain,
      actorRole: 'system',
      action: 'shopify.scopes_update',
      entityType: 'shopify_store',
      entityId: shopDomain,
    }).catch(() => {})
    return NextResponse.json({ received: true, processed: true, reason: 'scopes_update' })
  }

  // موضوع غير معروف → ack بلا enqueue (يحمي الطابور من الضجيج)
  if (!KNOWN_TOPICS.has(topic)) {
    // best-effort: إن كان المتجر مربوطاً وثّق التخطي في sync_logs بدل الصمت
    // (موضوع حقيقي جديد من متجر مربوط = حدث ضائع بلا أثر). البحث مخزّن
    // 60 ثانية فلا يكلف قاعدة البيانات في الضجيج المتكرر، والرد يبقى كما هو.
    try {
      const maybe = await ttlCache.get(
        `shopify:token:${shopDomain}`,
        60_000,
        async () => {
          const { data } = await supabase
            .from('shopify_tokens')
            .select('workspace_id')
            .eq('shop_domain', shopDomain)
            .maybeSingle()
          return data as { workspace_id: string | null } | null
        }
      )
      if (maybe?.workspace_id) {
        await logWebhookSkip({
          workspaceId: maybe.workspace_id,
          platform: 'shopify',
          event: topic,
          storeId: shopDomain,
          reason: 'unknown_topic',
          payload: {},
        })
      }
    } catch {
      // التوثيق best-effort فقط.
    }
    return NextResponse.json({ received: true, processed: false, reason: 'unknown_topic' })
  }

  // Idempotency ذرّي: `dedup_key` = shopify:<shop>:<topic>:<X-Shopify-Webhook-Id>
  // موصى به رسمياً في توثيق Shopify ومعه فهرس فريد جزئي، فتنهار التسليمات
  // المكرّرة إلى صف واحد حتى مع تزامن عمليّن.
  const shopifyDedupKey = webhookId ? `shopify:${shopDomain}:${topic}:${webhookId}` : null
  if (shopifyDedupKey) {
    // مقيّد بصفوف pending: الصف المجمّد (كل المحاولات استُنفدت) هو سجل تاريخي
    // قابله بلا معالجة — الفيتو على إدراج حدث جديد بمفتاحه يعيد فقدان الأحداث
    // الذي أزاله الفهرس الجزئي. (نفس إصلاح enqueueWebhookEvent.)
    const { data: dup } = await supabase
      .from('sync_queue')
      .select('id')
      .eq('dedup_key', shopifyDedupKey)
      .not('next_retry_at', 'is', null)
      .limit(1)
      .maybeSingle()
    if (dup) {
      return NextResponse.json({ received: true, processed: false, reason: 'duplicate' })
    }
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    // وصلنا هنا بعد تحقق HMAC ناجح (في الإنتاج) — جسم صالح التوقيع ولا
    // يمكنه الرد 400 صامتاً: يُحفظ كيتيم (workspace_id = null) بدل أن يضيع.
    console.error('[Shopify Webhook] Invalid JSON body on signed delivery — saved as orphan receipt')
    const { recordOrphanReceipt } = await import('@/lib/webhook-inbox')
    const stored = await recordOrphanReceipt({
      platform: 'shopify',
      storeId: shopDomain,
      event: topic,
      dedupKey: `shopify:malformed:${shopDomain}:${topic}:${webhookId || rawBody.length}`,
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
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // ── فحص خفيف للتوكن (مخزن مؤقتاً في الذاكرة 60 ثانية لحماية قاعدة البيانات) ──
  const shopifyToken = await ttlCache.get(
    `shopify:token:${shopDomain}`,
    60_000,
    async () => {
      const { data } = await supabase
        .from('shopify_tokens')
        .select('workspace_id')
        .eq('shop_domain', shopDomain)
        .maybeSingle()
      return data as { workspace_id: string | null } | null
    }
  )

  if (!shopifyToken?.workspace_id) {
    // لا يوجد ربط متجر لهذا الـshop — لا نخمّن المستأجر (تفادي خلط العملاء).
    //
    // كان يُعاد 404 هنا، أي رفض نهائي: Shopify توقّف عن الإرسال بعد 3 محاولات
    // فقـد الحدث. الآن نحفظه في صندوق الاستلام كـ«orphan» ونعيد 202: المتجر
    // يتوقف عن الإرسال بلا فائدة، والحدث يبقى محفوظاً قابلاً للاسترداد فور
    // ربط المتجر. نفس سلوك مسار زد.
    console.error('[Shopify Webhook] no workspace bound to shop — event stored as orphan', {
      topic,
      shopDomain,
    })
    const { recordOrphanReceipt } = await import('@/lib/webhook-inbox')
    const { fingerprintPayload } = await import('@/lib/sync-queue')
    const stored = await recordOrphanReceipt({
      platform: 'shopify',
      storeId: shopDomain,
      event: topic,
      dedupKey: `shopify:orphan:${shopDomain}:${topic}:${
        webhookId || fingerprintPayload(payload as Record<string, unknown>)
      }`,
      payload: payload as Record<string, unknown>,
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

  // ── فحص إعدادات صفحة Mapping Center (Standard Mapping) ──
  const { allowed, reason } = await isWebhookEventEnabled(shopifyToken.workspace_id, 'shopify', topic, shopDomain)
  if (!allowed) {
    // الرد يبقى 200 كما هو، لكن القرار يُوثَّق في sync_logs بدل الصمت.
    await logWebhookSkip({
      workspaceId: shopifyToken.workspace_id as string,
      platform: 'shopify',
      event: topic,
      storeId: shopDomain,
      reason: 'disabled_in_settings',
      detail: reason,
      payload: {},
    })
    return NextResponse.json({ received: true, processed: false, reason: 'disabled_in_settings', detail: reason })
  }

  // ── موضوع معروف بلا entity يُزامَن (carts/checkouts/inventory/refunds) ──
  // لا preset ستاندرد ولا كتالوج Mapping Center يقرأها، فالـ enqueue كان ينتهي
  // إلى لا شيء بصمت (standard-mapping-only, total=0) مع استهلاك دورة طابور.
  // نسجل التخطي في sync_logs ونرد 200 بدل enqueue لا معنى له. الاستثناء الوحيد:
  // custom field_mapping قديم بنفس الـ action — موجود قبل أن يُحصر الكتالوج —
  // فيُترك للمسار القديم (fail open عند أي خطأ في الفحص).
  if (!resolveEventOperation(topic, 'shopify')) {
    let hasCustomMapping = true
    try {
      hasCustomMapping = await ttlCache.get(
        `shopify:custom:${shopDomain}:${topic}`,
        60_000,
        async () => {
          const { data } = await supabase
            .from('field_mappings')
            .select('id')
            .or(`store_id.eq.${shopDomain},merchant_id.eq.${shopDomain}`)
            .eq('action', topic)
            .is('erp_destination_retired_at', null)
            .limit(1)
          return ((data as Array<{ id: string }> | null)?.length ?? 0) > 0
        }
      )
    } catch {
      hasCustomMapping = true
    }
    if (!hasCustomMapping) {
      await logWebhookSkip({
        workspaceId: shopifyToken.workspace_id as string,
        platform: 'shopify',
        event: topic,
        storeId: shopDomain,
        reason: 'no_entity_mapping',
        detail: 'Topic has no synced entity (no Standard preset or mapping-centre entry)',
        payload: {},
      })
      return NextResponse.json({ received: true, processed: false, reason: 'no_entity_mapping' })
    }
  }

  const entityId = extractShopifyEntityId(payload)
  const incomingTs = extractShopifyUpdatedAtMs(payload)
  const enrichedPayload = webhookId ? { ...payload, shopify_webhook_id: webhookId } : payload

  // ── دفعات: تجاهل خارج الترتيب + دمج تحديثات المنتج المتكررة ──────────
  // استعلام واحد خفيف (حتى 25 معلقة) يخدم الحالتين معاً.
  if (entityId && isShopifyUpdateTopic(topic)) {
    try {
      const { data: pending } = await supabase
        .from('sync_queue')
        .select('id, payload')
        .eq('store_id', shopDomain)
        .eq('event', topic)
        .eq('platform', 'shopify')
        .limit(25)
      const rows = (pending as Array<{ id: string; payload: any }> | null) || []
      let newestQueuedTs = 0
      let mergeRowId: string | null = null
      for (const row of rows) {
        const p = row?.payload as any
        if (!p || extractShopifyEntityId(p) !== entityId) continue
        const ts = extractShopifyUpdatedAtMs(p)
        if (ts > newestQueuedTs) newestQueuedTs = ts
        // دمج products/update: أحدث payload يربح — نُحدّث الصف بدل صف جديد
        if (topic === 'products/update' && mergeRowId === null) mergeRowId = row.id
      }
      // outside order: الوارد أقدم من المعلَّق → تجاهل مع توثيق في sync_logs.
      // «بلا أثر» لم يعد كذلك سالاً: يُحفظ كيتيم (workspace_id = null) —
      // دائم وقابل للاسترداد اليدوي، لا يستطيع وحده أن يرجّع حالة أقدم.
      if (incomingTs > 0 && newestQueuedTs > 0 && incomingTs < newestQueuedTs) {
        await logWebhookSkip({
          workspaceId: shopifyToken.workspace_id as string,
          platform: 'shopify',
          event: topic,
          storeId: shopDomain,
          reason: 'stale_event',
          payload: (enrichedPayload ?? {}) as Record<string, unknown>,
        })
        const { recordOrphanReceipt } = await import('@/lib/webhook-inbox')
        const stored = await recordOrphanReceipt({
          platform: 'shopify',
          storeId: shopDomain,
          event: topic,
          dedupKey: `shopify:stale:${shopDomain}:${topic}:${
            webhookId || fingerprintPayload(payload as Record<string, unknown>)
          }`,
          payload: (enrichedPayload ?? {}) as Record<string, unknown>,
        })
        if (!stored.ok) {
          return NextResponse.json(
            { received: false, processed: false, error: stored.error ?? 'orphan_store_failed' },
            { status: 503 }
          )
        }
        return NextResponse.json({ received: true, processed: false, reason: 'stale_event' })
      }
      // دمج: حدّث الصف المعلَّق بدل enqueue جديد (يضغط bursts)
      if (mergeRowId) {
        const { data: mergedRows, error: mergeErr } = await supabase
          .from('sync_queue')
          .update({
            payload: enrichedPayload,
            // تحديث updated_at مقصود: حارس تسوية العامل (settleSuccessfulItem)
            // يقارن updated_at — بلا هذا التحديث قد يقطع العامل الصف المدموج
            // عند نجاحه ويضيع Payload الدمج.
            updated_at: new Date().toISOString(),
          })
          .eq('id', mergeRowId)
          .select('id')
        if (mergeErr || (Array.isArray(mergedRows) && mergedRows.length === 0)) {
          // فشل الدمج (حُذف الصف عبر سباق أو خطأ) → لا 200 صامت: enqueue عادي
          // يضمن الحفظ الدائم. كان الرد `merged:true` يطمس الفشل نهائياً.
          console.warn('[Shopify Webhook] merge update fell through to enqueue', {
            topic,
            shopDomain,
            mergeRowId,
            error: mergeErr?.message ?? 'no_rows',
          })
        } else {
          return NextResponse.json({ received: true, queued: true, merged: true })
        }
      }
    } catch {
      // best-effort — عند فشل الفحص نتابع للـ enqueue العادي
    }
  }

  // ── بث SSE (in-memory سريع) ثم enqueue فقط — بلا إثراء ثقيل ──────────
  try {
    const queued = await enqueueWebhookEvent({
      acceptBeforeErp: true,
      workspaceId: shopifyToken.workspace_id as string,
      storeId: shopDomain,
      event: topic,
      platform: 'shopify',
      payload: enrichedPayload,
      dedupKey: shopifyDedupKey,
    })
    if (queued.error) {
      console.error('[Shopify Webhook] durable enqueue failed:', queued.error)
      return NextResponse.json(
        { received: false, processed: false, error: 'durable_storage_failed' },
        { status: 503 }
      )
    }
    if (queued.id) {
      // تنبيه الوصول نارٍ وانسى (P1-1): لا يُنتظر فلا يؤخر الرد، ويُرسل عند
      // الإدراج الطازج فقط — الدمج/التكرار ليس طلباً جديداً.
      import('@/lib/telegram-notifier')
        .then(({ notifyOrderArrival }) =>
          notifyOrderArrival({
            workspaceId: shopifyToken.workspace_id as string,
            platform: 'shopify',
            event: topic,
            storeId: shopDomain,
            payload: (enrichedPayload ?? {}) as Record<string, unknown>,
            eventKey: queued.id ? `queue:${queued.id}` : null,
          })
        )
        .catch(() => {})
    }
    return NextResponse.json({ received: true, queued: !queued.deferred })
  } catch {
    // استثناء قبل الحفظ الدائم → 503 ليعيد Shopify الإرسال (8 مرات / 4 ساعات).
    return NextResponse.json(
      { received: false, processed: false, error: 'enqueue_failed' },
      { status: 503 }
    )
  }

}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Shopify webhook endpoint is ready.',
  })
}

export async function POST(req: NextRequest) {
  return withDurableWebhookResponse('shopify', req, handlePost)
}
