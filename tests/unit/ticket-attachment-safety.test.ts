import { readFileSync } from 'fs'
import path from 'path'

const route = readFileSync(
  path.join(process.cwd(), 'src/app/api/tickets/attachments/route.ts'), 'utf8',
)
const support = readFileSync(
  path.join(process.cwd(), 'src/lib/odoo-support.ts'), 'utf8',
)

describe('central Odoo Studio attachment security', () => {
  it('never reaches a merchant Odoo or Supabase instance for ticket binaries', () => {
    expect(route).not.toContain("from '@/lib/odoo'")
    expect(route).not.toContain('supabase')
    expect(route).toContain('readOwnedOdooAttachment(id)')
    expect(support).toContain("'ir.attachment', 'read'")
  })
  it('authorizes the ticket owner before reading the attachment binary', () => {
    const start = support.indexOf('export async function readOwnedOdooAttachment')
    const snippet = support.slice(start)
    expect(snippet.indexOf('await ownedTicket(ticketId)')).toBeGreaterThan(-1)
    expect(snippet.indexOf("['raw']")).toBeGreaterThan(
      snippet.indexOf('await ownedTicket(ticketId)'))
  })
  it('never exposes Odoo internal notes and only serves public linked attachments', () => {
    expect(support).toContain("['is_internal', '=', false]")
    expect(support).toContain("['attachment_ids', 'in', [id]]")
    expect(support).toContain("throw new Error('Internal attachment')")
    expect(support).toContain("!msgs[0].is_internal")
  })
  it('checks file size before base64 decoding', () => {
    const start = support.indexOf('export async function readOwnedOdooAttachment')
    const snippet = support.slice(start)
    expect(snippet.indexOf('file.file_size > MAX_FILE_BYTES')).toBeGreaterThan(-1)
    expect(snippet.indexOf('encoded.length >')).toBeLessThan(
      snippet.indexOf("Buffer.from(encoded, 'base64')"))
    expect(snippet).toContain("buffer.length > MAX_FILE_BYTES")
  })
  it('returns downloaded files as attachments with strict browser headers', () => {
    expect(route).toContain('Content-Disposition')
    expect(route).toContain('X-Content-Type-Options')
    expect(route).toContain('private, no-store')
  })
})
