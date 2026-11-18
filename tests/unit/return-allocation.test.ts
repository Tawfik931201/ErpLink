import { incrementalReturnLineQuantities, isCumulativeFullReturn } from '@/lib/returns/allocation'

const lines = [
  { productId: 197, orderedQty: 1, price: 100, analytic: 7 },
  { productId: 197, orderedQty: 1, price: 200, analytic: 8 },
  { productId: 210, orderedQty: 1, price: 15 },
]

describe('cumulative Zid returns across separate sale lines of same product', () => {
  it('does not count a partial receipt as full just because it matches each individual line quantity', () => {
    const regular = lines.filter(line => line.productId !== 210)
    expect(isCumulativeFullReturn(regular, new Map([[197, 1]]))).toBe(false)
    expect(isCumulativeFullReturn(regular, new Map([[197, 2]]))).toBe(true)
    expect(isCumulativeFullReturn(regular, new Map([[197, 0]]))).toBe(false)
  })

  it('returns only the first original 100 SAR line on a one-unit partial receipt', () => {
    expect(incrementalReturnLineQuantities(lines, new Map([[197, 1]]), new Map()))
      .toEqual([1, 0, 0])
  })

  it('returns the second 200 SAR line on the next partial receipt without repeating the first line', () => {
    expect(incrementalReturnLineQuantities(lines,
      new Map([[197, 2], [210, 1]]),
      new Map([[197, 1]])))
      .toEqual([0, 1, 1])
  })

  it('handles multiple original lines of same product with quantities 2 and 3', () => {
    const multi = [{ productId: 197, orderedQty: 2 }, { productId: 197, orderedQty: 3 }]
    expect(incrementalReturnLineQuantities(multi, new Map([[197, 4]]), new Map()))
      .toEqual([2, 2])
    expect(incrementalReturnLineQuantities(multi, new Map([[197, 5]]), new Map([[197, 4]])))
      .toEqual([0, 1])
  })

  it('fails closed when Zid reports more returned than actually sold or an unmapped product', () => {
    expect(() => incrementalReturnLineQuantities(lines, new Map([[197, 3]]), new Map()))
      .toThrow('return_receipt_quantity_exceeds_original:197')
    expect(() => incrementalReturnLineQuantities(lines, new Map([[999, 1]]), new Map()))
      .toThrow('return_receipt_quantity_exceeds_original:999')
  })

  it('never re-applies already credited quantities on duplicate notifications', () => {
    expect(incrementalReturnLineQuantities(lines,
      new Map([[197, 2], [210, 1]]), new Map([[197, 2], [210, 1]])))
      .toEqual([0, 0, 0])
  })

  it('keeps a negative quantity discount line capped to one refunded unit', () => {
    const discount = [{ productId: 197, orderedQty: 1 }, { productId: 215, orderedQty: -1 }]
    expect(incrementalReturnLineQuantities(discount,
      new Map([[197, 1], [215, 1]]), new Map()))
      .toEqual([1, 1])
  })
})
