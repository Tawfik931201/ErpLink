/**
 * Allocate cumulative returns by the actual sale.order.line ordering.
 *
 * Zid return receipts identify a product (not a specific Odoo sale.order.line).
 * A product may occur on multiple lines with distinct unit prices, discounts,
 * taxes, or analytics. Never apply a product's full cumulative quantity to
 * each line or refund a line more than its ordered quantity.
 */
type QuantityLine = { productId: number; orderedQty: number }
const EPSILON = 0.000001

function totalsByProduct(lines: readonly QuantityLine[]): Map<number, number> {
  const totals = new Map<number, number>()
  for (const line of lines) {
    const ordered = Math.abs(Number(line.orderedQty) || 0)
    if (!Number.isFinite(ordered)) throw new Error('return_original_quantity_invalid')
    totals.set(line.productId, (totals.get(line.productId) || 0) + ordered)
  }
  return totals
}

/** Full reversal is based on sum of EACH physical/regular line, not a per-line comparison against a product-wide target. */
export function isCumulativeFullReturn(
  regularLines: readonly QuantityLine[],
  targets: ReadonlyMap<number, number>,
): boolean {
  const totals = totalsByProduct(regularLines)
  return totals.size === 0 ||
    [...totals].every(([id, qty]) => (targets.get(id) || 0) + EPSILON >= qty)
}

/**
 * The ledger stores already-refunded quantities per product. Partition both
 * target and ledger along the original sale lines, yielding the incremental
 * quantity for each line without repeating previously refunded price bands.
 */
export function incrementalReturnLineQuantities(
  originalLines: readonly QuantityLine[],
  targets: ReadonlyMap<number, number>,
  ledger: ReadonlyMap<number, number>,
): number[] {
  const sold = totalsByProduct(originalLines)
  for (const [id, target] of targets) {
    if (!Number.isFinite(target) || target < 0 || target > (sold.get(id) || 0) + EPSILON) {
      throw new Error('return_receipt_quantity_exceeds_original:' + id)
    }
  }
  const visited = new Map<number, number>()
  return originalLines.map(line => {
    const id = line.productId
    const ordered = Math.abs(Number(line.orderedQty) || 0)
    const before = visited.get(id) || 0
    visited.set(id, before + ordered)
    const planned = Math.min(ordered, Math.max(0, (targets.get(id) || 0) - before))
    const refunded = Math.min(ordered, Math.max(0, (ledger.get(id) || 0) - before))
    return Math.max(0, planned - refunded)
  })
}
