import crypto from 'crypto'

import axios from 'axios'

import { getShopifyAccessToken } from './shopify/offline-token'

/** Shopify Admin API version — keep in sync with shopify.app.toml.
 * المصدر: env SHOPIFY_API_VERSION (موثّق في .env.example). لا تكتب نسخة يدوياً.
 *
 * ملاحظة الصلاحيات (protected customer data + read_all_orders):
 * - التثبيت الأدنى read-only (read_products/read_orders/...) يكفي لآخر 60 يوماً.
 * - الطلبات الأقدم تحتاج read_all_orders (موافقة من Partner Dashboard).
 * - customers/* يحتاج read_customers (بيانات محمية — موافقة + مبرر استخدام).
 *   https://shopify.dev/docs/apps/launch/protected-customer-data
 */
export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10'

// ─── Topic catalog (single source of truth) ──────────────────────────────
// Full list lives in ./shopify-topics.ts — TOML / UI / mapping-constants must
// stay in sync with it (see file header for the 4 places to update).
export {
  SHOPIFY_ALL_SYSTEM_TOPICS,
  SHOPIFY_CORE_TOPICS,
  SHOPIFY_GDPR_TOPICS,
  SHOPIFY_SCOPES_UPDATE_TOPIC,
  SHOPIFY_SYSTEM_TOPICS,
  SHOPIFY_TOPIC_CATALOG,
  isShopifyUpdateTopic,
} from './shopify-topics'

/** نطاق متجر شوبيفاي الصالح: xxx.myshopify.com فقط (يُرفض أي مسار/استعلام). */
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i

/** هل نطاق المتجر صالح؟ (يُستخدم في connect/callback/webhook لمنع الحقن) */
export function isValidShopDomain(shop: string): boolean {
  return SHOP_DOMAIN_RE.test((shop || '').trim().toLowerCase())
}

/** طبّع مدخل المستخدم (رابط كامل/نطاق) إلى نطاق نظيف أو '' عند الفشل. */
export function normalizeShopDomain(input: string): string {
  const raw = (input || '').trim().toLowerCase()
  if (!raw) return ''
  const noProto = raw.replace(/^(https?:\/\/)/, '')
  const host = noProto.split('/')[0].split('?')[0].split('#')[0].trim()
  return SHOP_DOMAIN_RE.test(host) ? host : ''
}

/** Build an Admin API URL with the shared version constant (never hardcode). */
export function shopifyApiUrl(shopDomain: string, endpoint: string): string {
  const clean = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  return `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${clean}`
}

/** Sleep helper for 429 Retry-After backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Extract Retry-After delay (ms) from a Shopify 429 response.
 * Shopify sends `Retry-After: <seconds>` (default 2s when missing) plus
 * rate-limit headers (X-Shopify-Shop-Api-Call-Limit). We honor Retry-After
 * and cap the wait at 10s to keep server actions responsive.
 */
export function getShopifyRetryDelayMs(err: any): number {
  const raw = err?.response?.headers?.['retry-after'] ?? err?.response?.headers?.['Retry-After']
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 10_000)
  return 2000
}

/**
 * تحقق HMAC لمسار OAuth callback (query string).
 * يستخدم raw query مع الحفاظ على الترميز، ومقارنة ثابتة الزمن.
 * يُرجع false عند غياب hmac أو اختلاف الأطوال.
 */
