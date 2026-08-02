/**
 * POST /api/webhooks/zid
 *
 * Receives real-time webhook events from Zid:
 *   - order.created / order.updated / order.cancelled / order.delivered
 *   - product.created / product.updated / product.deleted
 *   - customer.created
 *
 * Zid sends the webhook as a POST request with a JSON body.
 * Verify the signature using the webhook secret set during registration.
 *
 * Security: Zid includes an HMAC-SHA256 signature in X-Zid-Signature header.
 */
import crypto from 'crypto'

import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

import { supabase } from '@/lib/supabase'
import { webhookEmitter, type WebhookEventPayload } from '@/lib/webhook-emitter'
import type { ZidWebhookEvent } from '@/lib/zid-client'
import { processWebhookEvent } from '@/lib/sync-engine'
import { startTelegramPoller } from '@/lib/telegram-long-poller'

// Lazy-start the Telegram poller on first webhook hit so /start confirmations
// work even if the user has never visited the notifications settings page.
startTelegramPoller()

interface ZidWebhookPayload {
  event: string   // Keep as string — Zid may send event names not in our type union
  store_id: number
  data: Record<string, unknown>
  timestamp: string
}

function verifyZidSignature(body: string, signature: string, secret: string): boolean {
  try {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const headersList = headers()
  const signature = headersList.get('x-zid-signature') ?? ''
  const webhookSecret = process.env.ZID_WEBHOOK_SECRET ?? ''

  // ── Verify signature (skip in development) ────────────────────────────────
  if (process.env.NODE_ENV === 'production' && webhookSecret) {
    if (!verifyZidSignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.warn('[Zid Webhook] Invalid JSON payload received')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // ── Log the raw payload and all headers ───────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    console.info('[Zid Webhook] ======================================')
    console.info('[Zid Webhook] RAW PAYLOAD KEYS:', Object.keys(payload))

    // Log all Zid-related headers to find event type header
    const allHeaders: Record<string, string> = {}
    headersList.forEach((value, key) => { allHeaders[key] = value })
    const zidHeaders = Object.fromEntries(
      Object.entries(allHeaders).filter(([k]) => k.toLowerCase().includes('zid') || k.toLowerCase().includes('event') || k.toLowerCase().includes('topic') || k.toLowerCase().includes('hook'))
    )
    console.info('[Zid Webhook] Zid-related headers:', JSON.stringify(zidHeaders, null, 2))
    console.info('[Zid Webhook] ======================================')
  }

  // ── Determine event type — in order of priority ───────────────────────────
  // Priority 1: Query parameter ?event=product.created
  //   → Register webhook in Zid as: https://your-domain.com/api/webhooks/zid?event=product.created
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
      if (lower.includes('category.delete') || lower.includes('category_delete') || lower.includes('category.deleted') || lower.includes('category_deleted')) {
        return 'category.deleted'
      }
      if (lower.includes('category.create') || lower.includes('category_create') || lower.includes('category.created') || lower.includes('category_created')) {
        return 'category.created'
      }
      if (lower.includes('category.update') || lower.includes('category_update') || lower.includes('category.updated') || lower.includes('category_updated')) {
        return 'category.updated'
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
      target.store_id ??
      target.storeId ??
      p.store?.id ??
      p.store?.store_id ??
      target.store?.id ??
      target.store?.store_id ??
      p.merchant?.store_id ??
      target.merchant?.store_id ??
      req.nextUrl.searchParams.get('store_id') ??
      req.nextUrl.searchParams.get('storeId') ??
      headersList.get('x-store-id') ??
      headersList.get('store-id') ??
      headersList.get('store_id') ??
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
      if (tokens && tokens.length > 0) {
        if (tokens.length === 1) {
          store_id = Number(tokens[0].store_id)
          console.info(`[Zid Webhook] Resolved store_id=${store_id} from single merchant token database fallback`)
        } else {
          // SECURITY: never guess the store from the "latest" token when multiple
          // stores exist — that could sync one tenant's data into another tenant's ERP.
          console.warn(
            `[Zid Webhook] ⚠️  store_id missing and ${tokens.length} merchant tokens exist — refusing to guess. ` +
            'Register the Zid webhook URL with ?store_id=<id> to fix this.'
          )
        }
      }
    } catch (err) {
      console.warn('[Zid Webhook] Failed to resolve fallback store_id from merchant_tokens:', err)
    }
  }

  // Zid sends event data nested inside a "data" field
  const data: Record<string, unknown> = (payload.data && typeof payload.data === 'object') ? payload.data : payload

  const entityId = data.id ?? data.category_id ?? data.category_uuid ?? data.customer_id ?? data.order_id ?? data.product_id ?? 'undefined'
  console.info(`[Zid Webhook] Event resolved → "${event}" (from: ${queryEvent ? 'query' : headerEvent ? 'header' : 'inference'})`)
  console.info(`[Zid Webhook] store_id=${store_id} | entity_id=${entityId} | sku=${data.sku ?? 'none'}`)
  if (!store_id) {
    console.warn('[Zid Webhook] ⚠️  store_id was not found in payload; field_mappings lookup may not match.')
  }
  if (event === 'unknown') {
    console.warn('[Zid Webhook] ⚠️  Could not determine event type!')
    console.warn('[Zid Webhook] 💡 FIX: Register your Zid webhook URL with ?event=product.created')
    console.warn('[Zid Webhook]    Example: https://your-domain.com/api/webhooks/zid?event=product.created')
  }

  // ── Broadcast to all SSE-connected browsers ───────────────────────────────
  const broadcastPayload: WebhookEventPayload = {
    event: event as any,
    store_id,
    data,
    timestamp: payload.updated_at ?? new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  }
  webhookEmitter.emit('zid-event', broadcastPayload)

  // ── Route events to handlers ──────────────────────────────────────────────
  console.info(`[Zid Webhook] ▶ Routing event="${event}" store_id=${store_id}`)

  try {
    switch (event) {
      case 'order.create':
      case 'order.created':
      case 'order_create':
      case 'order_created':
      case 'order.status.update':
      case 'order.updated':
      case 'order.delivered':
      case 'order.cancelled':
      case 'order.payment_status.update':
        await handleOrderEvent(event, store_id, data)
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
        await handleProductEvent(event, store_id, data)
        break

      default:
        // Log clearly so we know the exact event name Zid is sending
        console.warn(`[Zid Webhook] ⚠️  UNHANDLED event="${event}" — not matched in switch. Full payload:`)
        console.warn(JSON.stringify({ event, store_id, dataKeys: Object.keys(data) }, null, 2))
        break
    }
  } catch (err) {
    console.error('[Zid Webhook] handler error', { event, store_id, err })
    // Return 200 anyway so Zid doesn't retry indefinitely
    return NextResponse.json({ received: true, processed: false })
  } finally {
    // Process retry queue in the background
    try {
      const { processSyncQueue } = await import('@/lib/sync-queue')
      processSyncQueue().catch(e => console.warn('[SyncQueue] Background processing error:', e))
    } catch { /* ignore */ }
  }

  return NextResponse.json({ received: true, processed: true })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Zid webhook endpoint is ready.',
    events: ['product.created'],
  })
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function handleOrderEvent(
  event: string,
  storeId: number,
  data: Record<string, unknown>
) {
  // Find the Merchant Token record for this Zid store
  const { data: merchantToken } = await supabase
    .from('merchant_tokens')
    .select('*')
    .eq('store_id', String(storeId))
    .maybeSingle()

  if (!merchantToken) {
    console.warn('[Zid Webhook] Merchant token not found for order event', { storeId })
    return
  }

  // Check sync settings (like handleProductEvent does)
  if (merchantToken.sync_settings) {
    const syncSettings = merchantToken.sync_settings as Record<string, any>
    const normalizedEvent = event.replace(/\./g, '_')
    const eventSettings = syncSettings[normalizedEvent]
    const isEnabled = eventSettings?.zid2odoo === true
    if (!isEnabled) {
      console.info(`[Zid Webhook] Order event "${event}" is disabled in sync settings for store "${storeId}". Skipping sync.`)
      return
    }
  }

  console.info('[Zid Webhook] Order event received — triggering sync engine', { event, storeId, orderId: data.id })
  await processWebhookEvent(event, storeId, data, 'zid')
}

