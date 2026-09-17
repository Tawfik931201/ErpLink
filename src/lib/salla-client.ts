import axios from 'axios'

import { supabase } from '@/lib/supabase'

export interface SallaTokenRow {
  merchant_id: string
  access_token: string
  refresh_token: string
  expires_in: number | null
  updated_at: string
}

/**
 * Single source of truth for the Salla OAuth scopes requested in
 * `src/app/api/salla/connect/route.ts`.
 * Full-catalog scopes: the product/order/customer/category reads the sync
 * engine needs, plus offline_access (refresh) and webhooks.
 * MUST match the App Scopes in the Salla Partners Portal, otherwise
 * API calls fail with 401 missing scope.
 * NOTE: expanded scopes (orders.read_write, shipments.read, payments.read,
 * settings.read, customers.read_write) require RE-APPROVAL — existing
 * merchants must reconnect, otherwise new API calls fail with 401/403
 * missing scope until they re-authorize.
 */
export const SALLA_OAUTH_SCOPES =
  'offline_access products.read_write orders.read_write customers.read_write categories.read settings.read shipments.read payments.read webhooks.read_write'

/** Max parallel Salla API calls when (un)registering webhooks (bulk safety). */
export const SALLA_WEBHOOK_CONCURRENCY = 3

/**
 * In-memory refresh locks per merchant. Salla refresh_tokens are single-use:
 * two concurrent refreshes with the same token invalidate each other, so the
 * loser gets invalid_grant. The lock serializes refreshes per merchant.
 * (Per-instance only — serverless concurrency is further guarded by the
 * invalid_grant → reconnect Arabic message below.)
 */
const sallaRefreshLocks = new Map<string, Promise<string>>()

/** Arabic message shown when the grant is dead and the merchant must reconnect. */
export const SALLA_RECONNECT_MESSAGE =
  'انتهت صلاحية ربط متجر سلة ويحتاج إلى إعادة ربط. افتح صفحة ربط المتجر واضغط «ربط متجر Salla» ثم وافق على الصلاحيات. (invalid_grant)'

function isInvalidGrant(err: any): boolean {
  const data = err?.response?.data
  const code = String(data?.error ?? data?.error_description ?? err?.message ?? '').toLowerCase()
  return code.includes('invalid_grant')
}

/**
 * Refreshes Salla access token and updates the database.
 * Note: Salla refresh does not need redirect_uri — only the code exchange does.
 */
