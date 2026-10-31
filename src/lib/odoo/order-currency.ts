/**
 * Multi-currency handling for Zid orders synced to Odoo.
 *
 * Core rules:
 * 1. If multi-currency is enabled and the currency sent from Zid is active in Odoo:
 *    - The sales order (`sale.order`) is created with that `currency_id`.
 *    - Line prices, shipping, COD fees, and discounts stay in the original currency
 *      (e.g. 200 AED stays 200 on lines, and Odoo accounts for it in AED).
 *    - Invoices and credit notes automatically inherit that currency.
 *
 * 2. If the currency sent from Zid is NOT active in Odoo (or not found), or multi-currency
 *    is disabled:
 *    - The order is created in Odoo's base currency (either user-selected fallback currency
 *      or company default without forcing an invalid currency_id).
 *    - Crucially: Line prices, shipping, COD fee, and discounts MUST be converted to the base
 *      currency using the conversion rate (from Zid payload, Odoo rate, or common rates).
 *      Otherwise an order of 200 AED would be wrongly recorded as 200 SAR!
 */

import { resolvePath } from '@/lib/sync-helpers'

/**
 * Common exchange rates to SAR (Saudi Riyal) used when neither Zid nor Odoo
 * provides a live rate for conversion to base SAR.
 * Values indicate how many SAR 1 unit of foreign currency is worth.
 * (e.g. 1 AED = 1.02 SAR, 1 USD = 3.75 SAR).
 */
export const COMMON_RATES_TO_SAR: Record<string, number> = {
  SAR: 1.0,
  AED: 1.02,
  BHD: 9.95,
  KWD: 12.20,
  OMR: 9.75,
  QAR: 1.03,
  USD: 3.75,
  EUR: 4.05,
  GBP: 4.80,
  EGP: 0.077,
  JOD: 5.29,
  TRY: 0.11,
}

/**
 * Extract the currency ISO code from an order payload across Zid, Salla, or Shopify.
 */
export function extractOrderCurrency(zidData: Record<string, unknown>, platform?: string): string {
  if (!zidData || typeof zidData !== 'object') return 'SAR'

  // 1. Explicit currency keys (string or nested object)
  const candidates = [
    'currency_code',
    'currency',
    'currency.code',
    'currency.currency_code',
    'amounts.currency',
    'amounts.currency.code',
    'payment.currency',
    'payment.currency.code',
    'payment_summary.currency',
    'payment_summary.currency.code',
    'order.currency_code',
    'order.currency',
    'order.currency.code',
    'order.amounts.currency',
  ]

  for (const path of candidates) {
    const val = resolvePath(zidData, path)
    if (typeof val === 'string' && val.trim()) {
      return val.trim().toUpperCase()
    }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>
      const sub = obj.code || obj.currency_code || obj.name
      if (typeof sub === 'string' && sub.trim()) {
        return sub.trim().toUpperCase()
      }
    }
  }

  // 2. Extract 3-letter currency code from formatted amount strings (e.g. "183.00 SAR", "90.97 AED")
  const stringCandidates = [
    'order_total_string',
    'transaction_amount_string',
    'products_sum_total_string',
    'amounts.total_string',
    'total_string',
  ]
  for (const path of stringCandidates) {
    const strVal = resolvePath(zidData, path)
    if (typeof strVal === 'string') {
      const match = strVal.trim().match(/\b([A-Za-z]{3})\b$/)
      if (match && match[1]) {
        return match[1].toUpperCase()
      }
    }
  }

  // 3. Platform-specific fallbacks
  if (platform === 'shopify') {
    const shopifyCurr = resolvePath(zidData, 'presentment_currency') || resolvePath(zidData, 'currency')
    if (typeof shopifyCurr === 'string' && shopifyCurr.trim()) {
      return shopifyCurr.trim().toUpperCase()
    }
  } else if (platform === 'salla') {
    const sallaCurr = resolvePath(zidData, 'currency') || resolvePath(zidData, 'price.currency')
    if (typeof sallaCurr === 'string' && sallaCurr.trim()) {
      return sallaCurr.trim().toUpperCase()
    }
  }

  return 'SAR'
}

/**
 * Resolves the exchange rate to convert amounts from `sourceCurrency` to `baseCurrency` (default SAR).
 * Checks in order:
 * 1. Zid payload conversion rate or transaction_amount / order_total ratio.
 * 2. Odoo currency rate if provided.
 * 3. Fallback table for common currencies to SAR.
 */
export function resolveOrderExchangeRate(
  zidData: Record<string, unknown>,
  sourceCurrency: string,
  baseCurrency = 'SAR',
  odooCurrencyRate?: number | null
): number {
  const from = (sourceCurrency || 'SAR').trim().toUpperCase()
  const to = (baseCurrency || 'SAR').trim().toUpperCase()

  if (from === to) return 1.0

  // 1. Check if Zid payload carries explicit conversion rate
  const rateCandidates = [
    'currency_conversion_rate',
    'conversion_rate',
    'exchange_rate',
    'currency_rate',
    'amounts.conversion_rate',
    'payment.conversion_rate',
  ]
  for (const path of rateCandidates) {
    const raw = resolvePath(zidData, path)
    if (raw !== undefined && raw !== null && typeof raw !== 'object') {
      const num = parseFloat(String(raw))
      if (!isNaN(num) && num > 0) {
        return num
      }
    }
  }

  // 2. Check if Zid has transaction_amount vs order_total
  // When a store sells in AED but settles in SAR, Zid often provides:
  // transaction_amount (e.g. 204.00 SAR) and order_total (e.g. 200.00 AED)
  const txAmount = parseFloat(String(
    resolvePath(zidData, 'transaction_amount') ??
    resolvePath(zidData, 'payment.transaction_amount') ??
    0
  ))
  const orderTotal = parseFloat(String(
    resolvePath(zidData, 'order_total') ??
    resolvePath(zidData, 'amounts.total.amount') ??
    0
  ))
  if (txAmount > 0 && orderTotal > 0 && Math.abs(txAmount - orderTotal) > 0.001) {
    const derivedRate = txAmount / orderTotal
    if (!isNaN(derivedRate) && derivedRate > 0) {
      return derivedRate
    }
  }

  // 3. Odoo rate if available:
  // In Odoo res.currency, rate is defined relative to the company base currency (base=1.0).
  // If base is SAR and AED has rate 0.98 (i.e. 1 SAR = 0.98 AED), then 1 AED = (1 / rate) SAR.
  if (odooCurrencyRate && typeof odooCurrencyRate === 'number' && odooCurrencyRate > 0) {
    if (to === 'SAR') {
      return 1 / odooCurrencyRate
    }
  }

  // 4. Common fallback rates table (to SAR)
  if (to === 'SAR' && COMMON_RATES_TO_SAR[from]) {
    return COMMON_RATES_TO_SAR[from]
  }

  return 1.0
}

/**
 * Pure amount conversion with 2 decimal places precision.
 */
export function convertCurrencyAmount(amount: number, rate: number): number {
  if (typeof amount !== 'number' || isNaN(amount) || amount === 0) return 0
  if (rate === 1.0 || isNaN(rate) || rate <= 0) return amount
  return Math.round(amount * rate * 100) / 100
}
