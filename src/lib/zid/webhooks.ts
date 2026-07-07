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

/** Maps internal sync-settings keys → Zid webhook event names */
export const ZID_EVENT_MAP: Record<string, string> = {
  order_create:                  'order.create',
  order_status_update:           'order.status.update',
  order_payment_status_update:   'order.payment_status.update',
  product_create:                'product.create',
  product_update:                'product.update',
  product_delete:                'product.delete',
  product_publish:               'product.publish',
  abandoned_cart_created:        'abandoned_cart.created',
  abandoned_cart_completed:      'abandoned_cart.completed',
  category_create:               'category.create',
  category_delete:               'category.delete',
  category_update:               'category.update',
  customer_create:               'customer.create',
  customer_login:                'customer.login',
  customer_update:               'customer.update',
  customer_merchant_update:      'customer.merchant.update',
}

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
    if (!tokens || !tokens.authorization) return null

    let authHeader = tokens.authorization
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

function getWebhookUrl(): string {
  return (
    process.env.ZID_WEBHOOK_URL ??
    `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')}/api/webhooks/zid`
  )
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
  const webhookUrl = getWebhookUrl()
  const body: Record<string, any> = {
    event: zidEventName,
    target_url: webhookUrl,
    original_id: config.clientId,
  }
  if (process.env.ZID_WEBHOOK_SECRET) body.secret = process.env.ZID_WEBHOOK_SECRET

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
  const webhookUrl = getWebhookUrl()
  const deleteUrl = new URL('managers/webhooks', `${config.apiUrl}/`)
  deleteUrl.searchParams.set('original_id', config.clientId)

  const body: Record<string, any> = {
    event: zidEventName,
    target_url: webhookUrl,
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
 * Synchronize webhooks with settings by clearing existing webhooks on Zid first,
 * and then registering the currently checked ones (where `zid2odoo === true`).
 *
 * @param merchantId   - The Zid merchant/store ID
 * @param newSettings  - New sync settings the user just saved
 */
export async function syncWebhooksWithSettings(
  merchantId: string,
  newSettings: Record<string, { odoo2zid: boolean; zid2odoo: boolean }>
): Promise<void> {
  const headers = await getMerchantHeaders(merchantId)
  if (!headers) {
    console.error('[Zid Webhook] Merchant tokens not found for sync')
    return
  }

  const config = getZidConfig()
  const deleteUrl = new URL('managers/webhooks', `${config.apiUrl}/`)
  deleteUrl.searchParams.set('original_id', config.clientId)

  // 1. Delete all existing webhooks for our app first
  try {
    console.info('[Zid Webhook] Clearing all existing webhooks for app', config.clientId)
    const response = await fetch(deleteUrl.toString(), {
      method: 'DELETE',
      headers,
      cache: 'no-store',
    })
    const payload = response.status !== 204 ? await response.json().catch(() => null) : null
    
    console.info('[Zid Webhook] Clear response', {
      status: response.status,
      payload,
    })
  } catch (err) {
    console.error('[Zid Webhook] Error clearing existing webhooks:', err)
  }

  // 2. Register all currently enabled webhooks
  const toRegister: string[] = []
  for (const [key, val] of Object.entries(newSettings)) {
    if (key in ZID_EVENT_MAP && val.zid2odoo) {
      toRegister.push(key)
    }
  }

  if (toRegister.length === 0) {
    console.info('[Zid Webhook] No webhooks to register')
    return
  }

  console.info('[Zid Webhook] Registering webhooks:', { merchantId, toRegister })
  const results = await Promise.allSettled(
    toRegister.map((k) => registerZidWebhook(merchantId, k))
  )

  results.forEach((r) => {
    if (r.status === 'fulfilled' && !r.value.success) {
      console.warn('[Zid Webhook] Failed to register webhook:', r.value)
    } else if (r.status === 'rejected') {
      console.error('[Zid Webhook] Unexpected error registering webhook:', r.reason)
    }
  })
}
