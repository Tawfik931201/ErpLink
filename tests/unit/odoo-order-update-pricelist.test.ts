import fs from 'fs'
import path from 'path'

describe('Odoo sale.order update multi-currency and partner safety', () => {
  it('pins that prepareSaleOrderForUpdate prunes partner_id to prevent Odoo resetting pricelist to partner default', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/lib/sync-engine.ts'), 'utf8')
    expect(src).toContain('delete effectiveOdooValues.partner_id')
    expect(src).toContain('async function prepareSaleOrderForUpdate(')
  })

  it('pins that prepareSaleOrderForUpdate preserves pricelist_id on draft quotations and deletes it on confirmed orders', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/lib/sync-engine.ts'), 'utf8')
    expect(src).toContain("const isConfirmed = state && state !== 'draft' && state !== 'sent'")
    expect(src).toContain('delete effectiveOdooValues.pricelist_id')
    expect(src).toContain('delete effectiveOdooValues.currency_id')
    expect(src).toContain('effectiveOdooValues.pricelist_id = existingPricelistId')
  })

  it('pins that createDraftInvoiceForOrder clears default taxes if line has zero taxes', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/lib/sync-engine.ts'), 'utf8')
    expect(src).toContain('lineVals.tax_ids = [[5, 0, 0]]')
  })
})
