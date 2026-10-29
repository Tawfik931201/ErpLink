/**
 * Pure return-detection rules shared by the webhook engine and the tests.
 *
 * Kept import-free on purpose (like `telegram/link-code.ts`): the rules are
 * the part that is easy to get silently wrong, so they must be unit-testable
 * without a database, an Odoo client or a Supabase mock.
 *
 * Verified against the platforms' own documentation (2026-10-21):
 *   - Zid publishes NO return webhook. Its order events are only
 *     `order.create`, `order.status.update`, `order.payment_status.update`,
 *     and the documented `conditions` enum for a status update is
 *     new/preparing/ready/inDelivery/delivered/cancelled - `reversed` is not
 *     in it. The status VALUE can still be `reversed` /
 *     `partially_reversed`, so the return is detected from the order status
 *     plus `view-for-return`, and treated as a trigger only.
 *   - Salla publishes `order.refunded` and the `order.shipment.return.*`
 *     family. Real payloads carry `refunded_items` on the order object (probed
 *     in `webhook_inbox` on 2026-10-21), which is the cumulative refunded
 *     quantity per line - exactly what a credit note needs.
 */

export type ReturnMode = 'nothing' | 'negative_so' | 'stock_return_credit_note'

export type ReturnFallback = 'skip' | 'negative_so'

export interface ReturnSettings {
  mode: ReturnMode
  create_credit_note: boolean
  credit_note_journal_id: number | null
  fallback_when_missing: ReturnFallback
  reason: string
}

export const DEFAULT_RETURN_SETTINGS: ReturnSettings = {
  mode: 'nothing',
  create_credit_note: true,
  credit_note_journal_id: null,
  fallback_when_missing: 'skip',
  reason: '',
}

export interface StoreReturnLine {
  storeProductId: string
  sku: string
  quantity: number
  name?: string
  priceUnit?: number
}

const ZID_RETURN_STATUSES = new Set(['reversed', 'partially_reversed', 'reverse_in_progress'])

const ARABIC_STATUS_MAP: Record<string, string> = {
  'مسترجع': 'reversed',
  'مرتجع': 'reversed',
  'استرجاع': 'reversed',
  'مسترجع جزئيا': 'partially_reversed',
  'مسترجع جزئي': 'partially_reversed',
  'مرتجع جزئيا': 'partially_reversed',
  'مرتجع جزئي': 'partially_reversed',
  'جاري الاسترجاع': 'reverse_in_progress',
  'جاري الإرجاع': 'reverse_in_progress',
  'جاري ارجاع': 'reverse_in_progress',
  'refund': 'reversed',
  'refunded': 'reversed',
  'reverse': 'reversed',
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return ''
  return String(value).trim()
}

function toPositiveQty(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function firstText(source: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const text = toText(source[key])
    if (text) return text
  }
  return ''
}

function firstQty(source: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const qty = toPositiveQty(source[key])
    if (qty > 0) return qty
  }
  return 0
}

/**
 * Zid order status that means "goods came back". `reverse_in_progress` is
 * deliberately NOT treated as a completed return by itself - it is the
 * transient state before Zid finishes the reversal, and acting on it would
 * return goods that the merchant may still cancel.
 */
export function isZidReturnStatus(status: unknown, allowInProgress = false): boolean {
  const key = zidStatusKey(status).replace(/-/g, '_')
  if (!key) return false
  if (!allowInProgress && key.startsWith('reverse_in_progress')) return false
  return ZID_RETURN_STATUSES.has(key)
}

/**
 * Zid's order status appears as `{ code, name }` in the documented order
 * payload (`OrderForReturnSerializer.order_status`) and as `slug` in some
 * webhook builds. `code`/`slug`/`value` are stable machine keys; `name` is
 * localized ("مرتجع"), so it is only a last resort.
 */
