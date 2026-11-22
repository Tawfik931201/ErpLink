/**
 * Zid Webhook Management
 *
 * Handles registering and unregistering webhooks via the Zid API
 * based on the merchant's sync settings (zid2odoo column).
 *
 * Zid webhook endpoints:
 *   POST   /v1/managers/webhooks   → Create webhook
 *   DELETE /v1/managers/webhooks   → Delete webhook
 */

import { getZidConfig } from './config'
import { getAccessToken } from './token'
import { getZidWebhookCredential } from './webhook-auth'

/**
 * Maps internal sync-settings keys → Zid webhook event names.
 *
 * Only the 14 official Zid webhook events (docs.zid.sa/webhooks) are listed.
 * Unofficial names (order.cancelled/delivered/tagged, product.stock.*, location.*)
 * were removed — Zid never sends them. Status changes arrive via
 * `order.status.update` and stock changes via `product.update`.
 *
 * NOTE: `inventory_sync` (sync-settings UI) is intentionally NOT mapped here —
 * it is a bidirectional meta-key: zid2odoo is instantaneous via product.update,
 * odoo2zid runs on schedule (cron) via locations stock-update.
 */
export const ZID_EVENT_MAP: Record<string, string> = {
  order_create: 'order.create',
  order_status_update: 'order.status.update',
  order_payment_status_update: 'order.payment_status.update',
  product_create: 'product.create',
  product_update: 'product.update',
  product_delete: 'product.delete',
  product_publish: 'product.publish',
  abandoned_cart_created: 'abandoned_cart.created',
  abandoned_cart_completed: 'abandoned_cart.completed',
  category_create: 'category.create',
  category_update: 'category.update',
  category_delete: 'category.delete',
  customer_create: 'customer.create',
  customer_update: 'customer.update',
  customer_login: 'customer.login',
  customer_merchant_update: 'customer.merchant.update',
}

/**
 * The core events auto-registered on connect. They cover catalog (products
 * + categories, full create/update/delete), sales (all order events) and
 * customers. Everything else is opt-in from Advanced settings.
 */
export const ZID_CORE_EVENTS = [
  'order_create',
  'order_status_update',
  'order_payment_status_update',
  'product_create',
  'product_update',
  'product_delete',
  'product_publish',
  'customer_create',
  'customer_update',
  'customer_merchant_update',
  'category_create',
  'category_update',
  'category_delete',
]

interface MerchantAuthHeaders {
  Authorization: string
  'X-Manager-Token': string
  Accept: string
  'Content-Type': string
  [key: string]: string
}

/** Fetch merchant auth headers using getAccessToken to ensure automatic refresh */
async function getMerchantHeaders(merchantId: string): Promise<MerchantAuthHeaders | null> {
  try {
    const tokens = await getAccessToken(merchantId)
    if (!tokens) return null

    // Partner-level Authorization token is returned by Zid during OAuth. If it
    // was not stored, fall back to the access token so webhook calls still work.
    let authHeader = tokens.authorization || tokens.accessToken
    if (!authHeader.startsWith('Bearer ')) {
      authHeader = `Bearer ${authHeader}`
    }

    return {
      Authorization: authHeader,
      'X-Manager-Token': tokens.accessToken,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }
  } catch (error) {
    console.error('[Zid Webhook] Failed to get valid access token for merchant:', merchantId, error)
    return null
  }
}

let _webhookUrlWarningShown = false

function getWebhookUrl(): string {
  const url = (
    process.env.ZID_WEBHOOK_URL ??
    `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')}/api/webhooks/zid`
  )
  if (url.includes('undefined') && !_webhookUrlWarningShown) {
    console.error(
      '[Zid Webhooks] ⚠️ Webhook URL is INVALID — neither ZID_WEBHOOK_URL nor NEXT_PUBLIC_APP_URL is set. ' +
      'Webhooks from Zid will NOT be received. Set NEXT_PUBLIC_APP_URL in your environment.'
    )
    _webhookUrlWarningShown = true
  }
  return url
}

/**
 * Register a single webhook event for a merchant in Zid.
 * POST /v1/managers/webhooks
 */
