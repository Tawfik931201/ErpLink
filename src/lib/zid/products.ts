/** Merge full current Zid product details over a potentially stale webhook. */
export function mergeZidProductPayload(
  webhook: Record<string, unknown>,
  current: object
): Record<string, unknown> {
  return { ...webhook, ...current }
}

export async function enrichZidProduct(
  data: Record<string, unknown>,
  storeIdStr: string,
  isLegacyDelivery: boolean,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  if (!workspaceId) throw new Error('Zid product enrichment requires a trusted workspace')
  const productId = data.id || data.product_id
  if (isLegacyDelivery && !productId) throw new Error('Unauthenticated Zid product event has no verifiable ID')
  if (productId) {
    try {
      const { supabaseAdmin } = await import('@/lib/sync-runtime')
      const { data: tokenRow } = await supabaseAdmin
        .from('merchant_tokens')
        .select('*')
        .or(`store_id.eq.${storeIdStr},merchant_id.eq.${storeIdStr}`)
        .eq('workspace_id', workspaceId)
        .maybeSingle()

      if (tokenRow) {
        const { getAccessToken } = await import('./token')
        const { ZidAPI } = await import('@/lib/zid-client')

        const storedTokens = await getAccessToken(tokenRow.merchant_id)
        const creds = {
          authorization: storedTokens.authorization || '',
          managerToken: storedTokens.accessToken,
          storeId: tokenRow.store_id || tokenRow.merchant_id,
        }
        console.info(`[SyncEngine] Zid product webhook payload may be minimal. Fetching full details for ID ${productId}...`)
        const response = await ZidAPI.products.get(creds, String(productId))
        const productData = response.data?.product || response.data
        if (productData && (productData.id || productData.name)) {
          console.info(`[SyncEngine] Full Zid product data fetched for ID ${productId}. Class: ${productData.product_class}`)
          const apiVariants = Array.isArray((productData as any).variants) && (productData as any).variants.length > 0 ? (productData as any).variants : null
          const apiOptions = Array.isArray((productData as any).options) && (productData as any).options.length > 0 ? (productData as any).options : null
          const apiAttributes = Array.isArray(productData.attributes) && productData.attributes.length > 0 ? productData.attributes : null
          const apiStructure = productData.structure && productData.structure !== 'standalone' ? productData.structure : null
          const apiHasOptions = (productData as any).has_options === true
          // The Zid API is the current source of truth. An older product.publish
          // webhook can arrive AFTER product.update and must never overwrite the
          // latest name, price, stock or variants fetched here. Keep webhook-only
          // metadata as a fallback when the API omits it.
          data = mergeZidProductPayload(data, productData)
          // Force API-fetched fields for grouped/bundle product detection.
          // Webhook payloads are often minimal; we must preserve bundle data from the API.
          const pClass = (productData as any).product_class
          if (pClass === 'grouped_product' || pClass === 'dynamic_bundle' || pClass === 'bundle' || pClass === 'grouped' || pClass === 'voucher' || pClass === 'downloadable') {
            if ((productData as any).group_products) (data as any).group_products = (productData as any).group_products
            if ((productData as any).grouped_products) (data as any).grouped_products = (productData as any).grouped_products
            if ((productData as any).components) (data as any).components = (productData as any).components
            if ((productData as any).bundle_products) (data as any).bundle_products = (productData as any).bundle_products
            if (pClass) (data as any).product_class = pClass
          }
          if (apiVariants) data.variants = apiVariants
          if (apiOptions) data.options = apiOptions
          if (apiAttributes) data.attributes = apiAttributes
          if (apiStructure) data.structure = apiStructure
          if (apiHasOptions) data.has_options = true
        } else if (isLegacyDelivery) {
          throw new Error('Zid API did not verify product event')
        }
      } else if (isLegacyDelivery) {
        throw new Error('Zid store is no longer linked to this workspace')
      }
    } catch (err: any) {
      if (isLegacyDelivery) throw err // Never apply a product from a forged body.
      const msg = err?.message ?? String(err)
      const isTokenError = /401|403|unauthorized|token|expired|forbidden/i.test(msg)
      if (isTokenError) {
        console.error(`[SyncEngine] ⚠️ Zid token issue while fetching product ${productId} — sync will continue with minimal payload. Error: ${msg}`)
      } else {
        console.warn(`[SyncEngine] Failed to fetch full Zid product details for ID ${productId}:`, msg)
      }
    }
  }
  return data
}

/** Zid options describe attributes. Only variants contains sellable products. */
export function readZidProductVariants(payload: Record<string, unknown>): unknown[] {
  return Array.isArray(payload.variants) ? payload.variants : []
}
