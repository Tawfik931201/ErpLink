import { supabase } from '@/lib/supabase'
import { getSyncRequestContext } from '@/lib/sync/request-context'

import { isOrderCreationEvent } from './order-helpers'

export interface ZidOrderTokenScope {
  merchant_id: string
  store_id: string | null
  workspace_id: string
}

/** Resolve the store first; a merchant id may equal another tenant's store id. */
export async function resolveZidOrderTokenScope(
  storeId: string,
  workspaceId: string,
): Promise<ZidOrderTokenScope | null> {
  if (!workspaceId) throw new Error('Zid order enrichment requires a workspace')
  const ctx = getSyncRequestContext()
  const cacheKey = `${workspaceId}:${storeId}`
  if (ctx && ctx.zidTokenScopes.has(cacheKey)) {
    return ctx.zidTokenScopes.get(cacheKey)!
  }
  if (ctx && ctx.settingsStoreKeys.has(`${workspaceId}:zid:${storeId}`)) {
    const knownMerchantId = ctx.settingsStoreKeys.get(`${workspaceId}:zid:${storeId}`)!
    const result: ZidOrderTokenScope = {
      merchant_id: knownMerchantId,
      store_id: storeId,
      workspace_id: workspaceId,
    }
    ctx.zidTokenScopes.set(cacheKey, result)
    return result
  }

  const columns = 'merchant_id,store_id,workspace_id'
  const byStore = await supabase.from('merchant_tokens').select(columns)
    .eq('store_id', storeId).maybeSingle()
  if (byStore.error) throw byStore.error
  if (byStore.data) {
    if (byStore.data.workspace_id !== workspaceId) {
      throw new Error('Zid order store is no longer linked to this workspace')
    }
    const result = byStore.data as ZidOrderTokenScope
    if (ctx) {
      ctx.zidTokenScopes.set(cacheKey, result)
      if (result.merchant_id) {
        ctx.settingsStoreKeys.set(`${workspaceId}:zid:${storeId}`, String(result.merchant_id))
      }
    }
    return result
  }
  const byMerchant = await supabase.from('merchant_tokens').select(columns)
    .eq('merchant_id', storeId).eq('workspace_id', workspaceId).maybeSingle()
  if (byMerchant.error) throw byMerchant.error
  const result = byMerchant.data as ZidOrderTokenScope | null
  if (ctx) ctx.zidTokenScopes.set(cacheKey, result)
  return result
}

export function zidOrderCacheScope(workspaceId: string, storeId: string): string {
  return JSON.stringify([workspaceId, storeId])
}

/** Cached creation details help retries; updates need current lines, payment and state. */
export function canReuseZidOrderDetails(event: string, isLegacyDelivery: boolean): boolean {
  return !isLegacyDelivery && isOrderCreationEvent(event)
}

export function assertZidOrderDetails(details: Record<string, unknown>, orderId: string): void {
  const returnedId = details.id ?? details.order_id
  if (returnedId !== undefined && String(returnedId) !== orderId) {
    throw new Error(`Zid returned a different order for id ${orderId}`)
  }
  const hasItems = ['products', 'items', 'order_items', 'order_items_list', 'line_items']
    .some(key => Array.isArray(details[key]) && (details[key] as unknown[]).length > 0)
  if (!hasItems) throw new Error(`Zid returned no line items for order ${orderId}`)
}

/** The API is the latest snapshot; a queued webhook may describe an older revision. */
export function mergeZidOrderDetails(
  payload: Record<string, unknown>,
  snapshot: Record<string, unknown>,
  isLegacyDelivery: boolean,
): Record<string, unknown> {
  if (isLegacyDelivery) return { ...snapshot }
  const merged = { ...payload, ...snapshot }
  // Preserve signed event metadata even if a provider adds similarly named keys.
  for (const key of Object.keys(payload)) {
    if (key.startsWith('__')) merged[key] = payload[key]
  }
  const payment = snapshot.payment as Record<string, unknown> | null | undefined
  const paymentState = snapshot.payment_status ?? payment?.status ?? payment?.payment_status
  if (paymentState !== undefined && paymentState !== null) {
    // isOrderPaid accepts several aliases. An old `financial_status: paid`
    // must not overrule the current API's `payment_status: pending`.
    for (const key of ['payment_status', 'financial_status', 'payment_status_name']) {
      if (!(key in snapshot)) delete merged[key]
    }
    if (!('payment' in snapshot) && payload.payment && typeof payload.payment === 'object') {
      const oldPayment = { ...payload.payment as Record<string, unknown> }
      delete oldPayment.status
      delete oldPayment.payment_status
      merged.payment = oldPayment
    }
    if (!('order' in snapshot) && payload.order && typeof payload.order === 'object') {
      const oldOrder = { ...payload.order as Record<string, unknown> }
      delete oldOrder.payment_status
      delete oldOrder.payment
      merged.order = oldOrder
    }
  }
  // Prevent an alternative body array from replacing a newer API line list
  // in mapping readers that accept more than one payload shape.
  const itemKeys = ['products', 'items', 'order_items', 'order_items_list', 'line_items']
  if (itemKeys.some(key => Array.isArray(snapshot[key]))) {
    for (const key of itemKeys) {
      if (!(key in snapshot)) delete merged[key]
    }
  }
  return merged
}
