import {
  collectRefundedItems,
  extractSallaRefundedLines,
  extractStoreReturnReason,
  extractZidRemainingLines,
  isReturnSignal,
  zidReturnRefundsOrderFees,
  verifiedZidFallbackRefundTotal,
  isSallaReturnEvent,
  isZidReturnStatus,
  returnDedupeKey,
  returnSnapshotSignature,
  type StoreReturnLine,
} from '@/lib/returns/detect'

describe('isZidReturnStatus', () => {
  it('accepts the completed reversal statuses', () => {
    expect(isZidReturnStatus('reversed')).toBe(true)
    expect(isZidReturnStatus('partially_reversed')).toBe(true)
    expect(isZidReturnStatus('PARTIALLY-REVERSED')).toBe(true)
  })

  it('reads the documented { code } object, not only its slug', () => {
    expect(isZidReturnStatus({ code: 'reversed', name: 'Reversed' })).toBe(true)
    expect(isZidReturnStatus({ code: 'delivered', name: 'Delivered' })).toBe(false)
  })

  it('ignores reverse_in_progress by default - the merchant can still cancel', () => {
    expect(isZidReturnStatus('reverse_in_progress')).toBe(false)
    expect(isZidReturnStatus('reverse_in_progress', true)).toBe(true)
  })

  it('does not treat ordinary statuses as returns', () => {
    expect(isZidReturnStatus('delivered')).toBe(false)
    expect(isZidReturnStatus('cancelled')).toBe(false)
    expect(isZidReturnStatus('')).toBe(false)
    expect(isZidReturnStatus(undefined)).toBe(false)
  })
})

describe('isSallaReturnEvent', () => {
  it('accepts only the two documented return events', () => {
    expect(isSallaReturnEvent('order.refunded')).toBe(true)
    expect(isSallaReturnEvent('order.shipment.return.created')).toBe(true)
  })

  it('rejects the other shipment events and the bare order update', () => {
    expect(isSallaReturnEvent('order.shipment.created')).toBe(false)
    expect(isSallaReturnEvent('order.shipment.cancelled')).toBe(false)
    expect(isSallaReturnEvent('order.status.updated')).toBe(false)
  })
})

describe('extractZidRemainingLines (documented view-for-return payload)', () => {
  // Trimmed copy of the example published at
  // docs.zid.sa "Order Details – View for Return". The two traps it encodes:
  // `quantity` is the REMAINING quantity (4 = 6 ordered − 2 already returned),
  // and `id` is the order-product UUID, not the store product id.
  const documented = {
    status: 'object',
    order: {
      id: 39017136,
      code: 'XAiG6yjJCW',
      order_status: { name: 'Partially Reversed', code: 'partially_reversed' },
      products_count: 1,
      order_total: 245.99,
      products: [
        {
          id: 'a1e5eb8f-12a7-4a43-97af-f98e0d9af17b',
          order_product_id: 60564,
          name: 'Test file',
          sku: 'Z.1.17314985477182937',
          quantity: 4,
          price: 122.99,
          tax_percentage: 0.15,
          total: 491.96,
        },
      ],
    },
  }

  it('takes quantity as the remaining quantity', () => {
    const lines = extractZidRemainingLines(documented)
    expect(lines).toHaveLength(1)
    expect(lines[0].quantity).toBe(4)
  })

  it('identifies the line by SKU, never by the order-product UUID', () => {
    const [line] = extractZidRemainingLines(documented)
    expect(line.sku).toBe('Z.1.17314985477182937')
    expect(line.storeProductId).toBe('')
  })

  it('converts the tax-inclusive price to a net unit price', () => {
    const [line] = extractZidRemainingLines(documented)
    expect(line.priceUnit).toBeCloseTo(106.95, 2)
  })

  it('keeps a fully-returned row (quantity 0) instead of dropping it', () => {
    const lines = extractZidRemainingLines({
      order: { products: [{ id: 'uuid-1', sku: 'A', quantity: 0, price: 10 }] },
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].quantity).toBe(0)
  })

  it('returns [] for a fully reversed order (documented: products = [])', () => {
    expect(extractZidRemainingLines({ order: { products: [], products_count: 0 } })).toEqual([])
  })

  it('returns [] when there is no products array at all, so the caller can say "unknown"', () => {
    expect(extractZidRemainingLines({ order: { id: 1 } })).toEqual([])
    expect(extractZidRemainingLines(null)).toEqual([])
  })
})