async function handleProductEvent(
  event: string,
  storeId: number,
  data: Record<string, unknown>
) {
  const productName = (data.name && typeof data.name === 'object') 
    ? ((data.name as any).ar || (data.name as any).en || JSON.stringify(data.name)) 
    : String(data.name || 'بدون اسم')
  const productSku = String(data.sku || 'لا يوجد')
  const productId = String(data.id || 'غير معروف')
  console.info(`\n[Zid Webhook] 📥 وصل منتج من زد: [الحدث: ${event}] | [الاسم: ${productName}] | [المعرف: ${productId}] | [الرمز SKU: ${productSku}]`)

  // Check sync settings from merchant_tokens (like Salla and Shopify do)
  const { data: merchantToken } = await supabase
    .from('merchant_tokens')
    .select('sync_settings')
    .eq('store_id', String(storeId))
    .maybeSingle()

  if (merchantToken?.sync_settings) {
    const syncSettings = merchantToken.sync_settings as Record<string, any>
    // Zid sends dot-notation event names (e.g. "product.create") but
    // sync_settings are stored with underscore keys ("product_create").
    const normalizedEvent = event.replace(/\./g, '_')
    const eventSettings = syncSettings[normalizedEvent]
    const isEnabled = eventSettings?.zid2odoo === true
    if (!isEnabled) {
      console.info(`[Zid Webhook] Event "${event}" is disabled in sync settings for store "${storeId}". Skipping sync.`)
      console.info('[Zid Webhook] ===== handleProductEvent END (skipped) =====')
      return
    }
  }

  // Trigger sync engine directly — it reads field_mappings by store_id internally
  const result = await processWebhookEvent(event, storeId, data, 'zid')
  if (result.success > 0) {
    const syncedRecords = result.records
      .filter(record => record.status === 'success')
      .map(record => `${record.model}#${record.odooRecordId}`)
      .join(', ')
    console.info(`[Zid Webhook] ✅ تم التسجيل والمزامنة بنجاح في أودو: ${syncedRecords}`)
  } else if (result.processed === 0) {
    console.warn(`[Zid Webhook] ⚠️  لم يتم العثور على خريطة مطابقة (Field Mapping) لحدث المنتجات: event="${event}" store_id=${storeId}`)
  } else {
    console.warn(
      `[Zid Webhook] ⚠️  انتهت محاولة التسجيل في أودو بدون نجاح: success=${result.success} skipped=${result.skipped} failed=${result.failed}`
    )
  }
  console.info('[Zid Webhook] ======================================')
}

