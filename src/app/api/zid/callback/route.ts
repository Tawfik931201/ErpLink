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
  const url = new URL('/dashboard/connect-zid', appUrl)

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

async function registerProductCreatedWebhook(headers: Headers) {
  const config = getZidConfig()
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ??
    process.env.NEXTAUTH_URL?.replace(/\/$/, '')
  const webhookUrl = process.env.ZID_WEBHOOK_URL ?? `${appUrl}/api/webhooks/zid`

  if (!appUrl && !process.env.ZID_WEBHOOK_URL) {
    return {
      registered: false,
      message: 'Missing NEXT_PUBLIC_APP_URL or ZID_WEBHOOK_URL.',
    }
  }

  const body: Record<string, any> = {
    event: 'product.create',
    target_url: webhookUrl,
    original_id: config.clientId,
  }

  if (process.env.ZID_WEBHOOK_SECRET) {
    body.secret = process.env.ZID_WEBHOOK_SECRET
  }

  const requestHeaders = new Headers(headers)
  requestHeaders.set('Content-Type', 'application/json')

  const response = await fetch(new URL('managers/webhooks', `${config.apiUrl}/`), {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null)

  console.info('[Zid Webhook] product.created registration response', {
    status: response.status,
    ok: response.ok,
    webhookUrl,
  })

  return {
    registered: response.ok,
    status: response.status,
    webhookUrl,
    payload,
  }
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const error = request.nextUrl.searchParams.get('error')
  const state = request.nextUrl.searchParams.get('state')
  const storedState = request.cookies.get('zid_oauth_state')?.value

  if (error) {
    console.warn('[Zid OAuth] Merchant denied authorization', { error })
    if (process.env.ZID_CALLBACK_RESPONSE === 'json') {
      return NextResponse.json({ error: 'zid_denied', message: 'Merchant denied authorization' }, { status: 400 })
    }
    return redirectToConnectZid(request, { error: 'zid_denied' })
  }

  if (!state || !storedState || state !== storedState) {
    console.warn('[Zid OAuth] Callback state validation failed')
    if (process.env.ZID_CALLBACK_RESPONSE !== 'json') {
      return redirectToConnectZid(request, { error: 'invalid_state' })
    }
  }

  if (!code) {
    console.warn('[Zid OAuth] Callback missing authorization code')
    if (process.env.ZID_CALLBACK_RESPONSE === 'json') {
      return NextResponse.json({ error: 'zid_missing_code', message: 'Callback missing authorization code' }, { status: 400 })
    }
    return redirectToConnectZid(request, { error: 'zid_missing_code' })
  }

  try {
    console.info('[Zid OAuth] Callback received authorization code')
    const rawResponse = await exchangeAuthorizationCodeForResponse(code)
    console.info('[Zid OAuth Debug] rawResponse:', JSON.stringify(rawResponse))
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
      }

      let existingToken: any = null
      
      const { data: byMerchant, error: findErrorMerchant } = await supabase
        .from('merchant_tokens')
        .select('*')
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
          .select('*')
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
          // Same merchant ID: perform inline update
          const { error: updateError } = await supabase
            .from('merchant_tokens')
            .update(tokenData)
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
          console.info(`[Zid OAuth] Migrating token from ${existingToken.merchant_id} to ${merchantId}`)
          
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

          // Preserve existing sync settings
          tokenData.sync_settings = existingToken.sync_settings ?? {}

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
