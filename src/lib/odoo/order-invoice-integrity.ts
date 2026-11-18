import type { OdooClient } from '@/lib/odoo-client'

const AMOUNT_TOLERANCE = 0.05

/**
 * Odoo's invoice wizard (or a third-party onchange) can sometimes rebuild a
 * draft invoice using a gross product price, although ERP Link already stored
 * the VAT-exclusive price on sale.order.line. Never divide the invoice price
 * a second time: the persisted sale line is the accounting source of truth.
 *
 * Only the Zid VAT-inclusive workflow calls this helper, and only before post.
 * Existing posted invoices are never edited.
 */
export async function reconcileInclusiveDraftInvoice(
  client: OdooClient,
  saleOrderId: number,
  invoiceId: number,
): Promise<void> {
  const [sale] = await client.searchRead<any>(
    'sale.order', [['id', '=', saleOrderId]], ['id', 'amount_total', 'order_line'], 1,
  )
  const [invoice] = await client.searchRead<any>(
    'account.move', [['id', '=', invoiceId], ['move_type', '=', 'out_invoice']],
    ['id', 'state', 'amount_total', 'invoice_line_ids'], 1,
  )
  const expected = Number(sale?.amount_total)
  const actual = Number(invoice?.amount_total)
  const error = (reason: string) => new Error(
    `order_invoice_total_mismatch_requires_review:${saleOrderId}:${expected}:${actual}:${reason}`,
  )
  if (!sale || !invoice || !Number.isFinite(expected) || !Number.isFinite(actual)) {
    throw error('amount_unreadable')
  }
  if (Math.abs(actual - expected) <= AMOUNT_TOLERANCE) return
  if (invoice.state !== 'draft') throw error('invoice_not_draft')

  const orderLineIds: number[] = Array.isArray(sale.order_line) ? sale.order_line : []
  const invoiceLineIds: number[] = Array.isArray(invoice.invoice_line_ids) ? invoice.invoice_line_ids : []
  if (!orderLineIds.length || !invoiceLineIds.length) throw error('missing_lines')

  const version = await client.getMajorVersion()
  const saleTaxField = version >= 18 ? 'tax_ids' : 'tax_id'
  const saleLines = await client.searchRead<any>(
    'sale.order.line', [['id', 'in', orderLineIds], ['display_type', '=', false]],
    ['id', 'price_unit', 'discount', 'product_uom_qty', saleTaxField], orderLineIds.length,
  )
  const invoiceLines = await client.searchRead<any>(
    'account.move.line', [['id', 'in', invoiceLineIds]],
    ['id', 'sale_line_ids', 'price_unit', 'discount', 'quantity', 'tax_ids', 'display_type'],
    invoiceLineIds.length,
  )
  const productInvoiceLines = invoiceLines.filter(line =>
    line.display_type === 'product' || !line.display_type,
  )
  // An invoice with a merged, extra, missing or partially invoiced line needs
  // manual review; guessing its quantities or prices would corrupt accounting.
  if (!saleLines.length || saleLines.length !== productInvoiceLines.length) {
    throw error('line_count_mismatch')
  }
  const saleById = new Map<number, any>(saleLines.map(line => [Number(line.id), line]))
  const seen = new Set<number>()
  const writes: Array<{ id: number; values: Record<string, unknown> }> = []

  for (const invoiceLine of productInvoiceLines) {
    const sourceIds = invoiceLine.sale_line_ids
    if (!Array.isArray(sourceIds) || sourceIds.length !== 1) throw error('sale_line_link_missing')
    const sourceId = Number(sourceIds[0])
    const source = saleById.get(sourceId)
    if (!source || seen.has(sourceId)) throw error('sale_line_link_ambiguous')
    seen.add(sourceId)

    const sourcePrice = Number(source.price_unit)
    const sourceDiscount = Number(source.discount || 0)
    const sourceQty = Number(source.product_uom_qty)
    const sourceTaxes = source[saleTaxField]
    const invoiceTaxes = invoiceLine.tax_ids
    if (![sourcePrice, sourceDiscount, sourceQty, Number(invoiceLine.quantity)].every(Number.isFinite)
      || !Array.isArray(sourceTaxes) || !Array.isArray(invoiceTaxes)
      || Math.abs(sourceQty - Number(invoiceLine.quantity)) > 0.00001) {
      throw error('line_values_unverifiable')
    }
    const expectedTaxes = sourceTaxes.map(Number).sort((a: number, b: number) => a - b)
    const currentTaxes = invoiceTaxes.map(Number).sort((a: number, b: number) => a - b)
    if (![...expectedTaxes, ...currentTaxes].every(Number.isInteger)) {
      throw error('tax_values_unverifiable')
    }

    const values: Record<string, unknown> = {}
    if (Math.abs(sourcePrice - Number(invoiceLine.price_unit)) > 0.00001) {
      values.price_unit = sourcePrice
    }
    if (Math.abs(sourceDiscount - Number(invoiceLine.discount || 0)) > 0.00001) {
      values.discount = sourceDiscount
    }
    if (JSON.stringify(expectedTaxes) !== JSON.stringify(currentTaxes)) {
      values.tax_ids = [[6, 0, expectedTaxes]]
    }
    if (Object.keys(values).length) writes.push({ id: Number(invoiceLine.id), values })
  }

  if (seen.size !== saleById.size) throw error('unmatched_sale_lines')
  if (!writes.length) throw error('invoice_amount_mismatch_without_price_difference')

  for (const write of writes) {
    const updated = await client.write('account.move.line', [write.id], write.values)
    if (!updated) throw error('invoice_line_update_rejected')
  }

  const [reloaded] = await client.searchRead<any>(
    'account.move', [['id', '=', invoiceId]], ['amount_total', 'state'], 1,
  )
  const corrected = Number(reloaded?.amount_total)
  if (reloaded?.state !== 'draft' || !Number.isFinite(corrected)
    || Math.abs(corrected - expected) > AMOUNT_TOLERANCE) {
    throw new Error(
      `order_invoice_total_mismatch_requires_review:${saleOrderId}:${expected}:${corrected}:after_reconciliation`,
    )
  }
}
