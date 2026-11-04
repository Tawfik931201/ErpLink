import type { OdooClient } from '@/lib/odoo-client'
import { toNameString } from '@/lib/sync-helpers'

export interface CategoryField {
  type: string
  readonly?: boolean
  string?: string
  selection?: Array<[string, string]>
}

// An operation-local facade: never mutate a shared client's company context.
export function categoryCompanyClient(client: OdooClient, company: unknown): OdooClient {
  const id = Number(company)
  if (!Number.isInteger(id) || id <= 0) return client
  const scoped = Object.create(client) as OdooClient
  scoped.execute = (model, method, args, kwargs = {}) => client.execute(model, method, args, {
    ...kwargs,
    context: { ...(kwargs.context as object || {}), allowed_company_ids: [id], force_company: id },
  })
  return scoped
}

export async function categoryFields(client: OdooClient): Promise<Record<string, CategoryField>> {
  const fields = await client.execute<Record<string, CategoryField>>('product.category', 'fields_get', [], {
    attributes: ['type', 'readonly', 'selection', 'string'],
  })
  if (!fields?.name) throw new Error('Cannot verify Odoo category fields')
  return fields
}

export function categoryMatchValue(value: unknown, field: CategoryField): string | number | boolean {
  if (field.type === 'char' || field.type === 'text' || field.type === 'selection') {
    const text = toNameString(value)
    if (!text) throw new Error('Category match value is empty')
    if (field.selection && !field.selection.some(([key]) => key === text)) throw new Error('Invalid category match selection')
    return text
  }
  if (field.type === 'integer' || field.type === 'float') {
    const number = Number(value)
    if (!Number.isFinite(number) || (field.type === 'integer' && !Number.isSafeInteger(number))) throw new Error('Invalid numeric category match value')
    return number
  }
  throw new Error(`Unsupported category match field type: ${field.type}`)
}

export function prepareCategoryValues(values: Record<string, unknown>, fields: Record<string, CategoryField>): Record<string, unknown> {
  const result = { ...values }
  delete result.id
  const aliases: Record<string, string[]> = {
    property_stock_journal_id: ['property_stock_journal'],
    property_stock_input_account_id: ['property_stock_account_input_categ_id'],
    property_stock_output_account_id: ['property_stock_account_output_categ_id'],
  }
  for (const [legacy, candidates] of Object.entries(aliases)) {
    if (result[legacy] === undefined || fields[legacy]) continue
    const target = candidates.find(name => fields[name])
    if (target) { result[target] = result[legacy]; delete result[legacy] }
  }
  const valuation = fields.property_valuation?.selection
  if (result.property_valuation === 'manual_periodic' && valuation?.some(([key]) => key === 'periodic') && !valuation.some(([key]) => key === 'manual_periodic')) result.property_valuation = 'periodic'
  if (result.property_valuation === 'periodic' && valuation?.some(([key]) => key === 'manual_periodic') && !valuation.some(([key]) => key === 'periodic')) result.property_valuation = 'manual_periodic'
  // Standard Odoo 14–19 shares categories; Odoo 20/custom modules can expose company_id.
  if (!fields.company_id) delete result.company_id
  for (const [key, value] of Object.entries(result)) {
    const field = fields[key]
    if (!field || field.readonly) throw new Error(`Odoo category field is missing or readonly: ${key}`)
    if (field.selection && value !== false && !field.selection.some(([option]) => option === value)) {
      throw new Error(`Unsupported Odoo category setting: ${key}=${String(value)}`)
    }
  }
  return result
}

export async function archiveCategory(client: OdooClient, id: number): Promise<boolean> {
  const fields = await categoryFields(client)
  if (fields.active && !fields.active.readonly) return client.write('product.category', [id], { active: false })
  const rows = await client.searchRead<{ name: string }>('product.category', [['id', '=', id]], ['name'], 1)
  if (!rows[0]) throw new Error(`Category ${id} no longer exists`)
  const name = rows[0].name
  return client.write('product.category', [id], { name: /^\[(Archived|ملغي)\]/.test(name) ? name : `[Archived] ${name}` })
}
