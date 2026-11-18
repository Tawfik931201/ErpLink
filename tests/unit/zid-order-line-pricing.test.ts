import { normalizeMappedZidUnitPrice, zidSaleUnitPrice } from '../../src/lib/orders/zid-line-pricing'

describe('Zid order line price_unit conversion', () => {
  it('does not charge the full line total again for qty > 1', () => {
    const item = {
      price: 501, net_price: 501, gross_price: 501,
      discounted_total: 1002, total: 1002,
      quantity: 2, is_discounted: false,
    }
    expect(zidSaleUnitPrice(item, 2, 501)).toBe(501)
    expect(zidSaleUnitPrice(item, 2, 501) * 2).toBe(1002)
  })

  it('uses the actual discounted unit when a line discount exists', () => {
    expect(zidSaleUnitPrice({
      price: 100, net_price: 100, discounted_total: 160,
      quantity: 2, is_discounted: true,
    }, 2, 100)).toBe(80)
    expect(zidSaleUnitPrice({
      price: 100, net_sale_price: 72, discounted_total: 160,
      quantity: 2, is_discounted: true,
    }, 2, 100)).toBe(72)
  })

  it('preserves a genuine fully discounted free item', () => {
    expect(zidSaleUnitPrice({
      price: 100, is_discounted: true, discounted_total: 0,
    }, 3, 100)).toBe(0)
  })

  it('does not consider an unset discount total of zero to mean free', () => {
    expect(zidSaleUnitPrice({
      price: 100, is_discounted: false, discounted_total: 0,
    }, 2, 100)).toBe(100)
  })

  it('divides line totals for a custom price_unit mapping too', () => {
    expect(normalizeMappedZidUnitPrice('discounted_total', 1002, 2)).toBe(501)
    expect(normalizeMappedZidUnitPrice('total', 1002, 2)).toBe(501)
    expect(normalizeMappedZidUnitPrice('total_before', 1002, 2)).toBe(501)
    expect(normalizeMappedZidUnitPrice('net_price', 501, 2)).toBe(501)
  })

  it('handles qty one, invalid qty and missing sale price', () => {
    expect(zidSaleUnitPrice({ price: 501, total: 501 }, 1, 501)).toBe(501)
    expect(zidSaleUnitPrice({ total: 1002 }, 2, 501)).toBe(501)
    expect(zidSaleUnitPrice({}, 0, 17)).toBe(17)
    expect(normalizeMappedZidUnitPrice('total', 501, 0)).toBe(501)
  })

  it('supports currency-formatted numeric strings', () => {
    expect(zidSaleUnitPrice({ discounted_total: '1,002.00 SAR' }, 2, 501)).toBe(501)
  })
})
