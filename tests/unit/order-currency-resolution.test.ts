import { extractOrderCurrency, qualifiedZidExchangeRate } from '@/lib/odoo/order-currency'
import { resolveOrderCurrencySettings } from '@/lib/odoo/order-currency-resolution'

function fixture(options: { inactiveSource?: boolean; missingRate?: boolean; noPricelist?: boolean; rates?: Record<number, number> } = {}) {
  const currencies = [
    { id: 1, name: 'SAR', active: true }, { id: 2, name: 'USD', active: !options.inactiveSource },
    { id: 3, name: 'AED', active: true },
  ]
  const lists = [
    { id: 10, currency_id: [1, 'SAR'], company_id: false, active: true },
    { id: 11, currency_id: [2, 'USD'], company_id: [7, 'Company'], active: true },
    { id: 12, currency_id: [3, 'AED'], company_id: [8, 'Other company'], active: true },
  ]
  const client: any = {
    searchRead: jest.fn(async (model: string) => model === 'sale.order'
      ? [{ company_id: [7, 'Company'], currency_id: [2, 'USD'], pricelist_id: [11, 'USD list'] }]
      : [{ currency_id: [1, 'SAR'] }]),
    execute: jest.fn(async (model: string, method: string, args: any[], kwargs: any) => {
      if (method === 'default_get') return { company_id: 7 }
      if (method === 'create') return 90
      const domain = args[0]
      const term = (field: string) => domain.find((v: any) => Array.isArray(v) && v[0] === field)?.[2]
      if (model === 'res.currency') return currencies.filter(c => term('id') ? c.id === term('id') : c.name === term('name'))
      if (model === 'product.pricelist') {
        if (term('id')) return lists.filter(p => p.id === term('id'))
        if (options.noPricelist) return []
        // Simulate Odoo applying the actual company/global domain.
        const allowedCompanies = domain.filter((v: any) => Array.isArray(v) && v[0] === 'company_id').map((v: any) => v[2])
        return lists.filter(p => p.currency_id[0] === term('currency_id') && allowedCompanies.includes(Array.isArray(p.company_id) ? p.company_id[0] : false))
      }
      if (model === 'res.currency.rate') {
        expect(kwargs.context.company_id).toBe(7)
        expect(term('name')).toBe('2026-11-04')
        if (options.missingRate || term('company_id') === false) return []
        if (options.rates) return options.rates[term('currency_id')] === undefined ? [] : [{ rate: options.rates[term('currency_id')] }]
        return [{ rate: term('currency_id') === 2 ? 0.25 : 1 }]
      }
      throw new Error(`Unexpected RPC ${model}.${method}`)
    }),
  }
  const run = (settings: Record<string, any> = {}, extra: Record<string, any> = {}) => resolveOrderCurrencySettings({
    client, payload: { currency_code: 'USD', created_at: '2026-11-04T10:00:00Z' },
    values: { company_id: 7 }, settings, create: true, ...extra,
  })
  return { client, run }
}

