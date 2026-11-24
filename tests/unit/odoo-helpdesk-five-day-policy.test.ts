import { readFileSync } from 'fs'
import path from 'path'

const read = (...parts: string[]) =>
  readFileSync(path.join(process.cwd(), ...parts), 'utf8')

const ticketsUI = read('src', 'app', '(app)', 'app', 'tickets', 'tickets-client.tsx')
const customerActivity = read('odoo', 'helpdesk', 'automation', 'customer_message_activity.py')
const agentClock = read('odoo', 'helpdesk', 'automation', 'track_agent_reply.py')
const autoClose = read('odoo', 'helpdesk', 'automation', 'autoclose_five_days.py')

describe('ERP Link Helpdesk Odoo five-day support lifecycle policy', () => {
  it('discloses the five-full-day unanswered support policy in Arabic and English', () => {
    expect(ticketsUI).toContain('خلال 5 أيام كاملة من آخر رسالة للدعم')
    expect(ticketsUI).toContain('five full days of the last support message')
    expect(ticketsUI).toContain('tLocal.autoClosePolicy')
    expect((ticketsUI.match(/\{tLocal\.autoClosePolicy\}/g) || []).length).toBe(3)
  })

  it('verifies the customer before creating a deduplicated Odoo activity on the ticket', () => {
    expect(customerActivity).toContain("msg.author_id.id == record.x_partner_id.id")
    expect(customerActivity).toContain("env['mail.activity'].sudo().search")
    expect(customerActivity).toContain("env['mail.activity'].sudo().create")
    expect(customerActivity).toContain("'res_model_id': 2433")
    expect(customerActivity).toContain("'res_id': record.id")
    expect(customerActivity).toContain('msg.id, record.id')
    expect(customerActivity).not.toContain('send_mail(')
  })

  it('tracks only internal agent responses from real public Odoo Chatter messages', () => {
    expect(agentClock).toContain("('message_type', '=', 'comment')")
    expect(agentClock).toContain("('is_internal', '=', False)")
    expect(agentClock).toContain("('share', '=', False)")
    expect(agentClock).toContain('msg.author_id.id in internal_partners')
    expect(agentClock).toContain("'x_last_agent_reply': msg.date")
  })

  it('requires 120 hours, no newer customer response, and last message from Odoo staff', () => {
    expect(autoClose).toContain('datetime.timedelta(days=5)')
    expect(autoClose).toContain("('x_last_agent_reply', '!=', False)")
    expect(autoClose).toContain("('x_last_agent_reply', '<=', cutoff)")
    expect(autoClose).toContain("('x_ticket_stage', 'in', ['open', 'in_progress', 'waiting_customer'])")
    expect(autoClose).toContain('customer_date >= agent_date')
    expect(autoClose).toContain("('message_type', '=', 'comment')")
    expect(autoClose).toContain("('is_internal', '=', False)")
    expect(autoClose).toContain('latest.author_id.id not in staff_partner_ids')
    expect(autoClose).toContain('latest.date > cutoff')
    expect(autoClose).toContain("'x_ticket_stage': 'closed'")
    expect(autoClose).toContain("'x_status': 'closed'")
  })

  it('does not require Supabase or Hostinger cron, preserving ticket storage in Odoo', () => {
    expect(autoClose).not.toContain('supabase')
    expect(autoClose).not.toContain('fetch(')
    expect(autoClose).not.toContain('requests.')
    expect(customerActivity).not.toContain('supabase')
  })
})
