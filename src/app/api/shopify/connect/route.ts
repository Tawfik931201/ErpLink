import crypto from 'crypto'

import { type NextRequest, NextResponse } from 'next/server'

import { normalizeShopDomain } from '@/lib/shopify-client'

export async function GET(request: NextRequest) {
  try {
    const shop = request.nextUrl.searchParams.get('shop')
    if (!shop) {
      return NextResponse.json(
        { error: 'missing_shop', message: 'Shop parameter is required.' },
        { status: 400 }
      )
    }

    // طبّع وتحقق: xxx.myshopify.com فقط (يرفض المسارات والاستعلامات والحقن).
    const cleanShop = normalizeShopDomain(shop)
    if (!cleanShop) {
      return NextResponse.json(
        { error: 'invalid_shop', message: 'Invalid Shopify shop domain. Must end with .myshopify.com' },
        { status: 400 }
      )
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
    // Minimal install scopes (read-only core = catalog + orders + inventory).
    // Must stay in sync with shopify.app.toml [access_scopes]. write_* and
    // customers scopes are requested later as optional scopes when needed.
    authUrl.searchParams.set('scope', 'read_products,read_orders,read_inventory,read_locations')
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
