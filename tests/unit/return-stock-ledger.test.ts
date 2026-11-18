import { readStockReturnLedger } from '@/lib/returns/odoo'

describe('inventory receipt ledger without a credit note', () => {
  it.each([14, 17, 19, 20])('counts existing non-cancelled returned stock moves (Odoo %i)', async version => {
    const qtyField = version >= 17 ? 'quantity' : 'quantity_done'
    const client: any = {
      searchRead: jest.fn().mockImplementation(async (
        model: string, domain: unknown,
      ) => {
        if (model === 'stock.picking') return [{ id: 10 }]
        if (model !== 'stock.move') return []
        if (JSON.stringify(domain).includes('origin_returned_move_id')) {
          return [
            { id: 501, origin_returned_move_id: [401, 'outgoing'],
              product_id: [197, 'QA stock'], state: 'done',
              [qtyField]: 1, product_uom_qty: 1 },
            { id: 502, origin_returned_move_id: [401, 'outgoing'],
              product_id: [197, 'QA stock'], state: 'assigned',
              [qtyField]: 0, product_uom_qty: 1 },
          ]
        }
        return [{ id: 401, picking_id: [10, 'WH/OUT'], product_id: [197, 'QA stock'],
          [qtyField]: 3, product_uom_qty: 3 }]
      }),
      execute: jest.fn(),
    }
    const ledger = await readStockReturnLedger(client, 62, 'S00062', version)
    expect([...ledger]).toEqual([[197, 2]])
    expect(client.execute).not.toHaveBeenCalled()
    expect(client.searchRead.mock.calls.some((args: unknown[]) =>
      JSON.stringify(args[1]).includes('origin_returned_move_id'))).toBe(true)
  })

  it('does not count a return move belonging to another outgoing sale order', async () => {
    const client: any = {
      searchRead: jest.fn().mockImplementation(async (model: string, domain: unknown) =>
        model === 'stock.picking' ? [{ id: 10 }]
          : JSON.stringify(domain).includes('origin_returned_move_id')
            ? [{ id: 600, origin_returned_move_id: [999, 'unrelated'],
              product_id: [197, 'QA stock'], state: 'done', quantity: 8,
              product_uom_qty: 8 }]
            : [{ id: 401, picking_id: [10, 'WH/OUT'],
              product_id: [197, 'QA stock'], quantity: 2 }]
      ),
    }
    await expect(readStockReturnLedger(client, 62, 'S00062', 20))
      .resolves.toEqual(new Map())
  })

  it('supports Odoo versions that expose planned quantity only', async () => {
    const client: any = {
      searchRead: jest.fn().mockImplementation(async (
        model: string, domain: unknown, fields: string[],
      ) => {
        if (model === 'stock.picking') return [{ id: 10 }]
        if (JSON.stringify(domain).includes('origin_returned_move_id')) {
          if (fields.includes('quantity')) throw new Error('field quantity is missing')
          return [{ id: 501, origin_returned_move_id: [401, 'outgoing'],
            product_id: [197, 'QA stock'], state: 'done', product_uom_qty: 1 }]
        }
        return [{ id: 401, picking_id: [10, 'WH/OUT'],
          product_id: [197, 'QA stock'], product_uom_qty: 2 }]
      }),
    }
    expect(await readStockReturnLedger(client, 62, 'S00062', 20))
      .toEqual(new Map([[197, 1]]))
  })
})
