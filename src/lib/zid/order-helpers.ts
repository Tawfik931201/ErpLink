import { resolvePath } from '@/lib/sync-helpers'

/**
 * Pure Zid payload readers.
 *
 * These four functions used to live in the middle of `sync-engine.ts`, which
 * is 7,300 lines and mixes every platform. They are pure — no I/O, no Odoo
 * client, no database — so they belong with the other Zid modules and can be
 * tested without a database.
 *
 * `sync-engine.ts` imports them from here. They are not part of any API
 * surface; the `export` exists for the unit tests.
 */

// ──── Helper: resolve shipping/delivery fee from a Zid order payload ─────

/**
 * Zid order payloads put the delivery fee under different keys depending on the
 * payload version / store setup. Try every known path and return the first
 * non-zero value found.
 */
export function resolveZidShippingCost(zidData: Record<string, unknown>): number {
  // Zid's official order schema carries the fee breakdown in payment.invoice[]
  // (real order payloads have NO `amounts` key). Scan for the shipping/delivery row first.
  try {
    const payment = zidData.payment as Record<string, unknown> | undefined
    const invoice = payment?.invoice
    if (Array.isArray(invoice)) {
      for (const row of invoice) {
        const r = (row && typeof row === 'object') ? row as Record<string, unknown> : {}
        const code = String(r.code ?? '')
        const title = String(r.title ?? '')
        if (/ship|deliver|freight|postage|شحن|توصيل/i.test(code) || /ship|deliver|freight|postage|شحن|توصيل/i.test(title)) {
          const raw = r.value ?? r.value_string
          if (raw !== undefined && raw !== null && typeof raw !== 'object') {
            const num = parseFloat(String(raw).replace(/[^0-9.\-]/g, ''))
            if (!isNaN(num) && num > 0) return num
          }
        }
      }
    }
  } catch { /* fall through to path candidates */ }
  // Shopify carries the fee in `shipping_lines[]` (one row per rate) and in
  // `total_shipping_price_set.shop_money.amount`. Zid payloads have neither
  // key, so this branch is a no-op for them (pinned by subscription-dates /
  // zid-order-helpers tests).
  try {
    const lines = zidData.shipping_lines
    if (Array.isArray(lines) && lines.length > 0) {
      let sum = 0
      for (const row of lines) {
        const r = (row && typeof row === 'object') ? row as Record<string, unknown> : {}
        const raw = r.price ?? r.amount ?? r.total
        if (raw === undefined || raw === null || typeof raw === 'object') continue
        const num = parseFloat(String(raw).replace(/[^0-9.\-]/g, ''))
        if (!isNaN(num) && num > 0) sum += num
      }
      if (sum > 0) return sum
    }
    const set = zidData.total_shipping_price_set as Record<string, unknown> | undefined
    const shopMoney = set?.shop_money as Record<string, unknown> | undefined
    const setRaw = shopMoney?.amount ?? (set as Record<string, unknown> | undefined)?.amount
    if (setRaw !== undefined && setRaw !== null && typeof setRaw !== 'object') {
      const num = parseFloat(String(setRaw).replace(/[^0-9.\-]/g, ''))
      if (!isNaN(num) && num > 0) return num
    }
  } catch { /* fall through to path candidates */ }
  const candidates = [
    'amounts.shipping_cost.amount',
    'amounts.delivery_cost.amount',
    'shipping_cost',
    'delivery_cost',
    'shipping.price',
    'shipping.cost',
    'shipping.amount',
    'amounts.shipping_cost',
    // Shopify flat fallbacks (the array/set shapes are handled above).
    'total_shipping_price',
    'shipping_lines.0.price',
  ]
  for (const path of candidates) {
    const raw = resolvePath(zidData, path)
    if (raw === undefined || raw === null) continue
    let num = 0
    if (typeof raw === 'object') {
      const nested = resolvePath(raw as Record<string, unknown>, 'amount')
      num = parseFloat(String(nested ?? '')) || 0
    } else {
      num = parseFloat(String(raw)) || 0
    }
    if (num > 0) return num
  }
  return 0
}

