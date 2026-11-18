import { assertZidOrderTotalBeforeInvoice } from '@/lib/odoo/order-workflow'
import fs from 'fs'
import path from 'path'

function fakeClient(total: number, currency='SAR') {
  const client: any = {
    searchRead: jest.fn(async (model: string) => model === 'sale.order'
      ? [{ id: 53, amount_total: total, currency_id: [151, 'SAR'] }]
      : model === 'res.currency'
        ? [{ id: 151, name: currency }]
        : []
    ),
    create: jest.fn(),
    execute: jest.fn(),
    write: jest.fn(),
  }
  return client
}
const grouped = { id: 502217245, currency_code: 'SAR', order_total: '375.50000000000000' }

describe('Zid invoice preflight must reconcile Odoo persisted gross total', () => {
  it('blocks live grouped order 502217245: 375.50 source vs 355.50 Odoo before posting', async () => {
    const client = fakeClient(355.5)
    await expect(assertZidOrderTotalBeforeInvoice(client, 53, grouped, {}))
      .rejects.toThrow('order_invoice_total_mismatch_requires_review:53:375.5:355.5')
    expect(client.searchRead).toHaveBeenCalledWith('sale.order',
      [['id', '=', 53]], ['id', 'amount_total', 'currency_id'], 1)
    expect(client.create).not.toHaveBeenCalled()
  })

  it('accepts a complete original grouped order including 20 SAR shipping', async () => {
    const client = fakeClient(375.5)
    await expect(assertZidOrderTotalBeforeInvoice(client, 53, grouped, {}))
      .resolves.toBeUndefined()
  })

  it('catches the historic COD 5 SAR omission independent of COD mapping configuration', async () => {
    const client = fakeClient(20015)
    await expect(assertZidOrderTotalBeforeInvoice(client, 73, {
      id: 70953730, order_total: '20020.00000000000000', currency_code: 'SAR',
    }, { order: { add_cod_as_line: false } }))
      .rejects.toThrow('order_invoice_total_mismatch_requires_review:73:20020:20015')
  })

  it.each([14, 17, 19, 20])('allows a matching payment+shipping+product order in Odoo %i', async () => {
    const client = fakeClient(321)
    await expect(assertZidOrderTotalBeforeInvoice(client, 76, {
      currency_code: 'SAR', order_total: '321', id: 600,
    }, {})).resolves.toBeUndefined()
  })

  it('compares converted totals when saved forex rate is used', async () => {
    const client = fakeClient(751)
    await expect(assertZidOrderTotalBeforeInvoice(client, 53, grouped,
      { _currency_conversion_rate: 2 }))
      .resolves.toBeUndefined()
    expect(client.searchRead).toHaveBeenCalledTimes(1)
  })

  it('refuses equal nominal totals in different currencies', async () => {
    const client = fakeClient(375.5, 'AED')
    await expect(assertZidOrderTotalBeforeInvoice(client, 53, grouped, {}))
      .rejects.toThrow('order_invoice_currency_mismatch_requires_review')
  })

  it('does not invent an order total from partial webhook product quantities', async () => {
    const client = fakeClient(0)
    await expect(assertZidOrderTotalBeforeInvoice(client, 53, { id: 1 }, {}))
      .resolves.toBeUndefined()
    expect(client.searchRead).not.toHaveBeenCalled()
  })

  it('rejects invalid source total, rather than treating it as zero', async () => {
    const client = fakeClient(0)
    await expect(assertZidOrderTotalBeforeInvoice(client, 53,
      { order_total: 'not-a-number' }, {}))
      .rejects.toThrow('order_invoice_source_total_invalid_requires_review')
  })

  it('tolerates small monetary rounding, not a missing fee', async () => {
    const client = fakeClient(375.47)
    await expect(assertZidOrderTotalBeforeInvoice(client, 53, grouped, {}))
      .resolves.toBeUndefined()
  })

  it('wires total validation after COD validation and before any Zid invoice RPC', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/odoo/order-workflow.ts'), 'utf8')
    const pos = source.indexOf('const invoiceAction = row.invoice_action')
    const codAt = source.indexOf('await assertZidCodFeeBeforeInvoice(', pos)
    const totalAt = source.indexOf('await assertZidOrderTotalBeforeInvoice(', pos)
    const actionAt = source.indexOf('applyOrderInvoiceAction(', pos)
    expect(pos).toBeGreaterThan(-1)
    expect(codAt).toBeGreaterThan(pos)
    expect(totalAt).toBeGreaterThan(codAt)
    expect(actionAt).toBeGreaterThan(totalAt)
  })
})
