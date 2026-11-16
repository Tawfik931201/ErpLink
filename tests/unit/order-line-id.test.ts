import fs from 'fs'
import path from 'path'

import { SALLA_FIELDS } from '@/lib/platforms/salla/fields'
import { SHOPIFY_FIELDS } from '@/lib/platforms/shopify/fields'
import { ZID_FIELDS } from '@/lib/platforms/zid/fields'

/**
 * Order-line `id` pins (custom mapping page, /app/mapping-center/custom).
 *
 * On the sale.order.line tab the source dropdown must offer the line item's
 * `id` — for every platform and every order event/operation, since the
 * catalogue is keyed by model, not by event. The engine already reads any
 * mapped path from each item generically
 * (`resolvePath(productData, fm.zidField)` over the products / items /
 * line_items candidates), so no engine change was needed — only the
 * catalogues and the tab wiring were missing:
 *
 * - Zid/Salla `sale.order.line` catalogues had no `id` entry.
 * - Shopify had no `sale.order.line` catalogue at all (its order topics only
 *   carry header fields — no sku/quantity/price/title either), so custom
 *   line mappings for Shopify had nothing line-specific to pick.
 * - The form's shared resolver is header-oriented; the line tab needs an
 *   explicit branch to the per-platform line catalogue.
 */

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('sale.order.line catalogues offer the line id', () => {
  it.each([
    ['zid', ZID_FIELDS],
    ['salla', SALLA_FIELDS],
    ['shopify', SHOPIFY_FIELDS],
  ] as const)('%s offers id as the first line source field', (_platform, fields) => {
    const lineFields = fields['sale.order.line']
    expect(lineFields).toBeDefined()
    expect(lineFields.length).toBeGreaterThan(0)
    expect(lineFields[0].value).toBe('id')
  })
})

describe('shopify line catalogue covers the documented line_items shape', () => {
  // Field names verified against the Shopify Admin REST webhook reference
  // (orders/fulfilled + carts/update payloads): line_items[] carry id,
  // variant_id, product_id, title, sku, quantity, price, ...
  const values = new Set(SHOPIFY_FIELDS['sale.order.line'].map((f) => f.value))

  it.each([
    'id',
    'variant_id',
    'product_id',
    'title',
    'sku',
    'quantity',
    'price',
  ])('offers %s', (field) => {
    expect(values.has(field)).toBe(true)
  })
})

describe('line tab wiring (source pins)', () => {
  const form = read('src/app/(app)/app/mapping-center/field-mapping-form.tsx')

  it('branches the sale.order.line tab to the per-platform line catalogue', () => {
    // Checked to fail before the fix: the shared resolver only knew header
    // keys, so the line tab showed header fields for every platform.
    expect(form).toContain("currentModelKey === 'sale.order.line'")
    expect(form).toContain("SALLA_FIELDS['sale.order.line']")
    expect(form).toContain("SHOPIFY_FIELDS['sale.order.line']")
    expect(form).toContain("ZID_FIELDS['sale.order.line']")
  })

  it('leaves the header match-field dropdowns on header fields', () => {
    // The branch must serve the line tab's source list only — the primary
    // match dropdowns keep using resolvePlatformFields (header keys).
    expect(form).toContain('primaryMatchZidFields')
    expect(form).toContain('resolvePlatformFields(zidEvent, platform, activeTab, odooModel.toLowerCase(), odooModel)')
  })
})

describe('engine reads mapped line paths generically (source pin)', () => {
  it('resolves each line mapping through resolvePath on the item object', () => {
    // This is what makes a newly offered `id` work with zero engine
    // changes: any zidField path (incl. `id`) is read off the line item.
    // If this ever becomes a hardcoded field list, the catalogue `id`
    // silently stops resolving.
    const engine = read('src/lib/odoo/order-lines.ts')
    expect(engine).toContain('resolvePath(productData, fm.zidField)')
  })
})
