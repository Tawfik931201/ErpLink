import axios from 'axios'

import { decrypt, encrypt } from '@/lib/crypto'

import { getSallaWebhookCredential } from '@/lib/salla/webhook-auth'
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
 * NOTE: expanded scopes (orders.read_write, shippings.read_write, payments.read,
 * settings.read, customers.read_write) require RE-APPROVAL — existing
 * merchants must reconnect, otherwise new API calls fail with 401/403
 * missing scope until they re-authorize.
 */
export const SALLA_OAUTH_SCOPES =
  'offline_access products.read_write orders.read_write customers.read_write categories.read_write settings.read payments.read webhooks.read_write shippings.read_write'

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
        refresh_token: decrypt(refreshToken),
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
        access_token: encrypt(access_token),
        refresh_token: encrypt(refresh_token),
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
  // Legacy plaintext/CBC records remain readable and are migrated on use.
  const accessToken = decrypt(access_token)
  const refreshToken = decrypt(refresh_token)
  if (!access_token.startsWith('v2:') || !refresh_token.startsWith('v2:')) {
    // Compare the last refresh timestamp (not secrets): PostgREST equality filters
    // become URL query parameters and must never contain OAuth credentials.
    const { error: migrationError } = await supabase.from('salla_tokens')
      .update({ access_token: encrypt(accessToken), refresh_token: encrypt(refreshToken) })
      .eq('merchant_id', merchantId)
      .eq('updated_at', updated_at)
    if (migrationError) console.error('[SallaClient] Token encryption migration failed:', migrationError.message)
  }

  if (!expires_in) {
    return accessToken
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
    const task = refreshSallaToken(merchantId, refreshToken).finally(() => {
      sallaRefreshLocks.delete(merchantId)
    })
    sallaRefreshLocks.set(merchantId, task)
    return task
  }

  return accessToken
}

/**
 * Per-request timeout for every Salla Merchant API call.
 *
 * Without it a hung Salla connection blocks the caller indefinitely — and the
 * caller is usually a sync-queue worker holding a concurrency slot, so one
 * stalled TCP connection leaks a slot until the process restarts. Matches the
 * 30s used by zidClient. A timeout surfaces as a normal axios error, so the
 * queue treats it as a transient failure and retries.
 */
const SALLA_REQUEST_TIMEOUT_MS = 30_000

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
      timeout: SALLA_REQUEST_TIMEOUT_MS,
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
 * A Salla stock location — a real branch (from `GET /branches`) or the
 * synthetic default fallback used when the `branches.read` scope is missing.
 */
export interface SallaBranch {
  id: string
  name: string
  is_default: boolean
  /** true for the synthetic default branch used when the scope is missing */
  fallback: boolean
}

/**
 * Sentinel id for the synthetic default branch. When a warehouse mapping's
 * source_location_id is this value, the engine omits `branch` from the bulk
 * quantity call and Salla applies the change to its default branch.
 */
export const SALLA_DEFAULT_BRANCH_ID = 'default'

const FALLBACK_DEFAULT_BRANCH: SallaBranch = {
  id: SALLA_DEFAULT_BRANCH_ID,
  name: 'الفرع الافتراضي / Default branch',
  is_default: true,
  fallback: true,
}

function sallaBranchName(b: any): string {
  if (typeof b?.name === 'string' && b.name) return b.name
  if (b?.name && typeof b.name === 'object') {
    return b.name.ar || b.name.en || b.name['en-EN'] || String(b.name.id ?? '')
  }
  return String(b.id ?? '')
}

/**
 * Lists the merchant's stock locations (branches).
 *
 * Salla's native webhook-strategy app does NOT request the `branches.read`
 * scope on connect, so `GET /branches` answers 401/403 for every real store.
 * Those are caught here and the store falls back to a single synthetic
 * "default branch" rather than failing the whole inventory-sync setup — the
 * engine then omits `branch` on bulk quantity updates, which Salla applies to
 * its default branch. Any other error (network, 5xx) still throws so the UI
 * surfaces it as a real failure instead of silently pretending.
 */
export async function listSallaBranches(merchantId: string): Promise<SallaBranch[]> {
  try {
    const res = await callSallaApi(merchantId, 'GET', '/branches')
    const rows = Array.isArray(res?.data) ? res.data : []
    const branches = rows
      .filter((b: any) => b?.status !== 'inactive')
      .map((b: any) => ({
        id: String(b.id),
        name: sallaBranchName(b),
        is_default: b.is_default === true,
        fallback: false,
      }))
    return branches.length > 0 ? branches : [FALLBACK_DEFAULT_BRANCH]
  } catch (err: any) {
    const status = err?.response?.status
    if (status === 401 || status === 403) {
      return [FALLBACK_DEFAULT_BRANCH]
    }
    throw err
  }
}

