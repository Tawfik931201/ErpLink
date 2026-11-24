import fs from 'fs'
import path from 'path'

import { assertZidCodFeeBeforeInvoice } from '@/lib/odoo/order-workflow'

const order: Record<string, unknown> = {
  id: 70953730,
  order_total: '20020.00000000000000',
  payment: {
    method: { code: 'zid_cod', name: 'Cash on Delivery' },
    invoice: [
      { code: 'sub_totals', value: '20000.00000000000000' },
      { code: 'shipping', value: '15.00000000000000' },
      { code: 'zid_cod', value: '5.00000000000000' },
      { code: 'total', value: '20020.00000000000000' },
    ],
  },
}
const settings = {
  order: { add_cod_as_line: true, cod_product_id: 216 },
}

function fakeClient(lines: Array<Record<string, unknown>>) {
  return {
    searchRead: jest.fn(async () => lines),
    create: jest.fn(),
    execute: jest.fn(),
    write: jest.fn(),
  } as any
}

describe('Zid COD fee gate before invoice creation/posting', () => {
  it('blocks live historical SO73 missing the 5 SAR COD charge before any Odoo financial write', async () => {
    const client = fakeClient([
      { id: 110, product_id: [213, 'Sony A7S III'], price_total: 20000 },
      { id: 111, product_id: [210, 'Shipping'], price_total: 15 },
    ])
    await expect(assertZidCodFeeBeforeInvoice(client, 73, order, settings))
      .rejects.toThrow('order_cod_fee_missing_on_sale_order_requires_review:73:5')
    expect(client.searchRead).toHaveBeenCalledWith(
      'sale.order.line',
      [['order_id', '=', 73], ['display_type', '=', false]],
      ['id', 'product_id', 'price_total'], 200,
    )
    expect(client.create).not.toHaveBeenCalled()
    expect(client.write).not.toHaveBeenCalled()
  })

  it.each([14, 17, 19, 20])('accepts one correctly posted-tax Odoo COD line on Odoo %i', async () => {
    const client = fakeClient([
      { id: 110, product_id: [213, 'Sony A7S III'], price_total: 20000 },
      { id: 111, product_id: [210, 'Shipping'], price_total: 15 },
      { id: 112, product_id: [216, 'Cash on Delivery'], price_total: 5 },
    ])
    await expect(assertZidCodFeeBeforeInvoice(client, 73, order, settings))
      .resolves.toBeUndefined()
  })

  it('rejects a wrong 10 SAR COD line even if the configured fee product is present', async () => {
    const client = fakeClient([{ id: 112, product_id: [216, 'COD'], price_total: 10 }])
    await expect(assertZidCodFeeBeforeInvoice(client, 73, order, settings))
      .rejects.toThrow('order_cod_fee_amount_mismatch_requires_review:73:5:10')
  })

  it('uses the configured currency conversion on a foreign-currency order', async () => {
    const client = fakeClient([{ id: 112, product_id: [216, 'COD'], price_total: 10 }])
    await expect(assertZidCodFeeBeforeInvoice(client, 73, order,
      { ...settings, _currency_conversion_rate: 2 })).resolves.toBeUndefined()
  })

  it('does not assume COD fees for bank transfer payments without an invoice surcharge', async () => {
    const client = fakeClient([])
    const data = { id: 75467541, payment: {
      method: { code: 'zid_bank_transfer' },
      invoice: [{ code: 'shipping', value: 15 }, { code: 'total', value: 329.1 }],
    } }
    await expect(assertZidCodFeeBeforeInvoice(client, 72, data, settings))
      .resolves.toBeUndefined()
    expect(client.searchRead).not.toHaveBeenCalled()
  })

  it('respects a saved setting disabling the extra COD line even if Zid has a fee', async () => {
    const client = fakeClient([])
    await expect(assertZidCodFeeBeforeInvoice(client, 73, order,
      { order: { add_cod_as_line: false, cod_product_id: 216 } })).resolves.toBeUndefined()
    expect(client.searchRead).not.toHaveBeenCalled()
  })

  it('requires an actual configured Odoo COD product for financially enabled COD fees', async () => {
    const client = fakeClient([])
    await expect(assertZidCodFeeBeforeInvoice(client, 73, order,
      { order: { add_cod_as_line: true, cod_product_id: '' } }))
      .rejects.toThrow('order_cod_fee_product_not_configured_requires_review')
    expect(client.searchRead).not.toHaveBeenCalled()
  })

  it('checks persisted gross amount and ignores a tiny Odoo currency rounding delta', async () => {
    const client = fakeClient([{ id: 112, product_id: [216, 'COD'], price_total: 5.01 }])
    await expect(assertZidCodFeeBeforeInvoice(client, 73, order, settings))
      .resolves.toBeUndefined()
  })

  it('wires the preflight before any Zid invoice action, including post-only', () => {
    const source = fs.readFileSync(path.join(process.cwd(),
      'src/lib/odoo/order-workflow.ts'), 'utf8')
    const invoiceAt = source.indexOf('const invoiceAction = row.invoice_action')
    const preflightAt = source.indexOf('await assertZidCodFeeBeforeInvoice(', invoiceAt)
    const applyAt = source.indexOf('applyOrderInvoiceAction(', invoiceAt)
    expect(invoiceAt).toBeGreaterThan(-1)
    expect(preflightAt).toBeGreaterThan(invoiceAt)
    expect(applyAt).toBeGreaterThan(preflightAt)
    expect(source).toContain("resolvedPlatform === 'zid' && /^(?:create|post|create_and_post)$/.test(invoiceAction)")
  })
})