function zidStatusKey(status: unknown): string {
  const record = asRecord(status)
  let raw = ''
  if (record) {
    raw = (
      toText(record.code) ||
      toText(record.slug) ||
      toText(record.value) ||
      toText(record.name)
    ).toLowerCase()
  } else {
    raw = toText(status).toLowerCase()
  }
  return ARABIC_STATUS_MAP[raw] || raw
}

function hasZidReturnLabelRequest(val: unknown): boolean {
  if (!val) return false
  if (Array.isArray(val)) return val.length > 0
  if (typeof val === 'object') return Object.keys(val as Record<string, unknown>).length > 0
  return false
}

export function isSallaReturnEvent(event: string): boolean {
  const key = String(event || '').toLowerCase()
  if (!key) return false
  if (key === 'order.refunded') return true
  return key === 'order.shipment.return.created'
}

/**
 * A return is detected from the EVENT/platform pair plus the payload.
 * `refunded_items` alone is not a trigger: it is also present (empty) on
 * every ordinary order, and a non-empty value on an `order.updated` means a
 * refund that may already have been processed by `order.refunded`.
 */
export function isReturnSignal(
  platform: 'zid' | 'salla' | 'shopify',
  event: string,
  data: Record<string, unknown> | null | undefined
): boolean {
  if (platform === 'zid') {
    const ev = String(event || '').toLowerCase()
    if (ev.includes('reversed') || ev.includes('refund') || ev.includes('return')) return true
    if (!data) return false
    if (
      hasZidReturnLabelRequest(data.reverse_order_label_request) ||
      hasZidReturnLabelRequest(data.reverse_order_label_requests)
    ) {
      return true
    }
    const nestedOrder = asRecord(data.order)
    if (
      hasZidReturnLabelRequest(nestedOrder?.reverse_order_label_request) ||
      hasZidReturnLabelRequest(nestedOrder?.reverse_order_label_requests)
    ) {
      return true
    }
    // Check all standard and custom Zid status locations (including Arabic display names)
    const status =
      data.order_status ??
      nestedOrder?.order_status ??
      data.display_status ??
      nestedOrder?.display_status ??
      data.status ??
      nestedOrder?.status ??
      data.financial_status ??
      data.orderStatus ??
      data.current_status ??
      data.new_status ??
      data.order_status_code
    return isZidReturnStatus(status, true)
  }
  if (platform === 'salla') {
    if (isSallaReturnEvent(event)) return true
    const nestedOrder = asRecord(data?.order)
    const items = collectRefundedItems(data) ?? collectRefundedItems(nestedOrder)
    return Array.isArray(items) && items.length > 0
  }
  return false
}

export function collectRefundedItems(
  source: Record<string, unknown> | null | undefined
): unknown[] | null {
  if (!source) return null
  const direct = source.refunded_items
  if (Array.isArray(direct)) return direct
  const nestedOrder = asRecord(source.order)
  if (nestedOrder && Array.isArray(nestedOrder.refunded_items)) {
    return nestedOrder.refunded_items as unknown[]
  }
  return null
}

function extractLinesFromArray(items: unknown[]): StoreReturnLine[] {
  const lines: StoreReturnLine[] = []
  for (const raw of items) {
    const item = asRecord(raw)
    if (!item) continue
    const product = asRecord(item.product) ?? asRecord(item.item) ?? {}
    const storeProductId = firstText(item, ['product_id', 'store_product_id']) ||
      firstText(product, ['id']) ||
      firstText(item, ['id'])
    const sku = firstText(item, ['sku', 'product_sku']) || firstText(product, ['sku'])
    const quantity = firstQty(item, [
      'quantity',
      'qty',
      'refunded_quantity',
      'returned_quantity',
      'return_quantity',
    ])
    if (!storeProductId && !sku) continue
    if (quantity <= 0) continue
    lines.push({
      storeProductId,
      sku,
      quantity,
      name: firstText(item, ['name', 'product_name']) || firstText(product, ['name']) || undefined,
      priceUnit:
        toPositiveQty(item.price_unit) ||
        toPositiveQty(asRecord(item.amounts)?.price_without_tax) ||
        toPositiveQty(asRecord(item.amounts)?.total) ||
        undefined,
    })
  }
  return lines
}

