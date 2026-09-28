/**
 * GET /api/webhooks/zid/stream — بث SSE خفيف لمتابعة الويب هوك من المتصفح.
 *
 * يبث الخادم فقط الأحداث المفعّلة (route الأساسي لا يبث المعطّل أصلاً).
 * فلترة اختيارية من العميل لتقليل الحركة:
 *   /api/webhooks/zid/stream?store_id=123&event=product.created
 * يمكن تكرار event= عدة مرات. بدون فلاتر تُبث كل الأحداث المفعّلة.
 *
 * Security: يتطلب توكن صالح في الإنتاج عبر معلمة `?token=SECRET` أو header `Authorization: Bearer SECRET`.
 * في التطوير (NODE_ENV !== 'production') يمكن العمل بدون توكن للتصحيح.
 */

import { type NextRequest, NextResponse } from 'next/server'

import { webhookEmitter, type WebhookEventPayload } from '@/lib/webhook-emitter'

const STREAM_SECRET = process.env.STREAM_SECRET

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  // Auth: require secret in production; optional in dev for debugging
  if (STREAM_SECRET) {
    const authHeader = req.headers.get('authorization') || ''
    const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim()
    const queryToken = req.nextUrl.searchParams.get('token') || ''
    const provided = bearerToken || queryToken
    if (!provided || provided !== STREAM_SECRET) {
      return NextResponse.json({ error: 'Unauthorized: Invalid or missing stream secret' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[Zid SSE Stream] Security Alert: STREAM_SECRET is not configured in production — stream disabled.')
    return NextResponse.json({ error: 'Stream secret not configured on server' }, { status: 503 })
  }

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