export async function registerZidWebhook(
  merchantId: string,
  eventKey: string
): Promise<{ success: boolean; event: string; message?: string }> {
  const zidEventName = ZID_EVENT_MAP[eventKey]
  if (!zidEventName) {
    return { success: false, event: eventKey, message: `Unknown event key: ${eventKey}` }
  }

  const headers = await getMerchantHeaders(merchantId)
  if (!headers) {
    return { success: false, event: eventKey, message: 'Merchant tokens not found' }
  }

  const config = getZidConfig()
  const baseUrl = getWebhookUrl()
  const targetUrl = new URL(baseUrl)
  targetUrl.searchParams.set('event', zidEventName)
  targetUrl.searchParams.set('store_id', merchantId)

  const body: Record<string, any> = {
    event: zidEventName,
    target_url: targetUrl.toString(),
    original_id: config.clientId,
  }
  // Zid's only documented inbound authentication is HTTP Basic: supply
  // `username` + `password` at creation and Zid sends
  // `Authorization: Basic base64(username:password)` with every delivery.
  // The `secret` field this used to send is not in Zid's webhook schema, so it
  // was silently ignored and every delivery arrived unsigned.
  const credential = getZidWebhookCredential(merchantId)
  if (credential) {
    body.username = credential.username
    body.password = credential.password
  } else {
    // Unreachable in production (crypto.ts refuses to boot without
    // ENCRYPTION_KEY). Never send a placeholder: Zid would store it as the
    // real password and every later delivery would fail authentication.
    console.error(
      '[Zid Webhook] No credential derivable (ENCRYPTION_KEY missing) — registering without Basic Auth. Deliveries will not authenticate.'
    )
  }

  try {
    const response = await fetch(
      new URL('managers/webhooks', `${config.apiUrl}/`).toString(),
      { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' }
    )
    const payload = await response.json().catch(() => null)

    console.info('[Zid Webhook] Register', {
      event: zidEventName,
      merchantId,
      status: response.status,
      payload,
    })

    if (!response.ok) {
      return {
        success: false,
        event: zidEventName,
        message: `Zid API error ${response.status}: ${JSON.stringify(payload)}`,
      }
    }
    return { success: true, event: zidEventName }
  } catch (err: any) {
    console.error('[Zid Webhook] Network error registering', { event: zidEventName, err })
    return { success: false, event: zidEventName, message: err?.message ?? 'Network error' }
  }
}

/**
 * Unregister a single webhook event for a merchant in Zid.
 * DELETE /v1/managers/webhooks
 */
export async function unregisterZidWebhook(
  merchantId: string,
  eventKey: string
): Promise<{ success: boolean; event: string; message?: string }> {
  const zidEventName = ZID_EVENT_MAP[eventKey]
  if (!zidEventName) {
    return { success: false, event: eventKey, message: `Unknown event key: ${eventKey}` }
  }

  const headers = await getMerchantHeaders(merchantId)
  if (!headers) {
    return { success: false, event: eventKey, message: 'Merchant tokens not found' }
  }

  const config = getZidConfig()
  const baseUrl = getWebhookUrl()
  const targetUrl = new URL(baseUrl)
  targetUrl.searchParams.set('event', zidEventName)
  targetUrl.searchParams.set('store_id', merchantId)

  const deleteUrl = new URL('managers/webhooks', `${config.apiUrl}/`)
  deleteUrl.searchParams.set('original_id', config.clientId)

  const body: Record<string, any> = {
    event: zidEventName,
    target_url: targetUrl.toString(),
    original_id: config.clientId,
  }

  try {
    const response = await fetch(
      deleteUrl.toString(),
      { method: 'DELETE', headers, body: JSON.stringify(body), cache: 'no-store' }
    )
    const payload = response.status !== 204 ? await response.json().catch(() => null) : null

    console.info('[Zid Webhook] Unregister', {
      event: zidEventName,
      merchantId,
      status: response.status,
      payload,
    })

    if (!response.ok) {
      return {
        success: false,
        event: zidEventName,
        message: `Zid API error ${response.status}: ${JSON.stringify(payload)}`,
      }
    }
    return { success: true, event: zidEventName }
  } catch (err: any) {
    console.error('[Zid Webhook] Network error unregistering', { event: zidEventName, err })
    return { success: false, event: zidEventName, message: err?.message ?? 'Network error' }
  }
}

/**
 * Remove ALL webhooks registered for a specific merchant from Zid.
 * Used on store disconnect to avoid orphaned webhooks hitting our endpoint, and
 * by the Basic-Auth re-registration flow (credentials live on the webhook row,
 * so they can only be changed by deleting and re-creating).
 *
 * Unlike the old behaviour (deleting by app `original_id` — which wiped other
 * stores' webhooks), this only targets the webhooks whose target_url belongs to
 * this merchant.
 *
 * Returns what was removed so a caller can tell "nothing was registered" from
 * "the LIST call failed and the blind fallback ran".
 */
export async function unregisterAllZidWebhooks(
  merchantId: string
): Promise<{ removed: number; listFailed: boolean }> {
  const headers = await getMerchantHeaders(merchantId)
  if (!headers) {
    console.error('[Zid Webhook] Merchant tokens not found for cleanup')
    return { removed: 0, listFailed: true }
  }

  const config = getZidConfig()
  const storeMarker = `store_id=${encodeURIComponent(merchantId)}`

  let existing: Array<{ event?: string; target_url?: string; id?: string }> = []
  let listFailed = false
  try {
    const listUrl = new URL('managers/webhooks', `${config.apiUrl}/`)
    const response = await fetch(listUrl.toString(), { headers, cache: 'no-store' })
    const payload = await response.json().catch(() => null)
    if (response.ok && payload) {
      const items = Array.isArray(payload) ? payload : payload.data ?? payload.webhooks ?? null
      if (Array.isArray(items)) existing = items
    }
  } catch (err) {
    console.error('[Zid Webhook] Failed to list webhooks during cleanup:', err)
    listFailed = true
  }

  // If we can list webhooks, remove only those belonging to this merchant.
  const toRemove = existing.filter((wh) =>
    (wh.target_url || '').includes(storeMarker) || (wh.target_url || '').includes(merchantId)
  )

  let removed = 0
  for (const wh of toRemove) {
    try {
      const deleteUrl = new URL('managers/webhooks', `${config.apiUrl}/`)
      deleteUrl.searchParams.set('original_id', config.clientId)
      const body: Record<string, any> = { original_id: config.clientId }
      if (wh.event) body.event = wh.event
      if (wh.target_url) body.target_url = wh.target_url
      if (wh.id) body.id = wh.id

      const response = await fetch(deleteUrl.toString(), {
        method: 'DELETE',
        headers,
        body: JSON.stringify(body),
        cache: 'no-store',
      })
      if (response.ok) removed += 1
      console.info('[Zid Webhook] Removed webhook on disconnect', {
        merchantId,
        event: wh.event,
        status: response.status,
      })
    } catch (err) {
      console.error('[Zid Webhook] Failed to remove webhook on disconnect:', { event: wh.event, err })
    }
  }

  // If listing failed, fall back to unregistering every known enabled event.
  if (toRemove.length === 0 && existing.length === 0) {
    const keys = Object.keys(ZID_EVENT_MAP)
    const results = await Promise.allSettled(keys.map((k) => unregisterZidWebhook(merchantId, k)))
    results.forEach((r) => {
      if (r.status === 'rejected') {
        console.error('[Zid Webhook] Unexpected error during cleanup:', r.reason)
      } else if (r.value?.success) {
        removed += 1
      }
    })
  }

  return { removed, listFailed }
}

/**
 * Synchronize webhooks with settings.
 *
 * Instead of clearing ALL webhooks for the app (which would wipe other stores'
 * webhooks — a multi-tenant risk), it first lists the webhooks registered for
 * THIS merchant, deletes only the ones tied to this store that are no longer
 * enabled, and registers the currently enabled events that are missing.
 *
 * @param merchantId   - The Zid merchant/store ID
 * @param newSettings  - New sync settings the user just saved
 * @returns per-call counts, so the Basic-Auth re-registration flow can report
 *          what actually changed instead of assuming success.
 */
export async function syncWebhooksWithSettings(
  merchantId: string,
  newSettings: Record<string, { odoo2zid: boolean; zid2odoo: boolean }>
): Promise<{ registered: number; failed: number; removed: number }> {
  const empty = { registered: 0, failed: 0, removed: 0 }
  const headers = await getMerchantHeaders(merchantId)
  if (!headers) {
    console.error('[Zid Webhook] Merchant tokens not found for sync')
    return { ...empty, failed: 1 }
  }

  const config = getZidConfig()

  // Build the desired set of enabled events that map to Zid webhook names
  const desired = new Set<string>()
  for (const [key, val] of Object.entries(newSettings)) {
    if (key in ZID_EVENT_MAP && val.zid2odoo) {
      desired.add(ZID_EVENT_MAP[key])
    }
  }

  // 1. List existing webhooks to find the ones belonging to this merchant
  let existing: Array<{ event?: string; target_url?: string; id?: string }> = []
  try {
    const listUrl = new URL('managers/webhooks', `${config.apiUrl}/`)
    const response = await fetch(listUrl.toString(), { headers, cache: 'no-store' })
    const payload = await response.json().catch(() => null)
    if (response.ok && payload) {
      const items = Array.isArray(payload) ? payload : payload.data ?? payload.webhooks ?? null
      if (Array.isArray(items)) existing = items
    }
  } catch (err) {
    console.error('[Zid Webhook] Failed to list existing webhooks:', err)
  }

  // 2. Remove only THIS merchant's webhooks that are no longer enabled
  const storeMarker = `store_id=${encodeURIComponent(merchantId)}`
  const removals = existing.filter((wh) => {
    const url = wh.target_url || ''
    const belongsToStore = url.includes(storeMarker) || url.includes(merchantId)
    const event = wh.event
    return belongsToStore && (!event || !desired.has(event))
  })

  for (const wh of removals) {
    try {
      const deleteUrl = new URL('managers/webhooks', `${config.apiUrl}/`)
      deleteUrl.searchParams.set('original_id', config.clientId)
      const body: Record<string, any> = { original_id: config.clientId }
      if (wh.event) body.event = wh.event
      if (wh.target_url) body.target_url = wh.target_url
      if (wh.id) body.id = wh.id

      const response = await fetch(deleteUrl.toString(), {
        method: 'DELETE',
        headers,
        body: JSON.stringify(body),
        cache: 'no-store',
      })
      console.info('[Zid Webhook] Removed obsolete webhook', {
        merchantId,
        event: wh.event,
        status: response.status,
      })
    } catch (err) {
      console.error('[Zid Webhook] Failed to remove webhook:', { event: wh.event, err })
    }
  }

  // 3. Register currently enabled events that are missing
  const enabledEvents = new Set(existing.map((wh) => wh.event).filter(Boolean) as string[])
  const toRegister: string[] = []
  for (const [key, val] of Object.entries(newSettings)) {
    if (!(key in ZID_EVENT_MAP) || !val.zid2odoo) continue
    const zidEventName = ZID_EVENT_MAP[key]
    if (!enabledEvents.has(zidEventName) && desired.has(zidEventName)) {
      toRegister.push(key)
    }
  }

  if (toRegister.length === 0) {
    console.info('[Zid Webhook] No new webhooks to register', { merchantId })
    return { ...empty, removed: removals.length }
  }

  // If we couldn't list existing webhooks reliably, fall back to registering
  // the full desired set to guarantee sync coverage.
  const registerKeys =
    existing.length > 0
      ? toRegister
      : Array.from(desired).map(
          (zidEventName) =>
            Object.entries(ZID_EVENT_MAP).find(([, v]) => v === zidEventName)?.[0] ??
            zidEventName
        )

  console.info('[Zid Webhook] Registering webhooks:', { merchantId, registerKeys })
  const results = await Promise.allSettled(
    registerKeys.map((k) => registerZidWebhook(merchantId, k))
  )

  let registered = 0
  let failed = 0
  results.forEach((r) => {
    if (r.status === 'fulfilled' && !r.value.success) {
      failed += 1
      console.warn('[Zid Webhook] Failed to register webhook:', r.value)
    } else if (r.status === 'rejected') {
      failed += 1
      console.error('[Zid Webhook] Unexpected error registering webhook:', r.reason)
    } else {
      registered += 1
    }
  })

  return { registered, failed, removed: removals.length }
}
