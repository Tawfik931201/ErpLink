import { auth } from '@clerk/nextjs/server'
import axios from 'axios'
import { revalidateTag } from 'next/cache'
import { type NextRequest, NextResponse } from 'next/server'

import {
  SHOPIFY_API_VERSION,
  SHOPIFY_CORE_TOPICS,
  normalizeShopDomain,
  registerShopifyWebhook,
  verifyShopifyCallbackHmac,
} from '@/lib/shopify-client'
import { readShopifyOAuthContext, SHOPIFY_OAUTH_COOKIE } from '@/lib/shopify/oauth-state'
import { supabase } from '@/lib/supabase'
import { accessibleWorkspaceId } from '@/lib/workspace-access'

function redirectToConnectStore(request: NextRequest, params: Record<string, string>) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? request.nextUrl.origin
  const url = new URL('/app/connect-store', baseUrl)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const response = NextResponse.redirect(url)
  response.cookies.delete(SHOPIFY_OAUTH_COOKIE)
  return response
}

export async function GET(request: NextRequest) {
  const { checkRateLimit, rateLimitKeyFromHeaders } = await import('@/lib/rate-limit')
  const rate = checkRateLimit(
    rateLimitKeyFromHeaders((name) => request.headers.get(name), 'oauth-shopify-callback'),
    30, 60_000
  )
  if (!rate.allowed) return redirectToConnectStore(request, { error: 'rate_limited' })

  const clientId = process.env.SHOPIFY_CLIENT_ID
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return redirectToConnectStore(request, { error: 'shopify_missing_config' })
  }

  const shop = normalizeShopDomain(request.nextUrl.searchParams.get('shop') ?? '')
  if (!shop) return redirectToConnectStore(request, { error: 'invalid_shop' })

  // Shopify callback must be signed, and the original browser cookie must
  // match this exact shop + nonce + signed-in ERP Link user + workspace.
  if (!verifyShopifyCallbackHmac(request.url, clientSecret)) {
    return redirectToConnectStore(request, { error: 'shopify_invalid_signature' })
  }
  const state = request.nextUrl.searchParams.get('state') ?? ''
  const context = readShopifyOAuthContext(
    request.cookies.get(SHOPIFY_OAUTH_COOKIE)?.value,
    clientSecret,
    { shop, state }
  )
  if (!context) return redirectToConnectStore(request, { error: 'invalid_state' })

  const code = request.nextUrl.searchParams.get('code')
  if (!code) {
    const denied = request.nextUrl.searchParams.get('error') === 'access_denied'
    return redirectToConnectStore(request, { error: denied ? 'access_denied' : 'shopify_missing_code' })
  }

  const { userId } = await auth()
  if (!userId || userId !== context.userId) {
    return redirectToConnectStore(request, { error: 'unauthorized' })
  }
  const workspaceId = await accessibleWorkspaceId(userId, context.workspaceId)
  if (!workspaceId) {
    return redirectToConnectStore(request, { error: 'no_active_workspace' })
  }

  // Reject an existing foreign workspace before consuming the single-use code.
  // Never move the store or modify its sync settings implicitly.
  const { data: prior, error: lookupError } = await supabase
    .from('shopify_tokens')
    .select('workspace_id')
    .eq('shop_domain', shop)
    .maybeSingle()
  if (lookupError) return redirectToConnectStore(request, { error: 'shopify_storage_failed' })
  if (prior && prior.workspace_id !== workspaceId) {
    return redirectToConnectStore(request, { error: 'shopify_workspace_conflict' })
  }

  try {
    const tokenResult = await axios.post(
      'https://' + shop + '/admin/oauth/access_token',
      { client_id: clientId, client_secret: clientSecret, code },
      { timeout: 15_000 }
    )
    const accessToken: string | undefined = tokenResult.data?.access_token
    if (!accessToken) return redirectToConnectStore(request, { error: 'shopify_token_exchange_failed' })

    const detailsResult = await axios.post(
      'https://' + shop + '/admin/api/' + SHOPIFY_API_VERSION + '/graphql.json',
      { query: 'query ErpLinkShop { shop { name email } }' },
      {
        headers: { 'X-Shopify-Access-Token': accessToken },
        timeout: 15_000,
      }
    )
    const shopData = detailsResult.data?.data?.shop
    if (detailsResult.data?.errors || !shopData) {
      return redirectToConnectStore(request, { error: 'shopify_shop_lookup_failed' })
    }

    const baseData = {
      shop_domain: shop,
      access_token: accessToken,
      scopes: tokenResult.data?.scope ?? null,
      updated_at: new Date().toISOString(),
      workspace_id: workspaceId,
      name: shopData.name ?? null,
      email: shopData.email ?? null,
    }

    const updateWithinWorkspace = async () => {
      const { data, error } = await supabase
        .from('shopify_tokens')
        .update(baseData)
        .eq('shop_domain', shop)
        .eq('workspace_id', workspaceId)
        .select('shop_domain')
        .maybeSingle()
      if (error || !data) throw new Error('Shopify token update was not scoped to a workspace')
    }

    if (prior) {
      // Keep existing sync_settings on reauthorization.
      await updateWithinWorkspace()
    } else {
      const syncSettings = Object.fromEntries(
        SHOPIFY_CORE_TOPICS.map((topic) => [topic, { shopify2odoo: true }])
      )
      const { error: insertError } = await supabase
        .from('shopify_tokens')
        .insert([{ ...baseData, sync_settings: syncSettings }])
      if (insertError?.code === '23505') {
        // A concurrent callback inserted first: only update if it belongs
        // to this workspace, preserving its settings and rejecting a transfer.
        await updateWithinWorkspace()
      } else if (insertError) {
        throw new Error('Shopify token insert failed')
      }
    }

    // Invalidate Next.js cached store lists before returning a success signal.
    revalidateTag('shopify-token')

    // A successful OAuth exchange does not guarantee successful webhooks.
    // Await registration and surface a separate partial-success error.
    let failedSubscriptions = 0
    for (let i = 0; i < SHOPIFY_CORE_TOPICS.length; i += 3) {
      const batch = SHOPIFY_CORE_TOPICS.slice(i, i + 3)
      const results = await Promise.all(
        batch.map((topic) => registerShopifyWebhook(shop, topic, accessToken))
      )
      failedSubscriptions += results.filter((value) => !value).length
    }

    if (failedSubscriptions > 0) {
      console.warn('[Shopify OAuth] Store saved, but webhook subscriptions are incomplete', {
        shopDomain: shop,
        failedSubscriptions,
      })
      return redirectToConnectStore(request, { error: 'webhook_registration_failed' })
    }

    import('@/lib/auto-bootstrap')
      .then(({ autoBootstrapWorkspace }) => autoBootstrapWorkspace(workspaceId))
      .catch(() => {})

    return redirectToConnectStore(request, {
      success: 'shopify_connected',
      store: shopData.name || shop,
    })
  } catch {
    // Do not leak Shopify authorization codes or tokens in logs/responses.
    return redirectToConnectStore(request, { error: 'shopify_token_exchange_failed' })
  }
}
