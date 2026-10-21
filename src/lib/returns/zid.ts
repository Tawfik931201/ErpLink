/**
 * Zid has no reversal webhook (only order.create / order.status.update /
 * order.payment_status.update), and the status payload carries no quantities.
 *
 * `GET /v1/managers/store/orders/{orderId}/view-for-return` is the documented
 * source of truth (docs.zid.sa, "Order Details – View for Return"):
 *
 *   { status, order: { id, code, order_status: { code }, products_count,
 *       products: [{ id, order_product_id, name, sku, quantity, price,
 *                    tax_percentage, total }], payment: { invoice: [...] } },
 *     message }
 *
 * Two documented rules decide the whole feature:
 *   1. `products[].quantity` IS the remaining returnable quantity
 *      (`remaining_quantity = original_quantity − sum(previous_returns)`).
 *      It is NOT the ordered quantity.
 *   2. The list contains ONLY products that can still come back; a fully
 *      reversed order answers `products: []`. An absent product therefore
 *      means "nothing left to return", not "unknown".
 *
 * An unrecognised envelope still reports `known: false` rather than "nothing
 * returned", because treating an unreadable payload as "everything is back"
 * would reverse the entire order in Odoo.
 */

import type { ZidCredentials } from '@/lib/zid-client'
import { ZidAPI } from '@/lib/zid-client'

import { extractZidRemainingLines, type StoreReturnLine } from './detect'

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null
}

export interface ZidReturnState {
  known: boolean
  lines: StoreReturnLine[]
}

export async function fetchZidReturnState(
  creds: ZidCredentials,
  orderId: string
): Promise<ZidReturnState> {
  const response = await ZidAPI.returns.viewForReturn(creds, String(orderId))
  const payload = asRecord(response?.data)
  const order = asRecord(payload?.order) ?? asRecord(payload?.data)
  // `products` must be an array for the answer to be authoritative: an empty
  // array is a valid "everything already returned", a missing one is not.
  if (!order || !Array.isArray(order.products)) return { known: false, lines: [] }
  return { known: true, lines: extractZidRemainingLines(payload) }
}
