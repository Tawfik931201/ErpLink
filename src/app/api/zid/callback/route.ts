import { type NextRequest, NextResponse } from 'next/server'

import { getAppBaseUrl } from '@/lib/app-url'
import { checkRateLimit, rateLimitKeyFromHeaders } from '@/lib/rate-limit'
import { getZidConfig } from '@/lib/zid/config'
import {
  consumeZidState, oauthCookieOptions, savePendingZidConnection,
  PENDING_TTL_SECONDS, ZID_CONNECT_PATH, ZID_PENDING_COOKIE,
} from '@/lib/zid/oauth-pending'
import { exchangeAuthorizationCodeForResponse, toStoredTokens } from '@/lib/zid/token'

function cleanRedirect(request: NextRequest, error?: string) {
  const url = new URL(ZID_CONNECT_PATH, getAppBaseUrl(request))
  if (error) url.searchParams.set('error', error)
  const response = NextResponse.redirect(url)
  response.cookies.delete('zid_oauth_state')
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

/** Exchange promptly, before login. Never forward the authorization code. */
export async function GET(request: NextRequest) {
  const limit = checkRateLimit(rateLimitKeyFromHeaders(n => request.headers.get(n), 'oauth-zid-callback'), 30, 60_000)
  if (!limit.allowed) return cleanRedirect(request, 'rate_limited')
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const storedState = request.cookies.get('zid_oauth_state')?.value
  if (!code && !state && !request.nextUrl.searchParams.has('error')) {
    return NextResponse.redirect(new URL('/api/zid/connect', getAppBaseUrl(request)))
  }
  if (!state || !storedState || state !== storedState) return cleanRedirect(request, 'invalid_state')

  try {
    if (!await consumeZidState(state)) return cleanRedirect(request, 'invalid_state')
    if (request.nextUrl.searchParams.has('error')) return cleanRedirect(request, 'zid_denied')
    if (!code) return cleanRedirect(request, 'zid_missing_code')
    const rawResponse = await exchangeAuthorizationCodeForResponse(code)
    const tokens = toStoredTokens(rawResponse)
    const authorization = tokens.authorization || tokens.accessToken
    const headers = {
      Accept: 'application/json', 'Accept-Language': 'en',
      'X-Manager-Token': tokens.accessToken,
      Authorization: /^Bearer /i.test(authorization) ? authorization : `Bearer ${authorization}`,
    }
    const config = getZidConfig()
    const fetchAccount = async (path: string) => {
      const response = await fetch(`${config.apiUrl}/${path}`, {
        headers, cache: 'no-store', signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error('Could not verify the authorized Zid store')
      return response.json()
    }
    const [account, storeResponse] = await Promise.all([
      fetchAccount('managers/account/me'), fetchAccount('managers/account/store'),
    ])
    const store = storeResponse.store || storeResponse
    const manager = account.user || account
    if (!store.id || !/^[0-9]+$/.test(String(store.id))) throw new Error('Missing verified Zid store identity')
    const storeId = String(store.id)
    const tokenData = {
      // New connections use the verified STORE identity, never the manager id.
      merchant_id: storeId, store_id: storeId,
      access_token: tokens.accessToken, refresh_token: tokens.refreshToken,
      authorization_token: tokens.authorization || '', token_type: tokens.tokenType,
      expires_at_ms: tokens.expiresAt,
      name: store.title || store.name || null, email: manager.email || null,
      username: manager.name || store.username || manager.username || null,
      uuid: store.uuid || manager.uuid || null, old_id: Number(storeId),
    sync_settings: {
          order_create: { odoo2zid: false, zid2odoo: true },
          order_status_update: { odoo2zid: false, zid2odoo: true },
          order_payment_status_update: { odoo2zid: false, zid2odoo: true },
          product_create: { odoo2zid: false, zid2odoo: true },
          product_update: { odoo2zid: false, zid2odoo: true },
          product_delete: { odoo2zid: false, zid2odoo: true },
          product_publish: { odoo2zid: false, zid2odoo: true },
          customer_create: { odoo2zid: false, zid2odoo: true },
          customer_update: { odoo2zid: false, zid2odoo: true },
          category_create: { odoo2zid: false, zid2odoo: true },
          category_update: { odoo2zid: false, zid2odoo: true },
          category_delete: { odoo2zid: false, zid2odoo: true },
        },
    }
    const handle = await savePendingZidConnection(tokenData)
    const response = cleanRedirect(request)
    response.cookies.set(ZID_PENDING_COOKIE, handle, oauthCookieOptions(PENDING_TTL_SECONDS))
    return response
  } catch {
    // Provider responses/errors can contain secrets. Only a fixed public error leaves here.
    return cleanRedirect(request, 'zid_connection_failed')
  }
}
