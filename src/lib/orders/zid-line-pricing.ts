/**
 * Zid order line amounts may contain BOTH per-item prices and line totals.
 * Never write discounted_total / total straight into Odoo price_unit when
 * quantity > 1: Odoo multiplies price_unit by quantity on its own.
 */
function parsePositiveAmount(raw: unknown): number {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? ((raw as Record<string, unknown>).amount ?? (raw as Record<string, unknown>).value)
    : raw
  if (typeof value !== 'string' && typeof value !== 'number') return 0
  const parsed = Number(String(value).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function firstNonnegative(data: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = data[key]
    if (raw === undefined || raw === null || raw === '') continue
    const value = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? ((raw as Record<string, unknown>).amount ?? (raw as Record<string, unknown>).value)
      : raw
    if (typeof value !== 'string' && typeof value !== 'number') continue
    const parsed = Number(String(value).replace(/[^0-9.\\-]/g, ''))
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return null
}

function firstPositive(data: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const amount = parsePositiveAmount(data[key])
    if (amount > 0) return amount
  }
  return 0
}

export function zidSaleUnitPrice(
  item: Record<string, unknown>,
  quantity: number,
  fallbackBaseUnit: number,
): number {
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1
  const explicitDiscountedUnit = firstNonnegative(item, [
    'net_sale_price', 'gross_sale_price', 'sale_price',
    'price_after_discount', 'discounted_price',
  ])
  if (explicitDiscountedUnit !== null) return explicitDiscountedUnit

  // A truly free discounted line has a discounted_total of zero. Do not
  // treat an omitted/placeholder zero as free unless Zid marks it discounted.
  const discountedLineTotal = firstNonnegative(item, ['discounted_total'])
  if (discountedLineTotal !== null &&
      (discountedLineTotal > 0 || item.is_discounted === true)) {
    return discountedLineTotal / qty
  }

  const explicitUnit = firstPositive(item, ['price', 'net_price', 'gross_price'])
  if (explicitUnit > 0) return explicitUnit

  const total = firstPositive(item, ['total'])
  if (total > 0) return total / qty
  return fallbackBaseUnit
}

/** A merchant mapping price_unit <- line total must be normalized too. */
export function normalizeMappedZidUnitPrice(
  mappedField: string | undefined,
  amount: unknown,
  quantity: number,
): unknown {
  if (!['total', 'total_before', 'discounted_total'].includes(mappedField ?? '')) return amount
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1
  return typeof amount === 'number' && Number.isFinite(amount) ? amount / qty : amount
}
