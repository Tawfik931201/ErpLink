import { applyFixedSettingsToValues } from '@/lib/odoo/value-settings'
import type { OdooClient } from '@/lib/odoo-client'
import { allPlatformIdFieldNames } from '@/lib/platform-fields'
import { finiteProductNumber, readSallaProductPrice } from '@/lib/products/settings-values'
import type { GenericVariant } from '@/lib/products/variants'
import { resolveZidMatchValue, toNameString } from '@/lib/sync-helpers'

/** Build a variant using the same Standard Mapping settings as its parent. */
export async function buildVariantProductValues(
  client: OdooClient,
  parentValues: Record<string, unknown>,
  parentData: Record<string, unknown>,
  variant: GenericVariant,
  settings: Record<string, any>,
  platform: 'zid' | 'salla' | 'shopify',
  fixedMatch?: { odoo_field: string; zid_field: string },
): Promise<Record<string, any>> {
  const source = variant.source ?? { id: variant.id, sku: variant.sku, barcode: variant.barcode, price: variant.price, cost: variant.cost }
  const data: Record<string, unknown> = { ...parentData, ...source, id: variant.id, sku: variant.sku, barcode: variant.barcode }
  if (platform === 'salla') {
    data.price = readSallaProductPrice(source, 'price') ?? readSallaProductPrice(source, 'regular_price')
    data.sale_price = source.sale_price
    data.has_special_price = source.has_special_price
    data.cost_price = readSallaProductPrice(source, 'cost')
    data.cost = data.cost_price
  }
  const values: Record<string, any> = { ...parentValues }
  // A child must never carry its parent's external identity or barcode.
  for (const field of [...allPlatformIdFieldNames(), 'id', 'barcode', 'default_code']) delete values[field]
  if (fixedMatch?.odoo_field) delete values[fixedMatch.odoo_field]
  const attrs = Object.values(variant.attributes)
  values.name = `${toNameString(parentValues.name || parentData.name)} - ${attrs.length ? attrs.join(' - ') : String(variant.sku || variant.id)}`
  if (variant.sku) values.default_code = variant.sku
  if (variant.barcode) values.barcode = variant.barcode
  // Reset the transformed parent price before applying markup once.
  const rawPrice = finiteProductNumber(data.price)
  if (rawPrice !== undefined) values.list_price = rawPrice
  else delete values.list_price
  const cost = settings.price?.cost_source === 'none' ? undefined : finiteProductNumber(data.cost)
  if (cost !== undefined) values.standard_price = cost
  else if (platform === 'salla') delete values.standard_price
  if (variant.weight !== undefined) values.weight = variant.weight
  if (variant.description) values.description_sale = variant.description
  const major = await client.getMajorVersion()
  const result = await applyFixedSettingsToValues(values, settings, data, major, undefined, platform, 'product.template')
  // The configured parent language has already been selected; retain the suffix.
  result.name = values.name
  if (fixedMatch && fixedMatch.odoo_field !== 'id') {
    const match = resolveZidMatchValue(data, fixedMatch.zid_field)
    if (match !== undefined && match !== null && match !== '') result[fixedMatch.odoo_field] = String(match)
  }
  // Variant images are never synced (2026-11-09) — see the image note in
  // `applyFixedSettingsToValues`.
  return result
}
