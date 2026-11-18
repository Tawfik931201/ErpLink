import type { OdooClient } from '@/lib/odoo-client'
import { reconcileInclusiveDraftInvoice } from '@/lib/odoo/order-invoice-integrity'

function makeClient(options: {
  version?: number
  invoicePrice?: number
  invoiceState?: string
  sourcePrice?: number
  sourceQuantity?: number
  invoiceQuantity?: number
  saleLineLinks?: number[]
  invoiceTaxIds?: number[]
  initialInvoiceAmount?: number
} = {}) {
  const sourcePrice = options.sourcePrice ?? 100
  const invoiceState = options.invoiceState ?? 'draft'
  const sourceQuantity = options.sourceQuantity ?? 1
  const invoiceQuantity = options.invoiceQuantity ?? 1
  let price = options.invoicePrice ?? 115
  let taxIds = options.invoiceTaxIds ?? [5]
  const invoiceTotal = () => options.initialInvoiceAmount ?? Math.round(price * invoiceQuantity * (taxIds.includes(5) ? 1.15 : 1) * 100) / 100
  const client = {
    getMajorVersion: jest.fn().mockResolvedValue(options.version ?? 20),
    searchRead: jest.fn(async (model: string) => {
      if (model === 'sale.order') return [{
        id: 55, order_line: [70], amount_total: 115,
      }]
      if (model === 'account.move') return [{
        id: 99, move_type: 'out_invoice', state: invoiceState, amount_total: invoiceTotal(), invoice_line_ids: [80],
      }]
      if (model === 'sale.order.line') return [{
        id: 70, price_unit: sourcePrice, discount: 0,
        product_uom_qty: sourceQuantity, tax_ids: [5], tax_id: [5],
      }]
      if (model === 'account.move.line') return [{
        id: 80, display_type: 'product', sale_line_ids: options.saleLineLinks ?? [70],
        price_unit: price, discount: 0, quantity: invoiceQuantity, tax_ids: taxIds,
      }]
      throw new Error(`Unexpected read: ${model}`)
    }),
    write: jest.fn(async (model: string, ids: number[], values: Record<string, unknown>) => {
      if (model !== 'account.move.line' || ids[0] !== 80) throw new Error('unexpected invoice update')
      if (typeof values.price_unit === 'number') price = values.price_unit
      if (Array.isArray(values.tax_ids)) taxIds = (values.tax_ids as any)[0][2]
      return true
    }),
  } as unknown as OdooClient
  return { client, price: () => price, taxes: () => taxIds }
}

describe('Zid VAT-inclusive invoice total reconciliation', () => {
  it.each([14, 15, 16, 17, 18, 19, 20])(
    'keeps correct Odoo %s draft invoices unchanged (115 gross = 100 exclusive + 15 VAT)',
    async version => {
      const { client } = makeClient({ version, invoicePrice: 100 })
      await expect(reconcileInclusiveDraftInvoice(client, 55, 99)).resolves.toBeUndefined()
      expect(client.write).not.toHaveBeenCalled()
    },
  )

  it.each([14, 16, 18, 20])(
    'repairs a grossed-up Odoo %s draft using the existing tax-exclusive SO unit price',
    async version => {
      const { client, price } = makeClient({ version, invoicePrice: 115 })
      await expect(reconcileInclusiveDraftInvoice(client, 55, 99)).resolves.toBeUndefined()
      expect(price()).toBe(100)
      expect(client.write).toHaveBeenCalledTimes(1)
      expect(client.write).toHaveBeenCalledWith('account.move.line', [80], { price_unit: 100 })
    },
  )

  it('does not alter posted invoices even if the invoice is grossed up', async () => {
    const { client } = makeClient({ invoiceState: 'posted', invoicePrice: 115 })
    await expect(reconcileInclusiveDraftInvoice(client, 55, 99)).rejects.toThrow('invoice_not_draft')
    expect(client.write).not.toHaveBeenCalled()
  })

  it('rejects missing or ambiguous invoice-line links, without guessing product mapping', async () => {
    const { client } = makeClient({ saleLineLinks: [] })
    await expect(reconcileInclusiveDraftInvoice(client, 55, 99)).rejects.toThrow('sale_line_link_missing')
    expect(client.write).not.toHaveBeenCalled()
  })

  it('does not silently change partial-invoice quantities', async () => {
    const { client } = makeClient({ invoiceQuantity: 0.5 })
    await expect(reconcileInclusiveDraftInvoice(client, 55, 99)).rejects.toThrow('line_values_unverifiable')
    expect(client.write).not.toHaveBeenCalled()
  })

  it('does not duplicate VAT, and inherits the explicit SO VAT IDs when needed', async () => {
    const { client, taxes, price } = makeClient({ invoicePrice: 132.25, invoiceTaxIds: [] })
    await expect(reconcileInclusiveDraftInvoice(client, 55, 99)).resolves.toBeUndefined()
    expect(price()).toBe(100)
    expect(taxes()).toEqual([5])
    expect(client.write).toHaveBeenCalledWith('account.move.line', [80], {
      price_unit: 100,
      tax_ids: [[6, 0, [5]]],
    })
  })

  it('refuses to claim a fix when Odoo still reports a different final amount', async () => {
    const { client } = makeClient({ invoicePrice: 115, initialInvoiceAmount: 132.25 })
    await expect(reconcileInclusiveDraftInvoice(client, 55, 99)).rejects.toThrow('after_reconciliation')
  })
})
