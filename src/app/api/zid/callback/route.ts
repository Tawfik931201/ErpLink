/**
 * GET /api/zid/callback — المسار Canonical لاستكمال ربط زد (OAuth).
 *
 * المسار القديم /api/auth/zid/callback مجرد shim يعيد التوجيه إلى هنا
 * مع نفس query params — لا منطق مكرر.
 *
 * يقبل صيغة state الموحّدة فقط (بادئة اختيارية + قيمة عشوائية hex) التي
 * تولّدها /api/zid/connect وتُحفظ كاملة في كوكي zid_oauth_state — والتحقق يتم
 * بالمساواة التامة. لا يوجد أي مسار يقبل state بلا كوكي مطابق (CSRF).
 *
 * يسجّل الأحداث الأساسية فقط (ZID_CORE_EVENTS: الطلبات + المنتجات + العملاء + الكاتيجوري) — البقية opt-in من الإعدادات.
 */
import { auth } from '@clerk/nextjs/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { type NextRequest, NextResponse } from 'next/server'

import { getAppBaseUrl } from '@/lib/app-url'
import { supabase } from '@/lib/supabase'
import { getZidConfig } from '@/lib/zid/config'
import { exchangeAuthorizationCodeForResponse, toStoredTokens } from '@/lib/zid/token'
import { ZidOAuthError } from '@/lib/zid/types'

function redirectToConnectZid(request: NextRequest, params: Record<string, string>) {
  const appUrl = getAppBaseUrl(request)
  const url = new URL('/app/connect-store', appUrl)

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  return NextResponse.redirect(url)
}

async function fetchZidDebugResource(path: string, headers: Headers): Promise<unknown> {
  const config = getZidConfig()
  const response = await fetch(new URL(path.replace(/^\//, ''), `${config.apiUrl}/`), {
    headers,
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    return {
      error: true,
      status: response.status,
      payload,
    }
  }

  return payload
}

function decodeJwtPayload(token?: string): Record<string, unknown> | null {
  if (!token) {
    return null
  }

  const jwt = token.replace(/^Bearer\s+/i, '')
  const [, payload] = jwt.split('.')

  if (!payload) {
    return null
  }

  try {
    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decodedPayload = Buffer.from(normalizedPayload, 'base64').toString('utf8')

    return JSON.parse(decodedPayload) as Record<string, unknown>
  } catch {
    return null
  }
}

function collectStoreIds(value: unknown, path = '$'): Array<{ path: string; value: unknown }> {
  if (!value || typeof value !== 'object') {
    return []
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const nestedPath = `${path}.${key}`
    const current =
      key.toLowerCase() === 'store_id' || key.toLowerCase() === 'storeid'
        ? [{ path: nestedPath, value: nestedValue }]
        : []

    return [...current, ...collectStoreIds(nestedValue, nestedPath)]
  })
}

function getObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {}
}

function extractStoreId(...sources: unknown[]): string | null {
  for (const source of sources) {
    const candidate = collectStoreIds(source).find((item) => item.value)

    if (candidate?.value) {
      return String(candidate.value)
    }
  }

  return process.env.ZID_DEBUG_STORE_ID ?? null
}

async function registerProductCreatedWebhook(_headers: Headers) {
  // مهمل: التسجيل الموحد يتم بعد الحفظ عبر registerZidWebhook لكل
  // ZID_CORE_EVENTS (يضم store_id في target_url). تُركت الدالة كـno-op
  // لتفادي كسر أي استيراد خارجي.
  void _headers
  return { registered: false, deferred: true, message: 'Registered via ZID_CORE_EVENTS after token save.' }
}

