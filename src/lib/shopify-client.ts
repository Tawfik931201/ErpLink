import axios from 'axios'
import crypto from 'crypto'
import { supabase } from '@/lib/supabase'

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
 * Helper to call Shopify GraphQL Admin API.
 */
export async function callShopifyGraphQL(shopDomain: string, query: string, variables?: any) {
  const token = await getShopifyAccessToken(shopDomain)
  const url = `https://${shopDomain}/admin/api/2024-01/graphql.json`

  try {
    const response = await axios({
      method: 'POST',
      url,
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      data: JSON.stringify({ query, variables }),
    })
    
    if (response.data.errors) {
      console.error('[ShopifyClient] GraphQL Errors:', response.data.errors)
      throw new Error(`Shopify GraphQL Error: ${JSON.stringify(response.data.errors)}`)
    }
    
    return response.data.data
  } catch (err: any) {
    console.error(`[ShopifyClient] GraphQL Request Error on ${shopDomain}:`, err.response?.data || err.message)
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
  data?: any
) {
  const token = await getShopifyAccessToken(shopDomain)
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  const url = `https://${shopDomain}/admin/api/2024-01${cleanEndpoint}`

  try {
    const response = await axios({
      method,
      url,
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      data,
    })
    return response.data
  } catch (err: any) {
    console.error(`[ShopifyClient] REST API Error on ${method} ${endpoint}:`, err.response?.data || err.message)
    throw err
  }
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
  console.info(`[ShopifyClient] Searching product by ${matchField}="${value}"...`)

  if (matchField === 'id') {
    try {
      const restRes = await callShopifyREST(shopDomain, 'GET', `/products/${value}.json`)
      return restRes.product
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
  } catch (err) {
    console.error(`[ShopifyClient] Failed to search product by match field:`, err)
    return null
  }
}

/**
 * Updates a product in Shopify.
 */
export async function updateShopifyProduct(shopDomain: string, shopifyProductId: string, data: any) {
  console.info(`[ShopifyClient] Updating product ID="${shopifyProductId}" in Shopify...`)
  return callShopifyREST(shopDomain, 'PUT', `/products/${shopifyProductId}.json`, { product: data })
}

/**
 * Register a webhook in Shopify.
 */
export async function registerShopifyWebhook(shopDomain: string, topic: string, accessToken: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  const address = `${appUrl}/api/webhooks/shopify`
  const url = `https://${shopDomain}/admin/api/2024-01/webhooks.json`

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
    console.info(`[ShopifyClient] Registered webhook "${topic}" for shop "${shopDomain}"`)
    return response.data
  } catch (err: any) {
    console.error(`[ShopifyClient] Failed to register webhook "${topic}" for shop "${shopDomain}":`, err.response?.data || err.message)
    return null
  }
}

/**
 * Lists all products from Shopify with variant stock info. Uses REST API.
 */
export async function listShopifyProducts(
  shopDomain: string,
  limit: number = 250,
  pageInfo?: string
): Promise<{ products: any[]; nextPageInfo: string | null }> {
  console.info(`[ShopifyClient] Listing products limit=${limit} pageInfo=${pageInfo || 'none'}...`)
  let endpoint = `/products.json?limit=${limit}&fields=id,title,sku,status,variants,images`
  if (pageInfo) endpoint += `&page_info=${pageInfo}`
  const res = await callShopifyREST(shopDomain, 'GET', endpoint)
  const linkHeader = (res as any)?.headers?.link || ''
  let nextPageInfo: string | null = null
  if (linkHeader) {
    const match = linkHeader.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/)
    if (match) nextPageInfo = match[1]
  }
  const products = (res.products || []).map((p: any) => ({
    id: p.id,
    sku: p.sku || '',
    title: p.title || '',
    status: p.status || 'active',
    images: (p.images || []).map((img: any) => ({ src: img.src })),
    variants: (p.variants || []).map((v: any) => ({
      id: v.id,
      title: v.title,
      sku: v.sku || '',
      price: v.price || 0,
      inventory_quantity: v.inventory_quantity ?? 0,
      barcode: v.barcode || '',
    })),
  }))
  return { products, nextPageInfo }
}

/**
 * Verify Shopify Webhook HMAC Signature.
 */
export function verifyShopifySignature(body: string, signature: string, secret: string): boolean {
  try {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('base64')
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}
