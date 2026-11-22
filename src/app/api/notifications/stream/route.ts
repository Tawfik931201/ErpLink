import { type NextRequest } from 'next/server'
import { getActiveUserId, getActiveWorkspaceId } from '@/lib/auth'
import { subscribeAppNotifications } from '@/lib/app-notification-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const [userId, workspaceId] = await Promise.all([
    getActiveUserId(),
    getActiveWorkspaceId(),
  ])
  if (!userId || !workspaceId) return new Response('Unauthorized', { status: 401 })

  // Query value is only a consistency check. Authorization comes from session.
  const requestedWorkspace = request.nextUrl.searchParams.get('workspaceId')
  if (requestedWorkspace && requestedWorkspace !== workspaceId) {
    return new Response('Workspace changed; reconnect the notification stream.', { status: 409 })
  }

  const encoder = new TextEncoder()
  let unsubscribe = () => {}
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closed = false

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        unsubscribe()
        request.signal.removeEventListener('abort', close)
        try { controller.close() } catch { /* already closed */ }
      }
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'))
        } catch { close() }
      }

      unsubscribe = subscribeAppNotifications(workspaceId, notification => {
        send('notification', notification)
      })
      send('ready', { workspaceId })
      heartbeat = setInterval(() => {
        if (!closed) {
          try { controller.enqueue(encoder.encode(': keep-alive\n\n')) }
          catch { close() }
        }
      }, 25_000)
      request.signal.addEventListener('abort', close, { once: true })
      if (request.signal.aborted) close()
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat)
      unsubscribe()
      closed = true
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