export function verifyShopifyCallbackHmac(url: string, clientSecret: string): boolean {
  try {
    const urlObj = new URL(url)
    const hmac = urlObj.searchParams.get('hmac')
    if (!hmac || !clientSecret) return false
    const rawQuery = urlObj.search.startsWith('?') ? urlObj.search.slice(1) : urlObj.search
    const message = rawQuery
      .split('&')
      .filter((pair) => {
        const key = pair.split('=')[0]
        return key !== 'hmac' && key !== 'signature'
      })
      .sort()
      .join('&')
    const expected = crypto.createHmac('sha256', clientSecret).update(message).digest('hex')
    const a = Buffer.from(hmac, 'utf8')
    const b = Buffer.from(expected, 'utf8')
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export interface ShopifyTokenRow {
  shop_domain: string
  access_token: string
  scopes: string | null
  updated_at: string
  name: string | null
  email: string | null
  workspace_id: string | null
  sync_settings: any
}

export { getShopifyAccessToken } from './shopify/offline-token'

/**
 * Per-request timeout for every Shopify Admin API call (GraphQL and REST).
 *
 * Without it a hung Shopify connection blocks the caller indefinitely — and the
 * caller is usually a sync-queue worker holding a concurrency slot, so one
 * stalled TCP connection leaks a slot until the process restarts. Matches the
 * 30s used by zidClient. A timeout surfaces as a normal axios error, so the
 * queue treats it as a transient failure and retries.
 */
const SHOPIFY_REQUEST_TIMEOUT_MS = 30_000

/**
 * Helper to call Shopify GraphQL Admin API.
 */
export async function callShopifyGraphQL(shopDomain: string, query: string, variables?: any, _retried = false) {
  const token = await getShopifyAccessToken(shopDomain)
  const url = shopifyApiUrl(shopDomain, '/graphql.json')

  try {
    const response = await axios({
      method: 'POST',
      url,
      timeout: SHOPIFY_REQUEST_TIMEOUT_MS,
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      data: JSON.stringify({ query, variables }),
    })

    if (response.data.errors) {
      throw new Error(`Shopify GraphQL Error: ${JSON.stringify(response.data.errors)}`)
    }

    return response.data.data
  } catch (err: any) {
    // 429: honor Retry-After once (Shopify sends seconds, capped in helper).
    if (err?.response?.status === 429 && !_retried) {
      await sleep(getShopifyRetryDelayMs(err))
      return callShopifyGraphQL(shopDomain, query, variables, true)
    }
    throw err
  }
}

/**
 * Helper to call Shopify REST Admin API.
 */
export async function callShopifyREST(
  shopDomain: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  data?: any,
  _retried = false
) {
  const token = await getShopifyAccessToken(shopDomain)
  const url = shopifyApiUrl(shopDomain, endpoint)

  try {
    const response = await axios({
      method,
      url,
      timeout: SHOPIFY_REQUEST_TIMEOUT_MS,
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      data,
    })
    return response.data
  } catch (err: any) {
    // 429: honor Retry-After once.
    if (err?.response?.status === 429 && !_retried) {
      await sleep(getShopifyRetryDelayMs(err))
      return callShopifyREST(shopDomain, method, endpoint, data, true)
    }
    throw err
  }
}

/** معرّف الكيان من payload الويبهوك (id الرقمي أو GID) — للدمج وكشف التكرار. */
export function extractShopifyEntityId(payload: any): string {
  const raw = payload?.id ?? payload?.admin_graphql_api_id ?? ''
  const s = String(raw).trim()
  if (!s) return ''
  // gid://shopify/Product/123 → 123
  const parts = s.split('/')
  return parts[parts.length - 1]
}

/**
 * طابع الحداثة من payload الويبهوك (updated_at أولاً ثم created_at).
 * يُستخدم لتجاهل الأحداث خارج الترتيب في الدفعات. يُرجع 0 عند غيابه.
 */
export function extractShopifyUpdatedAtMs(payload: any): number {
  const raw =
    payload?.updated_at ?? payload?.updatedAt ?? payload?.modified_at ?? payload?.created_at ?? payload?.createdAt ?? null
  if (!raw) return 0
  const ms = Date.parse(String(raw))
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Finds a product in Shopify by matching SKU or barcode.
 * Uses GraphQL for fast and precise lookup across all variants.
 */
export async function findShopifyProductByMatchField(
  shopDomain: string,
  matchField: 'sku' | 'barcode' | 'id',
  value: string
): Promise<any | null> {
  if (!value) return null
  if (matchField === 'id') {
    // GraphQL بدل REST المتقادم (قراءة واحدة خفيفة).
    try {
      const numeric = String(value).split('/').pop()
      const gid = String(value).startsWith('gid://') ? String(value) : `gid://shopify/Product/${numeric}`
      const data = await callShopifyGraphQL(
        shopDomain,
        `query getProduct($id: ID!) { product(id: $id) { id title bodyHtml status variants(first: 1) { edges { node { id title price sku barcode } } } images(first: 1) { edges { node { url } } } } }`,
        { id: gid }
      )
      const p = data?.product
      if (!p) return null
      const v = p.variants?.edges?.[0]?.node
      return {
        id: String(p.id).split('/').pop(),
        title: p.title,
        body_html: p.bodyHtml,
        status: String(p.status || 'active').toLowerCase(),
        variants: v
          ? [{ id: String(v.id).split('/').pop(), title: v.title, price: v.price, sku: v.sku, barcode: v.barcode }]
          : [],
        images: p.images?.edges?.map((e: any) => ({ src: e.node.url })) || [],
      }
    } catch {
      return null
    }
  }

  // GraphQL query to search variants by SKU or barcode
  const query = `
    query searchProduct($query: String!) {
      productVariants(first: 1, query: $query) {
        edges {
          node {
            id
            title
            sku
            barcode
            price
            product {
              id
              title
              handle
              bodyHtml
              status
              images(first: 1) {
                edges {
                  node {
                    url
                  }
                }
              }
            }
          }
        }
      }
    }
  `

  try {
    const queryString = `${matchField}:${value}`
    const data = await callShopifyGraphQL(shopDomain, query, { query: queryString })
    const edges = data?.productVariants?.edges || []
    
    if (edges.length === 0) return null

    const variantNode = edges[0].node
    const productNode = variantNode.product

    // Format like REST product payload to match SyncEngine expectations
    return {
      id: productNode.id.split('/').pop(), // Extract ID from GraphQL GID (e.g. gid://shopify/Product/12345)
      title: productNode.title,
      body_html: productNode.bodyHtml,
      status: productNode.status.toLowerCase(),
      variants: [
        {
          id: variantNode.id.split('/').pop(),
          title: variantNode.title,
          price: variantNode.price,
          sku: variantNode.sku,
          barcode: variantNode.barcode,
        }
      ],
      images: productNode.images?.edges?.map((e: any) => ({ src: e.node.url })) || [],
    }
  } catch {
    return null
  }
}

function shopifyProductSetInput(data: any): Record<string, any> {
  const input: Record<string, any> = {}
  if (data?.title ?? data?.name) input.title = String(data.title ?? data.name)
  if (data?.body_html ?? data?.descriptionHtml ?? data?.description) {
    input.descriptionHtml = String(data.body_html ?? data.descriptionHtml ?? data.description)
  }
  if (data?.vendor != null) input.vendor = String(data.vendor)
  if (data?.product_type ?? data?.productType) input.productType = String(data.product_type ?? data.productType)
  if (data?.handle) input.handle = String(data.handle)
  if (data?.status) input.status = String(data.status).toUpperCase()
  if (data?.tags) {
    input.tags = Array.isArray(data.tags)
      ? data.tags.map(String)
      : String(data.tags).split(',').map((v) => v.trim()).filter(Boolean)
  }

  const rawVariants = Array.isArray(data?.variants) ? data.variants : []
  const rawOptions = Array.isArray(data?.options) ? data.options : []
  if (rawVariants.length > 0) {
    const options = rawOptions.length > 0
      ? rawOptions.slice(0, 3).map((option: any, index: number) => ({
          name: String(option?.name || `Option ${index + 1}`),
          position: index + 1,
          values: (Array.isArray(option?.values) ? option.values : [])
            .map((value: any) => ({ name: String(value) })),
        }))
      : [{ name: 'Title', position: 1, values: [{ name: 'Default Title' }] }]

    input.productOptions = options
    input.variants = rawVariants.map((variant: any) => {
      const optionValues = rawOptions.length > 0
        ? options.map((option: any, index: number) => ({
            optionName: option.name,
            name: String(variant?.[`option${index + 1}`] || option.values?.[0]?.name || 'Default'),
          }))
        : [{ optionName: 'Title', name: 'Default Title' }]
      const row: Record<string, any> = { optionValues }
      if (variant?.id && String(variant.id).startsWith('gid://')) row.id = String(variant.id)
      if (variant?.price != null) row.price = String(variant.price)
      if (variant?.compare_at_price != null) row.compareAtPrice = String(variant.compare_at_price)
      if (variant?.sku != null) row.sku = String(variant.sku)
      if (variant?.barcode != null) row.barcode = String(variant.barcode)
      return row
    })
  }
  return input
}

async function productSet(
  shopDomain: string,
  data: any,
  identifier?: { id?: string; handle?: string }
) {
  const mutation = `
    mutation ErpLinkProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
      productSet(input: $input, identifier: $identifier, synchronous: true) {
        product { id title handle }
        userErrors { field message code }
      }
    }
  `
  const response = await callShopifyGraphQL(shopDomain, mutation, {
    input: shopifyProductSetInput(data),
    identifier: identifier || null,
  })
  const result = response?.productSet
  if (result?.userErrors?.length) {
    throw new Error(result.userErrors.map((e: any) => e.message).join('; '))
  }
  return result?.product
}

/** Updates a Shopify product through the current GraphQL productSet API. */
export async function updateShopifyProduct(shopDomain: string, shopifyProductId: string, data: any) {
  const raw = String(shopifyProductId || '')
  const id = raw.startsWith('gid://') ? raw : `gid://shopify/Product/${raw}`
  return productSet(shopDomain, data, { id })
}

/** Creates a Shopify product through the current GraphQL productSet API. */
export async function createShopifyProduct(shopDomain: string, data: any) {
  return productSet(shopDomain, data)
}

/**
 * Convert Shopify REST-style webhook slugs (orders/create) to the GraphQL
 * WebhookSubscriptionTopic enum (ORDERS_CREATE), and back.
 */
function shopifyTopicEnum(topic: string): string {
  return String(topic || '').trim().replace('/', '_').toUpperCase()
}

function shopifyTopicSlug(topic: string): string {
  const lower = String(topic || '').trim().toLowerCase()
  const split = lower.indexOf('_')
  return split < 0 ? lower : `${lower.slice(0, split)}/${lower.slice(split + 1)}`
}

/**
 * Register a shop-scoped webhook through GraphQL Admin API.
 * App-scoped subscriptions are also declared in shopify.app.toml; this dynamic
 * path exists so per-store Mapping Center toggles can be reconciled safely.
 */
export async function registerShopifyWebhook(shopDomain: string, topic: string, _accessToken?: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  if (!appUrl) return null
  const address = `${appUrl}/api/webhooks/shopify`
  const mutation = `
    mutation ErpLinkWebhookCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        webhookSubscription { id topic uri }
        userErrors { field message }
      }
    }
  `
  try {
    const data = await callShopifyGraphQL(shopDomain, mutation, {
      topic: shopifyTopicEnum(topic),
      webhookSubscription: { uri: address },
    })
    const result = data?.webhookSubscriptionCreate
    if (result?.userErrors?.length) {
      const duplicateOnly = result.userErrors.every((e: any) =>
        String(e?.message || '').toLowerCase().includes('already')
      )
      if (!duplicateOnly) {
        console.warn('[Shopify] webhookSubscriptionCreate:', result.userErrors)
        return null
      }
    }
    return result?.webhookSubscription || { topic, uri: address }
  } catch (err: any) {
    console.warn('[Shopify] GraphQL webhook registration failed:', err?.message || err)
    return null
  }
}

/** Lists shop-scoped webhook subscriptions created through the Admin API. */
export async function listShopifyWebhooks(shopDomain: string): Promise<any[]> {
  try {
    const data = await callShopifyGraphQL(
      shopDomain,
      `query ErpLinkWebhooks {
        webhookSubscriptions(first: 250) {
          nodes { id topic uri }
        }
      }`
    )
    return (data?.webhookSubscriptions?.nodes || []).map((wh: any) => ({
      id: wh.id,
      topic: shopifyTopicSlug(wh.topic),
      address: wh.uri,
      uri: wh.uri,
    }))
  } catch {
    return []
  }
}

async function deleteShopifyWebhookSubscription(shopDomain: string, id: string): Promise<boolean> {
  try {
    const data = await callShopifyGraphQL(
      shopDomain,
      `mutation ErpLinkWebhookDelete($id: ID!) {
        webhookSubscriptionDelete(id: $id) {
          deletedWebhookSubscriptionId
          userErrors { field message }
        }
      }`,
      { id }
    )
    const result = data?.webhookSubscriptionDelete
    return !!result?.deletedWebhookSubscriptionId && !(result?.userErrors?.length)
  } catch {
    return false
  }
}

/** Deletes all shop-scoped webhooks pointing to the ErpLink endpoint. */
export async function unregisterShopifyWebhooks(shopDomain: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  if (!appUrl) return
  const ourAddress = `${appUrl}/api/webhooks/shopify`
  const webhooks = await listShopifyWebhooks(shopDomain)
  for (const wh of webhooks.filter((w: any) => w.address === ourAddress)) {
    await deleteShopifyWebhookSubscription(shopDomain, String(wh.id))
  }
}

/**
 * قراءة bulk للمنتجات عبر GraphQL (بدل REST المتقادم).
 * نفس شكل الإرجاع السابق {products, nextPageInfo} حتى لا ينكسر stock-sync/transfers.
 * pageInfo هنا هو endCursor في GraphQL. حد أقصى 250، والتوازي يُدار من المتصل
 * (لا حلقات نارية — دفعات متسلسلة مع sleep في stock-sync/transfers).
 */
export async function listShopifyProducts(
  shopDomain: string,
  limit: number = 250,
  pageInfo?: string
): Promise<{ products: any[]; nextPageInfo: string | null }> {
  const first = Math.min(Math.max(limit || 50, 1), 250)
  const query = `
    query listProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id title status handle
            images(first: 1) { edges { node { url } } }
            variants(first: 100) {
              edges { node { id title price sku barcode inventoryQuantity } }
            }
          }
        }
      }
    }
  `
  const data = await callShopifyGraphQL(shopDomain, query, {
    first,
    after: pageInfo || null,
  })
  const conn = data?.products
  const edges = conn?.edges || []
  const products = edges.map((e: any) => {
    const p = e.node
    return {
      id: String(p.id).split('/').pop(),
      sku: '',
      title: p.title || '',
      status: String(p.status || 'active').toLowerCase(),
      images: (p.images?.edges || []).map((img: any) => ({ src: img.node.url })),
      variants: (p.variants?.edges || []).map((ve: any) => {
        const v = ve.node
        return {
          id: String(v.id).split('/').pop(),
          title: v.title,
          sku: v.sku || '',
          price: v.price || 0,
          inventory_quantity: v.inventoryQuantity ?? 0,
          barcode: v.barcode || '',
        }
      }),
    }
  })
  const nextPageInfo = conn?.pageInfo?.hasNextPage ? (conn.pageInfo.endCursor as string) : null
  return { products, nextPageInfo }
}

/**
 * Lists customers through GraphQL Admin API. This requires read_customers and
 * Shopify protected-customer-data approval for public apps.
 */
export async function listShopifyCustomers(
  shopDomain: string,
  limit: number = 250,
  pageInfo?: string
): Promise<{ customers: any[]; nextPageInfo: string | null }> {
  const first = Math.min(Math.max(limit || 50, 1), 250)
  const data = await callShopifyGraphQL(
    shopDomain,
    `query ErpLinkCustomers($first: Int!, $after: String) {
      customers(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id legacyResourceId firstName lastName displayName
          defaultEmailAddress { emailAddress }
          defaultPhoneNumber { phoneNumber }
          numberOfOrders
          amountSpent { amount currencyCode }
          createdAt
        }
      }
    }`,
    { first, after: pageInfo || null }
  )
  const conn = data?.customers
  const customers = (conn?.nodes || []).map((c: any) => ({
    id: String(c.legacyResourceId || c.id).split('/').pop(),
    first_name: c.firstName || '',
    last_name: c.lastName || '',
    name: c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' '),
    email: c.defaultEmailAddress?.emailAddress || '',
    phone: c.defaultPhoneNumber?.phoneNumber || '',
    orders_count: Number(c.numberOfOrders ?? 0),
    total_spent: c.amountSpent?.amount || '0.00',
    created_at: c.createdAt || '',
  }))
  return {
    customers,
    nextPageInfo: conn?.pageInfo?.hasNextPage ? (conn.pageInfo.endCursor as string) : null,
  }
}

/**
 * Lists Shopify collections through the unified GraphQL Collection connection.
 */
export async function listShopifyCollections(
  shopDomain: string,
  limit: number = 250,
  pageInfo?: string
): Promise<{ collections: any[]; nextPageInfo: string | null }> {
  const first = Math.min(Math.max(limit || 50, 1), 250)
  const data = await callShopifyGraphQL(
    shopDomain,
    `query ErpLinkCollections($first: Int!, $after: String) {
      collections(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id legacyResourceId title handle descriptionHtml updatedAt sortOrder
        }
      }
    }`,
    { first, after: pageInfo || null }
  )
  const conn = data?.collections
  const collections = (conn?.nodes || []).map((c: any) => ({
    id: String(c.legacyResourceId || c.id).split('/').pop(),
    title: c.title || '',
    handle: c.handle || '',
    body_html: c.descriptionHtml || '',
    updated_at: c.updatedAt || '',
    sort_order: c.sortOrder || '',
  }))
  return {
    collections,
    nextPageInfo: conn?.pageInfo?.hasNextPage ? (conn.pageInfo.endCursor as string) : null,
  }
}

/** Creates a customer via GraphQL Admin API. Requires write_customers. */
export async function createShopifyCustomer(shopDomain: string, data: Record<string, any>) {
  const input: Record<string, any> = {}
  if (data.first_name ?? data.firstName) input.firstName = String(data.first_name ?? data.firstName)
  if (data.last_name ?? data.lastName) input.lastName = String(data.last_name ?? data.lastName)
  if (data.email) input.email = String(data.email)
  if (data.phone) input.phone = String(data.phone)
  if (data.note) input.note = String(data.note)
  if (data.tags) input.tags = Array.isArray(data.tags) ? data.tags.map(String) : String(data.tags).split(',').map((v) => v.trim()).filter(Boolean)

  const result = await callShopifyGraphQL(
    shopDomain,
    `mutation ErpLinkCustomerCreate($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id displayName }
        userErrors { field message }
      }
    }`,
    { input }
  )
  const payload = result?.customerCreate
  if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((e: any) => e.message).join('; '))
  return payload?.customer
}

/** Creates a collection/category via GraphQL Admin API. Requires write_products. */
export async function createShopifyCollection(shopDomain: string, data: Record<string, any>) {
  const input: Record<string, any> = {
    title: String(data.title ?? data.name ?? '').trim(),
  }
  if (!input.title) throw new Error('Shopify collection title is required')
  if (data.body_html ?? data.descriptionHtml ?? data.description) {
    input.descriptionHtml = String(data.body_html ?? data.descriptionHtml ?? data.description)
  }
  if (data.handle) input.handle = String(data.handle)

  const result = await callShopifyGraphQL(
    shopDomain,
    `mutation ErpLinkCollectionCreate($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection { id title handle }
        userErrors { field message }
      }
    }`,
    { input }
  )
  const payload = result?.collectionCreate
  if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((e: any) => e.message).join('; '))
  return payload?.collection
}

/**
 * Deletes shop-scoped webhooks for a single topic pointing at our endpoint.
 */
export async function unregisterShopifyWebhookTopic(shopDomain: string, topic: string): Promise<number> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  if (!appUrl) return 0
  const ourAddress = `${appUrl}/api/webhooks/shopify`
  const webhooks = await listShopifyWebhooks(shopDomain)
  const toDelete = webhooks.filter((wh: any) => wh.topic === topic && wh.address === ourAddress)
  let removed = 0
  for (const wh of toDelete) {
    if (await deleteShopifyWebhookSubscription(shopDomain, String(wh.id))) removed++
  }
  return removed
}

/**
 * Verify Shopify Webhook HMAC Signature (header X-Shopify-Hmac-Sha256).
 * مقارنة ثابتة الزمن مع فحص الأطوال (timingSafeEqual يرمي عند الاختلاف).
 */
export function verifyShopifySignature(body: string, signature: string, secret: string): boolean {
  try {
    const sig = (signature || '').trim()
    if (!sig || !secret) return false
    const expected = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')
    const a = Buffer.from(sig, 'utf8')
    const b = Buffer.from(expected, 'utf8')
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}