// ──── Helper: resolve COD collection-fee amount from a Zid order payload ─────
// Zid has NO dedicated COD-fee key. A store/carrier-configured COD surcharge
// surfaces (if at all) as an extra payment.invoice[] row, so scan invoice rows
// first — strong COD identifiers, then generic fee words (excluding shipping /
// tax / discount / total rows so the shipping fee is never double-counted) —
// then try named keys. Returns 0 when Zid sends no fee.
export function resolveZidCodAmount(zidData: Record<string, unknown>): number {
  const parseNum = (raw: unknown): number => {
    if (raw === undefined || raw === null || typeof raw === 'object') return 0
    const num = parseFloat(String(raw).replace(/[^0-9.\-]/g, ''))
    return !isNaN(num) && num > 0 ? num : 0
  }
  try {
    const payment = zidData.payment as Record<string, unknown> | undefined
    const invoice = payment?.invoice
    if (Array.isArray(invoice)) {
      const strong = /cod|cash|عند الاستلام|الدفع عند|تحصيل|collect/i
      const weak = /payment.?fee|handling|surcharge|service.?fee|رسوم/i
      const notFeeRow = /ship|deliver|شحن|توصيل|tax|vat|ضريب|discount|خصم|coupon|كوبون|total|subtotal|إجمالي/i
      for (const pattern of [strong, weak]) {
        for (const row of invoice) {
          const r = (row && typeof row === 'object') ? row as Record<string, unknown> : {}
          const code = String(r.code ?? '')
          const title = String(r.title ?? '')
          if (!(pattern.test(code) || pattern.test(title))) continue
          if (pattern === weak && (notFeeRow.test(code) || notFeeRow.test(title))) continue
          const num = parseNum(r.value ?? r.value_string)
          if (num > 0) return num
        }
      }
    }
  } catch { /* fall through to named keys */ }
  const candidates = [
    'cod_fee', 'cod_amount', 'payment.cod_fee', 'payment.payment_fee',
    'payment_fee', 'collection_fee', 'handling_fee', 'surcharge',
    'service_fee', 'additional_fees', 'amounts.cod_fee',
    'amounts.payment_fee', 'shipping.cod_fee',
  ]
  for (const path of candidates) {
    const num = parseNum(resolvePath(zidData, path))
    if (num > 0) return num
  }
  return 0
}

/**
 * Detect whether the destination shipping address of an order is within Saudi Arabia.
 * Checks shipping_address, shipping.address, order.shipping_address, delivery_address,
 * the Salla shipment destination (shipments[0].ship_to), customer address, and
 * falls back to city and phone prefix.
 *
 * Cross-platform by design: Zid uses shipping_address/country objects, Salla
 * uses shipping.address ({country, country_code, city} strings), a customer
 * object ({country, city, mobile, mobile_code}) and shipments[].ship_to.
 * Verified against Salla's published order payload (docs.salla.dev/doc-433804):
 * non-Saudi orders carry e.g. customer.country "الامارات" with mobile
 * "+971..." while Saudi ones carry country "SA"/"السعودية".
 */
// ──── Helper: resolve overall discount amount from an order payload ─────
export function resolveOrderDiscountAmount(zidData: Record<string, unknown>): number {
  if (!zidData || typeof zidData !== 'object') return 0
  const parseNum = (raw: unknown): number => {
    if (raw === undefined || raw === null || typeof raw === 'object') return 0
    const num = parseFloat(String(raw).replace(/[^0-9.\-]/g, ''))
    return !isNaN(num) && num > 0 ? num : 0
  }
  try {
    const payment = zidData.payment as Record<string, unknown> | undefined
    const invoice = payment?.invoice
    if (Array.isArray(invoice)) {
      for (const row of invoice) {
        const r = (row && typeof row === 'object') ? row as Record<string, unknown> : {}
        const code = String(r.code ?? '')
        const title = String(r.title ?? '')
        if (/discount|خصم|coupon|كوبون/i.test(code) || /discount|خصم|coupon|كوبون/i.test(title)) {
          const num = parseNum(r.value ?? r.value_string)
          if (num > 0) return num
        }
      }
    }
  } catch { /* fall through to path candidates */ }
  const candidates = [
    'amounts.discount.amount',
    'amounts.discount',
    'order_discount',
    'total_discount',
    'discount_amount',
    'coupon.amount',
    'coupon.discount',
    'discount',
  ]
  for (const path of candidates) {
    const num = parseNum(resolvePath(zidData, path))
    if (num > 0) return num
  }
  return 0
}

