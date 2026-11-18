/**
 * Zid sends discounted_total and total as EXTENDED line amounts, not unit prices.
 * A line with quantity=2, price=501 and discounted_total=1002 must sync to
 * sale.order.line(price_unit=501, product_uom_qty=2), not price_unit=1002.
 *
 * Keep this source-only helper independent of Odoo model fields (14–20).
 */
type ZidOrderItem = Record<string, unknown>

function positiveAmount(source: ZidOrderItem, key: string): number {
  let raw: unknown = source[key]
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const nested = raw as Record<string, unknown>
    raw = nested.amount ?? nested.value ?? nested.price ?? nested.total
  }
  if (raw == null || typeof raw === 'object') return 0
  const value = Number.parseFloat(String(raw).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(value) && value > 0 ? value : 0
}

function firstPositive(source: ZidOrderItem, keys: readonly string[]): number {
  for (const key of keys) {
    const value = positiveAmount(source, key)
    if (value > 0) return value
  }
  return 0
}

export function resolveZidLineUnitSalePrice(
  item: ZidOrderItem,
  quantity: number,
  fallbackUnitPrice: number,
): number {
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1

  // Explicit unit-price fields take precedence over extended line totals.
  const explicitUnit = firstPositive(item, [
    'net_sale_price', 'gross_sale_price', 'sale_price',
    'price_after_discount', 'discounted_price',
  ])
  if (explicitUnit > 0) return explicitUnit

  // This is a *line total*. Divide by quantity exactly once.
  const discountedLineTotal = positiveAmount(item, 'discounted_total')
  if (discountedLineTotal > 0) return discountedLineTotal / qty

  const regularUnit = positiveAmount(item, 'price')
  if (regularUnit > 0) return regularUnit

  const lineTotal = positiveAmount(item, 'total')
  if (lineTotal > 0) return lineTotal / qty

  return fallbackUnitPrice
}
