/**
 * GET /api/webhooks/zid/stream
 *
 * Server-Sent Events (SSE) endpoint.
 * The browser connects here and keeps the connection open.
 * Whenever the webhook handler receives a Zid event, it emits it through
 * the shared webhookEmitter — which this handler forwards to the client.
 */

import { type NextRequest, NextResponse } from 'next/server'

import { webhookEmitter, type WebhookEventPayload } from '@/lib/webhook-emitter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection confirmation
      const connectMsg = `data: ${JSON.stringify({ type: 'connected', message: 'SSE connected — listening for Zid webhooks' })}\n\n`
      controller.enqueue(encoder.encode(connectMsg))

      // Keep-alive ping every 20s so the connection doesn't time out
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          clearInterval(pingInterval)
        }
      }, 20_000)

      // Listen for Zid webhook events
      const onEvent = (payload: WebhookEventPayload) => {
        try {
          const msg = `data: ${JSON.stringify(payload)}\n\n`
          controller.enqueue(encoder.encode(msg))
        } catch {
          // Client disconnected — clean up
          webhookEmitter.off('zid-event', onEvent)
          clearInterval(pingInterval)
        }
      }

      webhookEmitter.on('zid-event', onEvent)

      // Clean up when the client closes the connection
      req.signal.addEventListener('abort', () => {
        webhookEmitter.off('zid-event', onEvent)
        clearInterval(pingInterval)
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable Nginx buffering if behind a proxy
    },
  })
}
