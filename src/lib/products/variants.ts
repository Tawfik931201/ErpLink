/** Pure platform variant normalization; preserves the existing fallback order. */

import { readSallaProductVariants, readSallaSkuAttributes } from '@/lib/salla/products'
import { readShopifyProductVariants, readShopifyVariantAttributes } from '@/lib/shopify/products'
import { toNameString } from '@/lib/sync-helpers'
import { readZidProductVariants } from '@/lib/zid/products'

import { finiteProductNumber, readSallaProductPrice } from './settings-values'

export interface GenericVariant {
  id: string | number
  sku: string
  price: number
  barcode?: string
  quantity?: number
  product_id?: string | number
  attributes: Record<string, string> // e.g. { Color: "Red", Size: "Large" }
  cost?: number
  weight?: number
  description?: string
  image?: string // URL or base64 of variant image
  /** Original fields are needed for configured price/cost/language sources. */
  source?: Record<string, unknown>
}

/** Odoo's automatic attribute lines generate the Cartesian product. */
export function assertSallaVariantCombinations(variants: GenericVariant[]): void {
  const attributes = new Map<string, Set<string>>()
  const combinations = new Set<string>()
  const normalize = (value: string) => value.trim().toLowerCase()
  for (const variant of variants) {
    const entries = Object.entries(variant.attributes).map(([key, value]) => [normalize(key), normalize(value)])
    const related = variant.source?.related_option_values
    if (!entries.length || (Array.isArray(related) && related.length !== entries.length)) {
      throw new Error(`Missing Salla option values for SKU ${variant.sku || variant.id}`)
    }
    for (const [key, value] of entries) {
      const values = attributes.get(key) ?? new Set<string>()
      values.add(value)
      attributes.set(key, values)
    }
    combinations.add(JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b))))
  }
  const expected = [...attributes.values()].reduce((total, values) => total * values.size, 1)
  if (expected !== variants.length || combinations.size !== variants.length ||
      variants.some(variant => Object.keys(variant.attributes).length !== attributes.size)) {
    throw new Error('Odoo would generate extra or duplicate Salla variants. Use separate products in Standard Mapping for this product.')
  }
}

export function extractGenericVariants(payload: any, platform: 'zid' | 'salla' | 'shopify'): GenericVariant[] {
  if (!payload) return []

  const salla = platform === 'salla' ? readSallaProductVariants(payload) : undefined
  const rawVariants = salla ? salla.rows
    : platform === 'shopify' ? readShopifyProductVariants(payload)
    : readZidProductVariants(payload)

  if (!Array.isArray(rawVariants) || rawVariants.length === 0) {
    return []
  }

  return rawVariants.map((v: any) => {
    const variantId = v.id || v.uuid || v.variant_id || ''
    const sku = v.sku || v.default_code || v.sku_code || ''
    const price = (platform === 'salla'
      ? readSallaProductPrice(v, 'price') ?? readSallaProductPrice(v, 'regular_price') ??
        (v.has_special_price === false ? undefined : readSallaProductPrice(v, 'sale_price'))
      : finiteProductNumber(v.sale_price ?? v.price ?? v.regular_price ?? v.price_after_discount)) ?? 0
    const barcode = v.barcode || v.gtin || v.upc || undefined

    // Quantity mapping across platforms
    const quantity = finiteProductNumber(v.quantity ?? v.stock_quantity ?? v.inventory_quantity)

    let attributes: Record<string, string>
    if (salla?.fromSkus) {
      attributes = readSallaSkuAttributes(salla.options, v)
    } else if (platform === 'shopify') {
      attributes = readShopifyVariantAttributes(payload, v)
    } else {
      attributes = {}
      const rawAttrs = v.attributes || v.features || v.option_values || []
      if (Array.isArray(rawAttrs)) {
        rawAttrs.forEach((attr: any) => {
          const attrName = toNameString(attr.name || attr.label || attr.option_name || attr.option_label || attr.slug)
          const attrVal = toNameString(attr.value || attr.value_name || attr.option_value || attr.option_value_name || attr.val || attr.text)
          if (attrName && attrVal) {
            attributes[attrName] = attrVal
          }
        })
      } else if (rawAttrs && typeof rawAttrs === 'object') {
        Object.entries(rawAttrs).forEach(([key, val]) => {
          const attrName = key
          const attrVal = toNameString(val)
          if (attrName && attrVal) {
            attributes[attrName] = attrVal
          }
        })
      }
    }

    const cost = platform === 'salla' ? readSallaProductPrice(v, 'cost') : finiteProductNumber(v.cost ?? v.cost_price)

    const rawWeight = v.weight ?? payload.weight
    let weight: number | undefined
    if (typeof rawWeight === 'object' && rawWeight !== null) {
      weight = finiteProductNumber((rawWeight as any).value ?? (rawWeight as any).weight)
    } else {
      weight = finiteProductNumber(rawWeight)
    }

    const description = toNameString(v.description || payload.description || payload.short_description || payload.body_html || '')

    // Extract variant image URL from platform-specific formats
    const variantImage = v.image?.src || v.main_image || v.image_url
      || (Array.isArray(v.images) && v.images[0]?.url)
      || (Array.isArray(v.images) && typeof v.images[0] === 'string' ? v.images[0] : null)
      || (typeof v.image === 'string' ? v.image : null)
      || (typeof v.image?.url === 'string' ? v.image.url : null)
      || ''

    return {
      id: variantId,
      sku,
      price,
      barcode,
      quantity: isNaN(quantity as number) ? undefined : quantity,
      product_id: v.product_id || payload.id || payload.product_id || undefined,
      attributes,
      cost,
      weight,
      description,
      image: variantImage || undefined,
      source: v,
    }
  })
}
