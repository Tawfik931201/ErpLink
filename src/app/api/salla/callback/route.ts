import { auth } from '@clerk/nextjs/server'
import { type NextRequest, NextResponse } from 'next/server'

import { extractSallaMerchantIdFromProfile } from '@/lib/salla-client'
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

// Arabic descriptions shown by store-selector.tsx (it renders `description`
// for unknown codes, with built-in Arabic for access_denied /
// redirect_uri_mismatch / invalid_scope / invalid_client).
const AR = {
  invalid_state: 'انتهت صلاحية طلب الربط. اضغط «ربط متجر Salla» وحاول مجدداً.',
  missing_code: 'لم يصل رمز التفويض من سلة. أعد المحاولة ووافق على الصلاحيات.',
  token_failed: 'فشل تبادل الرمز مع سلة. تأكد من تطابق رابط إعادة التوجيه (redirect_uri) ثم أعد المحاولة.',
  profile_failed: 'تعذر جلب بيانات متجر سلة. أعد الربط، وإن تكررت المشكلة تواصل مع الدعم.',
  no_merchant: 'تعذر التعرف على معرف متجر سلة من حساب سلة. سجل الدخول بحساب مالك المتجر ثم أعد المحاولة.',
  no_workspace: 'اختر مساحة عمل نشطة أولاً من لوحة التحكم ثم أعد ربط المتجر.',
  save_failed: 'تعذر حفظ بيانات الربط. حاول مجدداً، وإن تكررت المشكلة تواصل مع الدعم.',
} as const

/** Map Salla OAuth error codes to the codes store-selector.tsx understands. */
function mapSallaError(error: string): string {
  const e = error.toLowerCase()
  if (e === 'access_denied') return 'access_denied'
  if (e.includes('redirect_uri')) return 'redirect_uri_mismatch'
  if (e.includes('invalid_client')) return 'invalid_client'
  if (e.includes('invalid_scope') || e.includes('scope')) return 'invalid_scope'
  return error
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const error = request.nextUrl.searchParams.get('error')
  const state = request.nextUrl.searchParams.get('state')
  const storedState = request.cookies.get('salla_oauth_state')?.value

  if (error) {
    const errorDesc = request.nextUrl.searchParams.get('error_description')
    return redirectToConnectStore(request, { error: mapSallaError(error), description: errorDesc || '' })
  }

  if (!state || !storedState || state !== storedState) {
    return redirectToConnectStore(request, { error: 'invalid_state', description: AR.invalid_state })
  }

  if (!code) {
    return redirectToConnectStore(request, { error: 'salla_missing_code', description: AR.missing_code })
  }

  try {
    const clientId = process.env.SALLA_CLIENT_ID!
    const clientSecret = process.env.SALLA_CLIENT_SECRET!
    // Must be byte-identical to the redirect_uri sent in /connect,
    // otherwise the code exchange fails with redirect_uri_mismatch.
    const redirectUri = process.env.SALLA_REDIRECT_URI!

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
      const errCode = typeof tokenPayload?.error === 'string' ? mapSallaError(tokenPayload.error) : 'salla_token_exchange_failed'
      const errDesc =
        typeof tokenPayload?.error_description === 'string' && tokenPayload.error_description
          ? tokenPayload.error_description
          : AR.token_failed
      return redirectToConnectStore(request, { error: errCode, description: errDesc })
    }

    const { access_token, refresh_token, expires_in } = tokenPayload

    // 2. Fetch merchant profile info
    const profileResponse = await fetch('https://accounts.salla.sa/oauth2/user/info', {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })

    const profilePayload = await profileResponse.json()
    const sallaData = profilePayload?.data

    if (!profileResponse.ok || !sallaData) {
      return redirectToConnectStore(request, { error: 'salla_profile_fetch_failed', description: AR.profile_failed })
    }

    // Robust merchant extraction (number|string|object) — never persist a
    // placeholder id; fail loudly with an Arabic message instead.
    const merchantId = extractSallaMerchantIdFromProfile(profilePayload)
    if (!merchantId) {
      return redirectToConnectStore(request, { error: 'salla_profile_fetch_failed', description: AR.no_merchant })
    }

    const merchant = sallaData.merchant && typeof sallaData.merchant === 'object' ? sallaData.merchant : {}
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
      return redirectToConnectStore(request, { error: 'no_active_workspace', description: AR.no_workspace })
    }

    // 4. Upsert SallaToken record in supabase
    // (expires_in is BIGINT — plain number, never BigInt: JSON
    // serialization of BigInt throws inside the Supabase client).
    const tokenData: any = {
      merchant_id: merchantId,
      access_token: access_token,
      refresh_token: refresh_token,
      expires_in: expires_in ? Number(expires_in) : null,
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

    // 5. Register webhooks automatically so event sync works out of the box
    // (capped parallelism inside registerSallaWebhooks; best-effort).
    try {
      const { registerSallaWebhooks } = await import('@/lib/salla-client')
      const webhookSecret = process.env.SALLA_WEBHOOK_SECRET || undefined
      await registerSallaWebhooks(merchantId, webhookSecret)
    } catch {
      // Webhook registration is best-effort — the store is connected even if
      // some events failed to register; they can be repaired later.
    }

    // Auto-bootstrap workspace defaults in background (zero-configuration)
    if (workspaceId) {
      import('@/lib/auto-bootstrap').then(({ autoBootstrapWorkspace }) => {
        autoBootstrapWorkspace(workspaceId).catch(() => {})
      }).catch(() => {})
    }

    // NOTE: pass the raw store name — URLSearchParams encodes it once.
    // (Pre-encoding here double-encoded Arabic names.)
    const response = redirectToConnectStore(request, {
      success: 'salla_connected',
      store: storeName || merchantId,
    })

    response.cookies.delete('salla_oauth_state')
    return response

  } catch {
    return redirectToConnectStore(request, { error: 'salla_token_exchange_failed', description: AR.save_failed })
  }
}
