import { auth } from '@clerk/nextjs/server'
import { type NextRequest, NextResponse } from 'next/server'

import {
  SHOPIFY_API_VERSION,
  SHOPIFY_CORE_TOPICS,
  normalizeShopDomain,
  registerShopifyWebhook,
  verifyShopifyCallbackHmac,
} from '@/lib/shopify-client'
import { supabase } from '@/lib/supabase'
import { accessibleWorkspaceId } from '@/lib/workspace-access'

function redirectToConnectStore(request: NextRequest, params: Record<string, string>) {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ??
    request.nextUrl.origin
  const url = new URL('/app/connect-store', appUrl)

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const { checkRateLimit, rateLimitKeyFromHeaders } = await import('@/lib/rate-limit')
  const cbRl = checkRateLimit(
    rateLimitKeyFromHeaders((n) => request.headers.get(n), 'oauth-shopify-callback'),
    30,
    60_000
  )
  if (!cbRl.allowed) {
    return redirectToConnectStore(request, { error: 'rate_limited' })
  }

  const code = request.nextUrl.searchParams.get('code')
  const shopParam = request.nextUrl.searchParams.get('shop')
  const state = request.nextUrl.searchParams.get('state')
  const storedState = request.cookies.get('shopify_oauth_state')?.value

  // تحقق النطاق أولاً (early-return يخفف السيرفر ويمنع الحقن).
  const shop = shopParam ? normalizeShopDomain(shopParam) : ''
  if (!shop) {
    return redirectToConnectStore(request, { error: 'invalid_shop' })
  }

  if (!state || !storedState || state !== storedState) {
    return redirectToConnectStore(request, { error: 'invalid_state' })
  }

  if (!code) {
    return redirectToConnectStore(request, { error: 'shopify_missing_code' })
  }

  // Resolve the session before spending the single-use authorization code. The
  // workspace was already required further down, but only *after* the exchange,
  // so a signed-out visitor could burn a code for nothing.
  const { userId } = await auth()
  if (!userId) {
    return redirectToConnectStore(request, { error: 'unauthorized' })
  }

  const { data: userDb, error: userDbErr } = await supabase
    .from('users')
    .select('active_workspace_id')
    .eq('id', userId)
    .maybeSingle()

  if (userDbErr) {
    console.error('[Shopify OAuth] Could not load the user profile:', userDbErr.message)
    return redirectToConnectStore(request, { error: 'no_active_workspace' })
  }

  const activeWorkspaceId = await accessibleWorkspaceId(userId, userDb?.active_workspace_id)
  if (!activeWorkspaceId) {
    return redirectToConnectStore(request, { error: 'no_active_workspace' })
  }

  let failureCode = 'shopify_token_exchange_failed'
  try {
    const clientId = process.env.SHOPIFY_CLIENT_ID!
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET!
    if (!clientId || !clientSecret) {
      return redirectToConnectStore(request, { error: 'shopify_token_exchange_failed' })
    }

    // تحقق HMAC على query (مقارنة ثابتة الزمن في shopify-client).
    if (!verifyShopifyCallbackHmac(request.url, clientSecret)) {
      return redirectToConnectStore(request, { error: 'shopify_invalid_signature' })
    }

    // 1. Request access token
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (!tokenResponse.ok) {
      const detail = await tokenResponse.text()
      // Log only known error categories. Provider bodies can contain credentials.
      const category = /expiring/i.test(detail) ? 'token_expiry_policy'
        : /invalid_client|client secret/i.test(detail) ? 'client_credentials'
        : /invalid_grant|authorization code/i.test(detail) ? 'authorization_code' : 'provider_rejected'
      console.error('[Shopify OAuth] Token exchange rejected', tokenResponse.status, category)
      return redirectToConnectStore(request, { error: 'shopify_token_exchange_failed' })
    }
    const { access_token, scope } = await tokenResponse.json()
    if (!access_token) {
      return redirectToConnectStore(request, { error: 'shopify_token_exchange_failed' })
    }

    // The shop profile is optional display data. A profile lookup failure must
    // not discard a valid offline token or erase a previously stored name.
    const profile: { name?: string; email?: string } = {}
    try {
      const result = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': access_token },
        body: JSON.stringify({ query: '{ shop { name email } }' }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      })
      if (result.ok) {
        const data = (await result.json()).data?.shop
        if (typeof data?.name === 'string') profile.name = data.name
        if (typeof data?.email === 'string') profile.email = data.email
      }
    } catch {
      console.warn('[Shopify OAuth] Shop profile unavailable')
    }
    failureCode = 'shopify_connection_save_failed'
    // 3. The active workspace was resolved (and required) before the code was
    //    exchanged, so `activeWorkspaceId` is guaranteed non-null from here on.
    const workspaceId = activeWorkspaceId

    // 4. Save Shopify token details in DB
    // New connections start with the full core preset syncing store→ERP
    // (products + collections + all order topics + customers), built from
    // SHOPIFY_CORE_TOPICS so the saved toggles can never drift from what the
    // auto-registration loop below subscribes.
    const tokenData = {
      shop_domain: shop,
      access_token,
      scopes: scope ?? null,
      updated_at: new Date().toISOString(),
      workspace_id: workspaceId,
      ...profile,
      sync_settings: Object.fromEntries(
        SHOPIFY_CORE_TOPICS.map((topic) => [topic, { shopify2odoo: true }])
      ),
    }

    const { data: existingToken, error: lookupError } = await supabase
      .from('shopify_tokens')
      .select('shop_domain')
      .eq('shop_domain', shop)
      .maybeSingle()

    if (lookupError) throw lookupError
    if (existingToken) {
      // Preserve the merchant's existing sync toggles on reconnect.
      const { sync_settings: _ignore, ...updateData } = tokenData
      void _ignore
      const { error: updateError } = await supabase
        .from('shopify_tokens')
        .update(updateData)
        .eq('shop_domain', shop)

      if (updateError) throw updateError
    } else {
      // Multi-store: a workspace may link several Shopify shops, so a new
      // shop is always INSERTED and sibling rows are never touched here.
      const { error: insertError } = await supabase
        .from('shopify_tokens')
        .insert([tokenData])

      if (insertError) throw insertError
    }

    // 5. Automatically register webhooks (non-blocking, best-effort).
    // الأساسية + app/uninstalled (تنظيف التوكن) + GDPR الثلاثة + scopes_update
    // (امتثال App Store — يجب أن تبقى مشتركة دائماً).
    // Store-sync topics are shop-scoped so per-store toggles can remove them.
    // app/uninstalled + GDPR + scopes_update are app-scoped in shopify.app.toml.
    const webhookTopics = [...SHOPIFY_CORE_TOPICS]

    for (const topic of webhookTopics) {
      // Async webhook registration. We do not block the OAuth flow on this.
      registerShopifyWebhook(shop, topic, access_token).catch(() => {})
    }

    // Auto-bootstrap workspace defaults in background (zero-configuration)
    if (workspaceId) {
      import('@/lib/auto-bootstrap').then(({ autoBootstrapWorkspace }) => {
        autoBootstrapWorkspace(workspaceId).catch(() => {})
      }).catch(() => {})
    }

    const response = redirectToConnectStore(request, {
      success: 'shopify_connected',
      store: profile.name || shop,
    })

    response.cookies.delete('shopify_oauth_state')
    return response

  } catch (error) {
    const code = (error as { code?: string })?.code
    console.error('[Shopify OAuth]', failureCode, typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'request_failed')
    return redirectToConnectStore(request, { error: failureCode })
  }
}
