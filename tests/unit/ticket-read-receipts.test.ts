import {
  advanceTicketReadReceipt, countUnreadTicketMessages, isCustomerTicketMessage,
  parseTicketReadReceipts,
} from '@/lib/ticket-read-receipts'

describe('Odoo-only ticket read receipts', () => {
  it('stores separate monotonic progress for multiple users', () => {
    const first = advanceTicketReadReceipt(false, 'user_A', 302)
    expect(first.changed).toBe(true)
    const second = advanceTicketReadReceipt(first.value, 'user_B', 314)
    expect(parseTicketReadReceipts(second.value)).toEqual({ user_A: 302, user_B: 314 })
    expect(advanceTicketReadReceipt(second.value, 'user_A', 300).changed).toBe(false)
    expect(advanceTicketReadReceipt(second.value, 'user_A', 320).changed).toBe(true)
  })
  it('rejects malformed or oversized receipts safely', () => {
    expect(parseTicketReadReceipts('not JSON')).toEqual({})
    expect(parseTicketReadReceipts('[]')).toEqual({})
    expect(parseTicketReadReceipts('{"bad":-5,"user_1":12,"fake":1.3}')).toEqual({ user_1: 12 })
    expect(() => advanceTicketReadReceipt(false, 'user_1', 0)).toThrow()
    expect(() => advanceTicketReadReceipt(false, '__proto__', 3)).not.toThrow()
  })
  it('counts only support replies after the reader cursor and separates tickets', () => {
    const tickets = [
      { id: 9, x_partner_id: [9, 'Customer'] as [number, string], x_customer_read_receipts: '{"user_A":302}' },
      { id: 8, x_partner_id: [9, 'Customer'] as [number, string], x_customer_read_receipts: false as const },
    ]
    const messages = [
      { id: 301, res_id: 9, author_id: [9, 'Customer'] as [number, string] },
      { id: 302, res_id: 9, author_id: [3, 'Agent'] as [number, string] },
      { id: 303, res_id: 9, author_id: [3, 'Agent'] as [number, string] },
      { id: 304, res_id: 9, author_id: [9, 'Customer'] as [number, string] },
      { id: 313, res_id: 9, author_id: [3, 'Agent'] as [number, string] },
      { id: 297, res_id: 8, author_id: [9, 'Customer'] as [number, string] },
      { id: 901, res_id: 456, author_id: [3, 'Other workspace'] as [number, string] },
    ]
    expect(countUnreadTicketMessages(tickets, messages, 'user_A')).toEqual({
      total: 2, byTicket: { 8: 0, 9: 2 },
    })
    expect(countUnreadTicketMessages(tickets, messages, 'user_B')).toEqual({
      total: 3, byTicket: { 8: 0, 9: 3 },
    })
    expect(isCustomerTicketMessage([9, 'Customer'], [9, 'Customer'])).toBe(true)
  })
})
