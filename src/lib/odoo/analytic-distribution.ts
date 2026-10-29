/**
 * Pure analytic-distribution math shared by the Standard Mapping UI contract
 * and the sync engine.
 *
 * Odoo 17+ stores a distribution per sale.order.line in
 * `analytic_distribution` as `{ "<account_id>": <percentage> }`; Odoo <= 16
 * only has a single `analytic_account_id`. Nothing here talks to Odoo or the
 * database — the engine passes in the payload-derived keys and the field
 * availability it discovered.
 *
 * Rules are saved on `standard_mapping_settings.settings.order.analytic`:
 *   { enabled, rules: [{ condition, source_value, source_label,
 *                        odoo_analytic_account_id, percentage }] }
 *
 * Matching contract:
 * - `warehouse` and `payment` rules match independently;
 * - `all` rules are a general fallback and are used ONLY when no specific
 *   rule (warehouse or payment) matches;
 * - configured percentages are sent verbatim to Odoo without any
 *   re-normalisation or calculation (e.g. if merchant set 100, 100 is sent
 *   to every line; if 50, 50 is sent).
 */

export type AnalyticCondition = 'all' | 'warehouse' | 'payment'

export interface AnalyticRule {
  condition: AnalyticCondition
  source_value: string
  source_label: string
  odoo_analytic_account_id: number
  percentage: number
}

export interface AnalyticConfig {
  enabled: boolean
  rules: AnalyticRule[]
}

export interface AnalyticDistributionEntry {
  accountId: number
  percentage: number
}

export interface ResolveAnalyticInput {
  config?: unknown
  locationId?: string
  locationName?: string
  paymentKeys?: string[]
  /**
   * When true, returns the rule percentages exactly as configured (no
   * re-normalisation to 100). Odoo accepts analytic_distribution values whose
   * percentages do not sum to 100, so the merchant's configured percentages
   * are sent verbatim.
   */
  preservePercentages?: boolean
}

const CONDITIONS: AnalyticCondition[] = ['all', 'warehouse', 'payment']

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Lower-cases, strips the platform prefix and collapses separators. */
export function normalizePaymentKey(value: unknown): string {
  if (value === null || value === undefined) return ''
  const raw = String(value).trim().toLowerCase()
  if (!raw) return ''
  const withoutPlatformPrefix = raw.replace(/^(zid|salla)[\s_\-/.]+/, '')
  return withoutPlatformPrefix.replace(/[\s_\-/.]+/g, '')
}

function normalizeName(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Validates persisted rules. Invalid rows are dropped instead of throwing:
 * settings are hand-editable JSON in the database and a bad row must never
 * take an order sync down.
 */
export function normalizeAnalyticRules(raw: unknown): AnalyticRule[] {
  if (!Array.isArray(raw)) return []

  const rules: AnalyticRule[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>

    const condition = String(row.condition ?? '') as AnalyticCondition
    if (!CONDITIONS.includes(condition)) continue

    const accountId = toFiniteNumber(row.odoo_analytic_account_id)
    if (accountId === null || accountId <= 0 || !Number.isInteger(accountId)) continue

    const rawPercentage = toFiniteNumber(row.percentage)
    if (rawPercentage !== null && rawPercentage <= 0) continue
    const percentage = rawPercentage === null ? 100 : Math.min(rawPercentage, 100)

    const sourceLabel = toText(row.source_label)
    if (condition === 'all') {
      rules.push({
        condition,
        source_value: '',
        source_label: '',
        odoo_analytic_account_id: accountId,
        percentage,
      })
      continue
    }

    const rawSource = toText(row.source_value) || sourceLabel
    if (!rawSource) continue
    const sourceValue = condition === 'payment' ? normalizePaymentKey(rawSource) : rawSource
    if (!sourceValue) continue

    rules.push({
      condition,
      source_value: sourceValue,
      source_label: sourceLabel || rawSource,
      odoo_analytic_account_id: accountId,
      percentage,
    })
  }
  return rules
}

export function parseAnalyticConfig(raw: unknown): AnalyticConfig {
  if (!raw || typeof raw !== 'object') return { enabled: false, rules: [] }
  const value = raw as Record<string, unknown>
  return {
    enabled: value.enabled === true,
    rules: normalizeAnalyticRules(value.rules),
  }
}

function pushKey(out: string[], value: unknown) {
  if (value === null || value === undefined) return
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    pushKey(out, obj.code)
    pushKey(out, obj.slug)
    pushKey(out, obj.title)
    pushKey(out, obj.name)
    return
  }
  const key = normalizePaymentKey(value)
  if (key) out.push(key)
}

