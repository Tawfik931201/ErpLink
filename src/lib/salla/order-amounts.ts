import { resolvePath } from '../sync-helpers'

export const orderItemBasePriceKeys = ['price_before', 'net_price', 'gross_price', 'price', 'unit_price', 'amount']

export function readSallaAmount(value: unknown): number | undefined {
  const amount = value && typeof value === 'object' ? (value as { amount?: unknown }).amount : value
  if ((typeof amount !== 'number' && typeof amount !== 'string') || String(amount).trim() === '') return undefined
  const number = Number(amount)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

export function readSallaOrderDiscount(order: Record<string, unknown>): number | undefined {
  const discounts = resolvePath(order, 'amounts.discounts')
  if (!Array.isArray(discounts)) return undefined
  // discounted_shipping is already reflected in amounts.shipping_cost.
  return discounts.reduce((total, discount) => total + (readSallaAmount(discount?.discount) ?? 0), 0)
}

export function hasSallaItemPrice(item: Record<string, unknown>): boolean {
  return [
    'amounts.price_without_tax', ...orderItemBasePriceKeys, 'total_before', 'total', 'net_sale_price',
    'gross_sale_price', 'sale_price', 'price_after_discount', 'discounted_price', 'discounted_total',
  ].some(key => readSallaAmount(resolvePath(item, key)) !== undefined)
}

export function hasPricedSallaItems(items: unknown): boolean {
  return Array.isArray(items) && items.length > 0 && items.every(item => item && typeof item === 'object' && hasSallaItemPrice(item))
}
