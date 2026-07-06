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
    if (p.sku !== undefined || p.sale_price !== undefined || p.product_class !== undefined) {
      // Has product-specific fields → product event
      // Check if it's a create or update based on created_at vs updated_at
      if (p.created_at && p.updated_at) {
        const created = new Date(p.created_at).getTime()
        const updated = new Date(p.updated_at).getTime()
        // If created within last 30 seconds and matches updated → new product
        const isNew = (Date.now() - created) < 30_000
        return isNew ? 'product.created' : 'product.updated'
      }
      return 'product.created' // default to create
    }
    if (p.order_number !== undefined || p.total_price !== undefined) return 'order.created'
    if (p.email !== undefined && p.first_name !== undefined) return 'customer.created'
    return 'unknown'
  }

  function extractStoreId(p: any): number {
    const rawStoreId =
      p.store_id ??
      p.storeId ??
      p.store?.id ??
      p.store?.store_id ??
      p.merchant?.store_id ??
      req.nextUrl.searchParams.get('store_id') ??
      req.nextUrl.searchParams.get('storeId') ??
      headersList.get('x-store-id') ??
      headersList.get('store-id') ??
      headersList.get('store_id') ??
      0

    const parsed = Number(rawStoreId)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const event: string = queryEvent || headerEvent || inferEventFromPayload(payload)

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
          const { data: latestToken } = await supabase
            .from('merchant_tokens')
            .select('store_id')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (latestToken) {
            store_id = Number(latestToken.store_id)
            console.info(`[Zid Webhook] Resolved store_id=${store_id} from latest merchant token database fallback`)
          }
        }
      }
    } catch (err) {
      console.warn('[Zid Webhook] Failed to resolve fallback store_id from merchant_tokens:', err)
    }
  }

  // Zid sends product data at the TOP LEVEL (not nested in a "data" field)
  const data: Record<string, unknown> = payload

  const entityId = payload.id ?? payload.category_id ?? payload.category_uuid ?? payload.customer_id ?? payload.order_id ?? 'undefined'
  console.info(`[Zid Webhook] Event resolved → "${event}" (from: ${queryEvent ? 'query' : headerEvent ? 'header' : 'inference'})`)
  console.info(`[Zid Webhook] store_id=${store_id} | entity_id=${entityId} | sku=${payload.sku ?? 'none'}`)
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

  console.info('[Zid Webhook] Order event received — triggering sync engine', { event, storeId, orderId: data.id })
  await processWebhookEvent(event, storeId, data, 'zid')
}

async function handleProductEvent(
  event: string,
  storeId: number,
  data: Record<string, unknown>
) {
  console.info('[Zid Webhook] ===== handleProductEvent START =====')
  console.info('[Zid Webhook] event:', event, '| storeId:', storeId)
  console.info('[Zid Webhook] data keys:', Object.keys(data))

  // Trigger sync engine directly — it reads field_mappings by store_id internally
  console.info('[Zid Webhook] Calling processWebhookEvent...')
  const result = await processWebhookEvent(event, storeId, data)
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
  console.info('[Zid Webhook] ===== handleProductEvent END =====')
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
  await processWebhookEvent(event, storeId, data)
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
  console.info('[Zid Webhook] Calling processWebhookEvent...')
  const result = await processWebhookEvent(event, storeId, data)
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
  console.info('[Zid Webhook] ===== handleCategoryEvent END =====')
}
