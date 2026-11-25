import { callShopifyGraphQL } from '@/lib/shopify-client'

type ShopifyMetafieldNode = {
  namespace?: string | null
  key?: string | null
  value?: string | null
  type?: string | null
}

type ShopifyResourceType = 'Product' | 'Customer' | 'Order' | 'Collection'

function gid(type: ShopifyResourceType, value: unknown): string {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return ''
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  const raw = String(value).trim()
  const prefix = `gid://shopify/${type}/`
  const id = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
  return /^[1-9]\d*$/.test(id) ? prefix + id : ''
}

function resourceGid(type: ShopifyResourceType, payload: Record<string, unknown>): string {
  // Prefer the exact GraphQL identifier over a JSON number that may already
  // have lost precision during parsing. Never guess an unsafe numeric ID.
  return gid(type, payload.admin_graphql_api_id) || gid(type, payload.id)
}

/**
 * Converts Shopify metafields into a mapping-friendly nested object:
 * metafields.custom.external_code -> "ABC".
 *
 * The original typed rows are preserved separately in metafield_rows.
 */
export function normalizeShopifyMetafields(nodes: ShopifyMetafieldNode[] | null | undefined) {
  const nested: Record<string, Record<string, string>> = {}
  const rows = (nodes || []).filter(Boolean).map((node) => ({
    namespace: String(node.namespace || ''),
    key: String(node.key || ''),
    value: String(node.value ?? ''),
    type: String(node.type || ''),
  }))

  for (const row of rows) {
    if (!row.namespace || !row.key) continue
    if (!nested[row.namespace]) nested[row.namespace] = {}
    nested[row.namespace][row.key] = row.value
  }

  return {
    metafields: nested,
    metafield_rows: rows,
    metafields_json: JSON.stringify(nested),
  }
}

function metafieldNodes(resource: any): ShopifyMetafieldNode[] {
  return resource?.metafields?.nodes || resource?.metafields?.edges?.map((e: any) => e?.node).filter(Boolean) || []
}

function mergeMetafields(payload: Record<string, unknown>, resource: any): Record<string, unknown> {
  if (!resource) return payload
  return {
    ...payload,
    ...normalizeShopifyMetafields(metafieldNodes(resource)),
  }
}

async function enrichProduct(shop: string, payload: Record<string, unknown>) {
  const id = resourceGid('Product', payload)
  if (!id) return payload
  const data = await callShopifyGraphQL(
    shop,
    `query ErpLinkProductMetafields($id: ID!) {
      product(id: $id) {
        metafields(first: 100) { nodes { namespace key value type } }
      }
    }`,
    { id }
  )
  return mergeMetafields(payload, data?.product)
}

async function enrichCustomer(shop: string, payload: Record<string, unknown>) {
  const id = resourceGid('Customer', payload)
  if (!id) return payload
  const data = await callShopifyGraphQL(
    shop,
    `query ErpLinkCustomerMetafields($id: ID!) {
      customer(id: $id) {
        metafields(first: 100) { nodes { namespace key value type } }
      }
    }`,
    { id }
  )
  return mergeMetafields(payload, data?.customer)
}

async function enrichOrder(shop: string, payload: Record<string, unknown>) {
  const id = resourceGid('Order', payload)
  if (!id) return payload
  const data = await callShopifyGraphQL(
    shop,
    `query ErpLinkOrderMetafields($id: ID!) {
      order(id: $id) {
        metafields(first: 100) { nodes { namespace key value type } }
      }
    }`,
    { id }
  )
  return mergeMetafields(payload, data?.order)
}

async function enrichCollection(shop: string, payload: Record<string, unknown>) {
  const id = resourceGid('Collection', payload)
  if (!id) return payload
  const data = await callShopifyGraphQL(
    shop,
    `query ErpLinkCollectionMetafields($id: ID!) {
      collection(id: $id) {
        metafields(first: 100) { nodes { namespace key value type } }
      }
    }`,
    { id }
  )
  return mergeMetafields(payload, data?.collection)
}

/**
 * Shopify-specific enrichment. It deliberately lives outside the generic sync
 * engine and never imports Zid/Salla code.
 *
 * Metafields are not guaranteed to be present in standard webhook payloads.
 * We fetch them through GraphQL so custom mappings can address paths such as
 * `metafields.custom.external_code`. Missing optional/protected scopes fail
 * open: the original authenticated webhook payload is still processed.
 */
export async function prepareShopifyWebhookData(
  payload: Record<string, unknown>,
  shopDomain: string,
  event: string
): Promise<Record<string, unknown>> {
  const normalized = event.toLowerCase()
  try {
    if (normalized.startsWith('products/')) return await enrichProduct(shopDomain, payload)
    if (normalized.startsWith('customers/')) return await enrichCustomer(shopDomain, payload)
    if (normalized.startsWith('orders/')) return await enrichOrder(shopDomain, payload)
    if (normalized.startsWith('collections/')) return await enrichCollection(shopDomain, payload)
  } catch (error: any) {
    // Optional/protected scopes (especially read_customers) can be absent.
    // A custom-field enrichment failure must never discard a valid webhook.
    console.warn('[Shopify] Metafield enrichment skipped:', error?.message || error)
  }
  return payload
}
