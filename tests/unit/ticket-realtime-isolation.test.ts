import { readFileSync } from 'fs'
import path from 'path'

import { publishTicketLiveEvent, subscribeTicketLiveEvent } from '@/lib/ticket-live-events'

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), 'utf8')
const hook = read('src', 'app', 'api', 'tickets', 'live', 'hook', 'route.ts')
const stream = read('src', 'app', 'api', 'tickets', 'live', 'stream', 'route.ts')
const client = read('src', 'app', '(app)', 'app', 'tickets', 'tickets-client.tsx')
const support = read('src', 'lib', 'odoo-support.ts')

describe('ticket-only Odoo realtime streaming', () => {
  it('notifies only listeners for a matching ticket, with no message contents', () => {
    let alice = 0; let bob = 0
    const cancelA = subscribeTicketLiveEvent(1001, () => alice++)
    const cancelB = subscribeTicketLiveEvent(1002, () => bob++)
    try {
      publishTicketLiveEvent(1001)
      expect([alice, bob]).toEqual([1, 0])
      cancelA()
      publishTicketLiveEvent(1001)
      publishTicketLiveEvent(1002)
      expect([alice, bob]).toEqual([1, 1])
    } finally { cancelA(); cancelB() }
  })
  it('authorizes each SSE subscriber by ticket ownership', () => {
    expect(stream).toContain('await assertTicketLiveAccess(ticketId)')
    expect(support).toContain('await ownedTicket(ticketId)')
  })
  it('authenticates webhook by Odoo-held private per-ticket source UUID', () => {
    expect(hook).toContain('timingSafeEqual')
    expect(hook).toContain("fields: ['x_source_uuid']")
    expect(hook).toContain('sameSourceId(sourceId, rows[0]?.x_source_uuid')
    expect(hook.indexOf('sameSourceId(sourceId, rows[0]?.x_source_uuid')).toBeLessThan(hook.indexOf('publishTicketLiveEvent(ticketId)'))
    expect(hook).not.toContain('supabase')
  })
  it('loads messages through the existing authorized server action, not raw payloads', () => {
    expect(client).toContain("new EventSource('/api/tickets/live/stream?ticketId='")
    expect(client).toContain("source.addEventListener('ticket-updated'")
    expect(client).toContain('getTicketMessages(ticketId)')
    expect(stream).not.toContain('supabase')
  })
})
