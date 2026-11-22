import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/tickets/attachments/route.ts'), 'utf8'
)

describe('Odoo helpdesk attachment security and compatibility', () => {
  it('reads metadata without including removed Odoo 20 binary fields', () => {
    expect(source).toContain("fields: ['name', 'mimetype', 'res_model', 'res_id', 'file_size']")
    expect(source).not.toContain("fields: ['name', 'raw', 'datas'")
  })

  it('validates ticket ownership before fetching binary content', () => {
    const owner = source.indexOf("if (!isOwner)")
    const binary = source.indexOf("fields: ['raw']")
    expect(owner).toBeGreaterThan(-1)
    expect(binary).toBeGreaterThan(owner)
    expect(source).toContain("['partner_email', '=', userEmail]")
  })

  it('rejects oversized file_size metadata before fetching from Odoo', () => {
    const cap = source.indexOf('declaredSize > MAX_ATTACHMENT_BYTES')
    const binary = source.indexOf("fields: ['raw']")
    expect(cap).toBeGreaterThan(-1)
    expect(cap).toBeLessThan(binary)
  })

  it('retries the legacy datas field only when raw is not in the model', () => {
    expect(source).toContain("fields: ['raw']")
    expect(source).toContain("fields: ['datas']")
    expect(source).toContain('if (!/invalid field')
    expect(source).toContain('throw error')
  })

  it('rejects oversized encoded payloads before Buffer.from allocates a decoded copy', () => {
    const lenGuard = source.indexOf('base64Data.length > MAX_BASE64_CHARS')
    const decoding = source.indexOf("Buffer.from(base64Data, 'base64')")
    expect(lenGuard).toBeGreaterThan(-1)
    expect(decoding).toBeGreaterThan(lenGuard)
    expect(source).toContain("Content-Disposition")
    expect(source).toContain("X-Content-Type-Options")
  })
})