export function isSaudiShippingAddress(zidData: Record<string, unknown>): boolean {
  if (!zidData || typeof zidData !== 'object') return true

  const addressCandidates = [
    (zidData as any)?.shipping_address,
    (zidData as any)?.shipping?.address,
    (zidData as any)?.order?.shipping_address,
    (zidData as any)?.order?.shipping?.address,
    (zidData as any)?.delivery_address,
    (zidData as any)?.shipments?.[0]?.ship_to,
    (zidData as any)?.shipping,
    (zidData as any)?.billing_address,
    (zidData as any)?.customer?.address,
    (zidData as any)?.customer,
    zidData,
  ]

  let rawCountry: any = null
  for (const obj of addressCandidates) {
    if (!obj || typeof obj !== 'object') continue
    const val = obj.country || obj.country_code || obj.country_name || obj.country_id
    if (val !== undefined && val !== null && val !== '') {
      rawCountry = val
      break
    }
  }

  let countryStr = ''
  if (typeof rawCountry === 'string') {
    countryStr = rawCountry.trim()
  } else if (rawCountry && typeof rawCountry === 'object') {
    // Salla/branch-style objects use name_en alongside code/name.
    const nm = rawCountry.name
    const nameStr = typeof nm === 'string'
      ? nm
      : String(nm?.ar || nm?.en || nm?.name_en || '')
    countryStr = String(
      rawCountry.code ||
      rawCountry.country_code ||
      nameStr ||
      rawCountry.en ||
      rawCountry.name_en ||
      rawCountry.ar ||
      ''
    ).trim()
  } else if (typeof rawCountry === 'number') {
    if (rawCountry === 1) return true
  }

  if (countryStr) {
    const lower = countryStr.toLowerCase()
    if (
      lower === 'sa' ||
      lower === 'sau' ||
      lower === 'ksa' ||
      lower === 'saudi arabia' ||
      lower === 'kingdom of saudi arabia' ||
      lower.includes('سعودي') ||
      lower.includes('المملكة العربية السعودية')
    ) {
      return true
    }
    return false
  }

  // Fallback: Check city name (Salla also carries a top-level customer.city)
  const cityCandidates = [
    (zidData as any)?.shipping_address?.city,
    (zidData as any)?.shipping?.address?.city,
    (zidData as any)?.order?.shipping_address?.city,
    (zidData as any)?.delivery_address?.city,
    (zidData as any)?.customer?.city,
    (zidData as any)?.city,
  ]
  const saudiCities = [
    'riyadh', 'الرياض', 'jeddah', 'جدة', 'dammam', 'الدمام', 'makkah', 'مكة',
    'madinah', 'المدينة', 'khobar', 'الخبر', 'dhahran', 'الظهران', 'tabuk', 'تبوك',
    'taif', 'الطائف', 'abha', 'أبها', 'khamis mushait', 'خميس مشيط', 'jubail', 'الجبيل',
    'al ahsa', 'الأحساء', 'hofuf', 'الهفوف', 'yanbu', 'ينبع', 'qassim', 'القصيم',
    'buraidah', 'بريدة', 'onaizah', 'عنيزة', 'hail', 'حائل', 'najran', 'نجران', 'jizan', 'جازان'
  ]
  for (const rawCity of cityCandidates) {
    if (!rawCity) continue
    const cityStr = (
      typeof rawCity === 'string'
        ? rawCity
        : (rawCity.name || rawCity.name_en || rawCity.en || rawCity.ar || '')
    ).trim().toLowerCase()
    if (cityStr && saudiCities.some(c => cityStr.includes(c))) {
      return true
    }
  }

  // Fallback: Check phone prefix. Salla sends the national number bare
  // (e.g. mobile 501806978) with the country in mobile_code ("+966"), so the
  // code is composed in when the number itself carries no international
  // prefix. Digit-normalised: equivalent to the old +966/00966/966/05 checks.
  const cust = (zidData as any)?.customer
  const phone = String(
    cust?.phone ||
    cust?.mobile ||
    (zidData as any)?.shipping_address?.phone ||
    (zidData as any)?.shipping_address?.mobile ||
    ''
  ).trim()
  const mobileCode = String(cust?.mobile_code || '').trim()
  const dialled = (!/^(?:\+|00)/.test(phone) && mobileCode) ? `${mobileCode}${phone}` : phone
  const digits = dialled.replace(/\D/g, '')
  if (/^05/.test(digits) || digits.replace(/^0+/, '').startsWith('966')) {
    return true
  }

  return true
}

