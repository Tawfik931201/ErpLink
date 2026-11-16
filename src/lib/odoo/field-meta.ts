import type { OdooClient } from '@/lib/odoo-client';
import type { OdooFieldMeta } from '@/lib/sync-types';
import { ttlCache } from '@/lib/ttl-cache';

// ─── Helper: fetch Odoo field metadata (ttype + relation) for a model ─────────
export async function fetchFieldMeta(
  client: OdooClient,
  model: string,
  fieldNames: string[]
): Promise<Map<string, OdooFieldMeta>> {
  try {
    const rows = await client.execute<Array<{ name: string; ttype: string; relation: string }>>(
      'ir.model.fields',
      'search_read',
      [[['model', '=', model], ['name', 'in', fieldNames]]],
      { fields: ['name', 'ttype', 'relation'] }
    )
    const map = new Map<string, OdooFieldMeta>()
    for (const r of rows) map.set(r.name, r)
    console.info(`[SyncEngine] Fetched field meta for [${fieldNames.join(', ')}]:`,
      rows.map(r => `${r.name}(${r.ttype}${r.relation ? '→' + r.relation : ''})`).join(', '))
    return map
  } catch (err) {
    console.warn('[SyncEngine] Could not fetch field meta, will skip relational resolution:', err)
    return new Map()
  }
}

// ─── Helper: known selection keys of a sale.order custom field ──────────────
// The order custom-status feature writes the platform status string into a
// Selection field (x_zid_order_status / x_salla_order_status). Odoo validates
// selection values on write — an unmapped status (e.g. a Salla shipment slug
// like "in_progress", or raw Arabic text) would fail the WHOLE order create
// with a ValidationError. So both injection sites check membership first and
// skip unknown values with a warning instead of killing the sync.
// Returns null when the options cannot be read (fail-open: inject as before,
// preserving the old behaviour in degraded mode). Cached 10 min per field.
const SELECTION_KEYS_TTL_MS = 10 * 60 * 1000

export async function getSaleOrderSelectionKeys(
  client: OdooClient,
  workspaceId: string,
  fieldName: string
): Promise<Set<string> | null> {
  try {
    return await ttlCache.get<Set<string> | null>(
      `selopts:${workspaceId}:sale.order:${fieldName}`,
      SELECTION_KEYS_TTL_MS,
      async () => {
        const rows = await client.execute<Array<{ selection?: string }>>(
          'ir.model.fields',
          'search_read',
          [[['model', '=', 'sale.order'], ['name', '=', fieldName]]],
          { fields: ['selection'], limit: 1 }
        )
        const sel = rows?.[0]?.selection
        if (!sel) return null
        const keys = new Set<string>()
        const regex = /\('([^']+)',\s*'([^']+)'\)/g
        let match: RegExpExecArray | null
        while ((match = regex.exec(sel)) !== null) keys.add(match[1])
        return keys.size > 0 ? keys : null
      }
    )
  } catch {
    return null
  }
}

export const HARDCODED_FIELD_META: Record<string, { ttype: string; relation?: string }> = {
  image_1920: { ttype: 'binary' },
  image_1024: { ttype: 'binary' },
  image_512: { ttype: 'binary' },
  image_256: { ttype: 'binary' },
  image_128: { ttype: 'binary' },
  image_variant_1920: { ttype: 'binary' },
  // Product fields
  default_code: { ttype: 'char' },
  barcode: { ttype: 'char' },
  name: { ttype: 'char' },
  description: { ttype: 'text' },
  description_sale: { ttype: 'text' },
  list_price: { ttype: 'float' },
  standard_price: { ttype: 'float' },
  weight: { ttype: 'float' },
  volume: { ttype: 'float' },
  sale_ok: { ttype: 'boolean' },
  purchase_ok: { ttype: 'boolean' },
  active: { ttype: 'boolean' },
  categ_id: { ttype: 'many2one', relation: 'product.category' },
  uom_id: { ttype: 'many2one', relation: 'uom.uom' },
  uom_po_id: { ttype: 'many2one', relation: 'uom.uom' },
  taxes_id: { ttype: 'many2many', relation: 'account.tax' },
  supplier_taxes_id: { ttype: 'many2many', relation: 'account.tax' },
  route_ids: { ttype: 'many2many', relation: 'stock.route' },
  // Variant fields
  attribute_line_ids: { ttype: 'one2many', relation: 'product.template.attribute.line' },
  product_variant_ids: { ttype: 'one2many', relation: 'product.product' },
  // Customer / res.partner fields
  street: { ttype: 'char' },
  street2: { ttype: 'char' },
  city: { ttype: 'char' },
  zip: { ttype: 'char' },
  country_id: { ttype: 'many2one', relation: 'res.country' },
  state_id: { ttype: 'many2one', relation: 'res.country.state' },
  email: { ttype: 'char' },
  phone: { ttype: 'char' },
  mobile: { ttype: 'char' },
  website: { ttype: 'char' },
  vat: { ttype: 'char' },
  company_type: { ttype: 'selection' },
  company_name: { ttype: 'char' },
  company_registry: { ttype: 'char' },
  customer_rank: { ttype: 'integer' },
  partner_id: { ttype: 'many2one', relation: 'res.partner' },
  partner_invoice_id: { ttype: 'many2one', relation: 'res.partner' },
  partner_shipping_id: { ttype: 'many2one', relation: 'res.partner' },
  // Order / sale.order fields
  order_line: { ttype: 'one2many', relation: 'sale.order.line' },
  amount_total: { ttype: 'monetary' },
  amount_untaxed: { ttype: 'monetary' },
  amount_tax: { ttype: 'monetary' },
  date_order: { ttype: 'datetime' },
  note: { ttype: 'text' },
  state: { ttype: 'selection' },
  // Category fields
  parent_id: { ttype: 'many2one', relation: 'product.category' },
  // Custom / X fields (commonly used)
  x_zid_id: { ttype: 'char' },
  x_salla_id: { ttype: 'char' },
  x_shopify_id: { ttype: 'char' },
  shopify_id: { ttype: 'char' },
  x_store_id: { ttype: 'char' },
  x_cr_no: { ttype: 'char' },
  x_payment_method: { ttype: 'char' },
  x_payment_status: { ttype: 'char' },
  x_shipping_fee: { ttype: 'float' },
}