/** Salla: cumulative refunded quantities, from a real `refunded_items` array. */
export function extractSallaRefundedLines(
  data: Record<string, unknown> | null | undefined
): StoreReturnLine[] {
  const items = collectRefundedItems(data)
  return items ? extractLinesFromArray(items) : []
}

const ZID_LINE_ARRAY_KEYS = ['products', 'items', 'order_products'] as const

/**
 * Zid: remaining returnable quantities from `view-for-return`.
 *
 * Documented shape (2026-10-21, docs.zid.sa "Order Details – View for Return"):
 *
 *   order.products[] = { id (order-product UUID), order_product_id (integer),
 *                        name, sku, quantity, price, tax_percentage, total }
 *
 * `quantity` is the REMAINING quantity, not the ordered one. `id` is the
 * order-product UUID and `order_product_id` is its integer handle - neither is
 * the store product id, so product resolution goes through `sku` (the only
 * stable product key the endpoint returns).
 *
 * Rows with `quantity: 0` are kept: they still tell the caller "this product is
 * fully returned", which is different from "this product was not mentioned".
 */
export function extractZidRemainingLines(
  payload: Record<string, unknown> | null | undefined
): StoreReturnLine[] {
  if (!payload) return []
  const candidates: unknown[] = [payload]
  for (const key of ['data', 'order', 'result']) {
    const nested = asRecord(payload[key])
    if (nested) candidates.push(nested)
  }
  for (const container of candidates) {
    const record = asRecord(container)
    if (!record) continue
    for (const key of ZID_LINE_ARRAY_KEYS) {
      const arr = record[key]
      if (!Array.isArray(arr)) continue
      const lines: StoreReturnLine[] = []
      for (const raw of arr) {
        const item = asRecord(raw)
        if (!item) continue
        const product = asRecord(item.product) ?? {}
        const storeProductId =
          firstText(item, ['product_uuid', 'product_id', 'store_product_id']) ||
          firstText(product, ['id'])
        const sku = firstText(item, ['sku', 'product_sku']) || firstText(product, ['sku'])
        // `quantity` = remaining. The other names are tolerated in case a
        // custom build renames it, but the documented one comes first.
        const quantity =
          firstQty(item, ['quantity', 'remaining_quantity', 'remaining', 'returnable_quantity'])
        if (!storeProductId && !sku) continue
        // `price` is tax-inclusive; Odoo computes tax from the line's taxes,
        // so the net unit is what must be written when there is no mapping.
        const gross = toPositiveQty(item.price) || toPositiveQty(item.price_unit)
        const taxRate = Number(item.tax_percentage)
        const net =
          gross > 0 && Number.isFinite(taxRate) && taxRate > 0
            ? Math.round((gross / (1 + taxRate)) * 1e6) / 1e6
            : gross
        lines.push({
          storeProductId,
          sku,
          quantity,
          name: firstText(item, ['name', 'product_name']) || firstText(product, ['name']) || undefined,
          priceUnit: net > 0 ? net : undefined,
        })
      }
      // An explicit, empty products array is meaningful for a fully reversed
      // order: it means "everything already came back", not "unknown".
      return lines
    }
  }
  return []
}

/**
 * Stable content signature for a cumulative return snapshot. Used as the
 * idempotency key so a redelivered webhook cannot apply the same return twice
 * after its `sync_queue` row settles (the dedup index only covers pending
 * rows). FNV-1a, because the module stays import-free.
 */
export function returnSnapshotSignature(lines: readonly StoreReturnLine[], extra = ''): string {
  const parts = lines
    .map(line => `${line.storeProductId || line.sku}:${line.quantity}`)
    .sort()
  let hash = 0x811c9dc5
  const input = `${extra}|${parts.join('|')}`
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function returnDedupeKey(platform: string, orderId: string, signature: string): string {
  return `${platform}:return:${orderId}:${signature}`
}
