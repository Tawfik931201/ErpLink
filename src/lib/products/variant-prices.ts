import type { OdooClient } from '@/lib/odoo-client'

export interface VariantPrice { id: number; valueIds: number[]; price: number }

/** OdooClient.searchRead defaults to 100 rows; product snapshots can be larger. */
export async function readAllProductRows(client: OdooClient, model: string, domain: unknown[], fields: string[]): Promise<any[]> {
  const rows: any[] = []
  const pageSize = 250
  for (let offset = 0; ; offset += pageSize) {
    const page = await client.searchRead<any>(model, domain, fields, pageSize, offset)
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

/** Odoo 14–19: lst_price inverse writes the SHARED template list_price.
 * Solve attribute extras instead; inconsistent combination prices must fail
 * before any write, rather than silently changing siblings' sale prices.
 */
export function solveVariantPriceExtras(base: number, rows: VariantPrice[], current: Record<number, number>): Record<number, number> {
  const ids = [...new Set(rows.flatMap(row => row.valueIds))]
  const matrix = rows.map(row => [
    ...ids.map(id => row.valueIds.includes(id) ? 1 : 0),
    row.price - base - row.valueIds.reduce((sum, id) => sum + (current[id] ?? 0), 0),
  ])
  const pivots: number[] = []
  let rank = 0
  for (let col = 0; col < ids.length && rank < matrix.length; col++) {
    const pivot = matrix.findIndex((row, i) => i >= rank && Math.abs(row[col]) > 1e-9)
    if (pivot < 0) continue
    ;[matrix[rank], matrix[pivot]] = [matrix[pivot], matrix[rank]]
    const scale = matrix[rank][col]
    matrix[rank] = matrix[rank].map(value => value / scale)
    for (let i = 0; i < matrix.length; i++) {
      if (i === rank) continue
      const factor = matrix[i][col]
      if (Math.abs(factor) < 1e-9) continue
      matrix[i] = matrix[i].map((value, j) => value - factor * matrix[rank][j])
    }
    pivots.push(col)
    rank++
  }
  if (matrix.some(row => row.slice(0, -1).every(value => Math.abs(value) < 1e-8) && Math.abs(row[ids.length]) > 1e-6)) {
    throw new Error('Variant prices cannot be represented by Odoo attribute extras. Use AS_SEPARATE_PRODUCTS for independent combination prices.')
  }
  const result = { ...current }
  pivots.forEach((col, row) => { result[ids[col]] = (current[ids[col]] ?? 0) + matrix[row][ids.length] })
  return result
}

export interface VariantPriceSyncResult {
  /** False when combination prices are not representable as attribute extras on Odoo <=19 */
  represented: boolean
  /** Why the price write was skipped (set only when represented === false) */
  reason?: string
}

export async function syncVariantPrices(
  client: OdooClient, templateId: number, prices: Map<number, number>, preserveOthers = false, strict = false,
): Promise<VariantPriceSyncResult> {
  if (!prices.size) return { represented: true }
  if ((await client.getMajorVersion()) >= 20) {
    for (const [id, price] of prices) {
      const written = await client.write('product.product', [id], { lst_price: price })
      if (!written && strict) throw new Error(`Odoo rejected price for variant #${id}`)
    }
    return { represented: true }
  }
  const templates = await client.searchRead<any>('product.template', [['id', '=', templateId]], ['list_price'])
  if (!templates.length) throw new Error(`Missing template #${templateId} while syncing variant prices`)
  const base = Number(templates[0].list_price)
  const variants = await readAllProductRows(client, 'product.product', [['product_tmpl_id', '=', templateId]], ['id', 'product_template_attribute_value_ids', 'lst_price'])
  const extras = await readAllProductRows(client, 'product.template.attribute.value', [['product_tmpl_id', '=', templateId]], ['id', 'price_extra', 'attribute_line_id'])
  const current = Object.fromEntries(extras.map((row: any) => [row.id, Number(row.price_extra) || 0]))
  const rows = variants.filter((row: any) => prices.has(row.id) || preserveOthers).map((row: any) => ({
    id: row.id, valueIds: row.product_template_attribute_value_ids || [], price: prices.get(row.id) ?? Number(row.lst_price),
  }))
  if ([...prices.keys()].some(id => !rows.some(row => row.id === id))) throw new Error('Missing Odoo variant while syncing prices')
  if (!Number.isFinite(base) || rows.some(row => !Number.isFinite(row.price))) throw new Error('Invalid variant price')
  let result: Record<number, number>
  try {
    result = solveVariantPriceExtras(base, rows, current)
  } catch (err: any) {
    // Inconsistent combination prices (store discounts that don't decompose
    // additively into attribute extras) must not fail the whole product sync:
    // the template, variants and stock are already written. Surface the skip
    // to the caller instead of throwing, so it can be logged visibly while
    // the rest of the sync succeeds.
    if (String(err?.message || '').includes('cannot be represented')) {
      console.warn(`[VariantPrices] Prices for template #${templateId} cannot be represented as attribute extras; keeping current extras. ${String(err?.message || err)}`)
      return { represented: false, reason: String(err?.message || err) }
    }
    throw err
  }
  // One ORM call/transaction, with no intermediate partially updated extras.
  const lines = new Map<number, unknown[]>()
  for (const [id, price] of Object.entries(result)) {
    if (Math.abs(price - current[Number(id)]) <= 1e-8) continue
    const extra = extras.find((row: any) => row.id === Number(id))
    const lineId = Array.isArray(extra?.attribute_line_id) ? extra.attribute_line_id[0] : extra?.attribute_line_id
    if (!lineId) throw new Error('Missing Odoo attribute line while syncing prices')
    const commands = lines.get(lineId) || []
    commands.push([1, Number(id), { price_extra: price }])
    lines.set(lineId, commands)
  }
  const commands = [...lines].map(([id, values]) => [1, id, { product_template_value_ids: values }])
  if (commands.length) {
    const written = await client.write('product.template', [templateId], { attribute_line_ids: commands })
    if (!written && strict) throw new Error(`Odoo rejected variant prices for product #${templateId}`)
  }
  return { represented: true }
}
