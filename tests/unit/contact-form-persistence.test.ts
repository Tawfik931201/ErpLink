import { readFileSync } from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '../..')
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8')

const action = read('src', 'app', 'actions', 'contact.ts')
const store = read('src', 'lib', 'contact-messages.ts')
const adminActions = read('src', 'app', 'actions', 'contact-messages.ts')
const support = read('src', 'lib', 'odoo-support.ts')
const ticketActions = read('src', 'app', 'actions', 'tickets.ts')

describe('all support and public-contact persistence is central Odoo Studio', () => {
  it('persists the contact inbox before creating an Odoo ticket', () => {
    expect(action.indexOf('await insertContactMessage(')).toBeGreaterThan(-1)
    expect(action.indexOf('await createPublicContactTicket(')).toBeGreaterThan(
      action.indexOf('await insertContactMessage('))
  })
  it('never imports Supabase or application SMTP into public contact or support modules', () => {
    for (const file of [action, store, support, ticketActions]) {
      expect(file).not.toMatch(/from ['"]@\/lib\/supabase['"]/)
      expect(file).not.toContain("from '@/lib/supabase-support'")
    }
    expect(action).not.toContain('await sendEmail(')
    expect(store).toContain("upsertArchive('contact'")
    expect(support).toContain("const TICKET = 'x_erplink_support_ticket'")
  })
  it('creates public contact tickets with contact partner details and private scope', () => {
    expect(support).toContain('createPublicContactTicket(')
    expect(support).toContain('x_partner_id: partnerId')
    expect(support).toContain("x_channel: 'contact'")
    expect(support).toContain("x_source_uuid: 'public-contact:'")
  })
  it('rate limits public contact before the first Odoo write', () => {
    expect(action.indexOf('checkRateLimit(')).toBeLessThan(action.indexOf('await insertContactMessage('))
  })
  it('never returns a false successful ticket creation', () => {
    expect(action).toContain("if (!saved.ok) return { success: false")
    expect(action).toContain('catch (error)')
  })
})

describe('admin contact messages actions retain per-request authorization', () => {
  it('checks admin on every exported action', () => {
    const exported = adminActions.match(/export async function /g) ?? []
    const guarded = adminActions.match(/await requireAdmin\(\)/g) ?? []
    expect(guarded.length).toBe(exported.length)
  })
  it('whitelists statuses', () => {
    expect(adminActions).toContain("['new', 'read', 'archived']")
    expect(adminActions).toContain('STATUSES.includes(status)')
  })
  it('keeps public messages unscoped, but support tickets scoped to their owner', () => {
    expect(store).not.toContain('workspace_id')
    expect(support).toContain("['x_user_id', '=', userId]")
    expect(support).toContain("['x_workspace_uuid', '=', workspaceId]")
  })
  it('admin inbox pages remain bounded', () => {
    const central = read('src', 'lib', 'central-contact-inbox.ts')
    expect(central).toContain('Math.min(Math.max(params.limit ?? 50, 1), 200)')
  })
})