export async function GET(request: NextRequest) {
  const { checkRateLimit, rateLimitKeyFromHeaders } = await import('@/lib/rate-limit')
  const cbRl = checkRateLimit(
    rateLimitKeyFromHeaders((n) => request.headers.get(n), 'oauth-zid-callback'),
    30,
    60_000
  )
  if (!cbRl.allowed) {
    if (process.env.ZID_CALLBACK_RESPONSE === 'json') {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }
    return redirectToConnectZid(request, { error: 'rate_limited' })
  }

  const code = request.nextUrl.searchParams.get('code')
  const error = request.nextUrl.searchParams.get('error')
  const state = request.nextUrl.searchParams.get('state')
  const storedState = request.cookies.get('zid_oauth_state')?.value

  if (error) {
    if (process.env.ZID_CALLBACK_RESPONSE === 'json') {
      return NextResponse.json({ error: 'zid_denied', message: 'Merchant denied authorization' }, { status: 400 })
    }
    return redirectToConnectZid(request, { error: 'zid_denied' })
  }

  // تثبيت من سوق زد: يصل التاجر دون code — نبدأ تدفق OAuth بدل كسر الربط.
  if (!code && !state) {
    const connectUrl = new URL('/api/zid/connect', getAppBaseUrl(request))
    return NextResponse.redirect(connectUrl)
  }

  // تحقق state: مساواة تامة مع الكوكي فقط.
  //
  // كان هنا فرع يقبل أي state فيه ':' عند غياب الكوكي (لنفّاذ روابط قديمة)،
  // لكنه كان يجعل فحص CSRF قابلاً للتجاوز: مهاجمcould يرسل رابطاً crafted على
  // شكل ?code=<code_المهاجم>&state=a:b فيتجاوز الفحص ويُعاد ربط متجره مكان
  // متجر الضحية. أزل الفرع بالكامل — /api/zid/connect (والمسار القديم
  // /api/auth/zid/authorize الذي صار shim عليه) يضع الكوكي في كل مرة،
  // فمسار state صار دائماً "<orgId>:<random>" أو "<random>" وكلاهما
  // محفوظ في zid_oauth_state ويُقارن بالكامل. لا يوجد رابط صالح بلا كوكي.
  if (!state || !storedState || state !== storedState) {
    if (process.env.ZID_CALLBACK_RESPONSE === 'json') {
      return NextResponse.json({ error: 'invalid_state', message: 'OAuth state mismatch' }, { status: 403 })
    }
    return redirectToConnectZid(request, { error: 'invalid_state' })
  }

  if (!code) {
    if (process.env.ZID_CALLBACK_RESPONSE === 'json') {
      return NextResponse.json({ error: 'zid_missing_code', message: 'Callback missing authorization code' }, { status: 400 })
    }
    return redirectToConnectZid(request, { error: 'zid_missing_code' })
  }

  // A store can only be attached to a workspace, so both must exist before the
  // authorization code is spent. Without this check an unauthenticated caller
  // could drive the whole OAuth handshake and leave a `merchant_tokens` row with
  // a NULL workspace_id — an orphan nobody can ever use, but anyone can create.
  // Checking first also means we fail fast instead of burning the single-use code.
  const { userId } = await auth()
  if (!userId) {
    if (process.env.ZID_CALLBACK_RESPONSE === 'json') {
      return NextResponse.json({ error: 'unauthorized', message: 'Sign in before connecting a store' }, { status: 401 })
    }
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
    console.error('[Zid OAuth] Could not load the user profile:', userDbErr.message)
    return redirectToConnectZid(request, { error: 'workspace_lookup_failed' })
  }

  let workspaceId: string | null = userDb?.active_workspace_id ?? null
  if (!workspaceId) {
    const { ensureDefaultWorkspace } = await import('@/lib/workspace-defaults')
    workspaceId = await ensureDefaultWorkspace(userId)
  }

  if (!workspaceId) {
    if (process.env.ZID_CALLBACK_RESPONSE === 'json') {
      return NextResponse.json({ error: 'no_workspace', message: 'Select a workspace before connecting a store' }, { status: 400 })
    }
    return redirectToConnectZid(request, { error: 'no_workspace' })
  }

  try {
    const rawResponse = await exchangeAuthorizationCodeForResponse(code)
    const tokens = toStoredTokens(rawResponse)

    // 2. Fetch debug/account resources to get store information
    let authorization = tokens.authorization || rawResponse.authorization || rawResponse.Authorization
    if (authorization) {
      if (!authorization.startsWith('Bearer ')) {
        authorization = `Bearer ${authorization}`
      }
    } else {
      authorization = `Bearer ${tokens.accessToken}`
    }

    const debugHeaders = new Headers({
      Accept: 'application/json',
      'X-Manager-Token': tokens.accessToken,
      Authorization: authorization,
    })

    const [user, store] = await Promise.all([
      fetchZidDebugResource('/managers/account/me', debugHeaders),
      fetchZidDebugResource('/managers/account/store', debugHeaders),
    ])
    // Register the first webhook immediately (proves the connection works),
    // the remaining core events are registered after the token is saved.
    const webhookRegistration = await registerProductCreatedWebhook(debugHeaders)

    // 3. Extract store and manager metadata
    const authorizationPayload = decodeJwtPayload(authorization)
    const storeData = getObject(getObject(store).store || store)
    const storeId =
      (storeData.id ? String(storeData.id) : null) ??
      extractStoreId(rawResponse, authorizationPayload, user, store)
    const storeName = storeData.title ?? storeData.name ?? null

    const userData = getObject(getObject(user).user || user)
    const managerId = userData.id ? String(userData.id) : null
    const managerEmail = userData.email ?? null
    const managerName = userData.name ?? null
    const managerUsername = userData.username ?? null

    const merchantId =
      managerId ??
      (authorizationPayload?.sub ? String(authorizationPayload.sub) : null) ??
      storeId

    // 4. The active workspace was resolved (and required) before the code was
    //    exchanged, so `workspaceId` is guaranteed non-null from here on.

    // 5. Save the token mapped to the real store ID and workspace ID
    if (merchantId) {
      const storeUsername = storeData.username ?? null
      const finalUsername = managerName ?? storeUsername ?? managerUsername

      const tokenData: any = {
        merchant_id: merchantId,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: tokens.expiresAt ? Math.max(0, Math.floor((tokens.expiresAt - Date.now()) / 1000)) : null,
        token_type: tokens.tokenType,
        authorization_token: tokens.authorization || '',
        updated_at: new Date().toISOString(),
        store_id: storeId,
        workspace_id: workspaceId,
        name: storeName ?? managerName,
        email: managerEmail,
        username: finalUsername,
        uuid: storeData.uuid ?? userData.uuid ?? null,
        old_id: storeId ? Number(storeId) : null,
        // New connections start with the 12 core events syncing store→ERP
        // (orders + products incl. publish + customers + categories incl. delete).
        // ERP→store stays off by default (safe, one toggle to enable later).
        sync_settings: {
          order_create: { odoo2zid: false, zid2odoo: true },
          order_status_update: { odoo2zid: false, zid2odoo: true },
          order_payment_status_update: { odoo2zid: false, zid2odoo: true },
          product_create: { odoo2zid: false, zid2odoo: true },
          product_update: { odoo2zid: false, zid2odoo: true },
          product_delete: { odoo2zid: false, zid2odoo: true },
          product_publish: { odoo2zid: false, zid2odoo: true },
          customer_create: { odoo2zid: false, zid2odoo: true },
          customer_update: { odoo2zid: false, zid2odoo: true },
          category_create: { odoo2zid: false, zid2odoo: true },
          category_update: { odoo2zid: false, zid2odoo: true },
          category_delete: { odoo2zid: false, zid2odoo: true },
        },
      }

      let existingToken: any = null

      const { data: byMerchant, error: findErrorMerchant } = await supabase
        .from('merchant_tokens')
        .select('merchant_id,workspace_id,sync_settings')
        .eq('merchant_id', merchantId)
        .maybeSingle()

      if (findErrorMerchant) {
        throw new ZidOAuthError({
          code: 'token_storage_failed',
          message: 'Could not check existing Zid merchant token by merchant_id in Supabase.',
          details: findErrorMerchant,
        })
      }

      existingToken = byMerchant

      if (existingToken) {
        // If workspace_id was not resolved in this flow but exists in the DB, preserve it
        if (!tokenData.workspace_id && existingToken.workspace_id) {
          tokenData.workspace_id = existingToken.workspace_id
        }

        if (existingToken.merchant_id === merchantId) {
          // Same merchant ID: perform inline update, but preserve the
          // merchant's existing sync settings (don't reset custom toggles).
          const { sync_settings: _ignore, ...updateData } = tokenData
          void _ignore
          const { error: updateError } = await supabase
            .from('merchant_tokens')
            .update(updateData)
            .eq('merchant_id', merchantId)
          if (updateError) {
            throw new ZidOAuthError({
              code: 'token_storage_failed',
              message: 'Could not update Zid merchant token in Supabase.',
              details: updateError,
            })
          }
        }
      } else {
        // New store (first or additional for this workspace): insert a new
        // row and KEEP any other rows — a workspace may link several stores
        // of the same platform. Never migrate or delete sibling rows here.
        const { error: insertError } = await supabase
          .from('merchant_tokens')
          .insert([tokenData])
        if (insertError) {
          throw new ZidOAuthError({
            code: 'token_storage_failed',
            message: 'Could not insert new Zid merchant token in Supabase.',
            details: insertError,
          })
        }
      }
    } else {
      throw new ZidOAuthError({
        code: 'missing_store_id',
        message: 'Zid OAuth completed, but store_id/merchant_id could not be resolved.',
        // `rawResponse` is deliberately excluded: it holds the access_token and
        // refresh_token, and this object is returned to the caller verbatim when
        // ZID_CALLBACK_RESPONSE=json.
        details: { store, user, hasAuthorizationPayload: Boolean(authorizationPayload) },
      })
    }

    // Auto-register the core webhooks in the background (non-blocking).
    // Tokens are saved by now, so registerZidWebhook can resolve auth headers.
    // Only ZID_CORE_EVENTS with ?event=&store_id= URLs — the rest is
    // opt-in from Advanced settings (syncWebhooksWithSettings).
    if (merchantId) {
      import('@/lib/zid/webhooks').then(({ ZID_CORE_EVENTS, registerZidWebhook }) => {
        for (const key of ZID_CORE_EVENTS) {
          registerZidWebhook(merchantId, key).catch(() => {})
        }
      }).catch(() => {})
    }

    // Auto-bootstrap workspace defaults in background (zero-configuration)
    if (workspaceId) {
      import('@/lib/auto-bootstrap').then(({ autoBootstrapWorkspace }) => {
        autoBootstrapWorkspace(workspaceId).catch(() => {})
      }).catch(() => {})
    }

    try {
      revalidateTag('zid-token')
      revalidatePath('/app/connect-store')
      revalidatePath('/app/dashboard')
    } catch {}

    if (process.env.ZID_CALLBACK_RESPONSE === 'json') {
      // Debug shape only. `rawResponse` carried Zid's access_token and
      // refresh_token straight into an HTTP response body (browser history,
      // devtools, proxy logs), so it is not returned here. The `user`/`store`
      // payloads are what a developer actually needs to debug the handshake.
      const response = NextResponse.json({
        success: true,
        store_id: storeId ?? null,
        merchant_id: merchantId ?? null,
        workspace_id: workspaceId,
        user,
        store,
        webhook_registration: webhookRegistration,
      })
      response.cookies.delete('zid_oauth_state')
      return response
    }

    const response = redirectToConnectZid(request, { 
      success: 'zid_connected',
      store: storeName ? encodeURIComponent(storeName) : (storeId ?? '')
    })

    response.cookies.delete('zid_oauth_state')
    return response
  } catch (error) {
    console.error('[Zid OAuth] Callback token exchange failed', {
      code: error instanceof ZidOAuthError ? error.code : 'unknown_error',
      message: error instanceof Error ? error.message : 'Unknown error',
    })

    if (process.env.ZID_CALLBACK_RESPONSE === 'json') {
      const status = error instanceof ZidOAuthError ? error.status || 400 : 500
      const details = error instanceof ZidOAuthError ? error.details : null
      return NextResponse.json(details || {
        error: error instanceof ZidOAuthError ? error.code : 'zid_token_exchange_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, { status })
    }

    return redirectToConnectZid(request, {
      error: error instanceof ZidOAuthError ? error.code : 'zid_token_exchange_failed',
    })
  }
}
