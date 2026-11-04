import { resolvePath } from '@/lib/sync-helpers'

/** Empty/null prices are absent; zero is a real price, never a fallback signal. */
export function finiteProductNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

export function applyProductPriceSettings(
  values: Record<string, unknown>, settings: Record<string, any>, data: Record<string, unknown>,
): void {
  const cfg = settings.price
  if (!cfg) return
  // Select the source BEFORE applying markup; do not turn sale_price=null into 0.
  if (cfg.source) {
    const source = finiteProductNumber(resolvePath(data, cfg.source))
      ?? (cfg.source === 'sale_price' ? finiteProductNumber(data.price) : undefined)
    if (source !== undefined) values.list_price = source
  }
  if (cfg.cost_source) {
    const cost = finiteProductNumber(resolvePath(data, cfg.cost_source))
    if (cost !== undefined) values.standard_price = cost
  }
  const price = finiteProductNumber(values.list_price)
  if (price !== undefined) values.list_price = price * (1 + (finiteProductNumber(cfg.markup_percent) ?? 0) / 100)
  const decimals = finiteProductNumber(cfg.decimal_places)
  if (decimals === undefined || decimals < 0 || decimals > 10) return
  const round = cfg.rounding === 'nearest' ? Math.round : cfg.rounding === 'ceil' ? Math.ceil : cfg.rounding === 'floor' ? Math.floor : null
  if (!round) return
  const factor = 10 ** decimals
  for (const field of ['list_price', 'standard_price']) {
    const value = finiteProductNumber(values[field])
    if (value !== undefined) {
      const scaled = value * factor
      const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4
      values[field] = round(scaled + (cfg.rounding === 'ceil' ? -tolerance : tolerance)) / factor
    }
  }
}

/** Never apply stock to a service, an untracked item or an ERP-owned balance. */
export function shouldSyncProductStock(settings: Record<string, any>, data: Record<string, unknown>): boolean {
  const type = typeof settings.product_type === 'string' ? settings.product_type : settings.product_type?.default_type
  const allowed = type !== 'service' && settings.inventory?.track_inventory !== false
    && settings.inventory?.sync_enabled !== true && data.is_infinite !== true
  return allowed
}

export function assertProductWriteAllowed(settings: Record<string, any>, exists: boolean): void {
  const operation = exists ? 'update' : 'create'
  if (settings.disabled || (Array.isArray(settings.enabled_actions) && !settings.enabled_actions.includes(operation))) {
    throw new Error(`Product ${operation} is disabled in Standard Mapping settings`)
  }
}
