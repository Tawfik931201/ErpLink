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
    'تم التنفيذ': 'completed',
  }
  return ARABIC_TO_KEY[statusStr] || statusStr
}
