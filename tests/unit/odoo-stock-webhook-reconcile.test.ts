import fs from 'fs'
import path from 'path'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

describe('Odoo stock webhook reconciliation', () => {
  it('rearms the canonical automation and removes exact-name duplicates', () => {
    const source = read('src/lib/odoo-webhook.ts')
    expect(source).toContain('export async function reconcileOdooStockWebhook')
    expect(source).toContain("['name', '=', exactName]")
    expect(source).toContain("await client.unlink('base.automation', [duplicateId])")
    expect(source).toContain("await client.write('base.automation', [canonicalId], { active: false })")
    expect(source).toContain("await client.write('base.automation', [canonicalId], { active: true })")
  })

  it('normalizes the canonical refs into enabled and legacy per-store rows', () => {
    const source = read('src/app/actions/inventory-sync.ts')
    expect(source).toContain('reconcileStoredWebhook(workspaceId, ownRefs, storeType)')
    expect(source).toContain('reconcileStoredWebhook(workspaceId, otherRefs, storeType)')
    expect(source).toContain('reconcileStoredWebhook(workspaceId, refs, storeType)')
    expect(source).toContain("inv.sync_enabled === true || !!inv.odoo_stock_webhook")
    expect(source).toContain('odoo_stock_webhook: refs')
  })
})
