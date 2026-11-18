import { extractZidReceivedReturnLines } from '@/lib/returns/detect'

const product = (overrides: Record<string, unknown> = {}) => ({
  id: 'return-line-1',
  product_uuid: 'store-product-1',
  product: { id: 'store-product-1', sku: 'QA-SKU', name: 'QA' },
  order_product: { sku: 'QA-SKU', meta: null },
  reversed_quantity: 3,
  received_quantity: 1,
  not_received_quantity: 2,
  damaged_quantity: 0,
  ...overrides,
})

const payload = (products: unknown[], id = 'return-1') => ({
  order_status: { code: 'reversed' },
  reverse_order_label_request: { id, products },
  reverse_order_label_requests: [{ id, products }],
})

describe('Zid completed returns use actual receipt quantities', () => {
  it('refunds one received unit, NOT three units requested for reversal', () => {
    const actual = extractZidReceivedReturnLines(payload([product()]))
    expect(actual).toEqual({
      known: true,
      lines: [{ storeProductId: 'store-product-1', sku: 'QA-SKU', quantity: 1 }],
    })
  })

  it('ignores quantities not received by the merchant', () => {
    expect(extractZidReceivedReturnLines(payload([
      product({ received_quantity: 0, not_received_quantity: 3 }),
    ]))).toEqual({ known: true, lines: [] })
  })

  it('deduplicates the same reverse request appearing in single and list fields', () => {
    const p: any = payload([product()])
    p.reverse_order_label_requests.push(p.reverse_order_label_request)
    expect(extractZidReceivedReturnLines(p).lines).toHaveLength(1)
  })

  it('sums two distinct completed partial returns without losing their identity', () => {
    const first = { id: 'return-1', products: [product({ received_quantity: 1, not_received_quantity: 0, reversed_quantity: 1 })] }
    const next = { id: 'return-2', products: [product({ received_quantity: 2, not_received_quantity: 0, reversed_quantity: 2 })] }
    const actual = extractZidReceivedReturnLines({ reverse_order_label_requests: [first, next] })
    expect(actual.known).toBe(true)
    expect(actual.lines.reduce((total, line) => total + line.quantity, 0)).toBe(3)
  })

  it('rejects damaged returned goods until merchant refund policy is known', () => {
    const result = extractZidReceivedReturnLines(payload([
      product({ received_quantity: 1, damaged_quantity: 1, not_received_quantity: 1 }),
    ]))
    expect(result.error).toBe('return_damaged_requires_financial_review')
  })

  it('does not guess how many parent bundles to refund from component unit counts', () => {
    const result = extractZidReceivedReturnLines(payload([product({
      order_product: { sku: 'QA-SKU', meta: { group_product_id: 'parent-bundle' } },
    })]))
    expect(result.error).toBe('return_grouped_components_require_review')
  })

  it('rejects malformed or missing received quantities rather than refunding all', () => {
    expect(extractZidReceivedReturnLines(payload([product({ received_quantity: null })])).error)
      .toBe('return_received_quantity_missing')
    expect(extractZidReceivedReturnLines(payload([product({ received_quantity: 5 })])).error)
      .toBe('return_receipt_quantity_invalid')
    expect(extractZidReceivedReturnLines({ order_status: { code: 'reversed' } }))
      .toEqual({ known: false, lines: [] })
  })

  it('accepts a full properly received return and a repeated webhook snapshot', () => {
    const value = payload([product({
      reversed_quantity: 3, received_quantity: 3, not_received_quantity: 0,
    })])
    expect(extractZidReceivedReturnLines(value).lines[0].quantity).toBe(3)
    expect(extractZidReceivedReturnLines(value)).toEqual(extractZidReceivedReturnLines(value))
  })
})
