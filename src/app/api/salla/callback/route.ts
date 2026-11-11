import { auth } from '@clerk/nextjs/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { type NextRequest, NextResponse } from 'next/server'

import { getAppBaseUrl } from '@/lib/app-url'
import { extractSallaMerchantIdFromProfile } from '@/lib/salla-client'
import { supabase } from '@/lib/supabase'
import { accessibleWorkspaceId } from '@/lib/workspace-access'

function redirectToConnectStore(request: NextRequest, params: Record<string, string>) {
  const appUrl = getAppBaseUrl(request)
  const url = new URL('/app/connect-store', appUrl)

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
  unauthorized: 'سجّل الدخول إلى حسابك ثم أعد ربط المتجر.',
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

/**
 * Legacy connection settings retained for existing readers. Standard Mapping
 * controls inbound Salla operations.
 */
const SALLA_CONNECT_SYNC_DEFAULTS: Record<string, { odoo2salla: boolean; salla2odoo: boolean }> =
  Object.fromEntries(
    [
      'order.created',
      'order.updated',
      'order.status.updated',
      'order.cancelled',
      'order.refunded',
      'order.deleted',
      'order.payment.updated',
      'product.created',
      'product.updated',
      'product.deleted',
      'product.publish',
      'customer.created',
      'customer.updated',
      'category.created',
      'category.updated',
    ].map((key) => [key, { odoo2salla: false, salla2odoo: true }])
  )

export async function GET(request: NextRequest) {
  const { checkRateLimit, rateLimitKeyFromHeaders } = await import('@/lib/rate-limit')
  const cbRl = checkRateLimit(
    rateLimitKeyFromHeaders((n) => request.headers.get(n), 'oauth-salla-callback'),
    30,
    60_000
  )
  if (!cbRl.allowed) {
    return redirectToConnectStore(request, { error: 'rate_limited' })
  }

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

  // Resolve the session before spending the single-use authorization code.
  // The workspace was already required further down, but only *after* the token
  // exchange — so an unauthenticated visitor could burn a code and hit Salla's
  // token endpoint for nothing. Failing here makes that impossible.
  const { userId } = await auth()
  if (!userId) {
    const signInUrl = new URL('/sign-in', getAppBaseUrl(request))
    const returnUrl = request.nextUrl.pathname + request.nextUrl.search
    signInUrl.searchParams.set('redirect_url', returnUrl)
    return NextResponse.redirect(signInUrl)
  }

  const { data: userDb, error: userDbErr } = await supabase
    .from('users')
    .select('active_workspace_id')
    .eq('id', userId)
    .maybeSingle()

  if (userDbErr) {
    console.error('[Salla OAuth] Could not load the user profile:', userDbErr.message)
    return redirectToConnectStore(request, { error: 'no_active_workspace', description: AR.no_workspace })
  }

  let workspaceId = await accessibleWorkspaceId(userId, userDb?.active_workspace_id)
  if (!workspaceId) {
    const { ensureDefaultWorkspace } = await import('@/lib/workspace-defaults')
    workspaceId = await ensureDefaultWorkspace(userId)
  }

  if (!workspaceId) {
    return redirectToConnectStore(request, { error: 'no_active_workspace', description: AR.no_workspace })
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

    // 3. The active workspace was resolved (and required) before the code was
    //    exchanged, so `workspaceId` is guaranteed non-null from here on.

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
      // Reconnect: preserve the merchant's existing sync toggles (tokenData
      // carries no sync_settings, so the column is left untouched).
      const { error: updateError } = await supabase
        .from('salla_tokens')
        .update(tokenData)
        .eq('merchant_id', merchantId)

      if (updateError) throw updateError
    } else {
      // New connection: persist the core preset (all order events + products +
      // customers + categories, store → ERP) so the merchant never has to open
      // Advanced settings and save by hand. Mirrors CORE_SALLA_EVENTS in
      // salla-sync-settings.tsx — keep the two lists in sync.
      //
      // Multi-store: a workspace may link several Salla stores, so a new
      // merchant is always INSERTED and sibling rows are never touched here.
      const { error: insertError } = await supabase
        .from('salla_tokens')
        .insert([{ ...tokenData, sync_settings: SALLA_CONNECT_SYNC_DEFAULTS }])

      if (insertError) throw insertError
    }

    try {
      revalidateTag('salla-token')
      revalidatePath('/app/connect-store')
      revalidatePath('/app/dashboard')
    } catch {}

    // 5. Register webhooks automatically so event sync works out of the box
    // (capped parallelism inside registerSallaWebhooks; best-effort).
    //
    // `undefined` — NOT `process.env.SALLA_WEBHOOK_SECRET` — so the registration
    // falls back to the credential derived from `ENCRYPTION_KEY`. Passing an
    // empty string used to mean "no auth header at all", which is precisely why
    // every delivery arrived unauthenticated. An explicit value is still honoured
    // for operators who want the header to mirror the env secret.
    let webhookRegistrationComplete = false
    try {
      const { registerSallaWebhooks } = await import('@/lib/salla-client')
      const result = await registerSallaWebhooks(merchantId, undefined)
      webhookRegistrationComplete = result.failed === 0 && result.credentialAttached
      if (result.failed > 0) {
        console.error(
          `[SallaCallback] ${result.failed}/${result.registered + result.failed} Salla webhook subscriptions failed for merchant ${merchantId} — repair with POST /api/admin/salla-webhooks/refresh`
        )
      }
      if (!result.credentialAttached) {
        console.error(
          `[SallaCallback] Subscriptions could not be registered with an ingress credential for merchant ${merchantId}.`
        )
      }
    } catch {
      console.error('[SallaCallback] Webhook registration could not be completed')
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
      ...(webhookRegistrationComplete
        ? { success: 'salla_connected' }
        : { error: 'salla_webhook_registration_failed' }),
      store: storeName || merchantId,
    })

    response.cookies.delete('salla_oauth_state')
    return response

  } catch {
    return redirectToConnectStore(request, { error: 'salla_token_exchange_failed', description: AR.save_failed })
  }
}