export async function refreshSallaToken(merchantId: string, refreshToken: string): Promise<string> {
  const clientId = process.env.SALLA_CLIENT_ID
  const clientSecret = process.env.SALLA_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Salla Client ID or Secret is not configured in env variables.')
  }

  try {
    const response = await axios.post(
      'https://accounts.salla.sa/oauth2/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )

    const { access_token, refresh_token, expires_in } = response.data

    // Update in Supabase (expires_in is BIGINT — plain number, never BigInt:
    // JSON serialization of BigInt throws and breaks the Supabase client).
    const { error } = await supabase
      .from('salla_tokens')
      .update({
        access_token,
        refresh_token,
        expires_in: expires_in ? Number(expires_in) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('merchant_id', merchantId)

    if (error) {
      throw new Error(`Failed to update refreshed Salla token in database: ${error.message}`)
    }

    return access_token
  } catch (err: any) {
    console.warn(`[SallaClient] Refresh failed for merchant="${merchantId}":`, err.response?.data || err.message)
    if (isInvalidGrant(err)) {
      throw new Error(SALLA_RECONNECT_MESSAGE)
    }
    throw new Error(`Failed to refresh Salla OAuth token: ${err.message}`)
  }
}

/**
 * Gets a valid access token for the given Salla merchant.
 * Auto-refreshes if the token is close to expiry or expired.
 */
export async function getSallaAccessToken(merchantId: string): Promise<string> {
  const { data: sallaToken, error } = await supabase
    .from('salla_tokens')
    .select('access_token, refresh_token, expires_in, updated_at')
    .eq('merchant_id', merchantId)
    .maybeSingle()

  if (error || !sallaToken) {
    throw new Error(`Salla token not found for merchant ID: ${merchantId}`)
  }

  const { access_token, refresh_token, expires_in, updated_at } = sallaToken as unknown as SallaTokenRow

  if (!expires_in) {
    return access_token
  }

  // Calculate if token is expired or close to expiry (within 5 minutes)
  const updatedAtTime = new Date(updated_at).getTime()
  const expiresAtTime = updatedAtTime + Number(expires_in) * 1000
  const timeBuffer = 5 * 60 * 1000 // 5 minutes buffer
  const isExpired = Date.now() + timeBuffer > expiresAtTime

  if (isExpired) {
    // Serialize concurrent refreshes per merchant (single-use refresh token).
    const ongoing = sallaRefreshLocks.get(merchantId)
    if (ongoing) {
      return ongoing
    }
    const task = refreshSallaToken(merchantId, refresh_token).finally(() => {
      sallaRefreshLocks.delete(merchantId)
    })
    sallaRefreshLocks.set(merchantId, task)
    return task
  }

  return access_token
}

/**
 * Helper to call Salla Merchant API.
 */
async function callSallaApi(merchantId: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', endpoint: string, data?: any) {
  const token = await getSallaAccessToken(merchantId)
  const url = `https://api.salla.dev/admin/v2${endpoint}`

  try {
    const response = await axios({
      method,
      url,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      data,
    })
    return response.data
  } catch (err: any) {
    console.warn(`[SallaClient] API Error on ${method} ${endpoint}:`, err.response?.data || err.message)
    throw err
  }
}

/**
 * Finds a product in Salla by matching a specific field.
 */
export async function findSallaProductByMatchField(
  merchantId: string,
  matchField: string,
  value: string
): Promise<any | null> {
  if (matchField === 'id') {
    try {
      const res = await callSallaApi(merchantId, 'GET', `/products/${value}`)
      return res.data
    } catch {
      return null
    }
  }

  // Query products list. We can use sku filter parameter if Odoo is matching sku.
  // Salla API: GET /products?sku=SKU_VALUE
  const queryParam = matchField === 'sku' ? `?sku=${encodeURIComponent(value)}` : `?keyword=${encodeURIComponent(value)}`
  
  try {
    const res = await callSallaApi(merchantId, 'GET', `/products${queryParam}`)
    const products = res.data || []
    
    // Exact match filter just to be double safe
    const match = products.find((p: any) => {
      if (matchField === 'sku') return String(p.sku || '').trim() === value.trim()
      if (matchField === 'barcode') return String(p.barcode || '').trim() === value.trim()
      return false
    })
    
    return match || null
  } catch {
    return null
  }
}

/**
 * Updates a product in Salla.
 */
export async function updateSallaProduct(merchantId: string, sallaProductId: string, data: any) {
  return callSallaApi(merchantId, 'PUT', `/products/${sallaProductId}`, data)
}

/**
 * Creates a product in Salla.
 * Salla requires at least: name, sku, price.amount. Other fields default.
 */
export async function createSallaProduct(merchantId: string, data: any) {
  return callSallaApi(merchantId, 'POST', '/products', data)
}

/**
 * Lists products from Salla with pagination. Returns simplified products with stock info.
 */
export async function listSallaProducts(
  merchantId: string,
  page: number = 1,
  perPage: number = 100
): Promise<{ products: any[]; total: number; next: string | null }> {
  const res = await callSallaApi(merchantId, 'GET', `/products?page=${page}&per_page=${perPage}`)
  const data = res.data || []
  const total = res.pagination?.total || data.length
  const next = res.pagination?.next_page ? String(res.pagination.next_page) : null
  const products = data.map((p: any) => ({
    id: p.id,
    sku: p.sku || '',
    name: p.name || '',
    quantity: p.quantity ?? p.stock_quantity ?? 0,
    price: p.price || 0,
    barcode: p.barcode || '',
  }))
  return { products, total, next }
}

/**
 * Lists customers from Salla with pagination.
 */
export async function listSallaCustomers(
  merchantId: string,
  page: number = 1,
  perPage: number = 100
): Promise<{ customers: any[]; total: number; next: string | null }> {
  const res = await callSallaApi(merchantId, 'GET', `/customers?page=${page}&per_page=${perPage}`)
  const data = res.data || []
  const total = res.pagination?.total || data.length
  const next = res.pagination?.next_page ? String(res.pagination.next_page) : null
  const customers = data.map((c: any) => ({
    id: c.id,
    name: c.name || '',
    email: c.email || '',
    phone: c.phone || c.mobile || '',
    gender: c.gender || '',
    created_at: c.created_at || '',
  }))
  return { customers, total, next }
}

/**
 * Lists categories from Salla with pagination.
 */
export async function listSallaCategories(
  merchantId: string,
  page: number = 1,
  perPage: number = 100
): Promise<{ categories: any[]; total: number; next: string | null }> {
  const res = await callSallaApi(merchantId, 'GET', `/categories?page=${page}&per_page=${perPage}`)
  const data = res.data || []
  const total = res.pagination?.total || data.length
  const next = res.pagination?.next_page ? String(res.pagination.next_page) : null
  const categories = data.map((c: any) => ({
    id: c.id,
    name: c.name || '',
    slug: c.slug || '',
    parent_id: c.parent_id || null,
    is_published: c.is_published ?? true,
  }))
  return { categories, total, next }
}

/**
 * Fetch a single order with full details (used to enrich thin webhooks).
 * Returns null instead of throwing so webhook handlers stay resilient.
 */
export async function getSallaOrder(merchantId: string, orderId: string | number): Promise<any | null> {
  try {
    const res = await callSallaApi(merchantId, 'GET', `/orders/${orderId}`)
    return res.data ?? null
  } catch {
    return null
  }
}

/**
 * Fetch a single customer with full details (used to enrich thin webhooks).
 */
export async function getSallaCustomer(merchantId: string, customerId: string | number): Promise<any | null> {
  try {
    const res = await callSallaApi(merchantId, 'GET', `/customers/${customerId}`)
    return res.data ?? null
  } catch {
    return null
  }
}

/**
 * Fetch a single category with full details (used to enrich thin webhooks).
 */
export async function getSallaCategory(merchantId: string, categoryId: string | number): Promise<any | null> {
  try {
    const res = await callSallaApi(merchantId, 'GET', `/categories/${categoryId}`)
    return res.data ?? null
  } catch {
    return null
  }
}

/**
 * Extract the Salla merchant id from the `oauth2/user/info` response.
 * Salla sends `merchant` as an object `{ id }` in most cases, but the shape
 * has varied (number/string/object) — accept all three, never invent one.
 * Returns '' when the id cannot be found so callers fail loudly instead of
 * persisting an 'unknown_salla_merchant' token row.
 */
export function extractSallaMerchantIdFromProfile(profilePayload: any): string {
  const data = profilePayload?.data ?? profilePayload ?? {}
  const m = data.merchant ?? data.merchant_id ?? data.store_id ?? data.id
  if (m === null || m === undefined || m === '') return ''
  if (typeof m === 'object') {
    const id = (m as any).id ?? (m as any).merchant_id ?? (m as any).store_id
    return id === null || id === undefined || id === '' ? '' : String(id)
  }
  // A bare numeric/string `data.id` is the *user* id, not the merchant —
  // only accept it when no merchant object exists AND a merchant key matched.
  if (typeof data.merchant === 'undefined' && typeof data.merchant_id === 'undefined' && typeof data.store_id === 'undefined') {
    return ''
  }
  return String(m)
}

/**
 * Default Salla store events registered on connect.
 * Mirrors every toggle in `salla-sync-settings.tsx` (SALLA_SYNC_GROUPS) so no
 * UI switch points at an event that was never registered, plus
 * `category.deleted` (needed for delete sync though the UI only exposes
 * created/updated).
 */
export const SALLA_DEFAULT_WEBHOOK_EVENTS = [
  'order.created',
  'order.updated',
  'order.status.updated',
  'order.cancelled',
  'order.refunded',
  'order.deleted',
  'order.payment.updated',
  'product.created',
  'product.updated',
  'product.deleted',
  'product.publish',
  'product.available',
  'product.quantity.low',
  'store.branch.created',
  'store.branch.updated',
  'store.branch.deleted',
  'abandoned.cart',
  'abandoned.cart.update',
  'abandoned.cart.purchased',
  'customer.created',
  'customer.updated',
  'customer.login',
  'category.created',
  'category.updated',
  'category.deleted',
]

/**
 * Run async tasks with a concurrency cap (bulk safety for webhook bursts).
 */
async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, cap: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(cap, 1), tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Registers (or updates) Salla webhooks pointing to our receive endpoint.
 * Salla's /webhooks/subscribe upserts by URL: re-subscribing with the same URL
 * replaces the old subscription and restores outdated webhooks.
 */
export async function registerSallaWebhooks(merchantId: string, webhookSecret?: string): Promise<number> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  const url = `${appUrl}/api/webhooks/salla`
  let registered = 0

  const tasks = SALLA_DEFAULT_WEBHOOK_EVENTS.map((event) => async () => {
    try {
      const body: Record<string, any> = {
        name: `ERP Link - ${event}`,
        event,
        url,
        version: 2,
      }
      if (webhookSecret) {
        body.headers = [{ key: 'x-erplink-webhook-secret', value: webhookSecret }]
      }
      await callSallaApi(merchantId, 'POST', '/webhooks/subscribe', body)
      registered++
    } catch (err: any) {
      console.warn(`[SallaClient] Failed to register webhook "${event}" for merchant "${merchantId}":`, err.response?.data || err.message)
    }
  })
  // Capped parallelism: 25 sequential subscribe calls made OAuth callbacks
  // time out; unbounded parallelism trips Salla rate limits.
  await runWithConcurrency(tasks, SALLA_WEBHOOK_CONCURRENCY)

  return registered
}

/**
 * Lists currently subscribed webhooks for a Salla merchant.
 */
export async function listSallaWebhooks(merchantId: string): Promise<any[]> {
  const res = await callSallaApi(merchantId, 'GET', '/webhooks')
  return res.data || []
}

/**
 * Deletes a specific Salla webhook subscription by id.
 */
export async function deleteSallaWebhook(merchantId: string, webhookId: string | number): Promise<void> {
  await callSallaApi(merchantId, 'DELETE', `/webhooks/${webhookId}`)
}

/**
 * Unregisters all Salla webhooks pointing to our receive endpoint.
 * Should be called on store disconnect to stop orphaned webhook deliveries.
 */
export async function unregisterSallaWebhooks(merchantId: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  const ourUrl = `${appUrl}/api/webhooks/salla`

  try {
    const webhooks = await listSallaWebhooks(merchantId)
    const toDelete = (webhooks || []).filter(
      (wh: any) => typeof wh?.url === 'string' && wh.url.replace(/\/$/, '') === ourUrl.replace(/\/$/, '')
    )

    await runWithConcurrency(
      toDelete.map((wh: any) => async () => {
        try {
          await deleteSallaWebhook(merchantId, wh.id)
        } catch (err: any) {
          console.warn(`[SallaClient] Failed to delete webhook id="${wh.id}" on disconnect:`, err.response?.data || err.message)
        }
      }),
      SALLA_WEBHOOK_CONCURRENCY
    )
  } catch (err: any) {
    console.warn(`[SallaClient] Failed to list webhooks on disconnect for merchant "${merchantId}":`, err.response?.data || err.message)
  }
}
