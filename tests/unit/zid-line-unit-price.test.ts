import fs from 'fs'
import path from 'path'
import { resolveZidLineUnitSalePrice } from '../../src/lib/orders/zid-line-unit-price'

describe('Zid order-line extended totals must never become unit prices', () => {
  it('regresses live order 502218442: 2 x 501, discounted_total 1002', () => {
    const unit = resolveZidLineUnitSalePrice(
      { sku: 'ERPFIX-QA1811-FIX01-L01', price: 501, net_price: 501, total: 1002, discounted_total: 1002, quantity: 2 },
      2,
      501,
    )
    expect(unit).toBe(501)
    expect(unit * 2).toBe(1002)
  })

  it('converts a discounted line total into the discounted unit price', () => {
    expect(resolveZidLineUnitSalePrice({ price: 65, discounted_total: 110, quantity: 2 }, 2, 65)).toBe(55)
  })

  it('prefers explicit sale unit price over totals and catalog price', () => {
    expect(resolveZidLineUnitSalePrice(
      { price: 100, sale_price: 80, discounted_total: 240, total: 300 }, 3, 100,
    )).toBe(80)
  })

  it('preserves regular unit price without discounted_total', () => {
    expect(resolveZidLineUnitSalePrice({ price: '501.00 SAR', total: '1,002.00 SAR' }, 2, 501)).toBe(501)
  })

  it('derives from total only when no unit price exists', () => {
    expect(resolveZidLineUnitSalePrice({ total: '300.00 SAR' }, 3, 0)).toBe(100)
  })

  it('handles missing/invalid quantity without division by zero', () => {
    expect(resolveZidLineUnitSalePrice({ discounted_total: 42 }, 0, 0)).toBe(42)
  })

  it('wires the runtime Zid branch to the tested helper', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/odoo/order-lines.ts'), 'utf8')
    expect(src).toContain("platform === 'zid'")
    expect(src).toContain('resolveZidLineUnitSalePrice(productData, qty, zidPrice)')
  })
})