// ──── Helper: resolve destination country code from an order payload ─────
export function resolveOrderCountryCode(zidData: Record<string, unknown>): string {
  if (!zidData || typeof zidData !== 'object') return 'SA'

  const addressCandidates = [
    (zidData as any)?.shipping_address,
    (zidData as any)?.shipping?.address,
    (zidData as any)?.order?.shipping_address,
    (zidData as any)?.order?.shipping?.address,
    (zidData as any)?.delivery_address,
    (zidData as any)?.shipments?.[0]?.ship_to,
    (zidData as any)?.shipping,
    (zidData as any)?.billing_address,
    (zidData as any)?.customer?.address,
    (zidData as any)?.customer,
    zidData,
  ]

  let rawCountry: any = null
  for (const obj of addressCandidates) {
    if (!obj || typeof obj !== 'object') continue
    const val = obj.country || obj.country_code || obj.country_name || obj.country_id
    if (val !== undefined && val !== null && val !== '') {
      rawCountry = val
      break
    }
  }

  let countryStr = ''
  if (typeof rawCountry === 'string') {
    countryStr = rawCountry.trim()
  } else if (rawCountry && typeof rawCountry === 'object') {
    const nm = rawCountry.name
    const nameStr = typeof nm === 'string'
      ? nm
      : String(nm?.ar || nm?.en || nm?.name_en || '')
    countryStr = String(
      rawCountry.code ||
      rawCountry.country_code ||
      nameStr ||
      rawCountry.en ||
      rawCountry.name_en ||
      rawCountry.ar ||
      ''
    ).trim()
  } else if (typeof rawCountry === 'number') {
    if (rawCountry === 1) return 'SA'
    if (rawCountry === 64) return 'EG'
    if (rawCountry === 2) return 'AE'
  }

  if (countryStr) {
    const lower = countryStr.toLowerCase()
    if (
      lower === 'sa' ||
      lower === 'sau' ||
      lower === 'ksa' ||
      lower === 'saudi arabia' ||
      lower === 'kingdom of saudi arabia' ||
      lower.includes('سعودي') ||
      lower.includes('المملكة العربية السعودية')
    ) {
      return 'SA'
    }
    if (
      lower === 'eg' ||
      lower === 'egy' ||
      lower === 'egypt' ||
      lower.includes('مصر')
    ) {
      return 'EG'
    }
    if (
      lower === 'ae' ||
      lower === 'uae' ||
      lower === 'are' ||
      lower === 'united arab emirates' ||
      lower.includes('إمارات') ||
      lower.includes('امارات')
    ) {
      return 'AE'
    }
    if (
      lower === 'kw' ||
      lower === 'kwt' ||
      lower === 'kuwait' ||
      lower.includes('كويت')
    ) {
      return 'KW'
    }
    if (
      lower === 'qa' ||
      lower === 'qat' ||
      lower === 'qatar' ||
      lower.includes('قطر')
    ) {
      return 'QA'
    }
    if (
      lower === 'bh' ||
      lower === 'bhr' ||
      lower === 'bahrain' ||
      lower.includes('بحرين')
    ) {
      return 'BH'
    }
    if (
      lower === 'om' ||
      lower === 'omn' ||
      lower === 'oman' ||
      lower.includes('عمان')
    ) {
      return 'OM'
    }
    if (
      lower === 'jo' ||
      lower === 'jor' ||
      lower === 'jordan' ||
      lower.includes('أردن') ||
      lower.includes('اردن')
    ) {
      return 'JO'
    }
    if (lower === 'us' || lower === 'usa' || lower === 'united states' || lower.includes('أمريكا')) {
      return 'US'
    }
    if (lower === 'gb' || lower === 'gbr' || lower === 'uk' || lower === 'united kingdom' || lower.includes('بريطانيا')) {
      return 'GB'
    }
    if (/^[A-Za-z]{2}$/.test(countryStr)) {
      return countryStr.toUpperCase()
    }
    return countryStr.toUpperCase()
  }

  // Fallback: Check city name
  const cityCandidates = [
    (zidData as any)?.shipping_address?.city,
    (zidData as any)?.shipping?.address?.city,
    (zidData as any)?.order?.shipping_address?.city,
    (zidData as any)?.delivery_address?.city,
    (zidData as any)?.customer?.city,
    (zidData as any)?.city,
  ]
  const saudiCities = [
    'riyadh', 'الرياض', 'jeddah', 'جدة', 'dammam', 'الدمام', 'makkah', 'مكة',
    'madinah', 'المدينة', 'khobar', 'الخبر', 'dhahran', 'الظهران', 'tabuk', 'تبوك',
    'taif', 'الطائف', 'abha', 'أبها', 'khamis mushait', 'خميس مشيط', 'jubail', 'الجبيل',
    'al ahsa', 'الأحساء', 'hofuf', 'الهفوف', 'yanbu', 'ينبع', 'qassim', 'القصيم',
    'buraidah', 'بريدة', 'onaizah', 'عنيزة', 'hail', 'حائل', 'najran', 'نجران', 'jizan', 'جازان'
  ]
  const egyptianCities = [
    'cairo', 'القاهرة', 'alexandria', 'الإسكندرية', 'giza', 'الجيزة',
    'mansoura', 'المنصورة', 'tanta', 'طنطا', 'assiut', 'أسيوط', 'ismailia', 'الإسماعيلية',
    'fayoum', 'الفيوم', 'zagazig', 'الزقازيق', 'aswan', 'أسوان', 'luxor', 'الأقصر',
    'hurghada', 'الغردقة', 'sharm', 'شرم الشيخ', 'suez', 'السويس', 'port said', 'بورسعيد'
  ]
  const uaeCities = [
    'dubai', 'دبي', 'abu dhabi', 'أبوظبي', 'sharjah', 'الشارقة',
    'ajman', 'عجمان', 'ras al khaimah', 'رأس الخيمة', 'fujairah', 'الفجيرة', 'umm al quwain', 'أم القيوين'
  ]

  for (const rawCity of cityCandidates) {
    if (!rawCity) continue
    const cityStr = (
      typeof rawCity === 'string'
        ? rawCity
        : (rawCity.name || rawCity.name_en || rawCity.en || rawCity.ar || '')
    ).trim().toLowerCase()
    if (!cityStr) continue
    if (saudiCities.some(c => cityStr.includes(c))) return 'SA'
    if (egyptianCities.some(c => cityStr.includes(c))) return 'EG'
    if (uaeCities.some(c => cityStr.includes(c))) return 'AE'
  }

  // Fallback: Check phone prefix
  const cust = (zidData as any)?.customer
  const phone = String(
    cust?.phone ||
    cust?.mobile ||
    (zidData as any)?.shipping_address?.phone ||
    (zidData as any)?.shipping_address?.mobile ||
    ''
  ).trim()
  const mobileCode = String(cust?.mobile_code || '').trim()
  const dialled = (!/^(?:\+|00)/.test(phone) && mobileCode) ? `${mobileCode}${phone}` : phone
  const digits = dialled.replace(/\D/g, '')

  if (/^05/.test(digits) || digits.replace(/^0+/, '').startsWith('966')) return 'SA'
  if (/^01[0125]/.test(digits) || digits.replace(/^0+/, '').startsWith('20')) return 'EG'
  if (/^05[024568]/.test(digits) || digits.replace(/^0+/, '').startsWith('971')) return 'AE'
  if (digits.replace(/^0+/, '').startsWith('965')) return 'KW'
  if (digits.replace(/^0+/, '').startsWith('974')) return 'QA'
  if (digits.replace(/^0+/, '').startsWith('973')) return 'BH'
  if (digits.replace(/^0+/, '').startsWith('968')) return 'OM'
  if (digits.replace(/^0+/, '').startsWith('962')) return 'JO'

  return isSaudiShippingAddress(zidData) ? 'SA' : ''
}

