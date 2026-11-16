export function readShopifyProductVariants(payload: Record<string, unknown>): unknown[] {
  if (Array.isArray(payload.variants) && payload.variants.length > 0) return payload.variants
  return Array.isArray(payload.options) ? payload.options : []
}

export function readShopifyVariantAttributes(payload: any, variant: any): Record<string, string> {
  const attributes: Record<string, string> = {}
  const options = payload.options || []
  if (variant.option1 && options[0]) attributes[options[0].name] = variant.option1
  if (variant.option2 && options[1]) attributes[options[1].name] = variant.option2
  if (variant.option3 && options[2]) attributes[options[2].name] = variant.option3
  return attributes
}
