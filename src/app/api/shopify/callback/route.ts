import { auth } from '@clerk/nextjs/server'
import axios from 'axios'
import { type NextRequest, NextResponse } from 'next/server'

import {
  SHOPIFY_API_VERSION,
  SHOPIFY_CORE_TOPICS,
  SHOPIFY_GDPR_TOPICS,
  SHOPIFY_SCOPES_UPDATE_TOPIC,
  normalizeShopDomain,
  registerShopifyWebhook,
  verifyShopifyCallbackHmac,
} from '@/lib/shopify-client'
import { supabase } from '@/lib/supabase'

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
    const tokenResponse = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: clientId,
      client_secret: clientSecret,
      code,
    })

    const { access_token, scope } = tokenResponse.data

    if (!access_token) {
      return redirectToConnectStore(request, { error: 'shopify_token_exchange_failed' })
    }

    // 2. Fetch Shopify store details (النسخة من الثابت الموحد — لا تكتبها يدوياً)
    const shopDetailsResponse = await axios.get(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, {
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
      // New connections start with the 5 core topics syncing store→ERP.
      sync_settings: {
        'products/create': { shopify2odoo: true },
        'products/update': { shopify2odoo: true },
        'orders/create': { shopify2odoo: true },
        'orders/paid': { shopify2odoo: true },
        'orders/fulfilled': { shopify2odoo: true },
      },
    }

    const { data: existingToken } = await supabase
      .from('shopify_tokens')
      .select('shop_domain')
      .eq('shop_domain', shop)
      .maybeSingle()

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
      const { error: insertError } = await supabase
        .from('shopify_tokens')
        .insert([tokenData])

      if (insertError) throw insertError
    }

    // 5. Automatically register webhooks (non-blocking, best-effort).
    // الأساسية + app/uninstalled (تنظيف التوكن) + GDPR الثلاثة + scopes_update
    // (امتثال App Store — يجب أن تبقى مشتركة دائماً).
    const webhookTopics = [
      ...SHOPIFY_CORE_TOPICS,
      'app/uninstalled',
      ...SHOPIFY_GDPR_TOPICS,
      SHOPIFY_SCOPES_UPDATE_TOPIC,
    ]

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
      store: shopName ? encodeURIComponent(shopName) : shop,
    })

    response.cookies.delete('shopify_oauth_state')
    return response

  } catch {
    return redirectToConnectStore(request, { error: 'shopify_token_exchange_failed' })
  }
}
