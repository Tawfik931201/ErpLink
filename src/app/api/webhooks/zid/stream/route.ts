/**
 * GET /api/webhooks/zid/stream — بث SSE خفيف لمتابعة الويب هوك من المتصفح.
 *
 * يبث الخادم فقط الأحداث المفعّلة (route الأساسي لا يبث المعطّل أصلاً).
 * فلترة اختيارية من العميل لتقليل الحركة:
 *   /api/webhooks/zid/stream?store_id=123&event=product.created
 * يمكن تكرار event= عدة مرات. بدون فلاتر تُبث كل الأحداث المفعّلة.
 */

import { type NextRequest, NextResponse } from 'next/server'

import { webhookEmitter, type WebhookEventPayload } from '@/lib/webhook-emitter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder()
  const filterStore = req.nextUrl.searchParams.get('store_id') ?? req.nextUrl.searchParams.get('storeId')
  const filterEvents = new Set(req.nextUrl.searchParams.getAll('event').filter(Boolean))

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

      // Listen for webhook events (filtered server-side — SSE خفيف)
      const onEvent = (payload: WebhookEventPayload) => {
        try {
          if (filterStore && String(payload.store_id) !== filterStore) return
          if (filterEvents.size > 0 && !filterEvents.has(payload.event)) return
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
