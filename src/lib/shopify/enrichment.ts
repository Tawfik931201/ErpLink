import { callShopifyGraphQL } from '@/lib/shopify-client'

type ShopifyMetafieldNode = {
  namespace?: string | null
  key?: string | null
  value?: string | null
  type?: string | null
}

function numericId(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.split('/').pop() || ''
}

function gid(type: 'Product' | 'Customer' | 'Order' | 'Collection', value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.startsWith('gid://') ? raw : `gid://shopify/${type}/${numericId(raw)}`
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
  const id = gid('Product', payload.id ?? payload.admin_graphql_api_id)
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
  const id = gid('Customer', payload.id ?? payload.admin_graphql_api_id)
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
  const id = gid('Order', payload.id ?? payload.admin_graphql_api_id)
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
  const id = gid('Collection', payload.id ?? payload.admin_graphql_api_id)
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
