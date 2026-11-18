import { readStockReturnLedger, type SaleOrderLineInfo } from '@/lib/returns/odoo'

const parent: SaleOrderLineInfo = {
  id: 86, productId: 102, productName: 'Grouped QA',
  orderedQty: 1, deliveredQty: 1, priceUnit: 355.5, taxIds: [],
}

describe('completed Grouped return webhook replay: exclude incoming pickings from delivered baseline', () => {
  it.each([14, 17, 19, 20])('reads parent=1 after A×3/C×2 incoming return (Odoo %i)', async version => {
    const qtyField = version >= 17 ? 'quantity' : 'quantity_done'
    const outgoing = [
      { id: 14, picking_id: [1, 'WH/OUT/00001'], product_id: [79, 'Component A'],
        sale_line_id: [86, 'Parent'], [qtyField]: 3, product_uom_qty: 3 },
      { id: 15, picking_id: [1, 'WH/OUT/00001'], product_id: [81, 'Component C'],
        sale_line_id: [86, 'Parent'], [qtyField]: 2, product_uom_qty: 2 },
    ]
    const incoming = [
      { id: 70, picking_id: [34, 'WH/IN/00014'], product_id: [79, 'Component A'],
        sale_line_id: [86, 'Parent'], [qtyField]: 3, product_uom_qty: 3 },
      { id: 71, picking_id: [34, 'WH/IN/00014'], product_id: [81, 'Component C'],
        sale_line_id: [86, 'Parent'], [qtyField]: 2, product_uom_qty: 2 },
    ]
    const returnMoves = [
      { ...incoming[0], state: 'done', origin_returned_move_id: [14, 'Origin A'] },
      { ...incoming[1], state: 'done', origin_returned_move_id: [15, 'Origin C'] },
    ]
    const client: any = {
      searchRead: jest.fn().mockImplementation(async (model: string, domain: unknown) => {
        const query = JSON.stringify(domain)
        if (model === 'stock.picking') {
          // A real Odoo return picking has sale_id=53 just like the original.
          // Without the type filter the service returns incoming plus outgoing.
          return query.includes('picking_type_code') && query.includes('outgoing')
            ? [{ id: 1 }] : [{ id: 1 }, { id: 34 }]
        }
        if (model === 'stock.move' && query.includes('origin_returned_move_id')) {
          return returnMoves
        }
        if (model === 'stock.move') {
          return query.includes('34') ? [...outgoing, ...incoming] : outgoing
        }
        return []
      }),
      execute: jest.fn(),
    }
    const ledger = await readStockReturnLedger(client, 53, 'S00053', version, [parent])
    expect(ledger).toEqual(new Map([[102, 1]]))
    expect(client.searchRead).toHaveBeenCalledWith(
      'stock.picking', expect.arrayContaining([['picking_type_code', '=', 'outgoing']]),
      ['id'], 100,
    )
    expect(client.execute).not.toHaveBeenCalled()
  })

  it('never auto-validates an incoming return waiting for receipt when no outgoing delivery exists', async () => {
    const client: any = {
      searchRead: jest.fn().mockImplementation(async (model: string, domain: unknown) => {
        if (model !== 'stock.picking') return []
        const query = JSON.stringify(domain)
        if (query.includes('picking_type_code') && query.includes('outgoing')) return []
        return [{ id: 34, state: 'assigned', picking_type_code: 'incoming' }]
      }),
      execute: jest.fn(),
    }
    expect(await readStockReturnLedger(client, 53, 'S00053', 20, [parent]))
      .toEqual(new Map())
    expect(client.execute).not.toHaveBeenCalled()
    const picks = client.searchRead.mock.calls.filter((args: unknown[]) => args[0] === 'stock.picking')
    expect(picks).toHaveLength(2)
    expect(picks.every((args: unknown[]) => JSON.stringify(args[1]).includes('outgoing')))
      .toBe(true)
  })
})
