import crypto from 'crypto'

import axios from 'axios'

import { supabase } from '@/lib/supabase'

/** Shopify Admin API version — keep in sync with shopify.app.toml.
 * المصدر: env SHOPIFY_API_VERSION (موثّق في .env.example). لا تكتب نسخة يدوياً.
 *
 * ملاحظة الصلاحيات (protected customer data + read_all_orders):
 * - التثبيت الأدنى read-only (read_products/read_orders/...) يكفي لآخر 60 يوماً.
 * - الطلبات الأقدم تحتاج read_all_orders (موافقة من Partner Dashboard).
 * - customers/* يحتاج read_customers (بيانات محمية — موافقة + مبرر استخدام).
 *   https://shopify.dev/docs/apps/launch/protected-customer-data
 */
export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07'

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

/**
 * Gets a valid access token for the given Shopify shop.
 */
export async function getShopifyAccessToken(shopDomain: string): Promise<string> {
  const { data: token, error } = await supabase
    .from('shopify_tokens')
    .select('access_token')
    .eq('shop_domain', shopDomain)
    .maybeSingle()

  if (error || !token) {
    throw new Error(`Shopify token not found for shop domain: ${shopDomain}`)
  }

  return token.access_token
}

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

/**
 * REST GET مع إرجاع الترويسات (لترقيم Link: page_info) + معالجة 429 موحدة.
 * يُستخدم لقوائم bulk القديمة (customers/collections) التي ما زالت REST.
 */
async function shopifyRestGetWithHeaders(
  shopDomain: string,
  endpoint: string,
  _retried = false
): Promise<{ data: any; headers: any }> {
  const token = await getShopifyAccessToken(shopDomain)
  const url = shopifyApiUrl(shopDomain, endpoint)
  try {
    const response = await axios({
      method: 'GET',
      url,
      timeout: SHOPIFY_REQUEST_TIMEOUT_MS,
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    })
    return { data: response.data, headers: response.headers }
  } catch (err: any) {
    if (err?.response?.status === 429 && !_retried) {
      await sleep(getShopifyRetryDelayMs(err))
      return shopifyRestGetWithHeaders(shopDomain, endpoint, true)
    }
    throw err
  }
}

/** استخرج cursor التالي من ترويسة Link (rel="next"). */
function extractNextPageInfo(linkHeader: string): string | null {
  if (!linkHeader) return null
  const match = linkHeader.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/)
  return match ? decodeURIComponent(match[1]) : null
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

/**
 * Updates a product in Shopify (REST — تُبقي REST لأن productSet في GraphQL
 * معقدة للمتغيرات الجزئية؛ 429 تُعالَج في callShopifyREST).
 */
export async function updateShopifyProduct(shopDomain: string, shopifyProductId: string, data: any) {
  return callShopifyREST(shopDomain, 'PUT', `/products/${shopifyProductId}.json`, { product: data })
}

/**
 * Creates a product in Shopify from an Odoo-derived payload.
 * Accepts a minimal product payload (title, body_html) and optionally variants.
 */
export async function createShopifyProduct(shopDomain: string, data: any) {
  return callShopifyREST(shopDomain, 'POST', '/products.json', { product: data })
}

/**
 * Register a webhook in Shopify (toggle ON يسجّل اشتراكاً حقيقياً).
 * 429 تُعالَج بانتظار Retry-After ثم محاولة واحدة.
 */
export async function registerShopifyWebhook(shopDomain: string, topic: string, accessToken: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  if (!appUrl) return null
  const address = `${appUrl}/api/webhooks/shopify`
  const url = shopifyApiUrl(shopDomain, '/webhooks.json')

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await axios({
        method: 'POST',
        url,
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        data: {
          webhook: {
            topic,
            address,
            format: 'json',
          },
        },
      })
      return response.data
    } catch (err: any) {
      if (err?.response?.status === 429 && attempt === 0) {
        await sleep(getShopifyRetryDelayMs(err))
        continue
      }
      return null
    }
  }
  return null
}

/**
 * Lists webhooks registered in a Shopify shop, as plain JSON (no pagination needed
 * for typical app webhook counts).
 */
