import { isOrderCreationEvent } from './order-helpers'

/** Read the authoritative snapshot when the event cannot safely supply the order. */
export async function enrichZidOrder(
  data: Record<string, unknown>,
  storeIdStr: string,
  resolvedWorkspaceId: string | undefined,
  normalizedEvent: string,
  isLegacyDelivery: boolean,
): Promise<{ data: Record<string, unknown> } | { errorMessage: string }> {
  const hasOrderItems = ['products', 'items', 'order_items', 'order_items_list', 'line_items']
    .some(k => Array.isArray((data as any)?.[k]) && ((data as any)[k] as any[]).length > 0)
  const orderId = data.id || data.order_id
  if (!orderId || isLegacyDelivery || !hasOrderItems || !isOrderCreationEvent(normalizedEvent)) {
    try {
      if (!orderId) throw new Error('Zid order event is missing its order id')
      const { resolveZidOrderTokenScope, zidOrderCacheScope, canReuseZidOrderDetails, assertZidOrderDetails, mergeZidOrderDetails } =
        await import('./order-enrichment')
      const tokenRow = await resolveZidOrderTokenScope(storeIdStr, resolvedWorkspaceId || '')

      if (tokenRow) {
        const { getAccessToken } = await import('./token')
        const { ZidAPI } = await import('@/lib/zid-client')
        const { acquirePullToken, getCachedOrderDetails, setCachedOrderDetails } =
          await import('@/lib/store-pull-budget')

        const orderIdStr = String(orderId)
        const workspaceForCache = zidOrderCacheScope(resolvedWorkspaceId || '', String(tokenRow.store_id || storeIdStr))

        // Reuse only creation retries. A status/payment/edit event must not replay
        // an earlier snapshot's state or line items (the cache lasts three minutes).
        const cached = canReuseZidOrderDetails(normalizedEvent, isLegacyDelivery)
          ? getCachedOrderDetails('zid', workspaceForCache, orderIdStr)
          : null
        let orderData: Record<string, unknown> | null = cached

        if (!orderData) {
          // ميزانية السحب: لا نتجاوز سقف زد (60/دقيقة).
          const granted = await acquirePullToken('zid', workspaceForCache)
          if (!granted) {
            throw new Error(
              'Zid API pull budget exhausted (60 reads/min) — the order is rescheduled instead of being written without its line items'
            )
          }
          const storedTokens = await getAccessToken(tokenRow.merchant_id, resolvedWorkspaceId)
          const creds = {
            authorization: storedTokens.authorization || '',
            managerToken: storedTokens.accessToken,
            storeId: tokenRow.store_id || tokenRow.merchant_id,
          }
          console.info(`[SyncEngine] Reading current Zid order details for ID ${orderId}...`)
          const response = await ZidAPI.orders.get(creds, orderIdStr)
          const raw = response.data?.order || response.data?.data || response.data
          orderData = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
        } else {
          console.info(`[SyncEngine] Zid order ${orderId} details served from the pull cache.`)
        }

        if (orderData && (orderData.id || orderData.order_number || orderData.code)) {
          assertZidOrderDetails(orderData, orderIdStr)
          if (!cached) setCachedOrderDetails('zid', workspaceForCache, orderIdStr, orderData)
          console.info(`[SyncEngine] Full Zid order data fetched for ID ${orderId}. Status: ${orderData.order_status || orderData.status || 'n/a'}`)
          // When fetching full order details from Zid API, orderData represents the authoritative real-time state of the order.
          // For order.create events, the webhook payload status (e.g. 'new') is stale if the user already updated the status in Zid.
          // The live API status from orderData must take precedence over stale body status.
          const liveStatus = orderData.order_status || orderData.status || orderData.display_status
          data = {
            ...mergeZidOrderDetails(data, orderData, isLegacyDelivery),
            ...(liveStatus ? {
              order_status: orderData.order_status,
              status: orderData.status,
              display_status: orderData.display_status,
            } : {}),
          }
        } else {
          // استُجيب لكن لا يوجد طلب بهذا المعرّف ⇒ لا بنود ⇒ لا نكتب.
          throw new Error(`Zid returned no order data for id ${orderId}`)
        }
      } else {
        throw new Error(`no Zid token row for store ${storeIdStr}`)
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      const isTokenError = /401|403|unauthorized|token|expired|forbidden/i.test(msg)
      // ⚠️ الفشل هنا كان **يُبتلع** ⇒ المتابعة ببيانات ناقصة ⇒ نكتب في
      // أودوو طلباً **بلا بنود** (لا منتجات) ويبدو أنه تمّ بنجاح. التاجر
      // يجد طلباً في أودوو بلا أصناف ولا يعرف why.
      //
      // الصحيح: **تفشل المهمة** ⇒ يُعاد جدولتها (5 محاولات) ثم صندوق
      // الموتى — قابل للاسترجاع ومرئي. لا يُكتب شيء ناقص.
      if (isTokenError) {
        console.error(`[SyncEngine] ⚠️ Zid token issue while fetching order ${orderId} — the order is NOT synced (it would have no line items). Error: ${msg}`)
      } else {
        console.error(`[SyncEngine] Failed to fetch full Zid order details for ID ${orderId} — the order is NOT synced (it would have no line items). Error: ${msg}`)
      }
      return { errorMessage: `Zid order details unavailable for id ${orderId}: ${msg}`.slice(0, 300) }
    }
  }
  return { data }
}
