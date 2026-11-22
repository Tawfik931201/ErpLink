import { decrypt, encrypt } from '@/lib/crypto'
import { supabase } from '@/lib/supabase'

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  refresh_token_expires_in?: number
}

export function shopifyTokenFields(data: TokenResponse, now = Date.now()) {
  if (!data.access_token || !data.refresh_token || !(Number(data.expires_in) > 0)
      || !(Number(data.refresh_token_expires_in) > 0)) {
    throw new Error('Incomplete expiring Shopify token response')
  }
  return {
    access_token: data.access_token,
    refresh_token: encrypt(data.refresh_token),
    expires_at: new Date(now + Number(data.expires_in) * 1000).toISOString(),
    refresh_token_expires_at: new Date(now + Number(data.refresh_token_expires_in) * 1000).toISOString(),
  }
}

async function readToken(shop: string) {
  const { data, error } = await supabase.from('shopify_tokens')
    .select('access_token, refresh_token, expires_at').eq('shop_domain', shop).maybeSingle()
  if (error || !data) throw new Error('Shopify store connection unavailable')
  return data
}

async function resolveToken(shop: string) {
  const row = await readToken(shop)
  if (!row.expires_at || Date.parse(row.expires_at) > Date.now() + 60_000) return row.access_token as string
  if (!row.refresh_token) throw new Error('Shopify store requires reauthorization')
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'refresh_token', refresh_token: decrypt(row.refresh_token),
    }),
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
  })
  if (response.ok) {
    const next = shopifyTokenFields(await response.json())
    const { data, error } = await supabase.from('shopify_tokens').update(next)
      .eq('shop_domain', shop).eq('expires_at', row.expires_at).select('expires_at').maybeSingle()
    if (error) throw new Error('Could not save refreshed Shopify authorization')
    if (data) return next.access_token
  }
  // A concurrent process or reconnect may already have rotated the pair.
  const latest = await readToken(shop)
  if (latest.expires_at !== row.expires_at && Date.parse(latest.expires_at) > Date.now()) return latest.access_token as string
  throw new Error(`Shopify token refresh failed (HTTP ${response.status})`)
}

const pending = new Map<string, Promise<string>>()

export function getShopifyAccessToken(shop: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) throw new Error('Invalid Shopify domain')
  const active = pending.get(shop)
  if (active) return active
  const request = resolveToken(shop).finally(() => pending.delete(shop))
  pending.set(shop, request)
  return request
}
