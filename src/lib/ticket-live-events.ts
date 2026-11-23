import { timingSafeEqual } from 'node:crypto'

/**
 * Ticket-only in-process realtime invalidation bus. NEVER contains message
 * content or attachments. A channel exists only while an authenticated ticket
 * detail screen is connected to this Node process.
 *
 * Odoo's outbound Studio webhooks have a short timeout: validating against
 * the already-authorized in-memory source UUID avoids a slow Odoo RPC and
 * adds zero database reads per webhook event.
 */
type Listener = () => void
type Channel = { sourceId: string; listeners: Set<Listener> }
type Registry = Map<number, Channel>
const runtime = globalThis as typeof globalThis & { __erpTicketLiveListeners?: Registry }

function registry(): Registry {
  if (!runtime.__erpTicketLiveListeners) runtime.__erpTicketLiveListeners = new Map()
  return runtime.__erpTicketLiveListeners
}

export function publishTicketLiveEvent(ticketId: number): void {
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) return
  for (const notify of registry().get(ticketId)?.listeners ?? []) {
    try { notify() } catch { /* disconnected browser: never break ticket writes */ }
  }
}

export function publishVerifiedTicketWebhook(ticketId: number, providedSourceId: string): boolean {
  const channel = registry().get(ticketId)
  if (!channel || !providedSourceId || !channel.sourceId ||
      providedSourceId.length > 200 || channel.sourceId.length > 200) return false
  const actual = Buffer.from(channel.sourceId)
  const provided = Buffer.from(providedSourceId)
  if (actual.length !== provided.length || !timingSafeEqual(actual, provided)) return false
  publishTicketLiveEvent(ticketId)
  return true
}

export function subscribeTicketLiveEvent(
  ticketId: number, sourceId: string, listener: Listener,
): () => void {
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) throw new Error('Invalid ticket ID')
  if (typeof sourceId !== 'string' || sourceId.length > 200) throw new Error('Invalid ticket source')
  let channel = registry().get(ticketId)
  if (channel && channel.sourceId !== sourceId) throw new Error('Ticket source changed; reconnect')
  if (!channel) {
    channel = { sourceId, listeners: new Set() }
    registry().set(ticketId, channel)
  }
  channel.listeners.add(listener)
  return () => {
    channel?.listeners.delete(listener)
    if (channel?.listeners.size === 0) registry().delete(ticketId)
  }
}
