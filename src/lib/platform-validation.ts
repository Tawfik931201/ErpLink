/**
 * Strict validation for upstream platform data BEFORE it reaches the sync
 * engine / Odoo. A compromised or malformed store payload must be rejected
 * at the door, never written as a price/status/qty.
 */

export interface PlatformValidation {
  ok: boolean
  error?: string
}

const MAX_PRICE = 10_000_000
const MAX_QTY = 1_000_000

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Price must be a finite non-negative number within a sane ceiling. */
export function validatePrice(value: unknown): PlatformValidation {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (!isFiniteNumber(n) || n < 0 || n > MAX_PRICE) {
    return { ok: false, error: 'invalid_price' }
  }
  return { ok: true }
}

/** Quantity must be a finite number within a sane range (integer-ish). */
export function validateQuantity(value: unknown): PlatformValidation {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (!isFiniteNumber(n) || Math.abs(n) > MAX_QTY) {
    return { ok: false, error: 'invalid_quantity' }
  }
  return { ok: true }
}

const STATUS_RE = /^[a-zA-Z0-9_.\-:]{1,64}$/

/** Status strings: allowlist shape only (letters/digits/_ . - :). */
export function validateStatus(value: unknown): PlatformValidation {
  if (typeof value !== 'string' || !STATUS_RE.test(value)) {
    return { ok: false, error: 'invalid_status' }
  }
  return { ok: true }
}

/**
 * Order payload guard used by webhook ingress: when an order event carries
 * `items`, every line must have a valid price and quantity. An order without
 * items is NOT rejected here (thin payloads are enriched in the worker) —
 * but an order WITH broken lines is.
 */
export function validateOrderLines(items: unknown, platform?: 'salla'): PlatformValidation {
  if (items === undefined || items === null) return { ok: true }
  if (!Array.isArray(items)) return { ok: false, error: 'invalid_items_shape' }
  for (const line of items.slice(0, 500)) {
    const l = line as Record<string, unknown>
    if (!l || typeof l !== 'object') return { ok: false, error: 'invalid_line_shape' }
    const amounts = l.amounts as { price_without_tax?: unknown } | undefined
    let price = (platform === 'salla' ? amounts?.price_without_tax : undefined) ?? l.price ?? l.total ?? l.unit_price
    if (platform === 'salla' && price && typeof price === 'object' && 'amount' in price) price = price.amount
    const qty = l.quantity ?? l.qty ?? l.count
    if (price !== undefined) {
      const r = validatePrice(price)
      if (!r.ok) return r
    }
    if (qty !== undefined) {
      const r = validateQuantity(qty)
      if (!r.ok) return r
    }
  }
  return { ok: true }
}
