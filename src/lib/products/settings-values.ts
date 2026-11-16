import { resolvePath } from '@/lib/sync-helpers'

/** Empty/null prices are absent; zero is a real price, never a fallback signal. */
export function finiteProductNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

export function sallaMoneyAmount(value: unknown): number | undefined {
  return finiteProductNumber(value && typeof value === 'object'
    ? (value as Record<string, unknown>).amount
    : value)
}

export function readSallaProductPrice(data: Record<string, unknown>, source: string): number | undefined {
  if (source === 'cost') return sallaMoneyAmount(data.cost_price) ?? sallaMoneyAmount(data.cost)
  return sallaMoneyAmount(resolvePath(data, source))
}

export function applyProductPriceSettings(
  values: Record<string, unknown>, settings: Record<string, any>, data: Record<string, unknown>,
  platform?: 'zid' | 'salla' | 'shopify',
): void {
  const cfg = settings.price
  if (!cfg) return
  const read = (source: string) => platform === 'salla'
    ? readSallaProductPrice(data, source)
    : finiteProductNumber(resolvePath(data, source))
  // Select the source BEFORE applying markup; do not turn sale_price=null into 0.
  if (cfg.source) {
    const selected = read(cfg.source)
    // Honor Salla's explicit no-promotion flag without discarding a real zero.
    const source = (platform === 'salla' && cfg.source === 'sale_price' && data.has_special_price === false
      ? undefined : selected) ?? (cfg.source === 'sale_price' ? read('price') : undefined)
    if (source !== undefined) values.list_price = source
    else if (platform === 'salla') delete values.list_price
  }
  // 'none' = "Don't update cost": never write values.standard_price, so the
  // client's Odoo cost stays untouched even when Zid sends a cost value.
  if (cfg.cost_source && cfg.cost_source !== 'none') {
    const cost = read(cfg.cost_source)
    if (cost !== undefined) values.standard_price = cost
    else if (platform === 'salla') delete values.standard_price
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
export function shouldSyncProductStock(
  settings: Record<string, any>, data: Record<string, unknown>, platform?: 'zid' | 'salla' | 'shopify',
): boolean {
  const type = typeof settings.product_type === 'string' ? settings.product_type : settings.product_type?.default_type
  const allowed = type !== 'service' && settings.inventory?.track_inventory !== false
    && settings.inventory?.sync_enabled !== true && data.is_infinite !== true
    && !(platform === 'salla' && data.unlimited_quantity === true)
  return allowed
}

export function assertProductWriteAllowed(settings: Record<string, any>, exists: boolean): void {
  const operation = exists ? 'update' : 'create'
  if (settings.disabled || (Array.isArray(settings.enabled_actions) && !settings.enabled_actions.includes(operation))) {
    throw new Error(`Product ${operation} is disabled in Standard Mapping settings`)
  }
}