export async function listShopifyWebhooks(shopDomain: string): Promise<any[]> {
  try {
    const res = await callShopifyREST(shopDomain, 'GET', '/webhooks.json?limit=250')
    return res?.webhooks || []
  } catch {
    return []
  }
}

/**
 * Deletes all webhooks pointing to our /api/webhooks/shopify endpoint.
 * Called on store disconnect to avoid orphaned webhook deliveries.
 */
export async function unregisterShopifyWebhooks(shopDomain: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  if (!appUrl) return
  const ourAddress = `${appUrl}/api/webhooks/shopify`

  const webhooks = await listShopifyWebhooks(shopDomain)
  const toDelete = webhooks.filter((wh: any) => wh.address === ourAddress)

  for (const wh of toDelete) {
    try {
      await callShopifyREST(shopDomain, 'DELETE', `/webhooks/${wh.id}.json`)
    } catch {
      // best-effort تنظيف — الفشل غير قاتل
    }
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
 * Lists customers from Shopify with cursor-based pagination.
 * تبقى REST: customers تتطلب read_customers (بيانات محمية) ولا توجد حاجة
 * لـ bulk GraphQL هنا — الحقول مُقلَّصة عمداً (بدون select(*)).
 */
export async function listShopifyCustomers(
  shopDomain: string,
  limit: number = 250,
  pageInfo?: string
): Promise<{ customers: any[]; nextPageInfo: string | null }> {
  const safeLimit = Math.min(Math.max(limit || 50, 1), 250)
  let endpoint = `/customers.json?limit=${safeLimit}&fields=id,first_name,last_name,email,phone,orders_count,total_spent,created_at`
  if (pageInfo) endpoint += `&page_info=${encodeURIComponent(pageInfo)}`

  const { data: body, headers } = await shopifyRestGetWithHeaders(shopDomain, endpoint)
  const nextPageInfo = extractNextPageInfo(headers?.link || '')

  const customers = ((body as any)?.customers || []).map((c: any) => ({
    id: c.id,
    first_name: c.first_name || '',
    last_name: c.last_name || '',
    name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
    email: c.email || '',
    phone: c.phone || '',
    orders_count: c.orders_count ?? 0,
    total_spent: c.total_spent || '0.00',
    created_at: c.created_at || '',
  }))
  return { customers, nextPageInfo }
}

/**
 * Lists collections (categories) from Shopify with cursor-based pagination.
 * تبقى REST لحين نقلها لـ GraphQL (custom/smart collections) — حقول مُقلَّصة.
 */
export async function listShopifyCollections(
  shopDomain: string,
  limit: number = 250,
  pageInfo?: string
): Promise<{ collections: any[]; nextPageInfo: string | null }> {
  const safeLimit = Math.min(Math.max(limit || 50, 1), 250)
  let endpoint = `/collections.json?limit=${safeLimit}&fields=id,title,handle,body_html,published_at`
  if (pageInfo) endpoint += `&page_info=${encodeURIComponent(pageInfo)}`

  const { data: body, headers } = await shopifyRestGetWithHeaders(shopDomain, endpoint)
  const nextPageInfo = extractNextPageInfo(headers?.link || '')

  const collections = ((body as any)?.collections || []).map((c: any) => ({
    id: c.id,
    title: c.title || '',
    handle: c.handle || '',
    body_html: c.body_html || '',
    published_at: c.published_at || '',
  }))
  return { collections, nextPageInfo }
}

/**
 * Deletes webhooks for a single topic pointing at our endpoint.
 * Used when a sync toggle is switched OFF (ON path uses registerShopifyWebhook).
 * Returns the number of deleted webhooks.
 */
export async function unregisterShopifyWebhookTopic(shopDomain: string, topic: string): Promise<number> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  if (!appUrl) return 0
  const ourAddress = `${appUrl}/api/webhooks/shopify`

  const webhooks = await listShopifyWebhooks(shopDomain)
  const toDelete = webhooks.filter((wh: any) => wh.topic === topic && wh.address === ourAddress)

  for (const wh of toDelete) {
    try {
      await callShopifyREST(shopDomain, 'DELETE', `/webhooks/${wh.id}.json`)
    } catch {
      // best-effort — تجاهل فشل الحذف المفرد
    }
  }
  return toDelete.length
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