describe('isReturnSignal', () => {
  it('reads the Zid status from the flat payload', () => {
    expect(isReturnSignal('zid', 'order.status.update', { status: 'reversed' })).toBe(true)
    expect(isReturnSignal('zid', 'order.status.update', { status: 'delivered' })).toBe(false)
    // Anti-regression: empty reverse_order_label_requests array must NOT trigger return detection
    expect(
      isReturnSignal('zid', 'order.status.update', {
        status: 'preparing',
        reverse_order_label_requests: [],
        reverse_order_label_request: null,
      })
    ).toBe(false)
    expect(
      isReturnSignal('zid', 'order.status.update', {
        status: 'delivered',
        reverse_order_label_requests: [{ id: 1 }],
      })
    ).toBe(true)
    expect(
      isReturnSignal('zid', 'order.status.update', {
        status: 'delivered',
        reverse_order_label_request: { id: 1 },
      })
    ).toBe(true)
  })

  it('reads the Zid status from an object and from a nested order', () => {
    expect(
      isReturnSignal('zid', 'order.status.update', { order_status: { slug: 'partially_reversed' } })
    ).toBe(true)
    expect(
      isReturnSignal('zid', 'order.status.update', { order: { status: 'reversed' } })
    ).toBe(true)
    // Documented order payload: order_status is { name, code }, not { slug }.
    expect(
      isReturnSignal('zid', 'order.updated', {
        order: { order_status: { code: 'partially_reversed', name: 'Partially Reversed' } },
      })
    ).toBe(true)
    expect(
      isReturnSignal('zid', 'order.updated', {
        order: { order_status: { code: 'delivered', name: 'Delivered' } },
      })
    ).toBe(false)
  })

  it('treats a Salla return event as a signal regardless of the payload', () => {
    expect(isReturnSignal('salla', 'order.shipment.return.created', { id: 1 })).toBe(true)
  })

  it('needs actual refunded items for a Salla order update', () => {
    expect(isReturnSignal('salla', 'order.status.updated', { refunded_items: [] })).toBe(false)
    expect(
      isReturnSignal('salla', 'order.status.updated', {
        refunded_items: [{ id: 1, quantity: 1 }],
      })
    ).toBe(true)
    expect(
      isReturnSignal('salla', 'order.status.updated', {
        order: { refunded_items: [{ id: 1, quantity: 1 }] },
      })
    ).toBe(true)
  })

  it('never signals for shopify', () => {
    expect(isReturnSignal('shopify', 'orders/updated', { refunded_items: [{ id: 1 }] })).toBe(false)
  })
})

describe('collectRefundedItems', () => {
  it('prefers the flat array and falls back to the nested order', () => {
    expect(collectRefundedItems({ refunded_items: [{ id: 1 }] })).toHaveLength(1)
    expect(collectRefundedItems({ order: { refunded_items: [{ id: 2 }] } })).toHaveLength(1)
    expect(collectRefundedItems({})).toBeNull()
  })
})

describe('extractSallaRefundedLines', () => {
  it('maps a real refunded_items row to a store line', () => {
    const lines = extractSallaRefundedLines({
      order: {
        refunded_items: [
          {
            id: 41030567,
            product: { id: 998877, sku: 'SKU-1', name: 'Shirt' },
            quantity: 2,
            amounts: { price_without_tax: 55.5 },
          },
        ],
      },
    })
    expect(lines).toEqual([
      {
        storeProductId: '998877',
        sku: 'SKU-1',
        quantity: 2,
        name: 'Shirt',
        priceUnit: 55.5,
      },
    ])
  })

  it('skips rows without an identifier or without a positive quantity', () => {
    const lines = extractSallaRefundedLines({
      refunded_items: [
        { quantity: 1 },
        { product: { id: 5 }, quantity: 0 },
        { product: { id: 6 }, quantity: 3 },
      ],
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].storeProductId).toBe('6')
  })
})

