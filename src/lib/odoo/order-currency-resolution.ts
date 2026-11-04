import type { OdooClient } from '@/lib/odoo-client'

import { extractOrderCurrency, extractZidStoreCurrency, qualifiedZidExchangeRate } from './order-currency'

type Currency = { id: number; name: string; active: boolean }
type Pricelist = { id: number; currency_id: number | [number, string]; company_id: false | number | [number, string]; active: boolean }
const idOf = (value: unknown): number => Number(Array.isArray(value) ? value[0] : value) || 0

/** Resolve a consistent currency/pricelist pair before order lines are priced. */
export async function resolveOrderCurrencySettings(params: {
  client: OdooClient; payload: Record<string, unknown>; values: Record<string, unknown>
  settings: Record<string, any>; create: boolean; existingOrderId?: number | null; mappedCurrencyId?: number; mappedConversionRate?: number
}): Promise<{ companyId: number; currencyId: number; pricelistId: number; rate: number }> {
  const { client, payload, values, settings } = params
  if (params.existingOrderId) {
    const [order] = await client.searchRead<any>('sale.order', [['id', '=', params.existingOrderId]], ['company_id', 'currency_id', 'pricelist_id'], 1)
    if (!idOf(order?.company_id) || !idOf(order?.currency_id) || !idOf(order?.pricelist_id)) throw new Error('Existing order currency could not be verified')
    // Updates preserve the original currency and prices; settings changes apply to new orders.
    return { companyId: idOf(order.company_id), currencyId: idOf(order.currency_id), pricelistId: idOf(order.pricelist_id), rate: 1 }
  }
  let companyId = idOf(values.company_id)
  if (!companyId) {
    const defaults = await client.execute<any>('sale.order', 'default_get', [['company_id']])
    companyId = idOf(defaults?.company_id)
  }
  if (!companyId) throw new Error('Order currency company could not be resolved')
  const [company] = await client.searchRead<any>('res.company', [['id', '=', companyId]], ['currency_id'], 1)
  const companyCurrencyId = idOf(company?.currency_id)
  if (!companyCurrencyId) throw new Error('Order company currency could not be resolved')
  const context = { allowed_company_ids: [companyId], force_company: companyId, company_id: companyId, active_test: false }
  const read = <T>(model: string, domain: unknown[], fields: string[], limit = 1, order?: string) =>
    client.execute<T[]>(model, 'search_read', [domain], { fields, limit, ...(order ? { order } : {}), context })
  const currencyById = async (id: number) => {
    const [currency] = await read<Currency>('res.currency', [['id', '=', id]], ['id', 'name', 'active'])
    if (!currency || !currency.active) throw new Error(`Configured order currency ${id} is unavailable or inactive`)
    return currency
  }
  const pricelistById = async (id: number) => {
    const [list] = await read<Pricelist>('product.pricelist', [['id', '=', id]], ['id', 'currency_id', 'company_id', 'active'])
    if (!list || !list.active || (idOf(list.company_id) && idOf(list.company_id) !== companyId)) throw new Error(`Configured order pricelist ${id} is unavailable for company ${companyId}`)
    return list
  }
  const sourceCode = extractOrderCurrency(payload, 'zid')
  const [source] = await read<Currency>('res.currency', [['name', '=', sourceCode]], ['id', 'name', 'active'])
  const explicitCurrencyId = idOf(values.currency_id)
  const explicitPricelistId = idOf(values.pricelist_id)
  let list = explicitPricelistId ? await pricelistById(explicitPricelistId) : undefined
  if (list && explicitCurrencyId && idOf(list.currency_id) !== explicitCurrencyId) throw new Error('Configured order currency conflicts with its explicit pricelist')
  let targetId = explicitCurrencyId || (list ? idOf(list.currency_id) : 0)
  const multiEnabled = !!(settings.multi_currency_enabled ?? settings.order?.multi_currency_enabled)
  if (!targetId && multiEnabled && source?.active) targetId = source.id
  if (!targetId) {
    const defaultPricelistId = idOf(settings.default_pricelist_id ?? settings.order?.default_pricelist_id)
    if (defaultPricelistId) list = await pricelistById(defaultPricelistId)
    const baseId = idOf(settings.base_currency_id ?? settings.order?.base_currency_id)
    targetId = baseId || (list ? idOf(list.currency_id) : 0) || params.mappedCurrencyId || companyCurrencyId
    if (list && idOf(list.currency_id) !== targetId) throw new Error('Configured base currency conflicts with the default pricelist')
  }
  const target = source?.id === targetId && source.active ? source : await currencyById(targetId)

  // The raw Odoo rates share a common anchor. Read actual dated rate rows:
  // res.currency.rate's computed fallback of 1 is not evidence of a real rate.
  let rate = 1
  if (sourceCode !== target.name) {
    const providerRate = qualifiedZidExchangeRate(payload, sourceCode, target.name)
    if (params.mappedCurrencyId === target.id && params.mappedConversionRate !== undefined) {
      if (!Number.isFinite(params.mappedConversionRate) || params.mappedConversionRate <= 0) throw new Error('Invalid configured manual order exchange rate')
      rate = params.mappedConversionRate
    } else if (providerRate !== null) {
      rate = providerRate
    } else {
      const storeCode = extractZidStoreCurrency(payload)
      const sourceToStore = storeCode ? qualifiedZidExchangeRate(payload, sourceCode, storeCode) : null
      let anchorCurrency = source
      if (sourceToStore !== null) {
        const storeCurrencies = await read<Currency>('res.currency', [['name', '=', storeCode]], ['id', 'name', 'active'])
        anchorCurrency = storeCurrencies[0]
      }
      if (!anchorCurrency) throw new Error(`Cannot convert unknown order currency ${sourceCode} to ${target.name}`)
      const rawDate = String(payload.created_at || payload.date || new Date().toISOString())
      const date = new Date(rawDate)
      if (!Number.isFinite(date.getTime())) throw new Error('Invalid order date for currency conversion')
      const day = date.toISOString().slice(0, 10)
      const readRate = async (currencyId: number): Promise<number> => {
        for (const rateCompany of [companyId, false]) {
          const [row] = await read<{ rate: number }>('res.currency.rate', [
            ['currency_id', '=', currencyId], ['company_id', '=', rateCompany], ['name', '<=', day],
          ], ['rate'], 1, 'name desc')
          if (row) {
            if (!Number.isFinite(row.rate) || row.rate <= 0) throw new Error('Invalid configured Odoo exchange rate')
            return row.rate
          }
        }
        // Raw rates share an arbitrary anchor. Even the company's own currency
        // needs a real row; its absolute raw rate is not necessarily 1.
        throw new Error(`Missing dated Odoo exchange rate for ${currencyId} in company ${companyId}`)
      }
      const [anchorRate, targetRate] = await Promise.all([readRate(anchorCurrency.id), readRate(target.id)])
      rate = (sourceToStore ?? 1) * targetRate / anchorRate
      if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid order currency conversion')
    }
  }
  if (!list) {
    const domain: unknown[] = [['currency_id', '=', target.id], ['active', '=', true], '|', ['company_id', '=', companyId], ['company_id', '=', false]]
    const pricelists = await read<Pricelist>('product.pricelist', domain, ['id', 'currency_id', 'company_id', 'active'])
    list = pricelists[0]
    if (!list) {
      if (!params.create) throw new Error(`No ${target.name} pricelist exists for order company ${companyId}`)
      const id = await client.execute<number>('product.pricelist', 'create', [{ name: `${target.name} Pricelist`, currency_id: target.id, company_id: companyId, active: true }], { context })
      list = { id, currency_id: target.id, company_id: companyId, active: true }
    }
  }
  return { companyId, currencyId: target.id, pricelistId: list.id, rate }
}
