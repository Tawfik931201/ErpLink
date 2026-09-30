import {
  isSaudiShippingAddress,
  resolveZidCodAmount,
  resolveZidShippingCost,
  resolveZidStatus,
} from '@/lib/zid/order-helpers'

/**
 * These four helpers are pure functions that decide money and tax-relevant
 * values on every Zid order. They are the first thing extracted in the planned
 * platform split, so they are pinned here before any move.
 *
 * Source under test: src/lib/sync-engine.ts
 */

describe('resolveZidShippingCost', () => {
  it('reads the shipping row out of payment.invoice[]', () => {
    const cost = resolveZidShippingCost({
      payment: {
        invoice: [
          { code: 'items_total', title: 'Items', value: 100 },
          { code: 'shipping', title: 'Shipping fee', value: '25.50' },
        ],
      },
    })
    expect(cost).toBe(25.5)
  })

  it('matches an Arabic shipping title', () => {
    const cost = resolveZidShippingCost({
      payment: { invoice: [{ code: 'x', title: 'رسوم الشحن', value: 30 }] },
    })
    expect(cost).toBe(30)
  })

  it('falls back to the named paths when invoice[] is absent', () => {
    expect(resolveZidShippingCost({ shipping_cost: 15 })).toBe(15)
    expect(resolveZidShippingCost({ amounts: { shipping_cost: { amount: 12.25 } } })).toBe(12.25)
  })

  it('never returns the tax or total rows', () => {
    const cost = resolveZidShippingCost({
      payment: {
        invoice: [
          { code: 'tax', title: 'VAT', value: 15 },
          { code: 'total', title: 'Total', value: 999 },
        ],
      },
    })
    expect(cost).toBe(0)
  })

  it('returns 0 for an empty or malformed payload instead of throwing', () => {
    expect(resolveZidShippingCost({})).toBe(0)
    expect(resolveZidShippingCost({ payment: 'not-an-object' })).toBe(0)
    expect(resolveZidShippingCost({ payment: { invoice: 'nope' } })).toBe(0)
  })

  it('ignores a zero or negative shipping value', () => {
    const cost = resolveZidShippingCost({
      payment: { invoice: [{ code: 'shipping', title: 'Shipping', value: 0 }] },
    })
    expect(cost).toBe(0)
  })
})

describe('resolveZidCodAmount', () => {
  it('reads an explicit COD fee row', () => {
    const cod = resolveZidCodAmount({
      payment: { invoice: [{ code: 'cod', title: 'Cash on delivery', value: 12 }] },
    })
    expect(cod).toBe(12)
  })

  it('reads the Arabic COD label', () => {
    const cod = resolveZidCodAmount({
      payment: { invoice: [{ code: 'x', title: 'الدفع عند الاستلام', value: 9 }] },
    })
    expect(cod).toBe(9)
  })

  it('does NOT report the shipping row as a COD fee', () => {
    // The whole point of `notFeeRow`: shipping must never be double-counted.
    const cod = resolveZidCodAmount({
      payment: { invoice: [{ code: 'shipping', title: 'رسوم الشحن', value: 25 }] },
    })
    expect(cod).toBe(0)
  })

  it('falls back to named keys', () => {
    expect(resolveZidCodAmount({ cod_fee: 7 })).toBe(7)
    expect(resolveZidCodAmount({ payment: { payment_fee: 5.5 } })).toBe(5.5)
  })

  it('returns 0 when Zid sends no COD fee at all', () => {
    expect(resolveZidCodAmount({})).toBe(0)
    expect(
      resolveZidCodAmount({ payment: { invoice: [{ code: 'total', value: 500 }] } })
    ).toBe(0)
  })

  it('never returns a negative or object value', () => {
    expect(resolveZidCodAmount({ cod_fee: -5 })).toBe(0)
    expect(resolveZidCodAmount({ cod_fee: { nested: 1 } })).toBe(0)
  })
})

describe('isSaudiShippingAddress', () => {
  it('accepts the ISO code, the long name and the Arabic name', () => {
    expect(isSaudiShippingAddress({ shipping_address: { country: 'SA' } })).toBe(true)
    expect(isSaudiShippingAddress({ shipping_address: { country: 'Saudi Arabia' } })).toBe(true)
    expect(
      isSaudiShippingAddress({ shipping_address: { country: 'المملكة العربية السعودية' } })
    ).toBe(true)
  })

  it('reads a structured country object', () => {
    expect(isSaudiShippingAddress({ shipping_address: { country: { code: 'SA' } } })).toBe(true)
  })

  it('rejects a non-Saudi country', () => {
    expect(isSaudiShippingAddress({ shipping_address: { country: 'EG' } })).toBe(false)
    expect(isSaudiShippingAddress({ shipping_address: { country: 'United Arab Emirates' } })).toBe(false)
  })

  it('falls back to the city when no country is present', () => {
    expect(isSaudiShippingAddress({ shipping_address: { city: 'Riyadh' } })).toBe(true)
    expect(isSaudiShippingAddress({ shipping_address: { city: 'جدة' } })).toBe(true)
  })

  it('defaults to true when the payload carries no address at all', () => {
    // Intentional: missing data must not silently flip the tax path.
    expect(isSaudiShippingAddress({})).toBe(true)
  })
})

describe('resolveZidStatus', () => {
  it('maps the Arabic Zid statuses to the internal keys', () => {
    expect(resolveZidStatus({ order_status: 'جديد' })).toBe('new')
    expect(resolveZidStatus({ order_status: 'جاري التجهيز' })).toBe('preparing')
    expect(resolveZidStatus({ order_status: 'تم التوصيل' })).toBe('delivered')
    expect(resolveZidStatus({ order_status: 'ملغي' })).toBe('cancelled')
    expect(resolveZidStatus({ order_status: 'مسترجع' })).toBe('reversed')
  })

  it('handles both spellings of the Arabic word for cancelled', () => {
    expect(resolveZidStatus({ order_status: 'تم الإلغاء' })).toBe('cancelled')
    expect(resolveZidStatus({ order_status: 'تم الالغاء' })).toBe('cancelled')
  })

  it('passes an English status through unchanged', () => {
    expect(resolveZidStatus({ order_status: 'ready' })).toBe('ready')
  })

  it('unwraps a structured status object', () => {
    expect(resolveZidStatus({ order_status: { code: 'delivered' } })).toBe('delivered')
  })

  it('falls back through the alternative status keys', () => {
    expect(resolveZidStatus({ display_status: 'جاهز' })).toBe('ready')
    expect(resolveZidStatus({ order: { order_status: 'تم الشحن' } })).toBe('delivered')
  })

  it('is case and whitespace insensitive', () => {
    expect(resolveZidStatus({ order_status: '  READY  ' })).toBe('ready')
  })

  it('returns an empty string when no status is present', () => {
    expect(resolveZidStatus({})).toBe('')
  })
})