describe('order currency resolution before pricing', () => {
  const nativeUsd = {
    created_at: '2026-11-04T10:00:00Z',
    currency: {
      order_currency: { id: 2, code: 'USD', exchange_rate: 1 },
      order_store_currency: { id: 4, code: 'SAR', exchange_rate: 3.75634 },
    },
    order_total: 111.62576337605, transaction_amount: 419.30431999999166,
    transaction_amount_string: '419.30 SAR',
  }

  it('uses the native Zid settlement ratio when inactive USD has no Odoo rate', async () => {
    const { client, run } = fixture({ inactiveSource: true, missingRate: true })
    expect(extractOrderCurrency(nativeUsd)).toBe('USD')
    const result = await run({ multi_currency_enabled: true }, { payload: nativeUsd })
    expect(result).toMatchObject({ currencyId: 1, pricelistId: 10 })
    expect(result.rate).toBeCloseTo(nativeUsd.transaction_amount / nativeUsd.order_total, 12)
    expect(client.execute.mock.calls.some(([model]: [string]) => model === 'res.currency.rate')).toBe(false)
  })

  it('honors an explicitly configured static manual rate only for its mapped target', async () => {
    const { run } = fixture({ missingRate: true })
    expect((await run({}, { payload: nativeUsd, mappedCurrencyId: 1, mappedConversionRate: 3.8 })).rate).toBe(3.8)
    expect((await run({}, { mappedCurrencyId: 2, mappedConversionRate: 3.8 })).rate).toBe(1)
  })

  it('does not apply the USD-to-SAR settlement ratio directly to an AED target', async () => {
    const { run } = fixture({ inactiveSource: true, rates: { 1: 3.75634, 3: 3.6725 } })
    const result = await run({ base_currency_id: 3 }, { payload: nativeUsd })
    expect(result.currencyId).toBe(3)
    expect(result.rate).toBeCloseTo((nativeUsd.transaction_amount / nativeUsd.order_total) * 3.6725 / 3.75634, 12)
  })

  it('preserves the arbitrary raw rate anchor instead of treating the company SAR rate as one', async () => {
    const { run } = fixture({ rates: { 1: 3.75634, 2: 1 } })
    expect((await run()).rate).toBeCloseTo(3.75634, 12)
  })

  it('refuses a missing company-currency raw rate rather than inventing an anchor', async () => {
    const { run } = fixture({ rates: { 2: 1 } })
    await expect(run()).rejects.toThrow('Missing dated Odoo exchange rate for 1')
  })

  it('requires declared source and target currencies before using transaction totals', () => {
    expect(qualifiedZidExchangeRate({ order_total: 100, transaction_amount: 375 }, 'USD', 'SAR')).toBeNull()
    expect(qualifiedZidExchangeRate(nativeUsd, 'USD', 'AED')).toBeNull()
    expect(() => qualifiedZidExchangeRate({ ...nativeUsd, transaction_amount_string: '419.30 AED' }, 'USD', 'SAR')).toThrow('settlement currency conflicts')
  })

  it('keeps an active source currency and a company-compatible pricelist when multi-currency is enabled', async () => {
    const { client, run } = fixture()
    expect(await run({ multi_currency_enabled: true })).toEqual({ companyId: 7, currencyId: 2, pricelistId: 11, rate: 1 })
    expect(client.execute.mock.calls.some(([model]: [string]) => model === 'res.currency.rate')).toBe(false)
    const call = client.execute.mock.calls.find(([model]: [string]) => model === 'product.pricelist')!
    expect(call[2][0]).toEqual(expect.arrayContaining(['|', ['company_id', '=', 7], ['company_id', '=', false]]))
  })

  it('converts source prices into the company currency when multi-currency is disabled', async () => {
    const { run } = fixture()
    expect(await run({ multi_currency_enabled: false })).toEqual({ companyId: 7, currencyId: 1, pricelistId: 10, rate: 4 })
  })

  it('uses the selected non-SAR base and creates its pricelist in the order company', async () => {
    const { client, run } = fixture()
    expect(await run({ base_currency_id: 3 })).toEqual({ companyId: 7, currencyId: 3, pricelistId: 90, rate: 4 })
    const create = client.execute.mock.calls.find((call: any[]) => call[1] === 'create')!
    expect(create[2][0]).toMatchObject({ currency_id: 3, company_id: 7 })
  })

  it('converts inactive source currency to the fallback rather than recording foreign amounts as base amounts', async () => {
    const { run } = fixture({ inactiveSource: true })
    expect(await run({ multi_currency_enabled: true })).toMatchObject({ currencyId: 1, pricelistId: 10, rate: 4 })
  })

  it('preserves an explicit mapped pricelist even when multi-currency is enabled', async () => {
    const { run } = fixture()
    expect(await run({ multi_currency_enabled: true }, { values: { company_id: 7, pricelist_id: 10 } })).toMatchObject({ currencyId: 1, pricelistId: 10, rate: 4 })
  })

  it('rejects conflicting explicit currency and pricelist before creating anything', async () => {
    const { client, run } = fixture()
    await expect(run({}, { values: { company_id: 7, pricelist_id: 10, currency_id: 2 } })).rejects.toThrow('conflicts')
    expect(client.execute.mock.calls.some((call: any[]) => call[1] === 'create')).toBe(false)
  })

  it('rejects an explicit pricelist from another company', async () => {
    const { run } = fixture()
    await expect(run({}, { values: { company_id: 7, pricelist_id: 12 } })).rejects.toThrow('unavailable for company')
  })

  it('uses a static currency mapping as the disabled-mode target with a matching pricelist', async () => {
    const { run } = fixture()
    expect(await run({}, { mappedCurrencyId: 2 })).toMatchObject({ currencyId: 2, pricelistId: 11, rate: 1 })
  })

  it('resolves the default company before selecting its currency', async () => {
    const { client, run } = fixture()
    await run({}, { values: {} })
    expect(client.execute).toHaveBeenCalledWith('sale.order', 'default_get', [['company_id']])
  })

  it('preserves an existing order currency without changing prices when settings change', async () => {
    const { client, run } = fixture()
    expect(await run({ base_currency_id: 3 }, { existingOrderId: 120, create: false })).toEqual({ companyId: 7, currencyId: 2, pricelistId: 11, rate: 1 })
    expect(client.execute).not.toHaveBeenCalled()
  })

  it('refuses missing rates instead of silently using a 1:1 conversion or creating a pricelist', async () => {
    const { client, run } = fixture({ missingRate: true, noPricelist: true })
    await expect(run({ base_currency_id: 3 })).rejects.toThrow('Missing dated Odoo exchange rate')
    expect(client.execute.mock.calls.some((call: any[]) => call[1] === 'create')).toBe(false)
  })

  it('refuses unknown order currencies rather than using legacy default exchange rates', async () => {
    const { run } = fixture()
    await expect(run({}, { payload: { currency_code: 'XYZ' } })).rejects.toThrow('unknown order currency')
  })
})