export interface SallaPaymentMethod {
  value: string
  label: string
}

/**
 * Lists the store's enabled payment methods (`GET /payment/methods`, scope
 * `payments.read`) for the Standard Mapping analytic rules.
 *
 * A token without that scope answers 401/403 — return [] so the rest of the
 * mapping screen still works; any other failure is real and is rethrown.
 */
export async function listSallaPaymentMethods(merchantId: string): Promise<SallaPaymentMethod[]> {
  const endpoints = ['/payment/methods?status=enabled', '/payment/methods']
  for (let i = 0; i < endpoints.length; i++) {
    try {
      const res = await callSallaApi(merchantId, 'GET', endpoints[i])
      const rows = Array.isArray(res?.data) ? res.data : []
      const seen = new Set<string>()
      const methods: SallaPaymentMethod[] = []
      for (const row of rows) {
        const value = String(row?.slug || row?.code || row?.id || '').trim()
        if (!value || seen.has(value)) continue
        seen.add(value)
        const label = typeof row?.name === 'string' ? row.name : sallaBranchName({ name: row?.name, id: value })
        methods.push({ value, label: label || value })
      }
      return methods
    } catch (err: any) {
      const status = err?.response?.status
      if (status === 401 || status === 403) return []
      if (i === endpoints.length - 1) throw err
    }
  }
  return []
}

/**
 * Bulk-updates product quantities on Salla.
 *
 * `POST /products/quantities/bulk` — one HTTP call for many products.
 * Field names follow Salla's OpenAPI DTO exactly, including the single-'f'
 * spelling of `identifer_type` / `identifer` (the docs' own DTO). `branch` is
 * per-item; omit it to target Salla's default branch.
 */
