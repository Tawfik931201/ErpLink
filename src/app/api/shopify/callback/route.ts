import crypto from 'crypto'
import { auth } from '@clerk/nextjs/server'
import { type NextRequest, NextResponse } from 'next/server'
import axios from 'axios'

import { supabase } from '@/lib/supabase'
import { registerShopifyWebhook } from '@/lib/shopify-client'

function redirectToConnectStore(request: NextRequest, params: Record<string, string>) {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ??
    request.nextUrl.origin
  const url = new URL('/dashboard/connect-store', appUrl)

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  return NextResponse.redirect(url)
}

function verifyCallbackHmac(url: string, clientSecret: string): boolean {
  const urlObj = new URL(url)
  const hmac = urlObj.searchParams.get('hmac')
  if (!hmac) return false

  // Parse raw query parameters directly from search string to preserve URL encoding (e.g. commas, slashes)
  const rawQuery = urlObj.search.startsWith('?') ? urlObj.search.slice(1) : urlObj.search
  const pairs = rawQuery.split('&')
  
  const cleanPairs = pairs
    .filter(pair => {
      const key = pair.split('=')[0]
      return key !== 'hmac' && key !== 'signature'
    })
    .sort()
    
  const message = cleanPairs.join('&')
  const expectedHmac = crypto
    .createHmac('sha256', clientSecret)
    .update(message)
    .digest('hex')

  return expectedHmac === hmac
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const shop = request.nextUrl.searchParams.get('shop')
  const state = request.nextUrl.searchParams.get('state')
  const storedState = request.cookies.get('shopify_oauth_state')?.value

  if (!shop || !/^[a-zA-Z0-9.-]+\.myshopify\.com$/.test(shop)) {
    console.warn('[Shopify OAuth] Callback received invalid shop parameter:', shop)
    return redirectToConnectStore(request, { error: 'invalid_shop' })
  }

  if (!state || !storedState || state !== storedState) {
    console.warn('[Shopify OAuth] Callback state validation failed')
    return redirectToConnectStore(request, { error: 'invalid_state' })
  }

  if (!code) {
    console.warn('[Shopify OAuth] Callback missing authorization code')
    return redirectToConnectStore(request, { error: 'shopify_missing_code' })
  }

  try {
    const clientId = process.env.SHOPIFY_CLIENT_ID!
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET!

    // Verify HMAC signature from Shopify using raw URL
    if (!verifyCallbackHmac(request.url, clientSecret)) {
      console.warn('[Shopify OAuth] HMAC signature verification failed')
      return redirectToConnectStore(request, { error: 'shopify_invalid_signature' })
    }

    console.info('[Shopify OAuth] Exchanging authorization code for permanent access token')

    // 1. Request access token
    const tokenResponse = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: clientId,
      client_secret: clientSecret,
      code,
    })

    const { access_token, scope } = tokenResponse.data

    if (!access_token) {
      console.error('[Shopify OAuth] Token response did not contain access token:', tokenResponse.data)
      return redirectToConnectStore(request, { error: 'shopify_token_exchange_failed' })
    }

    // 2. Fetch Shopify store details
    console.info('[Shopify OAuth] Fetching shop profile details')
    const shopDetailsResponse = await axios.get(`https://${shop}/admin/api/2024-01/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': access_token,
      },
    })

    const shopData = shopDetailsResponse.data.shop
    const shopName = shopData?.name ?? null
    const email = shopData?.email ?? null

    // 3. Retrieve the active workspace for Clerk user
    const { userId } = await auth()
    let workspaceId: string | null = null
    if (userId) {
      const { data: userDb } = await supabase
        .from('users')
        .select('active_workspace_id')
        .eq('id', userId)
        .single()
      
      workspaceId = userDb?.active_workspace_id ?? null
    }

    if (!workspaceId) {
      console.warn('[Shopify OAuth] User has no active workspace selected')
      return redirectToConnectStore(request, { error: 'no_active_workspace' })
    }

    // 4. Save Shopify token details in DB
    const tokenData = {
      shop_domain: shop,
      access_token,
      scopes: scope ?? null,
      updated_at: new Date().toISOString(),
      workspace_id: workspaceId,
      name: shopName,
      email,
    }

    const { data: existingToken } = await supabase
      .from('shopify_tokens')
      .select('shop_domain')
      .eq('shop_domain', shop)
      .maybeSingle()

    if (existingToken) {
      const { error: updateError } = await supabase
        .from('shopify_tokens')
        .update(tokenData)
        .eq('shop_domain', shop)

      if (updateError) throw updateError
    } else {
      const { error: insertError } = await supabase
        .from('shopify_tokens')
        .insert([tokenData])

      if (insertError) throw insertError
    }

    console.info('[Shopify OAuth] Shopify token saved successfully in DB')

    // 5. Automatically Register Shopify Webhooks
    const webhookTopics = [
      'products/create',
      'products/update',
      'products/delete',
      'orders/create',
      'orders/updated',
      'orders/cancelled',
      'orders/fulfilled',
      'orders/paid',
      'orders/partially_fulfilled',
      'orders/edited',
      'orders/delete',
      'customers/create',
      'customers/update',
      'customers/delete',
      'collections/create',
      'collections/update',
      'collections/delete',
      'carts/create',
      'carts/update',
      'checkouts/create',
      'checkouts/update',
      'checkouts/delete',
      'inventory_levels/update',
      'inventory_items/create',
      'inventory_items/update',
      'inventory_items/delete',
      'refunds/create'
    ]

    console.info('[Shopify OAuth] Auto-registering Shopify webhooks...')
    for (const topic of webhookTopics) {
      // Async webhook registration. We do not block the OAuth flow on this.
      registerShopifyWebhook(shop, topic, access_token).catch((err) => {
        console.error(`[Shopify OAuth] Failed to auto-register webhook for topic "${topic}":`, err)
      })
    }

    const response = redirectToConnectStore(request, {
      success: 'shopify_connected',
      store: shopName ? encodeURIComponent(shopName) : shop,
    })

    response.cookies.delete('shopify_oauth_state')
    return response

  } catch (error) {
    console.error('[Shopify OAuth] Callback handler failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    return redirectToConnectStore(request, { error: 'shopify_token_exchange_failed' })
  }
}