async function handleCustomerEvent(
  event: string,
  storeId: number,
  data: Record<string, unknown>
) {
  const { data: merchantToken } = await supabase
    .from('merchant_tokens')
    .select('*')
    .eq('store_id', String(storeId))
    .maybeSingle()

  if (!merchantToken) {
    console.warn('[Zid Webhook] Merchant token not found for customer event', { storeId })
    return
  }

  console.info('[Zid Webhook] Customer event — triggering sync engine', { event, storeId, customerId: data.id })
  await processWebhookEvent(event, storeId, data, 'zid')
}

async function handleCategoryEvent(
  event: string,
  storeId: number,
  data: Record<string, unknown>
) {
  console.info('[Zid Webhook] ===== handleCategoryEvent START =====')
  console.info('[Zid Webhook] event:', event, '| storeId:', storeId)
  console.info('[Zid Webhook] data keys:', Object.keys(data))

  // Trigger sync engine directly — it reads field_mappings by store_id internally
  // Sync operation filtering (create/update/delete) is handled by Standard Mapping settings
  // in the sync engine via isEntityOperationAllowed().
  console.info('[Zid Webhook] Calling processWebhookEvent...')
  try {
    const result = await processWebhookEvent(event, storeId, data, 'zid')
    if (result.success > 0) {
      const syncedRecords = result.records
        .filter(record => record.status === 'success')
        .map(record => `${record.model}#${record.odooRecordId}`)
        .join(', ')
      console.info(`[Zid Webhook] ✅ ERP sync completed: ${syncedRecords}`)
    } else if (result.processed === 0) {
      console.warn(`[Zid Webhook] ⚠️  No matching Field Mapping found for event="${event}" store_id=${storeId}`)
    } else {
      console.warn(
        `[Zid Webhook] ⚠️  ERP sync finished without successful operations: success=${result.success} skipped=${result.skipped} failed=${result.failed}`
      )
    }
  } catch (err: any) {
    console.error(`[Zid Webhook] ❌ processWebhookEvent threw for "${event}":`, err?.message ?? String(err))
  }
  console.info('[Zid Webhook] ===== handleCategoryEvent END =====')
}