export async function updateSallaStockBulk(
  merchantId: string,
  items: Array<{
    identifer_type: 'id' | 'sku'
    identifer: string
    quantity: number
    mode: 'overwrite' | 'increment' | 'decrement'
    branch?: string
    reason_id?: number
  }>
) {
  return callSallaApi(merchantId, 'POST', '/products/quantities/bulk', { products: items })
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

/** Order Details defaults to the light response. Read all items separately. */
export async function getSallaOrderItems(merchantId: string, orderId: string | number): Promise<unknown[]> {
  const items: unknown[] = []
  for (let page = 1; page <= 100; page++) {
    const query = new URLSearchParams({ order_id: String(orderId), page: String(page) })
    const res = await callSallaApi(merchantId, 'GET', `/orders/items?${query}`)
    if (!Array.isArray(res.data)) throw new Error('Invalid Salla order items response')
    items.push(...res.data)
    const hasNext = res.pagination?.next || res.pagination?.next_page || page < (res.pagination?.totalPages ?? 1)
    if (!hasNext) return items
    if (!res.data.length) throw new Error('Incomplete paginated Salla order items response')
  }
  throw new Error('Salla order items pagination did not complete')
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
 * Fetch a single product with full details. Used by the sync engine for
 * unauthenticated (legacy) deliveries: an unauthenticated `product.*` payload
 * is a trigger only — values are re-read from Salla's own API before anything
 * is written to Odoo (same trust rule as the Odoo → store direction).
 */
export async function getSallaProduct(merchantId: string, productId: string | number): Promise<any | null> {
  try {
    const res = await callSallaApi(merchantId, 'GET', `/products/${productId}`)
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

export async function getSallaShipmentOrderId(merchantId: string, shipmentId: string): Promise<string> {
  const { data } = await callSallaApi(merchantId, 'GET', `/shipments/${encodeURIComponent(shipmentId)}`)
  const orderId = String(data?.order_id ?? '')
  if (String(data?.id ?? '') !== shipmentId || !/^\d+$/.test(orderId)) {
    throw new Error('Salla shipment details did not identify its order')
  }
  return orderId
}

/** Store events received by Standard Mapping. Execution is gated per store. */
export const SALLA_DEFAULT_WEBHOOK_EVENTS = [
  // Orders. The `order.shipment.*` family is deliberate: it maps to the `orders`
  // entity (the name contains "order"), so a shipment status change arrives as an
  // order status change, which is what the deliver preset needs. Salla also offers
  // bare `shipment.*` events, but those map to no entity at all — they would be
  // enqueued and then have nothing to sync against.
  'order.created',
  'order.updated',
  'order.status.updated',
  'order.cancelled',
  'order.refunded',
  'order.deleted',
  'order.payment.updated',
  'order.coupon.updated',
  'order.customer.updated',
  'order.products.updated',
  'order.total.price.updated',
  'order.shipping.address.updated',
  'order.shipment.creating',
  'order.shipment.created',
  'order.shipment.cancelled',
  'order.shipment.return.creating',
  'order.shipment.return.created',
  'order.shipment.return.cancelled',
  // Products. `product.available` is deliberately absent: Salla's own event list
  // strikes it through as deprecated, and `product.quantity.low` is the live one.
  'product.created',
  'product.updated',
  'product.deleted',
  'product.price.updated',
  'product.status.updated',
  'product.quantity.low',
  'product.image.updated',
  'product.category.updated',
  'customer.created',
  'customer.updated',
  'customer.login',
  'category.created',
  'category.updated',
  // ⚠️ `abandoned.cart` is deliberately NOT subscribed. The slug is real and it
  // maps to `orders`/`create`, but the app's `carts` scope is deselected in the
  // Partners Portal, so Salla has no scope to deliver it — subscribing it buys a
  // permanent entry that can never fire. If the carts scope is ever enabled,
  // add it back here (it is already in the test's published-event allowlist).
  //
  // ⚠️ No `category.deleted`. Salla publishes no category-deletion event — the
  // documented category catalogue is created/updated only — so it used to be
  // subscribed here and could only ever fail, burning one API call per refresh
  // and inflating `failed` for a delivery that would never arrive. The category
  // *delete* path still exists in sync-engine.ts, but it cannot be driven by a
  // webhook; removing a category in Salla needs a manual/reconciliation pass.
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

export interface SallaWebhookRegistrationResult {
  registered: number
  failed: number
  /** False when no credential could be attached (no `ENCRYPTION_KEY`). */
  credentialAttached: boolean
}

/**
 * Registers (or updates) Salla webhooks pointing to our receive endpoint.
 *
 * Salla's `/webhooks/subscribe` upserts by URL: re-subscribing with the same URL
 * replaces the old subscription and restores outdated webhooks — so this is
 * **create-before-delete** by construction and needs no teardown window.
 *
 * Each subscription carries the ingress credential in its `headers` array.
 * That is what makes ingress work with **no host configuration**: the value is
 * derived from `ENCRYPTION_KEY` (see src/lib/salla/webhook-auth.ts), because
 * `SALLA_WEBHOOK_SECRET` was never set on the host and that alone used to 500
 * every delivery. Pass `webhookSecret` to override it with an explicit value.
 */
export async function registerSallaWebhooks(merchantId: string, webhookSecret?: string): Promise<SallaWebhookRegistrationResult> {
  const endpoint = new URL('/api/webhooks/salla', process.env.NEXT_PUBLIC_APP_URL)
  if (process.env.NODE_ENV === 'production' && (
    endpoint.protocol !== 'https:' || /(?:^|\.)ngrok(?:-free)?\.(?:app|dev|io)$/i.test(endpoint.hostname)
  )) {
    throw new Error('Salla webhooks require a permanent HTTPS application URL in production')
  }
  const url = endpoint.toString()
  let registered = 0
  let failed = 0

  const credential = getSallaWebhookCredential(webhookSecret)
  if (!credential) {
    return { registered: 0, failed: SALLA_DEFAULT_WEBHOOK_EVENTS.length, credentialAttached: false }
  }

  const tasks = SALLA_DEFAULT_WEBHOOK_EVENTS.map((event) => async () => {
    try {
      const body: Record<string, any> = {
        name: `ERP Link - ${event}`,
        event,
        url,
        version: 2,
      }
      body.headers = [{ key: credential.headerKey, value: credential.headerValue }]
      await callSallaApi(merchantId, 'POST', '/webhooks/subscribe', body)
      registered++
    } catch (err: any) {
      // Counted, not just logged: a silent partial registration is what leaves a
      // store "connected but not syncing" with no error anywhere.
      failed++
      console.warn(`[SallaClient] Failed to register webhook "${event}" for merchant "${merchantId}":`, err.response?.data || err.message)
    }
  })
  // Capped parallelism: 25 sequential subscribe calls made OAuth callbacks
  // time out; unbounded parallelism trips Salla rate limits.
  await runWithConcurrency(tasks, SALLA_WEBHOOK_CONCURRENCY)

  return { registered, failed, credentialAttached: Boolean(credential) }
}

/**
 * Lists currently subscribed webhooks for a Salla merchant.
 */
export async function listSallaWebhooks(merchantId: string): Promise<any[]> {
  const webhooks: any[] = []
  for (let page = 1; ; page++) {
    const res = await callSallaApi(merchantId, 'GET', `/webhooks?page=${page}`)
    webhooks.push(...(res.data || []))
    if (!res.pagination?.next && page >= (res.pagination?.totalPages ?? 1)) return webhooks
  }
}

/**
 * Deletes a specific Salla webhook subscription by id.
 */
export async function deleteSallaWebhook(merchantId: string, webhookId: string | number): Promise<void> {
  await callSallaApi(merchantId, 'DELETE', `/webhooks/unsubscribe?id=${encodeURIComponent(String(webhookId))}`)
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
