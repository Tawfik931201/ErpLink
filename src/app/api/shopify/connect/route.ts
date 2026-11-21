import { auth } from '@clerk/nextjs/server'
import { type NextRequest, NextResponse } from 'next/server'

import { normalizeShopDomain, verifyShopifyCallbackHmac } from '@/lib/shopify-client'
import {
  createShopifyOAuthContext,
  SHOPIFY_OAUTH_COOKIE,
  SHOPIFY_OAUTH_MAX_AGE_SECONDS,
} from '@/lib/shopify/oauth-state'
import { SHOPIFY_REQUIRED_SCOPE_STRING } from '@/lib/shopify/scopes'
import { supabase } from '@/lib/supabase'
import { accessibleWorkspaceId } from '@/lib/workspace-access'
import { ensureDefaultWorkspace } from '@/lib/workspace-defaults'

function errorRedirect(request: NextRequest, error: string): NextResponse {
  const url = new URL('/app/connect-store', request.nextUrl.origin)
  url.searchParams.set('error', error)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  try {
    const clientId = process.env.SHOPIFY_CLIENT_ID
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
    const redirectUri = process.env.SHOPIFY_REDIRECT_URI
    if (!clientId || !clientSecret || !redirectUri) {
      return errorRedirect(request, 'shopify_missing_config')
    }

    const shopParam = request.nextUrl.searchParams.get('shop')
    const shop = shopParam ? normalizeShopDomain(shopParam) : ''

    // Direct Shopify installation/launch supplies a signed shop. Never accept
    // an unsigned shop query (including one typed by a merchant in the URL).
    if (shopParam && (!shop || !verifyShopifyCallbackHmac(request.url, clientSecret))) {
      return errorRedirect(request, 'shopify_invalid_signature')
    }

    const timestampParam = request.nextUrl.searchParams.get('timestamp')
    if (shopParam && timestampParam) {
      const issued = Number(timestampParam) * 1000
      if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 10 * 60 * 1000) {
        return errorRedirect(request, 'shopify_invalid_signature')
      }
    }

    const { userId } = await auth()
    if (!userId) {
      const signInUrl = new URL('/sign-in', request.nextUrl.origin)
      const resumeUrl = new URL('/api/shopify/connect', request.nextUrl.origin)
      resumeUrl.search = request.nextUrl.search
      signInUrl.searchParams.set('redirect_url', resumeUrl.toString())
      return NextResponse.redirect(signInUrl)
    }

    // Resolve workspace before leaving ERP Link. OAuth state binds this exact
    // workspace so changing active_workspace_id during approval cannot reroute
    // a shop's token to another tenant.
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('active_workspace_id')
      .eq('id', userId)
      .maybeSingle()
    if (userError) return errorRedirect(request, 'no_active_workspace')
    const workspaceId = await accessibleWorkspaceId(userId, user?.active_workspace_id)
      ?? await ensureDefaultWorkspace(userId)
    if (!workspaceId) return errorRedirect(request, 'no_active_workspace')

    if (!shop) {
      // Shopify's install entrypoint shows a store picker. The shop domain
      // is received in the signed app launch after the merchant selects it.
      const installUrl = new URL('https://admin.shopify.com/oauth/install')
      installUrl.searchParams.set('client_id', clientId)
      return NextResponse.redirect(installUrl)
    }

    const { data: owner, error: ownerError } = await supabase
      .from('shopify_tokens')
      .select('workspace_id')
      .eq('shop_domain', shop)
      .maybeSingle()
    if (ownerError) return errorRedirect(request, 'shopify_storage_failed')
    if (owner && owner.workspace_id !== workspaceId) {
      return errorRedirect(request, 'shopify_workspace_conflict')
    }

    const { state, cookie } = createShopifyOAuthContext({
      shop, userId, workspaceId,
    }, clientSecret)
    const authUrl = new URL('https://' + shop + '/admin/oauth/authorize')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    // Keep required scopes aligned with shopify.app.toml.
    authUrl.searchParams.set('scope', SHOPIFY_REQUIRED_SCOPE_STRING)
    authUrl.searchParams.set('state', state)

    const response = NextResponse.redirect(authUrl)
    response.cookies.set(SHOPIFY_OAUTH_COOKIE, cookie, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SHOPIFY_OAUTH_MAX_AGE_SECONDS,
      path: '/',
    })
    return response
  } catch {
    return errorRedirect(request, 'authorization_failed')
  }
}
