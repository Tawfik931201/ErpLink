import type { OdooClient } from '@/lib/odoo-client'

type ProductClient = Pick<OdooClient, 'execute'>
const lookups = new WeakMap<ProductClient, Map<string, { id: number; expiresAt: number }>>()

/** Legacy matching is used only when no explicit product match pair is configured. */
export async function findUniqueOrderLineProduct(
  client: ProductClient,
  value: string,
  scopeKey = '',
): Promise<number | null> {
  const trimmed = value.trim()
  if (!trimmed) return null
  let cache = lookups.get(client)
  if (!cache) { cache = new Map(); lookups.set(client, cache) }
  const key = JSON.stringify([scopeKey, trimmed])
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.id
  for (const [field, operator] of [
    ['default_code', '='], ['default_code', '=ilike'],
    ['barcode', '='], ['barcode', '=ilike'], ['name', '=ilike'],
  ]) {
    const matches = await client.execute<number[]>('product.product', 'search', [
      [[field, operator, trimmed]],
    ], { limit: 2 })
    const ids = [...new Set((matches || []).map(Number).filter(id => Number.isInteger(id) && id > 0))]
    if (ids.length > 1) throw new Error(`Ambiguous order product match: ${field}=${trimmed}`)
    if (ids.length === 1) {
      if (cache.size >= 500) cache.delete(cache.keys().next().value!)
      cache.set(key, { id: ids[0], expiresAt: Date.now() + 5 * 60_000 })
      return ids[0]
    }
  }
  return null
}
