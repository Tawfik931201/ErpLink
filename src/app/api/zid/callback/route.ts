/**
 * GET /api/zid/callback — المسار Canonical لاستكمال ربط زد (OAuth).
 *
 * المسار القديم /api/auth/zid/callback مجرد shim يعيد التوجيه إلى هنا
 * مع نفس query params — لا منطق مكرر.
 *
 * يقبل صيغتي state (لإصلاح mismatch مع الروابط القديمة):
 *   - "<random>" (الحالية من /api/zid/connect)
 *   - "<orgId>:<random>" (القديمة من /api/auth/zid/authorize)
 * الشرط: مساواة تامة مع كوكي zid_oauth_state؛ وإن غاب الكوكي مع صيغة
 * قديمة تحمل ':' تُقبل لمرة واحدة (روابط قيد الطيران) بدل كسر الربط.
 *
 * يسجّل الأحداث الأساسية فقط (ZID_CORE_EVENTS ≈ 7) — البقية opt-in من الإعدادات.
 */
import { auth } from '@clerk/nextjs/server'
import { type NextRequest, NextResponse } from 'next/server'

import { supabase } from '@/lib/supabase'
import { getZidConfig } from '@/lib/zid/config'
import { exchangeAuthorizationCodeForResponse, toStoredTokens } from '@/lib/zid/token'
import { ZidOAuthError } from '@/lib/zid/types'

function redirectToConnectZid(request: NextRequest, params: Record<string, string>) {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ??
    process.env.NEXTAUTH_URL?.replace(/\/$/, '') ??
    request.nextUrl.origin
  const url = new URL('/dashboard/connect-store', appUrl)

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
    const connectUrl = new URL('/api/zid/connect', request.nextUrl.origin)
    return NextResponse.redirect(connectUrl)
  }

  // تحقق state: مساواة تامة مع الكوكي؛ قبول لمرة واحدة للصيغة القديمة
  // "<orgId>:<random>" عند غياب الكوكي (روابط قيد الطيران قبل التوحيد).
  const isLegacyState = !!state && !storedState && state.includes(':')
  if (!state || (!storedState && !isLegacyState) || (storedState && state !== storedState)) {
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

    // 4. Retrieve the active workspace for the currently logged-in Clerk user
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
        // New connections start with the 7 core events syncing store→ERP.
        // ERP→store stays off by default (safe, one toggle to enable later).
        sync_settings: {
          order_create: { odoo2zid: false, zid2odoo: true },
          order_status_update: { odoo2zid: false, zid2odoo: true },
          order_payment_status_update: { odoo2zid: false, zid2odoo: true },
          product_create: { odoo2zid: false, zid2odoo: true },
          product_update: { odoo2zid: false, zid2odoo: true },
          product_delete: { odoo2zid: false, zid2odoo: true },
          customer_create: { odoo2zid: false, zid2odoo: true },
          customer_update: { odoo2zid: false, zid2odoo: true },
          category_create: { odoo2zid: false, zid2odoo: true },
          category_update: { odoo2zid: false, zid2odoo: true },
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

      if (!existingToken && workspaceId) {
        const { data: byWorkspace, error: findErrorWorkspace } = await supabase
          .from('merchant_tokens')
          .select('merchant_id,workspace_id,sync_settings')
          .eq('workspace_id', workspaceId)
          .maybeSingle()

        if (findErrorWorkspace) {
          throw new ZidOAuthError({
            code: 'token_storage_failed',
            message: 'Could not check existing Zid merchant token by workspace_id in Supabase.',
            details: findErrorWorkspace,
          })
        }
        existingToken = byWorkspace
      }

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
        } else {
          // Different merchant ID for the same workspace/store: migrate mappings & settings
          // Migrate field mappings
          if (tokenData.workspace_id) {
            const { error: migrationError } = await supabase
              .from('field_mappings')
              .update({ merchant_id: merchantId })
              .eq('workspace_id', tokenData.workspace_id)
              .eq('merchant_id', existingToken.merchant_id)
            if (migrationError) {
              console.error('[Zid OAuth] Mappings migration failed:', migrationError)
            }
          }

          // Preserve existing sync settings (or keep the new-connection
          // defaults when the old row has none).
          tokenData.sync_settings = existingToken.sync_settings ?? tokenData.sync_settings

          // Delete old token
          const { error: deleteError } = await supabase
            .from('merchant_tokens')
            .delete()
            .eq('merchant_id', existingToken.merchant_id)
          if (deleteError) {
            throw new ZidOAuthError({
              code: 'token_storage_failed',
              message: 'Could not delete old Zid merchant token in Supabase.',
              details: deleteError,
            })
          }

          // Insert new token
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
        // Create new connection
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
        details: { rawResponse, authorizationPayload, user, store },
      })
    }

    // Auto-register the core webhooks in the background (non-blocking).
    // Tokens are saved by now, so registerZidWebhook can resolve auth headers.
    // Only ZID_CORE_EVENTS (≈7) with ?event=&store_id= URLs — the rest is
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

    if (process.env.ZID_CALLBACK_RESPONSE === 'json') {
      const response = NextResponse.json({
        oauth_response: rawResponse,
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
