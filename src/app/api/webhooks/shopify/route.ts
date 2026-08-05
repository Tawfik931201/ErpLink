import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

import { supabase } from '@/lib/supabase'
import { webhookEmitter, type WebhookEventPayload } from '@/lib/webhook-emitter'
import { processWebhookEvent } from '@/lib/sync-engine'
import { verifyShopifySignature } from '@/lib/shopify-client'
import { startSyncQueueRunner } from '@/lib/sync-queue-runner'

export async function POST(req: NextRequest) {
  startSyncQueueRunner()
  const rawBody = await req.text()
  const headersList = headers()
  
  const signature = headersList.get('x-shopify-hmac-sha256') ?? ''
  const shopDomain = headersList.get('x-shopify-shop-domain') ?? ''
  const topic = headersList.get('x-shopify-topic') ?? '' // e.g. products/create, orders/create
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET ?? ''

  console.info('[Shopify Webhook] ======================================')
  console.info(`[Shopify Webhook] Topic resolved → "${topic}"`)
  console.info(`[Shopify Webhook] shopDomain=${shopDomain}`)
  console.info('[Shopify Webhook] ======================================')

  // ── Verify signature (skip in development if no secret is set) ────────────────
  if (process.env.NODE_ENV === 'production' && webhookSecret) {
    if (!signature || !verifyShopifySignature(rawBody, signature, webhookSecret)) {
      console.warn('[Shopify Webhook] Signature verification failed')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  if (!shopDomain) {
    console.warn('[Shopify Webhook] Missing shop domain header')
    return NextResponse.json({ error: 'Missing shop domain header' }, { status: 400 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.warn('[Shopify Webhook] Invalid JSON payload received')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    // ── Get Shopify token to check sync settings ─────────────────────────────
    const { data: shopifyToken, error: tokenErr } = await supabase
      .from('shopify_tokens')
      .select('*')
      .eq('shop_domain', shopDomain)
      .maybeSingle()

    if (tokenErr || !shopifyToken) {
      console.warn('[Shopify Webhook] Shopify store token not found or DB error', { shopDomain, tokenErr })
      return NextResponse.json({ error: 'Shopify store not connected' }, { status: 404 })
    }

    const syncSettings = (shopifyToken.sync_settings as Record<string, any>) || {}
    const eventSettings = syncSettings[topic]
    const isEnabled = eventSettings?.shopify2odoo === true

    if (!isEnabled) {
      console.info(`[Shopify Webhook] Event "${topic}" is disabled in sync settings for shop "${shopDomain}". Skipping sync.`)
      
      // Broadcast to browser SSE console
      const broadcastPayload: WebhookEventPayload = {
        event: topic as any,
        store_id: shopDomain,
        data: payload,
        timestamp: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
      }
      webhookEmitter.emit('zid-event', broadcastPayload)

      return NextResponse.json({ received: true, processed: false, reason: 'disabled_in_settings' })
    }

    // ── Broadcast to SSE-connected browsers ───────────────────────────────────
    const broadcastPayload: WebhookEventPayload = {
      event: topic as any,
      store_id: shopDomain,
      data: payload,
      timestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    }
    webhookEmitter.emit('zid-event', broadcastPayload)

    // ── Enqueue webhook in sync queue ─────────────────────────────────────────
    console.info(`[Shopify Webhook] ▶ Enqueuing event="${topic}" shopDomain=${shopDomain} to sync queue`)
    const { enqueueWebhookEvent } = await import('@/lib/sync-queue')
    await enqueueWebhookEvent({
      workspaceId: shopifyToken.workspace_id,
      storeId: shopDomain,
      event: topic,
      platform: 'shopify',
      payload: payload,
    })

    return NextResponse.json({ received: true, queued: true })
  } catch (err: any) {
    console.error('[Shopify Webhook] Handler error', { topic, shopDomain, err })
    return NextResponse.json({ received: true, processed: false, error: err?.message || String(err) })
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Shopify webhook endpoint is ready.',
  })
}
