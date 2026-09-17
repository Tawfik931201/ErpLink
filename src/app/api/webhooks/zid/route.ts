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
 * Security: Zid includes an HMAC-SHA256 signature in X-Zid-Signature header
 * (hex أو base64). يُتحقق فقط عند ضبط ZID_WEBHOOK_SECRET.
 */
import crypto from 'crypto'

import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

import { supabase } from '@/lib/supabase'
import { webhookEmitter, type WebhookEventPayload } from '@/lib/webhook-emitter'

function verifyZidSignature(body: string, signature: string, secret: string): boolean {
  try {
    const sig = signature.trim().replace(/^sha256=/i, '')
    if (!sig) return false
    const hex = crypto.createHmac('sha256', secret).update(body).digest('hex')
    const b64 = crypto.createHmac('sha256', secret).update(body).digest('base64')
    for (const candidate of [hex, b64]) {
      try {
        if (sig.length === candidate.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(candidate))) {
          return true
        }
      } catch {
        // جرّب المرشح التالي
      }
    }
    return false
  } catch {
    return false
  }
}

function isUninstallEvent(event: string): boolean {
  const n = event.toLowerCase().replace(/[._\-/]/g, '')
  return n.includes('uninstall')
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const headersList = headers()
  const signature = headersList.get('x-zid-signature') ?? ''
  const webhookSecret = process.env.ZID_WEBHOOK_SECRET ?? ''

  // ── Verify signature (when a secret is configured, all envs) ───────────────
  if (webhookSecret) {
    if (!verifyZidSignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
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
    const explicitEvent = p.event || p.topic || p.action || target.event || target.topic || target.action
    if (typeof explicitEvent === 'string') {
      const lower = explicitEvent.toLowerCase()
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
  }

  // ── App uninstalled → fast 200 + clean the token (before any other lookup) ──
  if (isUninstallEvent(event)) {
    const storeStr = store_id ? String(store_id) : ''
    if (storeStr) {
      try {
        const { data: tokenRow } = await supabase
          .from('merchant_tokens')
          .select('merchant_id')
          .or(`store_id.eq.${storeStr},merchant_id.eq.${storeStr}`)
          .maybeSingle()
        const merchantId = (tokenRow as { merchant_id?: string } | null)?.merchant_id
        if (merchantId) {
          const { unregisterAllZidWebhooks } = await import('@/lib/zid/webhooks')
          await unregisterAllZidWebhooks(merchantId).catch(() => {})
        }
        await supabase.from('merchant_tokens').delete().or(`store_id.eq.${storeStr},merchant_id.eq.${storeStr}`)
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

  if (!store_id) {
    console.warn('[Zid Webhook] store_id missing — refusing to guess across tenants.')
    return NextResponse.json({ error: 'Missing store_id' }, { status: 400 })
  }
  if (event === 'unknown') {
    console.warn('[Zid Webhook] Could not determine event type — register webhook URL with ?event=<name>.')
    return NextResponse.json({ received: true, processed: false, reason: 'unknown_event' })
  }

  // ── Route events to handlers (enqueue فقط — 200 فوري) ─────────────────────
  // البث لـSSE يتم فقط للأحداث المفعّلة (داخل كل handler بعد فحص الإعدادات).
  try {
    switch (event) {
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
        await handleOrderEvent(event, store_id, data)
        break

      case 'abandoned_cart.created':
      case 'abandoned_cart_created':
      case 'abandoned_cart.completed':
      case 'abandoned_cart_completed':
        await handleAbandonedCartEvent(event, store_id, data)
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
        await handleProductEvent(event, store_id, data)
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
        await handleCustomerEvent(event, store_id, data)
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
        await handleCategoryEvent(event, store_id, data)
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
        await handleProductEvent(event, store_id, data)
        break

      default:
        return NextResponse.json({ received: true, processed: false, reason: 'unhandled_event' })
    }
  } catch (err) {
    console.error('[Zid Webhook] handler error', { event, store_id })
    // Return 200 anyway so Zid doesn't retry indefinitely
    return NextResponse.json({ received: true, processed: false })
  }

  // Trigger non-blocking background queue drain
  import('@/lib/sync-queue-runner').then(({ runSyncQueueOnce }) => {
    runSyncQueueOnce().catch(() => {})
  }).catch(() => {})

  return NextResponse.json({ received: true, queued: true })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Zid webhook endpoint is ready.',
    events: ['order.create', 'order.status.update', 'product.create', 'product.update', 'customer.create'],
  })
}

/** بث SSE خفيف: فقط للأحداث التي ستُعالج فعلاً (مفعّلة في الإعدادات). */
function emitToSse(event: string, store_id: number, data: Record<string, unknown>) {
  const broadcastPayload: WebhookEventPayload = {
    event,
    store_id,
    data,
    timestamp: (data.updated_at as string) ?? new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  }
  webhookEmitter.emit('zid-event', broadcastPayload)
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * Normalize any received event name (dot or underscore, legacy or official)
 * to the canonical sync-settings key used in ZID_EVENT_MAP.
 */
function toSettingsKey(event: string): string {
  const n = event.replace(/\./g, '_')
  // Legacy aliases from the old 29-key map → canonical keys
  const aliases: Record<string, string> = {
    order_updated: 'order_status_update',
    order_created: 'order_create',
    order_cancelled: 'order_status_update',
    order_delivered: 'order_status_update',
    order_tagged: 'order_status_update',
    product_created: 'product_create',
    product_updated: 'product_update',
    product_deleted: 'product_delete',
    product_published: 'product_publish',
    product_publish: 'product_publish',
    product_stock_create: 'product_update',
    product_stock_update: 'product_update',
    product_stock_delete: 'product_update',
    customer_created: 'customer_create',
    customer_updated: 'customer_update',
    category_created: 'category_create',
    category_updated: 'category_update',
    category_deleted: 'category_delete',
    location_create: 'product_update',
    location_update: 'product_update',
    location_delete: 'product_update',
    location_stock_update: 'product_update',
  }
  return aliases[n] ?? n
}

async function findMerchantToken(storeId: number) {
  const storeStr = String(storeId)
  const { data } = await supabase
    .from('merchant_tokens')
    .select('workspace_id, sync_settings')
    .or(`store_id.eq.${storeStr},merchant_id.eq.${storeStr}`)
    .maybeSingle()
  return data as { workspace_id: string | null; sync_settings: Record<string, { zid2odoo?: boolean }> | null } | null
}

function isEventEnabled(
  syncSettings: Record<string, { zid2odoo?: boolean }> | null | undefined,
  event: string
): boolean {
  if (!syncSettings) return false
  return syncSettings[toSettingsKey(event)]?.zid2odoo === true
}

async function handleOrderEvent(
  event: string,
  storeId: number,
  data: Record<string, unknown>
) {
  const merchantToken = await findMerchantToken(storeId)

  if (!merchantToken?.workspace_id) {
    console.warn('[Zid Webhook] Merchant token not found for order event', { storeId })
    return
  }

  if (!isEventEnabled(merchantToken.sync_settings, event)) return

  const { enqueueWebhookEvent } = await import('@/lib/sync-queue')
  await enqueueWebhookEvent({
    workspaceId: merchantToken.workspace_id,
    storeId: String(storeId),
    event,
    platform: 'zid',
    payload: data,
  })
  emitToSse(event, storeId, data)
}

async function handleProductEvent(
  event: string,
  storeId: number,
  data: Record<string, unknown>
) {
  // Check sync settings from merchant_tokens (like Salla and Shopify do)
  const merchantToken = await findMerchantToken(storeId)

  if (!merchantToken?.workspace_id) {
    console.warn('[Zid Webhook] Merchant token not found for product event', { storeId })
    return
  }

  // Zid sends dot-notation event names (e.g. "product.create") but
  // sync_settings are stored with underscore keys ("product_create").
  if (!isEventEnabled(merchantToken.sync_settings, event)) return

  const { enqueueWebhookEvent } = await import('@/lib/sync-queue')
  await enqueueWebhookEvent({
    workspaceId: merchantToken.workspace_id,
    storeId: String(storeId),
    event,
    platform: 'zid',
    payload: data,
  })
  emitToSse(event, storeId, data)
}

async function handleCustomerEvent(
  event: string,
  storeId: number,
  data: Record<string, unknown>
) {
  const merchantToken = await findMerchantToken(storeId)

  if (!merchantToken?.workspace_id) {
    console.warn('[Zid Webhook] Merchant token not found for customer event', { storeId })
    return
  }

  if (!isEventEnabled(merchantToken.sync_settings, event)) return

  const { enqueueWebhookEvent } = await import('@/lib/sync-queue')
  await enqueueWebhookEvent({
    workspaceId: merchantToken.workspace_id,
    storeId: String(storeId),
    event,
    platform: 'zid',
    payload: data,
  })
  emitToSse(event, storeId, data)
}

async function handleCategoryEvent(
  event: string,
  storeId: number,
  data: Record<string, unknown>
) {
  // Find workspace_id from merchant token
  const merchantToken = await findMerchantToken(storeId)

  if (!merchantToken?.workspace_id) {
    console.warn('[Zid Webhook] Merchant token not found for category event', { storeId })
    return
  }

  if (!isEventEnabled(merchantToken.sync_settings, event)) return

  try {
    const { enqueueWebhookEvent } = await import('@/lib/sync-queue')
    await enqueueWebhookEvent({
      workspaceId: merchantToken.workspace_id,
      storeId: String(storeId),
      event,
      platform: 'zid',
      payload: data,
    })
    emitToSse(event, storeId, data)
  } catch {
    console.error('[Zid Webhook] Failed to enqueue category event')
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
) {
  const merchantToken = await findMerchantToken(storeId)

  if (!merchantToken?.workspace_id) {
    console.warn('[Zid Webhook] Merchant token not found for abandoned-cart event', { storeId })
    return
  }

  if (!isEventEnabled(merchantToken.sync_settings, event)) return

  const { enqueueWebhookEvent } = await import('@/lib/sync-queue')
  await enqueueWebhookEvent({
    workspaceId: merchantToken.workspace_id,
    storeId: String(storeId),
    event,
    platform: 'zid',
    payload: data,
  })
  emitToSse(event, storeId, data)
}