export interface CountryTaxRateRule {
  rowKey?: string
  country_code: string
  tax_rate: number | string
  country_name?: string
}

export interface VatCountryRule {
  rowKey?: string
  country_code: string
  tax_id: number | string | null
  country_name?: string
}

/**
 * Resolves the Odoo tax ID for an order based on destination country and VAT mapping settings.
 * 1. If enableVat is false, returns taxId: null.
 * 2. If vatCountryRules array is provided:
 *    - Looks for exact match on destination country code.
 *    - If not found, looks for fallback rule ('OTHER', 'REST_OF_WORLD', '*', 'ALL').
 * 3. Falls back to legacy vatSaudiTaxId (for SA) / vatNonSaudiTaxId (for others).
 * 4. If no tax is selected or matched, returns taxId: null (allowing Odoo to apply default tax).
 */
export function resolveOrderVatTax(
  orderPayload: Record<string, unknown>,
  options: {
    enableVat: boolean
    vatCountryRules?: VatCountryRule[] | null
    vatSaudiTaxId?: number | string | null
    vatNonSaudiTaxId?: number | string | null
  }
): {
  taxId: number | null
  appliedCountryCode: string | null
  destinationCountryCode: string
} {
  if (!options.enableVat) {
    return { taxId: null, appliedCountryCode: null, destinationCountryCode: '' }
  }

  const destCountry = resolveOrderCountryCode(orderPayload).toUpperCase()

  // 1. If vatCountryRules array is provided and non-empty:
  if (Array.isArray(options.vatCountryRules) && options.vatCountryRules.length > 0) {
    // Check specific country match
    const matched = options.vatCountryRules.find(rule => {
      const code = String(rule.country_code || '').trim().toUpperCase()
      if (code && code !== 'OTHER' && code !== 'REST_OF_WORLD' && code !== '*' && code !== 'ALL' && code !== 'CUSTOM') {
        if (code === destCountry) return true
        const name = String(rule.country_name || '').trim().toLowerCase()
        if (name && (name === destCountry.toLowerCase() || destCountry.toLowerCase().includes(name))) return true
      }
      return false
    })

    if (matched) {
      const rawId = matched.tax_id
      const taxIdNum = (rawId !== null && rawId !== undefined && rawId !== '') ? Number(rawId) : null
      const validTaxId = taxIdNum && !isNaN(taxIdNum) && taxIdNum > 0 ? taxIdNum : null
      return {
        taxId: validTaxId,
        appliedCountryCode: matched.country_code.toUpperCase(),
        destinationCountryCode: destCountry,
      }
    }

    // Check fallback rule ('OTHER' / 'REST_OF_WORLD' / '*' / 'ALL')
    const fallbackRule = options.vatCountryRules.find(rule => {
      const code = String(rule.country_code || '').trim().toUpperCase()
      return code === 'OTHER' || code === 'REST_OF_WORLD' || code === '*' || code === 'ALL'
    })

    if (fallbackRule) {
      const rawId = fallbackRule.tax_id
      const taxIdNum = (rawId !== null && rawId !== undefined && rawId !== '') ? Number(rawId) : null
      const validTaxId = taxIdNum && !isNaN(taxIdNum) && taxIdNum > 0 ? taxIdNum : null
      return {
        taxId: validTaxId,
        appliedCountryCode: 'OTHER',
        destinationCountryCode: destCountry,
      }
    }

    // If vatCountryRules was explicitly provided with rules, but none matched destCountry and no 'OTHER' exists:
    // Tax ID is null (order lines will be sent without tax so Odoo adds default)
    return {
      taxId: null,
      appliedCountryCode: null,
      destinationCountryCode: destCountry,
    }
  }

  // 2. Legacy fallback when vatCountryRules is empty / undefined:
  if (destCountry === 'SA' || isSaudiShippingAddress(orderPayload)) {
    const rawId = options.vatSaudiTaxId
    const num = (rawId !== null && rawId !== undefined && rawId !== '') ? Number(rawId) : null
    const validId = num && !isNaN(num) && num > 0 ? num : null
    return {
      taxId: validId,
      appliedCountryCode: 'SA',
      destinationCountryCode: destCountry || 'SA',
    }
  }

  const rawNonSaudi = options.vatNonSaudiTaxId
  const nonSaudiNum = (rawNonSaudi !== null && rawNonSaudi !== undefined && rawNonSaudi !== '') ? Number(rawNonSaudi) : null
  const validNonSaudi = nonSaudiNum && !isNaN(nonSaudiNum) && nonSaudiNum > 0 ? nonSaudiNum : null
  return {
    taxId: validNonSaudi,
    appliedCountryCode: 'OTHER',
    destinationCountryCode: destCountry,
  }
}