describe('returnSnapshotSignature', () => {
  const lines: StoreReturnLine[] = [
    { storeProductId: '1', sku: 'A', quantity: 2 },
    { storeProductId: '2', sku: 'B', quantity: 1 },
  ]

  it('is stable for the same content in the same order', () => {
    expect(returnSnapshotSignature(lines, 'zid:10')).toBe(returnSnapshotSignature(lines, 'zid:10'))
  })

  it('is independent of line order because lines are sorted first', () => {
    expect(returnSnapshotSignature([...lines].reverse(), 'zid:10')).toBe(
      returnSnapshotSignature(lines, 'zid:10')
    )
  })

  it('changes when a quantity changes', () => {
    const changed = [{ ...lines[0], quantity: 3 }, lines[1]]
    expect(returnSnapshotSignature(changed, 'zid:10')).not.toBe(
      returnSnapshotSignature(lines, 'zid:10')
    )
  })

  it('changes when the scope changes', () => {
    expect(returnSnapshotSignature(lines, 'zid:10')).not.toBe(
      returnSnapshotSignature(lines, 'zid:11')
    )
  })
})

describe('returnDedupeKey', () => {
  it('is namespaced per platform and order', () => {
    expect(returnDedupeKey('zid', '10', 'abc')).toBe('zid:return:10:abc')
    expect(returnDedupeKey('salla', '10', 'abc')).toBe('salla:return:10:abc')
  })
})

describe('extractStoreReturnReason', () => {
  it('extracts Zid reverse_order_label_request reason array', () => {
    const payload = {
      reverse_order_label_request: {
        reason: [{ id: '1', name: 'العميل لم يعد بحاجة للمنتج' }],
      },
    }
    expect(extractStoreReturnReason(payload, 'zid')).toBe('العميل لم يعد بحاجة للمنتج')
  })

  it('extracts nested reason strings and fallbacks', () => {
    expect(extractStoreReturnReason({ return_reason: 'تالف أثناء الشحن' })).toBe('تالف أثناء الشحن')
    expect(extractStoreReturnReason({ order: { refund_reason: 'طلب العميل' } })).toBe('طلب العميل')
    expect(extractStoreReturnReason({ reason: 'عيب مصنعي' })).toBe('عيب مصنعي')
    expect(extractStoreReturnReason(null)).toBe('')
    expect(extractStoreReturnReason({})).toBe('')
  })
})

describe('Zid full reversal fee-refund accounting', () => {
  it('does not credit 15 SAR shipping when the full return totals are product-only', () => {
    const payload = {
      reverse_order_label_requests: [{ id: 'qa-products-only', reverse_total: 95, refund_total: 95 }],
    }
    expect(zidReturnRefundsOrderFees(payload)).toBe(true) // legacy totals alone are ambiguous
    expect(zidReturnRefundsOrderFees(payload, [{ sku: 'QA', storeProductId: 'p1', quantity: 1, priceUnit: 95 }], 15)).toBe(false)
    expect(verifiedZidFallbackRefundTotal(payload, [{ sku: 'QA', storeProductId: 'p1', quantity: 1, priceUnit: 95 }])).toBe(95)
  })

  it('credits shipping only when the source refund is the item total plus the fee', () => {
    const lines = [{ sku: 'QA', storeProductId: 'p1', quantity: 1, priceUnit: 63 }]
    expect(zidReturnRefundsOrderFees({
      reverse_order_label_requests: [{ id: 'qa-fee-refunded', reverse_total: 78, refund_total: 78 }],
    }, lines, 15)).toBe(true)
    expect(zidReturnRefundsOrderFees({
      reverse_order_label_requests: [{ id: 'qa-fee-not-refunded', reverse_total: 63, refund_total: 63 }],
    }, lines, 15)).toBe(false)
  })

  it('uses source VAT when deciding if a shipping fee is actually refundable', () => {
    const lines = [{ sku: 'QA', storeProductId: 'p1', quantity: 1, priceUnit: 261.74, taxAmountPerUnit: 39.26 }]
    expect(zidReturnRefundsOrderFees({
      reverse_order_label_requests: [{ reverse_total: 301, refund_total: 301 }],
    }, lines, 15)).toBe(false)
    expect(zidReturnRefundsOrderFees({
      reverse_order_label_requests: [{ reverse_total: 316, refund_total: 316 }],
    }, lines, 15)).toBe(true)
  })

  it('excludes shipping from the credit when Zid reverses 316 but refunds only 301 SAR', () => {
    expect(zidReturnRefundsOrderFees({
      reverse_order_label_requests: [{
        id: 'QA-return-1', reverse_total: 316, refund_total: 301,
        products: [{ received_quantity: 1 }],
      }],
    })).toBe(false)
  })

  it('allows fee credit only when Zid explicitly refunds the full reversed amount', () => {
    expect(zidReturnRefundsOrderFees({
      reverse_order_label_requests: [{ reverse_total: 316, refund_total: 316 }],
    })).toBe(true)
  })

  it('supports completed requests nested under order', () => {
    expect(zidReturnRefundsOrderFees({
      order: { reverse_order_label_requests: [{ reverse_total: '316.00', refund_total: '316.00' }] },
    })).toBe(true)
  })

  it('fails closed for unreadable or missing financial totals', () => {
    expect(zidReturnRefundsOrderFees({ reverse_order_label_requests: [{ products: [] }] })).toBe(false)
    expect(zidReturnRefundsOrderFees({ reverse_order_label_requests: [] })).toBe(false)
    expect(zidReturnRefundsOrderFees({
      reverse_order_label_requests: [{ reverse_total: 316, refund_total: 'not-a-number' }],
    })).toBe(false)
  })

  it('does not include fees when any partial reversal excludes them', () => {
    expect(zidReturnRefundsOrderFees({
      reverse_order_label_requests: [
        { id: 'one', reverse_total: 100, refund_total: 100 },
        { id: 'two', reverse_total: 216, refund_total: 201 },
      ],
    })).toBe(false)
  })
})


