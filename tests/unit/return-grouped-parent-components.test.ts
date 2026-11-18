import { extractZidReceivedReturnLines } from '@/lib/returns/detect'
import { createStockReturn, readStockReturnLedger, type SaleOrderLineInfo } from '@/lib/returns/odoo'

const originalParent: SaleOrderLineInfo = {
  id: 89, productId: 102, productName: 'Grouped QA',
  orderedQty: 1, deliveredQty: 1, priceUnit: 355.5, taxIds: [],
}
const outgoing = [
  { id: 18, picking_id: [3, 'WH/OUT/00003'], product_id: [79, 'Component A'],
    sale_line_id: [89, 'Grouped parent'], quantity: 3, quantity_done: 3,
    product_uom_qty: 3 },
  { id: 19, picking_id: [3, 'WH/OUT/00003'], product_id: [81, 'Component C'],
    sale_line_id: [89, 'Grouped parent'], quantity: 2, quantity_done: 2,
    product_uom_qty: 2 },
]
const zidParentReceipt = {
  order_status: { code: 'reversed' },
  reverse_order_label_requests: [{
    id: 'reverse1',
    products: [
      {
        product: { id: 'component-a', sku: 'COMP-A' },
        order_product: { sku: 'COMP-A', meta: { group_product_id: 'parent-uuid' } },
        received_quantity: 0, not_received_quantity: 0, damaged_quantity: 0,
        reversed_quantity: 3,
      },
      {
        product: { id: 'component-c', sku: 'COMP-C' },
        order_product: { sku: 'COMP-C', meta: { group_product_id: 'parent-uuid' } },
        received_quantity: 0, not_received_quantity: 0, damaged_quantity: 0,
        reversed_quantity: 2,
      },
      {
        product: { id: 'parent-uuid', sku: 'GROUP' },
        order_product: { sku: 'GROUP', meta: null },
        received_quantity: 1, not_received_quantity: 0, damaged_quantity: 0,
        reversed_quantity: 1,
      },
    ],
  }],
}

function fakeOdoo(version: number, original = outgoing) {
  const created: Array<{ model: string; vals: any }> = []
  const writes: Array<{ model: string; ids: number[]; values: any }> = []
  const client: any = {
    getMajorVersion: jest.fn().mockResolvedValue(version),
    searchRead: jest.fn().mockImplementation(async (
      model: string, domain: unknown,
    ) => {
      const filter = JSON.stringify(domain)
      if (model === 'product.product') return [
        { id: 102, type: version >= 18 ? 'consu' : 'product', is_storable: true },
      ]
      if (model === 'stock.picking') {
        if (filter.includes('return_id')) return []
        if (filter.includes('77')) return [{ id: 77, state: 'done' }]
        return [{ id: 3, state: 'done' }]
      }
      if (model === 'stock.move') {
        if (filter.includes('origin_returned_move_id')) return [
          { id: 180, origin_returned_move_id: [18, 'origin'], product_id: [79, 'A'],
            state: 'done', quantity: 3, quantity_done: 3, product_uom_qty: 3 },
          { id: 190, origin_returned_move_id: [19, 'origin'], product_id: [81, 'C'],
            state: 'done', quantity: 2, quantity_done: 2, product_uom_qty: 2 },
        ]
        if (filter.includes('77')) return [
          { id: 180, origin_returned_move_id: [18, 'origin'], product_id: [79, 'A'],
            product_uom_qty: 3 },
          { id: 190, origin_returned_move_id: [19, 'origin'], product_id: [81, 'C'],
            product_uom_qty: 2 },
        ]
        return original
      }
      return []
    }),
    create: jest.fn().mockImplementation(async (model: string, vals: any) => {
      created.push({ model, vals }); return 50
    }),
    execute: jest.fn().mockImplementation(async (model: string, method: string) => {
      if (method === 'action_return' || method === 'action_create_returns') {
        return { res_id: 77 }
      }
      return true
    }),
    write: jest.fn().mockImplementation(async (
      model: string, ids: number[], values: any,
    ) => { writes.push({ model, ids, values }); return true }),
  }
  return { client, created, writes }
}

describe('Grouped Zid parent is the financial line; component moves are its inventory', () => {
  it('ignores zero-received component placeholders, refunds ONLY parent once', () => {
    expect(extractZidReceivedReturnLines(zidParentReceipt)).toEqual({
      known: true, lines: [{ storeProductId: 'parent-uuid', sku: 'GROUP', quantity: 1 }],
    })
  })

  it('keeps an explicit component-only receipt as a terminal review, not a guessed parent refund', () => {
    const modified = JSON.parse(JSON.stringify(zidParentReceipt))
    modified.reverse_order_label_requests[0].products[0].received_quantity = 1
    expect(extractZidReceivedReturnLines(modified).error)
      .toBe('return_grouped_components_require_review')
  })

  it.each([14, 17, 19, 20])('returns component A×3 and C×2 for one parent, not parent stock (Odoo %i)', async version => {
    const { client, created, writes } = fakeOdoo(version)
    await expect(createStockReturn(client, 56, [{
      productId: 102, saleLineId: 89, quantity: 1, priceUnit: 355.5,
      name: 'Grouped QA', taxIds: [],
    }], version, { orderName: 'S00056', originalLines: [originalParent] }))
      .resolves.toEqual({ pickingIds: [77], returnedQty: 5 })
    if (version < 20) {
      const wizard = created.find(item => item.model === 'stock.return.picking')
      expect(wizard).toBeDefined()
      expect(wizard!.vals.product_return_moves.map((move: any[]) =>
        [move[2].move_id, move[2].product_id, move[2].quantity]))
        .toEqual([[18, 79, 3], [19, 81, 2]])
    } else {
      expect(writes.map(row => [row.ids[0], row.values.product_uom_qty]))
        .toEqual([[180, 3], [190, 2]])
    }
  })

  it('returns half the component quantities for one returned parent of two originally sold', async () => {
    const scaled = outgoing.map(move => ({ ...move,
      quantity: move.quantity * 2, quantity_done: move.quantity_done * 2,
      product_uom_qty: move.product_uom_qty * 2 }))
    const { client, writes } = fakeOdoo(20, scaled)
    await createStockReturn(client, 56, [{
      productId: 102, saleLineId: 89, quantity: 1, priceUnit: 355.5,
      name: 'Grouped QA', taxIds: [],
    }], 20, { orderName: 'S00056', originalLines: [{ ...originalParent, orderedQty: 2 }] })
    expect(writes.map(row => row.values.product_uom_qty)).toEqual([3, 2])
  })

  it('deduplicates received components as ONE parent in stock-only return ledger', async () => {
    const { client } = fakeOdoo(20)
    await expect(readStockReturnLedger(client, 56, 'S00056', 20, [originalParent]))
      .resolves.toEqual(new Map([[102, 1]]))
  })

  it('requires review for a partially returned child with no matching parent component quantity', async () => {
    const { client } = fakeOdoo(20)
    client.searchRead.mockImplementation(async (model: string, domain: unknown) => {
      const filter = JSON.stringify(domain)
      if (model === 'stock.picking') return [{ id: 3 }]
      if (model === 'stock.move' && filter.includes('origin_returned_move_id')) {
        return [{ id: 180, origin_returned_move_id: [18, 'origin'],
          product_id: [79, 'A'], state: 'done', quantity: 3, product_uom_qty: 3 }]
      }
      if (model === 'stock.move') return outgoing
      return []
    })
    await expect(readStockReturnLedger(client, 56, 'S00056', 20, [originalParent]))
      .rejects.toThrow('return_grouped_partial_inventory_effect_requires_review')
  })
})
