import { readFileSync } from 'fs'
import path from 'path'

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), 'utf8')
const support = read('src', 'lib', 'odoo-support.ts')
const actions = read('src', 'app', 'actions', 'tickets.ts')
const badge = read('src', 'components', 'pending-tickets-badge.tsx')
const messenger = read('src', 'app', '(app)', 'app', 'tickets', 'tickets-client.tsx')
const unreadSse = read('src', 'app', 'api', 'tickets', 'live', 'unread', 'stream', 'route.ts')
const streamClient = read('src', 'lib', 'ticket-unread-live-client.ts')

describe('Odoo support unread notifications and messenger UI', () => {
  it('authorizes each read acknowledgement and verifies the support message server-side', () => {
    expect(support).toContain("const ticket = await ownedTicket(ticketId)")
    expect(support).toContain("['res_id', '=', ticketId]")
    expect(support).toContain("['is_internal', '=', false]")
    expect(support).toContain('isCustomerTicketMessage(validated[0].author_id, ticket.x_partner_id)')
    expect(support).toContain('advanceTicketReadReceipt(ticket.x_customer_read_receipts')
    expect(actions).toContain('markOdooTicketRead(ticketId, supportMessageId)')
  })
  it('stores read receipts on central Odoo tickets only, never in Supabase', () => {
    expect(support).toContain('x_customer_read_receipts: next.value')
    expect(support).toContain('countUnreadTicketMessages(')
    expect(support).not.toContain("from '@/lib/supabase'")
    expect(badge).not.toContain('supabase')
    expect(unreadSse).not.toContain('supabase')
  })
  it('only subscribes to tickets authorized for the logged in user and workspace', () => {
    expect(unreadSse).toContain('await listAuthorizedTicketLiveSources()')
    expect(support).toContain("['x_user_id', '=', userId]")
    expect(support).toContain("['x_workspace_uuid', '=', workspaceId]")
    expect(unreadSse).toContain('subscribeTicketLiveEvent(ticket.id, ticket.x_source_uuid')
  })
  it('shows an accurate count on the menu and shares one SSE stream', () => {
    expect(badge).toContain('result.unreadCount')
    expect(badge).toContain('subscribeTicketUnreadStream(schedule)')
    expect(badge).not.toContain('setInterval')
    expect(streamClient).toContain("'/api/tickets/live/unread/stream'")
    expect(streamClient).toContain('const listeners = new Set<Listener>()')
  })
  it('renders customer and agent bubbles on opposite sides with safe HTML', () => {
    expect(messenger).toContain("isMine ? 'justify-end' : 'justify-start'")
    expect(messenger).toContain("is_customer")
    expect(messenger).toContain('sanitizeOdooHtml(msg.body)')
    expect(messenger).toContain("dir={dir}")
    expect(messenger).toContain('aria-label={tLocal.chatterTitle}')
  })
  it('only acknowledges replies on a visible conversation near the bottom', () => {
    expect(messenger).toContain("document.visibilityState !== 'visible'")
    expect(messenger).toContain('el.scrollHeight - el.scrollTop - el.clientHeight < 90')
    expect(messenger).toContain('markTicketRead(ticketId, lastSupportId)')
    expect(messenger).toContain("window.dispatchEvent(new Event('erp-ticket-read'))")
  })
})
