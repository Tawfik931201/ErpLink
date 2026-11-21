import { auth } from '@clerk/nextjs/server'
import { type NextRequest, NextResponse } from 'next/server'

import { callShopifyGraphQL, normalizeShopDomain, verifyShopifyCallbackHmac } from '@/lib/shopify-client'
import {
  createShopifyOAuthContext,
  SHOPIFY_OAUTH_COOKIE,
  SHOPIFY_OAUTH_MAX_AGE_SECONDS,
} from '@/lib/shopify/oauth-state'
import { SHOPIFY_REQUIRED_SCOPE_STRING } from '@/lib/shopify/scopes'
import { supabase } from '@/lib/supabase'
import { accessibleWorkspaceId } from '@/lib/workspace-access'
import { ensureDefaultWorkspace } from '@/lib/workspace-defaults'

const REAUTH_INTENT_COOKIE = 'shopify_reauth_intent'

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
      const response = NextResponse.redirect(installUrl)
      // A deliberate ERP Link "Connect / Reconnect" click must always run
      // consent, even when Shopify has already installed this app.
      response.cookies.set(REAUTH_INTENT_COOKIE, '1', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: SHOPIFY_OAUTH_MAX_AGE_SECONDS,
        path: '/',
      })
      return response
    }

    const { data: owner, error: ownerError } = await supabase
      .from('shopify_tokens')
      .select('workspace_id')
      .eq('shop_domain', shop)
      .maybeSingle()
    if (ownerError) return errorRedirect(request, 'shopify_storage_failed')
    const forceReauthorize = request.cookies.get(REAUTH_INTENT_COOKIE)?.value === '1'
    let linkedWorkspaceId = workspaceId
    if (owner && owner.workspace_id !== workspaceId) {
      // Shopify opens the existing app for merchants who might currently
      // have another ERP Link workspace active. Only switch into a workspace
      // the Clerk user already owns or belongs to. Never silently migrate the
      // shop or its credentials across workspaces.
      const accessibleOwnerWorkspace = !forceReauthorize
        ? await accessibleWorkspaceId(userId, owner.workspace_id)
        : null
      if (!accessibleOwnerWorkspace) {
        return errorRedirect(request, 'shopify_workspace_conflict')
      }
      const { error: activateError } = await supabase
        .from('users')
        .update({ active_workspace_id: accessibleOwnerWorkspace })
        .eq('id', userId)
      if (activateError) return errorRedirect(request, 'no_active_workspace')
      linkedWorkspaceId = accessibleOwnerWorkspace
    }

    if (owner && !forceReauthorize) {
      // Normal Shopify launch: validate an existing live token and go straight
      // to the connected-store UI. Explicit reconnect clicks still run OAuth.
      try {
        const details = await callShopifyGraphQL(
          shop, 'query ErpLinkLaunch { shop { name } }'
        )
        if (details?.shop) {
          const target = new URL('/app/connect-store', request.nextUrl.origin)
          target.searchParams.set('success', 'shopify_existing')
          const response = NextResponse.redirect(target)
          response.cookies.delete(REAUTH_INTENT_COOKIE)
          return response
        }
      } catch {
        // Expired/revoked token: obtain new authorization rather than
        // claiming an unverified existing connection is healthy.
      }
    }

    const { state, cookie } = createShopifyOAuthContext({
      shop, userId, workspaceId: linkedWorkspaceId,
    }, clientSecret)
    const authUrl = new URL('https://' + shop + '/admin/oauth/authorize')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    // Keep required scopes aligned with shopify.app.toml.
    authUrl.searchParams.set('scope', SHOPIFY_REQUIRED_SCOPE_STRING)
    authUrl.searchParams.set('state', state)

    const response = NextResponse.redirect(authUrl)
    response.cookies.delete(REAUTH_INTENT_COOKIE)
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
