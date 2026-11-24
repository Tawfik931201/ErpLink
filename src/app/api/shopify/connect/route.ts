import crypto from 'crypto'

import { auth } from '@clerk/nextjs/server'
import { type NextRequest, NextResponse } from 'next/server'

import { normalizeShopDomain, verifyShopifyCallbackHmac } from '@/lib/shopify-client'

export async function GET(request: NextRequest) {
  try {
    // Use the public origin when the proxy forwards to a private Node listener.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.SHOPIFY_REDIRECT_URI || request.url
    const shop = request.nextUrl.searchParams.get('shop')
    if (!shop) {
      // Shopify's managed install flow lets the merchant select a store in
      // Shopify Admin; no manual myshopify.com entry is needed in ErpLink.
      const clientId = process.env.SHOPIFY_CLIENT_ID
      if (!clientId) {
        return NextResponse.json(
          { error: 'missing_config', message: 'Shopify app credentials are not configured on the server.' },
          { status: 500 }
        )
      }
      const installUrl = new URL('https://admin.shopify.com/oauth/install')
      installUrl.searchParams.set('client_id', clientId)
      return NextResponse.redirect(installUrl)
    }

    // A shop value provided on Shopify's app launch must be signed by Shopify.
    // Never trust a shop query from another origin to initiate authorization.
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
    if (!clientSecret || !verifyShopifyCallbackHmac(request.url, clientSecret)) {
      return NextResponse.redirect(new URL('/app/connect-store?error=shopify_invalid_signature', appUrl))
    }

    // طبّع وتحقق: xxx.myshopify.com فقط (يرفض المسارات والاستعلامات والحقن).
    const cleanShop = normalizeShopDomain(shop)
    if (!cleanShop) {
      return NextResponse.json(
        { error: 'invalid_shop', message: 'Invalid Shopify shop domain. Must end with .myshopify.com' },
        { status: 400 }
      )
    }

    // The app may be launched from Shopify Admin before the merchant has an
    // ErpLink session. Complete sign-in first, then resume this signed launch.
    // This prevents spending a one-time Shopify OAuth code while signed out.
    const { userId } = await auth()
    if (!userId) {
      const signInUrl = new URL('/sign-in', appUrl)
      const returnUrl = new URL('/api/shopify/connect', appUrl)
      returnUrl.search = request.nextUrl.search
      signInUrl.searchParams.set('redirect_url', returnUrl.toString())
      return NextResponse.redirect(signInUrl)
    }

    const clientId = process.env.SHOPIFY_CLIENT_ID
    const redirectUri = process.env.SHOPIFY_REDIRECT_URI

    if (!clientId || !redirectUri) {
      return NextResponse.json(
        { error: 'missing_config', message: 'Shopify app credentials are not configured on the server.' },
        { status: 500 }
      )
    }

    const state = crypto.randomBytes(16).toString('hex')

    // Construct Shopify Auth URL
    const authUrl = new URL(`https://${cleanShop}/admin/oauth/authorize`)
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    // Core scopes required by the features exposed at install time: inbound catalog/orders/customers,
    // plus Data Transfer writes for products/collections/customers. Keep this in sync with shopify.app.toml.
    authUrl.searchParams.set('scope', 'read_products,write_products,read_orders,read_inventory,read_locations,read_customers,write_customers')
    authUrl.searchParams.set('state', state)

    const response = NextResponse.redirect(authUrl.toString())

    response.cookies.set('shopify_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60, // 10 minutes
      path: '/',
    })

    return response
  } catch {
    return NextResponse.json(
      { error: 'authorization_failed', message: 'Could not start Shopify authorization.' },
      { status: 500 }
    )
  }
}
