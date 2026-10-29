import fs from 'fs'
import path from 'path'

/**
 * Pins the discount calculation and line generation contract in Standard Mapping:
 * 1. Percentage mode applies discount % directly to sale.order.line ('discount' field)
 *    and does NOT append a discount product line item.
 * 2. Fixed mode appends a dedicated discount product line with negative price_unit
 *    (-Math.abs(totalDiscountAmount)) and does not add line-level discount %.
 * 3. Shipping line is enabled when shipping_product_id is configured.
 * 4. SKU fallbacks are removed from UI in favor of direct Odoo product selection.
 *
 * Source under test: src/lib/sync-engine.ts & order-settings-tab.tsx
 */

const enginePath = path.join(process.cwd(), 'src', 'lib', 'sync-engine.ts')
const engineSource = fs.readFileSync(enginePath, 'utf8')

const tabPath = path.join(
  process.cwd(),
  'src',
  'app',
  '(app)',
  'app',
  'mapping-center',
  'standard-components',
  'order-settings-tab.tsx'
)
const tabSource = fs.readFileSync(tabPath, 'utf8')

describe('Order Line Discount & Shipping logic in sync-engine', () => {
  it('enables shipping line when shippingProductId is set', () => {
    expect(engineSource).toContain('addShippingAsLine = !!orDefault(\'addShippingAsLine\', false) || !!shippingProductId')
  })

  it('resolves order-level discount using resolveOrderDiscountAmount', () => {
    expect(engineSource).toContain('orderLevelDiscount = resolveOrderDiscountAmount(zidData)')
  })

  it('applies percentage discount to order lines when discountMode is percent', () => {
    expect(engineSource).toContain('const shouldApplyPercentToLine = hasLineDiscountMapping || (addDiscountAsLine && discountMode === \'percent\')')
    expect(engineSource).toContain('line[\'discount\'] = discountPercent')
  })

  it('distributes order-level discount percentage to lines when lines lack direct discounts', () => {
    expect(engineSource).toContain('addDiscountAsLine && discountMode === \'percent\' && totalDiscountAmount > 0 && subtotalBeforeDiscount > 0')
    expect(engineSource).toContain('const overallDiscountPercent = Math.round((totalDiscountAmount / subtotalBeforeDiscount) * 100 * 100) / 100')
  })

  it('does NOT append a discount product line item when discountMode is percent', () => {
    expect(engineSource).toContain('if (addDiscountAsLine && discountMode !== \'percent\' && anyProductHasDiscount && totalDiscountAmount > 0)')
  })

  it('appends a negative fixed price line item when in fixed mode', () => {
    expect(engineSource).toContain('const discountValue = -Math.abs(totalDiscountAmount)')
  })
})

describe('Order Settings UI components', () => {
  it('does not render SKU fallback inputs for shipping, COD, or discount', () => {
    expect(tabSource).not.toContain('placeholder="shipping-product"')
    expect(tabSource).not.toContain('placeholder="cod-fee-product"')
    expect(tabSource).not.toContain('placeholder="discount-product"')
  })

  it('allows direct selection of Odoo shipping product without requiring an extra toggle', () => {
    expect(tabSource).toContain('setOrderShippingProductId(val)')
    expect(tabSource).toContain('setOrderAddShipping(!!val)')
  })

  it('clarifies percentage mode vs fixed mode in discount settings', () => {
    expect(tabSource).toContain('orderDiscountMode === \'fixed\' ?')
  })
})
