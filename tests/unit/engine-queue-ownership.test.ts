import { readFileSync } from 'fs'
import path from 'path'

it('leaves pending creates to the claimed queue worker instead of invoking and deleting another job', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/lib/sync-engine.ts'), 'utf8')
  const orderUpdate = source.slice(source.indexOf('// ── Out-of-order resolution'), source.indexOf("  if (existingId === null) {", source.indexOf('// ── Out-of-order resolution') + 600))
  expect(orderUpdate).not.toContain(".from('sync_queue')")
  expect(source).not.toContain(".delete().eq('id', matchCreate.id)")
  expect(source).not.toContain('await processWebhookEvent(\n          matchCreate.event')
  expect(source).toContain('auto-create through the effect ledger')
})

it('guards the Odoo-only preset transport before creating its client', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/lib/sync-engine.ts'), 'utf8')
  const preset = source.slice(source.indexOf('async function processFixedMappingFallbackInternal('), source.indexOf('async function skipNoFieldItems('))
  const protectsTransport = (text: string) => {
    const guard = text.indexOf("if (odooConn.erp_type && odooConn.erp_type !== 'odoo') return null")
    return guard >= 0 && guard < text.indexOf('new OdooClient(')
  }
  expect(protectsTransport(preset)).toBe(true)
  expect(protectsTransport(preset.replace("if (odooConn.erp_type && odooConn.erp_type !== 'odoo') return null", ''))).toBe(false)
})
