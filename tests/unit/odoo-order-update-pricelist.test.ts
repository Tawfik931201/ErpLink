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

  it('pins that normalizeOrderLinesForUpdate preserves existing line taxes and checks zero-tax orders', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/lib/sync-engine.ts'), 'utf8')
    expect(src).toContain("Preserve existing line taxes so replacement lines don't revert to default domestic VAT")
    expect(src).toContain('majorVersion >= 18 ? \'tax_ids\' : \'tax_id\'')
    expect(src).toContain('line.tax_ids = [[6, 0, existingTaxes]]')
    expect(src).toContain('line.tax_ids = [[6, 0, []]]')
  })

  it('pins that pure status-change events and updates do not rebuild or replace order lines on update', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/lib/sync-engine.ts'), 'utf8')
    expect(src).toContain("const isStatusUpdateEvent = event === 'order.status.update' || event.endsWith('.status.update') || event === 'order.status_update'")
    expect(src).toContain('delete effectiveOdooValues.tax_ids')
    expect(src).toContain('delete effectiveOdooValues.order_line')
    expect(src).toContain('delete effectiveOdooValues.partner_invoice_id')
    expect(src).toContain('delete effectiveOdooValues.partner_shipping_id')
    expect(src).toContain('delete effectiveOdooValues.fiscal_position_id')
  })

  it('pins that account.payment uses memo for Odoo 17+ and ref for Odoo <= 16', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/lib/odoo/order-payment.ts'), 'utf8')
    expect(src).toContain("const refField = major >= 17 ? 'memo' : 'ref'")
    expect(src).toContain('paymentValues.memo = params.ref')
  })
})
