import crypto from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const shop = request.nextUrl.searchParams.get('shop')
    
    if (!shop) {
      return NextResponse.json(
        { error: 'missing_shop', message: 'Shop parameter is required.' },
        { status: 400 }
      )
    }

    // Sanitize shop domain (must end with .myshopify.com and match format)
    const shopRegex = /^[a-zA-Z0-9.-]+\.myshopify\.com$/
    let cleanShop = shop.trim().toLowerCase()
    
    // Automatically strip http://, https:// and trailing slashes if user pastes full URL
    cleanShop = cleanShop.replace(/^(https?:\/\/)/, '')
    cleanShop = cleanShop.replace(/\/$/, '')
    
    if (!shopRegex.test(cleanShop)) {
      return NextResponse.json(
        { error: 'invalid_shop', message: 'Invalid Shopify shop domain. Must end with .myshopify.com' },
        { status: 400 }
      )
    }

    const clientId = process.env.SHOPIFY_CLIENT_ID
    const redirectUri = process.env.SHOPIFY_REDIRECT_URI

    if (!clientId || !redirectUri) {
      console.error('[Shopify OAuth] Missing environment variables:', { clientId, redirectUri })
      return NextResponse.json(
        { error: 'missing_config', message: 'Shopify app credentials are not configured on the server.' },
        { status: 500 }
      )
    }

    const state = crypto.randomBytes(16).toString('hex')
    console.info(`[Shopify OAuth] Starting authorization for shop="${cleanShop}"`)

    // Construct Shopify Auth URL
    const authUrl = new URL(`https://${cleanShop}/admin/oauth/authorize`)
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', 'read_products,write_products,read_orders,write_orders,read_customers,write_customers')
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
  } catch (error) {
    console.error('[Shopify OAuth] Connect route failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: 'authorization_failed', message: 'Could not start Shopify authorization.' },
      { status: 500 }
    )
  }
}
