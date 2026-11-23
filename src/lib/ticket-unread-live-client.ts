/**
 * Share one browser SSE connection across desktop and mobile ticket badges.
 * No polling, Supabase Realtime, or message payloads. Connection closes when
 * the last badge unmounts.
 */
type Listener = () => void
const listeners = new Set<Listener>()
let source: EventSource | null = null
let openedOnce = false

function notify() {
  for (const fn of listeners) {
    try { fn() } catch { /* one bad component must not stop others */ }
  }
}

function open() {
  if (typeof EventSource === 'undefined' || source || listeners.size === 0) return
  source = new EventSource('/api/tickets/live/unread/stream')
  let firstReady = !openedOnce
  openedOnce = true
  source.addEventListener('ready', () => {
    if (!firstReady) notify() // reconnect: reconcile events missed while away
    firstReady = false
  })
  source.addEventListener('ticket-updated', notify)
}

export function subscribeTicketUnreadStream(listener: Listener): () => void {
  listeners.add(listener)
  open()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      source?.close()
      source = null
      openedOnce = false
    }
  }
}

/** Rebuild the watched ticket set when the customer creates a new ticket. */
export function restartTicketUnreadStream() {
  source?.close()
  source = null
  open()
}
