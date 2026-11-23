import { readFileSync } from 'fs'
import path from 'path'

import {
  publishTicketLiveEvent, publishVerifiedTicketWebhook, subscribeTicketLiveEvent,
} from '@/lib/ticket-live-events'

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), 'utf8')
const hook = read('src', 'app', 'api', 'tickets', 'live', 'hook', 'route.ts')
const stream = read('src', 'app', 'api', 'tickets', 'live', 'stream', 'route.ts')
const client = read('src', 'app', '(app)', 'app', 'tickets', 'tickets-client.tsx')
const support = read('src', 'lib', 'odoo-support.ts')

const sourceA = 'app-ticket:be1ee5ed-0634-4664-9c1b-336eb6535eff'
const sourceB = 'app-ticket:acf3a9c9-08b9-455d-b6a2-1f4e3535b419'

describe('ticket-only Odoo realtime streaming', () => {
  it('broadcasts only to an authenticated ticket ID and matching source UUID', () => {
    let alice = 0; let bob = 0
    const cancelA = subscribeTicketLiveEvent(1001, sourceA, () => alice++)
    const cancelB = subscribeTicketLiveEvent(1002, sourceB, () => bob++)
    try {
      expect(publishVerifiedTicketWebhook(1001, sourceB)).toBe(false)
      expect(publishVerifiedTicketWebhook(1001, sourceA)).toBe(true)
      expect([alice, bob]).toEqual([1, 0])
      publishTicketLiveEvent(1002)
      expect([alice, bob]).toEqual([1, 1])
      cancelA()
      expect(publishVerifiedTicketWebhook(1001, sourceA)).toBe(false)
      expect([alice, bob]).toEqual([1, 1])
    } finally { cancelA(); cancelB() }
  })
  it('rejects source changes while a ticket stream is already subscribed', () => {
    const cleanup = subscribeTicketLiveEvent(1003, sourceA, () => {})
    try {
      expect(() => subscribeTicketLiveEvent(1003, sourceB, () => {}))
        .toThrow('Ticket source changed')
    } finally { cleanup() }
  })
  it('authorizes the ticket owner before saving an in-memory token to subscribe', () => {
    expect(stream).toContain('await assertTicketLiveAccess(ticketId)')
    expect(stream).toContain("subscribeTicketLiveEvent(ticketId, sourceId,")
    expect(support).toContain('await ownedTicket(id)')
  })
  it('validates webhook without an Odoo round-trip, secret URL or Supabase', () => {
    expect(hook).toContain('publishVerifiedTicketWebhook(ticketId, sourceId)')
    expect(hook).not.toContain('centralSupportCall')
    expect(hook).not.toContain('supabase')
    expect(hook).toContain('boundedBody(request)')
    const bus = read('src', 'lib', 'ticket-live-events.ts')
    expect(bus).toContain('timingSafeEqual')
  })
  it('fetches message data only through the existing authorized server action', () => {
    expect(client).toContain("new EventSource('/api/tickets/live/stream?ticketId='")
    expect(client).toContain("source.addEventListener('ticket-updated'")
    expect(client).toContain('getTicketMessages(ticketId)')
    expect(stream).not.toContain('supabase')
  })
})
