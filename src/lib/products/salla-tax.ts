import type { OdooClient } from '@/lib/odoo-client'
import { resolvePath } from '@/lib/sync-helpers'

import { finiteProductNumber, sallaMoneyAmount } from './settings-values'

function taxRate(data: Record<string, unknown>): number | undefined {
  const explicit = finiteProductNumber(data.tax_rate ?? resolvePath(data, 'tax.rate'))
  if (explicit !== undefined && explicit >= 0) return explicit
  // Salla's tax.amount is money. Infer a rate only with a positive net price
  // and a positive tax amount in the same currency.
  const currency = resolvePath(data, 'tax.currency')
  const netCurrency = resolvePath(data, 'pre_tax_price.currency')
  if ((typeof currency === 'string' || typeof netCurrency === 'string') && currency !== netCurrency) return undefined
  const amount = sallaMoneyAmount(data.tax)
  const net = sallaMoneyAmount(data.pre_tax_price)
  if (amount === undefined || amount <= 0 || net === undefined || net <= 0) return undefined
  return Math.round(amount / net * 10_000) / 100
}

export async function findSallaProductTax(
  client: OdooClient, data: Record<string, unknown>, companyId: unknown,
  mappedId?: number,
): Promise<number | undefined> {
  const domain: unknown[][] = [['type_tax_use', '=', 'sale']]
  const company = finiteProductNumber(companyId)
  if (company && company > 0) domain.push(['company_id', '=', company])
  if (mappedId) {
    const [id] = await client.search('account.tax', [...domain, ['id', '=', mappedId]], 1)
    if (!id) throw new Error('The mapped Salla sales tax is unavailable in the selected Odoo company')
    return id
  }
  const rawName = data.tax_name ?? resolvePath(data, 'tax.name') ?? data.tax
  const name = typeof rawName === 'string' && !Number.isFinite(Number(rawName)) ? rawName.trim() : ''
  const rate = taxRate(data)
  if (!name && rate === undefined) return undefined
  const rateDomain = rate === undefined ? [] : [['amount_type', '=', 'percent'], ['amount', '=', rate]]
  let ids = name ? await client.search('account.tax', [...domain, ['name', '=', name], ...rateDomain], 2) : []
  if (!ids.length && rateDomain.length) ids = await client.search('account.tax', [...domain, ...rateDomain], 2)
  if (ids.length !== 1) throw new Error('Automatic Salla sales tax requires one matching Odoo tax; select a specific tax in Standard Mapping')
  return ids[0]
}
