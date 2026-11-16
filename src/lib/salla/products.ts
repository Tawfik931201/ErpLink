import { toNameString } from '@/lib/sync-helpers'

export async function enrichSallaProduct(
  data: Record<string, unknown>,
  storeIdStr: string,
  entityId: unknown,
): Promise<Record<string, unknown>> {
  const { getSallaProduct } = await import('@/lib/salla-client')
  const full = await getSallaProduct(storeIdStr, String(entityId))
  if (full) data = { ...data, ...full }
  return data
}

export function readSallaProductVariants(payload: Record<string, unknown>) {
  const options = Array.isArray(payload.options) ? payload.options : []
  if (Array.isArray(payload.skus) && payload.skus.length > 0) {
    return { rows: payload.skus, options, fromSkus: true }
  }
  const rows = Array.isArray(payload.variants) && payload.variants.length > 0
    ? payload.variants
    : options.filter(option => !Array.isArray(option.values) &&
      (option.sku || option.sku_code || option.attributes || option.features || option.option_values))
  return { rows, options, fromSkus: false }
}

export function readSallaSkuAttributes(options: any[], variant: any): Record<string, string> {
  const attributes: Record<string, string> = {}
  const related = new Set((Array.isArray(variant.related_option_values) ? variant.related_option_values : []).map(String))
  const optionIds = new Set((Array.isArray(variant.related_options) ? variant.related_options : []).map(String))
  for (const option of options) {
    if (optionIds.size && !optionIds.has(String(option.id))) continue
    const name = toNameString(option.name)
    const selected = Array.isArray(option.values)
      ? option.values.find((value: any) => related.has(String(value.id)))
      : undefined
    const value = toNameString(selected?.name)
    if (name && value) attributes[name] = value
  }
  return attributes
}
