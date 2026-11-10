import type { RelatedMatchIdentity } from '@/lib/orders/related-matching'
import { acquirePullToken } from '@/lib/store-pull-budget'

import { resolveZidOrderTokenScope, zidOrderCacheScope } from './order-enrichment'
import { getAccessToken } from './token'

const reads = new WeakMap<object, Map<string, Promise<Record<string, unknown>>>>()

/** Hydrate only a missing match key; amounts/quantities still come from the order. */
export async function readOrderRelatedDetails(
  executionClient: object,
  identity: RelatedMatchIdentity,
  entity: 'products' | 'customers',
  source: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = source.id ?? (entity === 'products' ? source.product_id : source.customer_id)
  if ((typeof id !== 'string' && typeof id !== 'number') || !String(id).trim()) throw new Error('A store entity ID is required to load the missing match key')
  let cache = reads.get(executionClient)
  if (!cache) { cache = new Map(); reads.set(executionClient, cache) }
  const key = JSON.stringify([identity.workspaceId, identity.platform, identity.storeId, entity, id])
  const saved = cache.get(key)
  if (saved) return saved
  const read = (async () => {
    const token = await resolveZidOrderTokenScope(identity.storeId, identity.workspaceId)
    if (!token) throw new Error('No linked Zid store is available for related details')
    const scope = zidOrderCacheScope(identity.workspaceId, String(token.store_id || identity.storeId))
    if (!await acquirePullToken('zid', scope)) throw new Error('Zid related details pull budget exhausted; reschedule the order')
    const credentials = await getAccessToken(token.merchant_id, identity.workspaceId)
    const creds = { authorization: credentials.authorization || '', managerToken: credentials.accessToken, storeId: token.store_id || token.merchant_id }
    const { ZidAPI } = await import('@/lib/zid-client')
    const response = entity === 'products'
      ? await ZidAPI.products.get(creds, String(id))
      : await ZidAPI.customers.get(creds, String(id))
    const body = response.data as unknown as Record<string, unknown>
    const details = body?.[entity === 'products' ? 'product' : 'customer'] ?? body?.data ?? body
    if (!details || typeof details !== 'object' || Array.isArray(details)) throw new Error('Zid related details response is incomplete')
    const record = details as Record<string, unknown>
    if (record.id !== undefined && String(record.id) !== String(id)) throw new Error('Zid returned a different related entity')
    return { ...source, ...record }
  })().catch(error => { cache!.delete(key); throw error })
  if (cache.size >= 500) cache.delete(cache.keys().next().value!)
  cache.set(key, read)
  return read
}
