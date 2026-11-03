import { extractFulfilledItems } from '../../src/lib/orders/fulfillment-items'

describe('order fulfillment item characterization', () => {
  it('returns empty without a nonempty candidate', () => {
    expect(extractFulfilledItems({})).toEqual([])
    expect(extractFulfilledItems({ items: [] })).toEqual([])
  })
  it('uses the first nonempty array in the existing precedence', () => {
    expect(extractFulfilledItems({ fulfilled_items: [{ sku: 'first', quantity: 2 }], items: [{ sku: 'second', quantity: 8 }] }))
      .toEqual([{ sku: 'first', qty: 2 }])
    expect(extractFulfilledItems({ fulfilled_items: [], line_items: [{ default_code: 'code', qty: '3.5' }] }))
      .toEqual([{ sku: 'code', qty: 3.5 }])
  })
  it('preserves truthy aliases, numeric parsing, duplicates and positive-only filtering', () => {
    expect(extractFulfilledItems({ items: [
      { sku: '', product_id: 12, quantity: 0, qty: '2units' },
      { id: 13, fulfilled_qty: 4 }, { sku: 'same', quantity: 1 }, { sku: 'same', quantity: 2 },
      { sku: 'negative', quantity: -1 }, { sku: 'bad', quantity: 'invalid' }, { quantity: 8 },
    ] })).toEqual([{ sku: '12', qty: 2 }, { sku: '13', qty: 4 }, { sku: 'same', qty: 1 }, { sku: 'same', qty: 2 }])
  })
  it('does not try later arrays when the first candidate filters to empty', () => {
    expect(extractFulfilledItems({ fulfilled_items: [{ quantity: 0 }], items: [{ sku: 'later', quantity: 2 }] })).toEqual([])
  })
  it('preserves the shadowed nested Shopify fulfillment behavior', () => {
    expect(extractFulfilledItems({ fulfillments: [{ line_items: [{ sku: 'nested', quantity: 3 }] }] })).toEqual([])
    expect(extractFulfilledItems({ fulfillments: [{ sku: 'flat', quantity: 3 }] })).toEqual([{ sku: 'flat', qty: 3 }])
  })
})
