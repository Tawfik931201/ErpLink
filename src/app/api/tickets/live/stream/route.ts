import { type NextRequest } from 'next/server'

import { assertTicketLiveAccess } from '@/lib/odoo-support'
import { subscribeTicketLiveEvent } from '@/lib/ticket-live-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * One SSE connection while a customer has a support conversation open.
 * No polling, Odoo admin API key in the browser, or Supabase Realtime.
 */
export async function GET(request: NextRequest) {
  const rawId = request.nextUrl.searchParams.get('ticketId')
  if (!rawId || !/^[1-9][0-9]{0,14}$/.test(rawId)) {
    return new Response('Invalid ticket ID', { status: 400 })
  }
  const ticketId = Number(rawId)
  if (!Number.isSafeInteger(ticketId)) return new Response('Invalid ticket ID', { status: 400 })

  let sourceId: string
  try {
    sourceId = await assertTicketLiveAccess(ticketId)
  } catch {
    return new Response('Unauthorized or ticket not found', { status: 403 })
  }

  const encoder = new TextEncoder()
  let unsubscribe = () => {}
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let closed = false

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      function close() {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        unsubscribe()
        request.signal.removeEventListener('abort', close)
        try { controller.close() } catch { /* connection already closed */ }
      }
      function send(event: string) {
        if (closed) return
        try { controller.enqueue(encoder.encode('event: ' + event + '\ndata: {}\n\n')) }
        catch { close() }
      }
      unsubscribe = subscribeTicketLiveEvent(ticketId, sourceId, () => send('ticket-updated'))
      send('ready')
      heartbeat = setInterval(() => {
        if (closed) return
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')) }
        catch { close() }
      }, 25_000)
      request.signal.addEventListener('abort', close, { once: true })
      if (request.signal.aborted) close()
    },
    cancel() {
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      unsubscribe()
    },
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  })
}
