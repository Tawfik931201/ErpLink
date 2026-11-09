/**
 * Zid bundle (dynamic_bundle) support — pure helpers, no I/O.
 *
 * A dynamic bundle is NOT stocked: the bundle itself is recorded in Odoo as a
 * service product and its selling price lives on that single line. The items
 * the customer picked are recorded as normal products whose order lines carry
 * price 0 and the real quantities (for picking/delivery), plus a formatted
 * components list in the bundle's Internal Notes.
 *
 * These helpers only read the Zid payload shape; resolution against Odoo
 * (findUniqueOrderLineProduct) happens in sync-engine.
 */

export interface BundleComponent {
  id: string | number | null
  sku: string
  barcode: string
  name: string
  quantity: number
}

const COMPONENT_KEYS = ['group_products', 'grouped_products', 'components', 'bundle_products'] as const

function localizedName(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const ar = typeof obj.ar === 'string' ? obj.ar : ''
    const en = typeof obj.en === 'string' ? obj.en : ''
    const first = Object.values(obj).find((v): v is string => typeof v === 'string')
    return (ar || en || first || '').trim()
  }
  return ''
}

function finiteQty(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
  return Number.isFinite(n) && n > 0 ? n : 1
}

/** True when the payload belongs to a Zid dynamic bundle. */
export function isDynamicBundle(data: Record<string, unknown> | null | undefined): boolean {
  if (!data || typeof data !== 'object') return false
  return String(data.product_class ?? '').trim() === 'dynamic_bundle'
}

/**
 * Components carried by a bundle payload, from whichever of the known keys
 * Zid used. Returns [] when the payload carries no components (e.g. a minimal
 * webhook body) — the caller then keeps only the bundle line.
 */
export function extractBundleComponents(
  data: Record<string, unknown> | null | undefined,
): BundleComponent[] {
  if (!data || typeof data !== 'object') return []
  let raw: unknown[] = []
  for (const key of COMPONENT_KEYS) {
    const value = (data as Record<string, unknown>)[key]
    if (Array.isArray(value) && value.length > 0) {
      raw = value
      break
    }
  }
  const out: BundleComponent[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const c = entry as Record<string, unknown>
    const item = (c.item && typeof c.item === 'object' ? c.item : {}) as Record<string, unknown>
    const id = c.item_id ?? item.id ?? c.id ?? c.product_id ?? null
    const sku = String(item.sku ?? c.sku ?? c.sku_code ?? c.default_code ?? '').trim()
    const barcode = String(item.barcode ?? c.barcode ?? '').trim()
    const name =
      localizedName(item.name ?? item.title) ||
      localizedName(c.name ?? c.title) ||
      (sku ? `[${sku}]` : '')
    out.push({
      id: typeof id === 'string' || typeof id === 'number' ? id : null,
      sku,
      barcode,
      name,
      quantity: finiteQty(c.quantity ?? c.qty ?? c.product_qty ?? item.quantity),
    })
  }
  return out
}

/**
 * The formatted Internal Notes text written onto the bundle product in Odoo.
 * Returns '' when there is nothing to list, so the caller never overwrites an
 * existing note with an empty string.
 */
export function formatBundleInternalNotes(
  data: Record<string, unknown> | null | undefined,
): string {
  const components = extractBundleComponents(data)
  if (components.length === 0) return ''
  const lines = components.map((c) => {
    const skuPart = c.sku ? ` (SKU: ${c.sku})` : ''
    return `• ${c.name || c.sku || '—'} ×${c.quantity}${skuPart}`
  })
  return ['بزمة ديناميكية — المكونات:', ...lines].join('\n')
}