/**
 * Resolves the effective tax rate for an order based on destination country and mapping settings.
 * If the destination country is configured in countryTaxRates, its tax rate is returned.
 * If the destination country is NOT in the list (e.g. export order), 0% is returned
 * so no division occurs (1 + 0 = 1), preventing any loss on export orders.
 */
export function resolveEffectiveTaxRate(
  zidData: Record<string, unknown>,
  options: {
    pricesIncludeTax: boolean
    countryTaxRates?: CountryTaxRateRule[] | null
    fallbackTaxRatePercent?: number
  }
): {
  taxRate: number
  matchedCountryCode: string | null
  destinationCountryCode: string
} {
  if (!options.pricesIncludeTax) {
    return { taxRate: 0, matchedCountryCode: null, destinationCountryCode: '' }
  }

  const destCountry = resolveOrderCountryCode(zidData).toUpperCase()

  // 1. If countryTaxRates array is provided and contains rules:
  if (Array.isArray(options.countryTaxRates) && options.countryTaxRates.length > 0) {
    const matched = options.countryTaxRates.find(rule => {
      const code = String(rule.country_code || '').trim().toUpperCase()
      const name = String(rule.country_name || '').trim().toLowerCase()
      if (code && code === destCountry) return true
      if (name && (name === destCountry.toLowerCase() || destCountry.toLowerCase().includes(name))) return true
      return false
    })

    if (matched) {
      const rate = parseFloat(String(matched.tax_rate)) || 0
      return {
        taxRate: rate,
        matchedCountryCode: matched.country_code.toUpperCase(),
        destinationCountryCode: destCountry,
      }
    }

    // Crucial requirement: Country is not in the configured table (e.g. export orders)
    // Rate is 0%, preserving net export amounts without any division
    return {
      taxRate: 0,
      matchedCountryCode: null,
      destinationCountryCode: destCountry,
    }
  }

  // 2. Legacy fallback when countryTaxRates is empty / unconfigured:
  // Apply fallback rate (default 15) ONLY if destination is Saudi Arabia.
  // Any international / non-Saudi order gets 0% rate so it is never divided.
  if (destCountry === 'SA') {
    const fallback = options.fallbackTaxRatePercent !== undefined && !isNaN(Number(options.fallbackTaxRatePercent))
      ? Number(options.fallbackTaxRatePercent)
      : 15
    return {
      taxRate: fallback,
      matchedCountryCode: 'SA',
      destinationCountryCode: destCountry,
    }
  }

  return {
    taxRate: 0,
    matchedCountryCode: null,
    destinationCountryCode: destCountry,
  }
}