describe('Zid missing-original negative-SO money safety', () => {
  const item = [{ storeProductId: 'p1', sku: 'QA', quantity: 1, priceUnit: 301 }]

  it('refunds only the 301 SAR product even when 316 SAR was reversed', () => {
    expect(verifiedZidFallbackRefundTotal({
      reverse_order_label_requests: [{ id: 'r1', reverse_total: 316, refund_total: 301 }],
    }, item)).toBe(301)
  })

  it('blocks a second, unrefunded 15 SAR shipping charge before an Odoo write', () => {
    expect(() => verifiedZidFallbackRefundTotal({
      reverse_order_label_requests: [{ id: 'r1', reverse_total: 316, refund_total: 301 }],
    }, item, 15)).toThrow('return_fallback_refund_total_mismatch_requires_review')
  })

  it('allows 15 SAR shipping when the completed receipt actually refunds it', () => {
    expect(verifiedZidFallbackRefundTotal({
      reverse_order_label_requests: [{ reverse_total: 316, refund_total: 316 }],
    }, item, 15)).toBe(316)
  })

  it('adds original Zid VAT, not a second implicit VAT on an exempt order', () => {
    expect(verifiedZidFallbackRefundTotal({
      reverse_order_label_requests: [{ reverse_total: 301, refund_total: 301 }],
    }, [{ ...item[0], priceUnit: 261.74, taxAmountPerUnit: 39.26 }])).toBe(301)
  })

  it('deduplicates repeated requests but sums distinct cumulative receipts', () => {
    expect(verifiedZidFallbackRefundTotal({
      reverse_order_label_requests: [
        { id: 'one', refund_total: 301 },
        { id: 'one', refund_total: 301 },
        { id: 'two', refund_total: 301 },
      ],
    }, [{ ...item[0], quantity: 2 }])).toBe(602)
  })

  it('rejects missing or invalid source monetary amounts', () => {
    expect(() => verifiedZidFallbackRefundTotal({}, item)).toThrow('return_fallback_refund_total_missing')
    expect(() => verifiedZidFallbackRefundTotal({
      reverse_order_label_requests: [{ refund_total: null }],
    }, item)).toThrow('return_fallback_refund_total_missing')
    expect(() => verifiedZidFallbackRefundTotal({
      reverse_order_label_requests: [{ refund_total: 99 }],
    }, item)).toThrow('return_fallback_refund_total_mismatch_requires_review')
  })
})
