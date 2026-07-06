/**
 * POST /api/webhooks/salla
 *
 * Receives real-time webhook events from Salla:
 *   - product.created / product.updated / product.deleted
 *   - order.created / order.updated / order.status.updated / order.cancelled
 *   - customer.created / customer.updated
 *
 * Security: Salla includes an HMAC-SHA256 signature in the x-salla-signature header.
 */
import crypto from 'crypto'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

import { supabase } from '@/lib/supabase'
import { webhookEmitter, type WebhookEventPayload } from '@/lib/webhook-emitter'
import { processWebhookEvent } from '@/lib/sync-engine'

function verifySallaSignature(body: string, signature: string, secret: string): boolean {
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
  const signature = headersList.get('x-salla-signature') ?? headersList.get('salla-signature') ?? ''
  const webhookSecret = process.env.SALLA_WEBHOOK_SECRET ?? ''

  // ── Verify signature (skip in development) ────────────────────────────────
  if (process.env.NODE_ENV === 'production' && webhookSecret) {
    if (!verifySallaSignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.warn('[Salla Webhook] Invalid JSON payload received')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = payload.event ?? ''
  const merchantId = String(payload.merchant ?? '')
  const data = payload.data ?? {}

  console.info('[Salla Webhook] ======================================')
  console.info(`[Salla Webhook] Event resolved → "${event}"`)
  console.info(`[Salla Webhook] merchantId=${merchantId} | entityId=${data.id}`)
  console.info('[Salla Webhook] ======================================')

  if (!merchantId) {
    console.warn('[Salla Webhook] ⚠️  merchant ID not found in payload')
    return NextResponse.json({ error: 'Merchant ID not found in payload' }, { status: 400 })
  }

  // ── Get Salla token settings to check if enabled ───────────────────────────
  try {
    const { data: sallaToken, error: tokenErr } = await supabase
      .from('salla_tokens')
      .select('*')
      .eq('merchant_id', merchantId)
      .maybeSingle()

    if (tokenErr || !sallaToken) {
      console.warn('[Salla Webhook] Salla store token not found or DB error', { merchantId, tokenErr })
      return NextResponse.json({ error: 'Salla store not connected' }, { status: 404 })
    }

    const syncSettings = (sallaToken.sync_settings as Record<string, any>) || {}
    const eventSettings = syncSettings[event]
    const isEnabled = eventSettings?.salla2odoo === true

    if (!isEnabled) {
      console.info(`[Salla Webhook] Event "${event}" is disabled in sync settings for merchant "${merchantId}". Skipping sync.`)
      
      // Still broadcast to browser console/SSE so the user can see it arrived but was skipped
      const broadcastPayload: WebhookEventPayload = {
        event: event as any,
        store_id: Number(merchantId) || 0,
        data,
        timestamp: payload.created_at ?? new Date().toISOString(),
        receivedAt: new Date().toISOString(),
      }
      webhookEmitter.emit('zid-event', broadcastPayload)

      return NextResponse.json({ received: true, processed: false, reason: 'disabled_in_settings' })
    }

    // ── Broadcast to SSE-connected browsers ───────────────────────────────────
    const broadcastPayload: WebhookEventPayload = {
      event: event as any,
      store_id: Number(merchantId) || 0,
      data,
      timestamp: payload.created_at ?? new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    }
    webhookEmitter.emit('zid-event', broadcastPayload)

    // ── Process the webhook in SyncEngine ─────────────────────────────────────
    console.info(`[Salla Webhook] ▶ Routing event="${event}" merchantId=${merchantId}`)
    const result = await processWebhookEvent(event, merchantId, data)
    
    if (result.success > 0) {
      const syncedRecords = result.records
        .filter(record => record.status === 'success')
        .map(record => `${record.model}#${record.odooRecordId}`)
        .join(', ')
      console.info(`[Salla Webhook] ✅ ERP sync completed: ${syncedRecords}`)
    } else if (result.processed === 0) {
      console.warn(`[Salla Webhook] ⚠️  No matching Field Mapping found for event="${event}" merchantId=${merchantId}`)
    } else {
      console.warn(
        `[Salla Webhook] ⚠️  ERP sync finished without successful operations: success=${result.success} skipped=${result.skipped} failed=${result.failed}`
      )
    }

    return NextResponse.json({ received: true, processed: true, summary: result })
  } catch (err: any) {
    console.error('[Salla Webhook] handler error', { event, merchantId, err })
    return NextResponse.json({ received: true, processed: false, error: err?.message || String(err) })
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Salla webhook endpoint is ready.',
    events: ['product.created', 'product.updated'],
  })
}
