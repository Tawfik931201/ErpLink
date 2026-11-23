/**
 * Per-user support-ticket read markers, stored exclusively on Odoo Studio
 * support tickets (x_customer_read_receipts). No Supabase, no localStorage.
 */
export type TicketReadRecord = {
  id: number
  x_partner_id: [number, string] | false
  x_customer_read_receipts: string | false
}
export type TicketMessageReadRecord = {
  id: number
  res_id: number
  author_id: [number, string] | false
}

export function parseTicketReadReceipts(raw: string | false | null): Record<string, number> {
  if (!raw || typeof raw !== 'string' || raw.length > 64_000) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const result: Record<string, number> = Object.create(null)
    for (const [key, id] of Object.entries(value)) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(key)) continue
      if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) result[key] = id
    }
    return result
  } catch { return {} }
}

/** Monotonic per-user cursor; existing users' read progress is preserved. */
export function advanceTicketReadReceipt(raw: string | false, userId: string, messageId: number) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(userId) || !Number.isSafeInteger(messageId) || messageId <= 0) {
    throw new Error('Invalid support read receipt')
  }
  const receipts = parseTicketReadReceipts(raw)
  if ((receipts[userId] || 0) >= messageId) return { changed: false, value: raw || '{}' }
  receipts[userId] = messageId
  // Bound Odoo field size; preserve the current user's cursor.
  const keys = Object.keys(receipts).filter(key => key !== userId)
  for (const key of keys.slice(0, Math.max(0, keys.length - 149))) delete receipts[key]
  return { changed: true, value: JSON.stringify(receipts) }
}

export function isCustomerTicketMessage(
  author: [number, string] | false,
  partner: [number, string] | false,
): boolean {
  return Array.isArray(partner) && Array.isArray(author) && author[0] === partner[0]
}

/** Count actual unread *support messages* for one customer, never their own replies. */
export function countUnreadTicketMessages(
  tickets: TicketReadRecord[],
  messages: TicketMessageReadRecord[],
  userId: string,
): { total: number; byTicket: Record<number, number> } {
  const ticketLookup = new Map<number, { partner: TicketReadRecord['x_partner_id']; readId: number }>()
  const byTicket: Record<number, number> = {}
  for (const ticket of tickets) {
    ticketLookup.set(ticket.id, {
      partner: ticket.x_partner_id,
      readId: parseTicketReadReceipts(ticket.x_customer_read_receipts)[userId] || 0,
    })
    byTicket[ticket.id] = 0
  }
  let total = 0
  for (const msg of messages) {
    const ticket = ticketLookup.get(msg.res_id)
    if (!ticket || msg.id <= ticket.readId || isCustomerTicketMessage(msg.author_id, ticket.partner)) continue
    byTicket[msg.res_id] += 1
    total += 1
  }
  return { total, byTicket }
}
