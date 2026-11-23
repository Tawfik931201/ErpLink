/**
 * Support-ticket-only notification bus. Carries invalidation signals, never
 * chat text or attachments; the browser re-reads Odoo after authorization.
 * The registry is per Node process (no Supabase, Redis or database polling).
 */
type Listener = () => void
type Registry = Map<number, Set<Listener>>
const runtime = globalThis as typeof globalThis & { __erpTicketLiveListeners?: Registry }

function registry(): Registry {
  if (!runtime.__erpTicketLiveListeners) runtime.__erpTicketLiveListeners = new Map()
  return runtime.__erpTicketLiveListeners
}

export function publishTicketLiveEvent(ticketId: number) {
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) return
  for (const notify of registry().get(ticketId) ?? []) {
    try { notify() } catch { /* A disconnected listener must not break Odoo writes. */ }
  }
}

export function subscribeTicketLiveEvent(ticketId: number, listener: Listener): () => void {
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) throw new Error('Invalid ticket ID')
  let set = registry().get(ticketId)
  if (!set) { set = new Set(); registry().set(ticketId, set) }
  set.add(listener)
  return () => {
    set?.delete(listener)
    if (set?.size === 0) registry().delete(ticketId)
  }
}
