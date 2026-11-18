import {
  createCreditNote,
  createNegativeSaleOrder,
  createStockReturn,
  type OriginalSaleOrder,
  type OdooReturnLine,
} from '@/lib/returns/odoo'
import { isReturnSignal } from '@/lib/returns/detect'

const original: OriginalSaleOrder = {
  id: 62, name: 'S00062', state: 'sale', partnerId: 15,
  pricelistId: 1,
  companyId: 1, warehouseId: 1, invoiceIds: [], lines: [],
}
const untaxed: OdooReturnLine[] = [{
  productId: 100, name: 'QA option variant',
  quantity: 1, priceUnit: 139.25, taxIds: [],
}]

describe('live-return financial integrity regressions', () => {
  it.each([14, 17, 19, 20])('never lets default Odoo VAT reattach to negative SO lines (Odoo %i)', async (version) => {
    const client: any = {
      getMajorVersion: jest.fn().mockResolvedValue(version),
      create: jest.fn().mockResolvedValue(501),
    }
    await createNegativeSaleOrder(client, original, untaxed, 'QA return')
    const vals = client.create.mock.calls[0][1]
    const taxField = version >= 18 ? 'tax_ids' : 'tax_id'
    expect(vals.order_line[0][2][taxField]).toEqual([[6, 0, []]])
    expect(vals.order_line[0][2].product_uom_qty).toBe(-1)
  })

  it.each([14, 17, 19, 20])('clears source-zero tax on invoice lines and validates Odoo readback (Odoo %i)', async (version) => {
    let posted = false
    const client: any = {
      getMajorVersion: jest.fn().mockResolvedValue(version),
      create: jest.fn().mockResolvedValue(701),
      execute: jest.fn().mockImplementation(async () => { posted = true }),
      searchRead: jest.fn().mockImplementation(async (model: string) => {
        if (model === 'account.move') return [{
          id: 701, state: posted ? 'posted' : 'draft',
          invoice_line_ids: [801], amount_total: 139.25,
        }]
        if (model === 'account.move.line') return [{
          id: 801, product_id: [100, 'Product'], quantity: 1, tax_ids: [],
        }]
        return []
      }),
    }
    const id = await createCreditNote(client, original, null, untaxed, null, 'QA return')
    expect(id).toBe(701)
    expect(client.create.mock.calls[0][1].invoice_line_ids[0][2].tax_ids).toEqual([[6, 0, []]])
    expect(client.execute).toHaveBeenCalledWith('account.move', 'action_post', [[701]])
    expect(posted).toBe(true)
    expect(client.searchRead.mock.calls.filter((c: any[]) => c[0] === 'account.move.line')).toHaveLength(2)
  })

  it('refuses to post a credit note that Odoo automatically taxed at 15%', async () => {
    const client: any = {
      getMajorVersion: jest.fn().mockResolvedValue(19),
      create: jest.fn().mockResolvedValue(702),
      execute: jest.fn(),
      searchRead: jest.fn().mockImplementation(async (model: string) => {
        if (model === 'account.move') return [{
          id: 702, state: 'draft', invoice_line_ids: [802], amount_total: 160.14,
        }]
        if (model === 'account.move.line') return [{
          id: 802, product_id: [100, 'Product'], quantity: 1, tax_ids: [5],
        }]
        return []
      }),
    }
    await expect(createCreditNote(client, original, null, untaxed, null, 'QA return'))
      .rejects.toThrow('credit_note_tax_or_quantity_mismatch')
    expect(client.execute).not.toHaveBeenCalled()
  })

  it('rejects a wrong total even when Odoo returned empty tax ids', async () => {
    const client: any = {
      getMajorVersion: jest.fn().mockResolvedValue(19),
      create: jest.fn().mockResolvedValue(703),
      execute: jest.fn(),
      searchRead: jest.fn().mockImplementation(async (model: string) => {
        if (model === 'account.move') return [{
          id: 703, state: 'draft', invoice_line_ids: [803], amount_total: 160.14,
        }]
        if (model === 'account.move.line') return [{
          id: 803, product_id: [100, 'Product'], quantity: 1, tax_ids: [],
        }]
        return []
      }),
    }
    await expect(createCreditNote(client, original, null, untaxed, null, 'QA return'))
      .rejects.toThrow('credit_note_total_mismatch')
    expect(client.execute).not.toHaveBeenCalled()
  })

  it('never claims success when Odoo had no outgoing delivery to return', async () => {
    const client: any = {
      searchRead: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      execute: jest.fn(),
    }
    await expect(createStockReturn(client, 62, untaxed, 19, { orderName: 'S00062' }))
      .rejects.toThrow('stock_return_missing_delivered_moves')
    expect(client.create).not.toHaveBeenCalled()
    expect(client.execute).not.toHaveBeenCalled()
  })

  it('does not treat an uncompleted Zid return as an ERP reversal', () => {
    expect(isReturnSignal('zid', 'order.status.update', {
      order_status: { code: 'reverse_in_progress' },
    })).toBe(false)
    expect(isReturnSignal('zid', 'order.status.update', {
      order_status: { code: 'reverse_in_progress' },
      reverse_order_label_request: { id: 'test' },
    })).toBe(false)
    expect(isReturnSignal('zid', 'order.status.update', {
      order_status: { code: 'reversed' },
    })).toBe(true)
  })
})
