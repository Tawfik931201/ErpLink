/** Pure platform variant normalization; preserves the existing fallback order. */

import { toNameString } from '@/lib/sync-helpers'

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
}

export function extractGenericVariants(payload: any, platform: 'zid' | 'salla' | 'shopify'): GenericVariant[] {
  if (!payload) return []

  // Locate the variants array (could be variants, options, or other variations)
  // NOTE: For Zid, payload.options contains option definitions, not variant products,
  // so Zid must strictly read payload.variants.
  let rawVariants = Array.isArray(payload.variants) && payload.variants.length > 0
    ? payload.variants
    : (platform !== 'zid' && Array.isArray(payload.options) && payload.options.length > 0 ? payload.options : [])

  // Shopify options check
  if (platform === 'shopify' && !Array.isArray(rawVariants)) {
    rawVariants = payload.variants || []
  }

  if (!Array.isArray(rawVariants) || rawVariants.length === 0) {
    return []
  }

  return rawVariants.map((v: any) => {
    const variantId = v.id || v.uuid || v.variant_id || ''
    const sku = v.sku || v.default_code || v.sku_code || ''
    const price = parseFloat(v.sale_price || v.price || v.regular_price || v.price_after_discount || '0') || 0
    const barcode = v.barcode || v.gtin || v.upc || undefined

    // Quantity mapping across platforms
    const quantity = v.quantity !== undefined
      ? Number(v.quantity)
      : (v.stock_quantity !== undefined
        ? Number(v.stock_quantity)
        : (v.inventory_quantity !== undefined
          ? Number(v.inventory_quantity)
          : undefined))

    const attributes: Record<string, string> = {}

    if (platform === 'shopify') {
      const options = payload.options || []
      if (v.option1 && options[0]) attributes[options[0].name] = v.option1
      if (v.option2 && options[1]) attributes[options[1].name] = v.option2
      if (v.option3 && options[2]) attributes[options[2].name] = v.option3
    } else {
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

    const cost = parseFloat(v.cost || v.cost_price || '0') || 0

    const rawWeight = v.weight ?? payload.weight
    let weight = 0
    if (typeof rawWeight === 'object' && rawWeight !== null) {
      weight = parseFloat((rawWeight as any).value ?? (rawWeight as any).weight ?? '0') || 0
    } else {
      weight = parseFloat(String(rawWeight ?? '0')) || 0
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
      image: variantImage || undefined
    }
  })
}
