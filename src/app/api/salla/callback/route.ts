import { auth } from '@clerk/nextjs/server'
import { type NextRequest, NextResponse } from 'next/server'

import { supabase } from '@/lib/supabase'

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

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const error = request.nextUrl.searchParams.get('error')
  const state = request.nextUrl.searchParams.get('state')
  const storedState = request.cookies.get('salla_oauth_state')?.value

  if (error) {
    const errorDesc = request.nextUrl.searchParams.get('error_description')
    console.warn('[Salla OAuth] Salla authorization error:', { error, errorDesc })
    return redirectToConnectStore(request, { error: error, description: errorDesc || '' })
  }

  if (!state || !storedState || state !== storedState) {
    console.warn('[Salla OAuth] Callback state validation failed')
    return redirectToConnectStore(request, { error: 'invalid_state' })
  }

  if (!code) {
    console.warn('[Salla OAuth] Callback missing authorization code')
    return redirectToConnectStore(request, { error: 'salla_missing_code' })
  }

  try {
    const clientId = process.env.SALLA_CLIENT_ID!
    const clientSecret = process.env.SALLA_CLIENT_SECRET!
    const redirectUri = process.env.SALLA_REDIRECT_URI!

    console.info('[Salla OAuth] Exchanging authorization code for tokens')

    // 1. Exchange authorization code for access/refresh tokens
    const tokenRequestBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
    })

    const tokenResponse = await fetch('https://accounts.salla.sa/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenRequestBody,
      cache: 'no-store',
    })

    const tokenPayload = await tokenResponse.json()

    if (!tokenResponse.ok) {
      console.error('[Salla OAuth] Token exchange failed response', tokenPayload)
      return redirectToConnectStore(request, { error: 'salla_token_exchange_failed' })
    }

    const { access_token, refresh_token, expires_in } = tokenPayload

    // 2. Fetch merchant profile info
    console.info('[Salla OAuth] Fetching merchant profile details')
    const profileResponse = await fetch('https://accounts.salla.sa/oauth2/user/info', {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })

    const profilePayload = await profileResponse.json()
    const sallaData = profilePayload.data

    if (!profileResponse.ok || !sallaData) {
      console.error('[Salla OAuth] Profile fetch failed response or data missing', profilePayload)
      return redirectToConnectStore(request, { error: 'salla_profile_fetch_failed' })
    }

    const merchant = sallaData.merchant
    const merchantId = merchant?.id ? String(merchant.id) : 'unknown_salla_merchant'
    const storeName = merchant?.name ?? null
    const username = merchant?.username ?? null
    const name = sallaData.name ?? null
    const email = sallaData.email ?? null
    const mobile = sallaData.mobile ?? null

    // 3. Retrieve the active workspace for the currently logged-in Clerk user
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
      console.warn('[Salla OAuth] User has no active workspace selected')
      return redirectToConnectStore(request, { error: 'no_active_workspace' })
    }

    // 4. Upsert SallaToken record in supabase
    const tokenData: any = {
      merchant_id: merchantId,
      access_token: access_token,
      refresh_token: refresh_token,
      expires_in: expires_in ? BigInt(expires_in) : null,
      updated_at: new Date().toISOString(),
      workspace_id: workspaceId,
      name,
      email,
      username,
      store_name: storeName,
      mobile,
      scope: tokenPayload.scope ?? null,
      token_type: tokenPayload.token_type ?? null,
    }

    // We do a manual upsert since Prisma client handles BigInt but we are using supabase direct library.
    // We check if a token already exists for this merchant_id
    const { data: existingToken } = await supabase
      .from('salla_tokens')
      .select('merchant_id')
      .eq('merchant_id', merchantId)
      .maybeSingle()

    if (existingToken) {
      const { error: updateError } = await supabase
        .from('salla_tokens')
        .update(tokenData)
        .eq('merchant_id', merchantId)

      if (updateError) throw updateError
    } else {
      const { error: insertError } = await supabase
        .from('salla_tokens')
        .insert([tokenData])

      if (insertError) throw insertError
    }

    console.info('[Salla OAuth] Salla token saved successfully')

    const response = redirectToConnectStore(request, {
      success: 'salla_connected',
      store: storeName ? encodeURIComponent(storeName) : (merchantId ?? ''),
    })

    response.cookies.delete('salla_oauth_state')
    return response

  } catch (error) {
    console.error('[Salla OAuth] Callback handler failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    return redirectToConnectStore(request, { error: 'salla_token_exchange_failed' })
  }
}
