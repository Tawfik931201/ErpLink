import { type NextRequest } from 'next/server'

import { listAuthorizedTicketLiveSources } from '@/lib/odoo-support'
import { subscribeTicketLiveEvent } from '@/lib/ticket-live-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * One lightweight notification stream for the ticket navigation badge.
 * It subscribes only to the signed-in user's Odoo tickets, never all tenants.
 * Webhooks carry invalidations, not message bodies or attachments.
 */
export async function GET(request: NextRequest) {
  let tickets: Awaited<ReturnType<typeof listAuthorizedTicketLiveSources>>
  try {
    tickets = await listAuthorizedTicketLiveSources()
  } catch {
    return new Response('Unauthorized', { status: 403 })
  }

  const encoder = new TextEncoder()
  const unsubs: Array<() => void> = []
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closed = false

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        for (const unsub of unsubs.splice(0)) unsub()
        request.signal.removeEventListener('abort', close)
        try { controller.close() } catch { /* disconnected client */ }
      }
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'))
        } catch { close() }
      }
      try {
        for (const ticket of tickets) {
          unsubs.push(subscribeTicketLiveEvent(ticket.id, ticket.x_source_uuid, () => {
            send('ticket-updated', { ticketId: ticket.id })
          }))
        }
      } catch {
        close()
        return
      }
      send('ready', {})
      heartbeat = setInterval(() => {
        if (!closed) {
          try { controller.enqueue(encoder.encode(': heartbeat\n\n')) }
          catch { close() }
        }
      }, 25_000)
      request.signal.addEventListener('abort', close, { once: true })
      if (request.signal.aborted) close()
    },
    cancel() {
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      for (const unsub of unsubs.splice(0)) unsub()
    },
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