/**
 * Every payment identifier an order payload exposes, normalised so a stored
 * rule matches by code, slug, title or translated name.
 */
export function paymentKeysFromOrder(
  payload: Record<string, unknown> | null | undefined,
  _platform?: 'zid' | 'salla' | 'shopify'
): string[] {
  if (!payload || typeof payload !== 'object') return []
  const p = payload as any
  const keys: string[] = []

  pushKey(keys, p.payment_method)
  pushKey(keys, p.payment_method_name)
  pushKey(keys, p.payment?.method)
  pushKey(keys, p.payment_gateway)
  pushKey(keys, p.gateway)

  const list = p.payment_methods
  if (Array.isArray(list)) {
    for (const item of list) {
      if (!item || typeof item !== 'object') {
        pushKey(keys, item)
        continue
      }
      pushKey(keys, (item as any).payment_method)
      pushKey(keys, item)
    }
  }

  return [...new Set(keys)]
}

function locationMatches(rule: AnalyticRule, locationId?: string, locationName?: string): boolean {
  const value = toText(rule.source_value)
  if (!value) return false

  if (locationId && value === String(locationId).trim()) return true
  if (!locationName) return false

  // `source_value` may be an id while `source_label` holds the readable name —
  // compare the order's location name against both, never against the rule's
  // own label (that would always match itself).
  const orderName = normalizeName(locationName)
  return orderName === normalizeName(value) || orderName === normalizeName(rule.source_label)
}

function paymentMatches(rule: AnalyticRule, paymentKeys: string[]): boolean {
  const value = normalizePaymentKey(rule.source_value)
  if (!value) return false
  return paymentKeys.includes(value)
}

export function resolveAnalyticDistribution({
  config,
  locationId,
  locationName,
  paymentKeys = [],
  preservePercentages: _preservePercentages = true,
}: ResolveAnalyticInput): AnalyticDistributionEntry[] {
  const parsed = parseAnalyticConfig(config)
  if (!parsed.enabled || parsed.rules.length === 0) return []

  const fallbackRules = parsed.rules.filter(rule => rule.condition === 'all')
  const specificRules = parsed.rules.filter(rule => rule.condition !== 'all')

  const matched = specificRules.filter(rule =>
    rule.condition === 'warehouse'
      ? locationMatches(rule, locationId, locationName)
      : paymentMatches(rule, paymentKeys)
  )

  const selected = matched.length > 0 ? matched : fallbackRules

  // Send the merchant's configured percentages verbatim — no
  // re-normalisation to 100, no calculations. Odoo accepts analytic_distribution
  // values whose percentages do not sum to 100.
  const totals = new Map<number, number>()
  for (const rule of selected) {
    if (rule.percentage <= 0) continue
    totals.set(
      rule.odoo_analytic_account_id,
      (totals.get(rule.odoo_analytic_account_id) ?? 0) + rule.percentage
    )
  }

  return [...totals.entries()].map(([accountId, percentage]) => ({
    accountId,
    percentage,
  }))
}

/**
 * Builds the line values for the Odoo version in use. Nothing is returned
 * when the model has neither field, so an unsupported Odoo is a silent no-op
 * (the engine logs once).
 */
export function toOdooAnalyticFields(
  distribution: AnalyticDistributionEntry[],
  hasDistributionField: boolean,
  hasAccountField: boolean
): Record<string, unknown> {
  if (distribution.length === 0) return {}

  if (hasDistributionField) {
    return {
      analytic_distribution: Object.fromEntries(
        distribution.map(entry => [String(entry.accountId), entry.percentage])
      ),
    }
  }

  if (hasAccountField) {
    const top = [...distribution].sort((a, b) => b.percentage - a.percentage)[0]
    if (top) return { analytic_account_id: top.accountId }
  }

  return {}
}
