export async function enrichZidCustomer(
  data: Record<string, unknown>,
  storeIdStr: string,
  isLegacyDelivery: boolean,
): Promise<Record<string, unknown>> {
  const customerId = data.id || data.customer_id
  if (customerId) {
    try {
      const { supabaseAdmin } = await import('@/lib/sync-runtime')
      const { data: tokenRow } = await supabaseAdmin
        .from('merchant_tokens')
        .select('*')
        .or(`store_id.eq.${storeIdStr},merchant_id.eq.${storeIdStr}`)
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
        console.info(`[SyncEngine] Zid customer webhook payload is minimal. Fetching full details for ID ${customerId}...`)
        const response = await ZidAPI.customers.get(creds, String(customerId))
        if (response.data?.customer) {
          console.info(`[SyncEngine] Full Zid customer data fetched. Type: ${response.data.customer.type}`)
          //legacy: API يفوز عليه الجسم (المتصل غير المصادق محفز فقط)
          data = isLegacyDelivery
            ? { ...data, ...response.data.customer }
            : {
                ...response.data.customer,
                ...data,
              }
        }
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      const isTokenError = /401|403|unauthorized|token|expired|forbidden/i.test(msg)
      if (isTokenError) {
        console.error(`[SyncEngine] ⚠️ Zid token issue while fetching customer ${customerId} — sync will continue with minimal payload. Error: ${msg}`)
      } else {
        console.warn(`[SyncEngine] Failed to fetch full Zid customer details for ID ${customerId}:`, msg)
      }
    }
  }
  return data
}
