import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

import { recordAudit } from '@/lib/audit-logs'
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
import { enqueueWebhookEvent } from '@/lib/sync-queue'
import { ttlCache } from '@/lib/ttl-cache'
import { isWebhookEventEnabled } from '@/lib/webhook-gate'

const GDPR_TOPICS: readonly string[] = SHOPIFY_GDPR_TOPICS
const KNOWN_TOPICS: ReadonlySet<string> = new Set([
  ...(SHOPIFY_TOPIC_CATALOG as readonly string[]),
  'app/uninstalled',
  ...(SHOPIFY_GDPR_TOPICS as readonly string[]),
  'app/scopes_update',
])

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const headersList = headers()

  const signature = (headersList.get('x-shopify-hmac-sha256') ?? '').trim()
  const shopDomain = (headersList.get('x-shopify-shop-domain') ?? '').trim().toLowerCase()
  const topic = (headersList.get('x-shopify-topic') ?? '').trim()
  const webhookId = (headersList.get('x-shopify-webhook-id') ?? '').trim()
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET ?? ''

  // ── تحقق HMAC (header) قبل أي عمل ثقيل — 401 عند الفشل ───────────────
  if (webhookSecret) {
    if (!signature || !verifyShopifySignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[Shopify Webhook] Security Alert: SHOPIFY_WEBHOOK_SECRET is not configured in production.')
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
    return NextResponse.json({ received: true, processed: false, reason: 'unknown_topic' })
  }

  // Idempotency ذرّي: `dedup_key` = shopify:<shop>:<topic>:<X-Shopify-Webhook-Id>
  // موصى به رسمياً في توثيق Shopify ومعه فهرس فريد جزئي، فتنهار التسليمات
  // المكرّرة إلى صف واحد حتى مع تزامن عمليّن.
  const shopifyDedupKey = webhookId ? `shopify:${shopDomain}:${topic}:${webhookId}` : null
  if (shopifyDedupKey) {
    const { data: dup } = await supabase
      .from('sync_queue')
      .select('id')
      .eq('dedup_key', shopifyDedupKey)
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
  const { allowed, reason } = await isWebhookEventEnabled(shopifyToken.workspace_id, 'shopify', topic)
  if (!allowed) {
    return NextResponse.json({ received: true, processed: false, reason: 'disabled_in_settings', detail: reason })
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
      // خارج الترتيب: الوارد أقدم من المعلَّق → تجاهل
      if (incomingTs > 0 && newestQueuedTs > 0 && incomingTs < newestQueuedTs) {
        return NextResponse.json({ received: true, processed: false, reason: 'stale_event' })
      }
      // دمج: حدّث الصف المعلَّق بدل enqueue جديد (يضغط bursts)
      if (mergeRowId) {
        await supabase.from('sync_queue').update({ payload: enrichedPayload }).eq('id', mergeRowId)
        return NextResponse.json({ received: true, queued: true, merged: true })
      }
    } catch {
      // best-effort — عند فشل الفحص نتابع للـ enqueue العادي
    }
  }

  // ── بث SSE (in-memory سريع) ثم enqueue فقط — بلا إثراء ثقيل ──────────
  try {
    const queued = await enqueueWebhookEvent({
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
  } catch {
    // استثناء قبل الحفظ الدائم → 503 ليعيد Shopify الإرسال (8 مرات / 4 ساعات).
    return NextResponse.json(
      { received: false, processed: false, error: 'enqueue_failed' },
      { status: 503 }
    )
  }

  // رد 200 فوري — الإثراء والمعالجة الثقيلة في الطابور المركزي بعد الحفظ الدائم.
  return NextResponse.json({ received: true, queued: true })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Shopify webhook endpoint is ready.',
  })
}