// ──── Helper: read the order status value from a platform payload ─────
export function resolveZidStatus(zidData: Record<string, unknown>): string {
  const raw = (zidData as any)?.order_status
    || (zidData as any)?.display_status
    || (zidData as any)?.status
    || (zidData as any)?.order?.order_status
    || (zidData as any)?.order?.display_status
    || (zidData as any)?.order?.status
    || (zidData as any)?.financial_status
    || (zidData as any)?.orderStatus
    || (zidData as any)?.current_status
    || (zidData as any)?.new_status
    || (zidData as any)?.order_status_code
    || ''
  let statusStr = ''
  if (typeof raw === 'object' && raw !== null) {
    // Salla sends {id, name, slug} — the slug is the canonical key
    // (id is a numeric row id, useless for matching). Zid objects carry
    // code/status, so preferring slug first is a no-op for them.
    statusStr = String(raw.slug || raw.code || raw.status || raw.id || raw.name || '')
  } else {
    statusStr = String(raw || '')
  }
  statusStr = statusStr.trim().toLowerCase()

  const ARABIC_TO_KEY: Record<string, string> = {
    'جديد': 'new',
    'جاري التجهيز': 'preparing',
    'تجهيز': 'preparing',
    'جاهز': 'ready',
    'جاهز للاستلام': 'ready',
    'جاري التوصيل': 'indelivery',
    'في الطريق': 'indelivery',
    'تم التوصيل': 'delivered',
    'تم الشحن': 'delivered',
    'ملغي': 'cancelled',
    'تم الإلغاء': 'cancelled',
    'تم الالغاء': 'cancelled',
    'مسترجع': 'reversed',
    'استرجاع': 'reversed',
    'مسترجع جزئيا': 'partially_reversed',
    'جاري الاسترجاع': 'reverse_in_progress',
    // Salla Arabic display names (docs.salla.dev examples: 'بإنتظار
    // المراجعة' on under_review, 'تم التنفيذ' on completed) → canonical
    // slugs, so the Odoo custom selection field and the status-mapping
    // rows match instead of receiving raw Arabic text.
    'بإنتظار المراجعة': 'under_review',
    'بانتظار المراجعة': 'under_review',
    'مكتمل': 'delivered',
    'تم الإنجاز': 'delivered',
    'تم الانجاز': 'delivered',
    'تم التنفيذ': 'completed',
  }
  return ARABIC_TO_KEY[statusStr] || statusStr
}
