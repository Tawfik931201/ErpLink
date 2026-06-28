/**
 * GET /api/auth/zid/callback
 *
 * Handles TWO flows:
 *
 * FLOW A — App installed from Zid Marketplace (most common case)
 *   Zid redirects: GET /api/auth/zid/callback?code=XXX
 *   No `state` param. We exchange the code and store the tokens.
 *
 * FLOW B — OAuth initiated from our app (Connect button)
 *   Zid redirects: GET /api/auth/zid/callback?code=XXX&state=orgId:random
 *   We validate the CSRF state before exchanging the code.
 *
 * FLOW ERROR — Merchant denied consent
 *   Zid redirects: GET /api/auth/zid/callback?error=access_denied
 */
import { auth } from '@clerk/nextjs/server'
import { type NextRequest, NextResponse } from 'next/server'

import { supabase } from '@/lib/supabase'
import { exchangeZidOAuthCode, ZidAPI } from '@/lib/zid-client'

/** Always redirect to the public app URL (ngrok / production) — never localhost */
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
  process.env.NEXTAUTH_URL?.replace(/\/$/, '') ||
  'http://localhost:3000'

function redirect(path: string) {
  return NextResponse.redirect(`${APP_URL}${path}`)
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  const code  = searchParams.get('code')
  const state = searchParams.get('state')   // only present in FLOW B
  const error = searchParams.get('error')

  // ── Handle denied consent ────────────────────────────────────────────────
  if (error) {
    return redirect(`/dashboard/integrations?error=zid_denied`)
  }

  // ── Redirect to Authorize if no code (App Market Install) ────────────────
  if (!code) {
    // When a merchant clicks "Install" in Zid, they are sent to the Application URL
    // without a code. We must initiate the OAuth flow ourselves.
    return redirect(`/api/auth/zid/authorize?organizationId=default`)
  }

  // ── Exchange code for tokens ─────────────────────────────────────────────
  let tokens
  try {
    tokens = await exchangeZidOAuthCode({
      code,
      clientId: process.env.ZID_CLIENT_ID || process.env.NEXT_PUBLIC_ZID_CLIENT_ID!,
      clientSecret: process.env.ZID_CLIENT_SECRET!,
      redirectUri: process.env.ZID_OAUTH_REDIRECT_URI!,
    })
  } catch (err) {
    console.error('[Zid OAuth] Token exchange failed:', err)
    return redirect(`/dashboard/integrations?error=zid_token_exchange_failed`)
  }

  // ── Fetch the store info so we know WHICH store just connected ───────────
  let storeId: string | null = null
  let storeName: string | null = null
  let storeUuid: string | null = null
  try {
    const storeRes = await ZidAPI.account.store({
      authorization: `Bearer ${process.env.ZID_CLIENT_ID || process.env.NEXT_PUBLIC_ZID_CLIENT_ID}`,
      managerToken: tokens.access_token,
    })
    const store = storeRes.data?.store
    storeId   = store?.id   ? String(store.id)   : null
    storeName = store?.title ?? null
    storeUuid = store?.uuid ?? null
  } catch (err) {
    console.error('[Zid OAuth] Could not fetch store info:', err)
    // Non-fatal — we still save the tokens
  }

  // ── Determine the workspace/organization ──────────────────────────────────
  // FLOW B: state = "workspaceId:randomCsrf"
  // FLOW A: state is null — use the authenticated Clerk session OR create a new workspace
  let organizationId: string | null = null

  if (state) {
    // FLOW B — initiated from our app
    const [orgId] = state.split(':')
    organizationId = orgId || null
  }

  if (!organizationId) {
    // FLOW A — initiated from Zid marketplace
    // Try to re-use an existing merchant token for this Zid store
    if (storeId) {
      const { data: existingToken } = await supabase
        .from('merchant_tokens')
        .select('workspace_id')
        .eq('store_id', storeId)
        .single()
        
      organizationId = existingToken?.workspace_id ?? null
    }

    // If still no workspace, check if there's a logged-in Clerk session
    if (!organizationId) {
      const { userId, orgId: clerkOrgId } = await auth()
      
      // If Clerk organization is active, find the corresponding workspace
      if (clerkOrgId) {
        const { data: workspace } = await supabase
          .from('workspaces')
          .select('id')
          .eq('clerk_org_id', clerkOrgId)
          .single()
          
        organizationId = workspace?.id ?? null
      }

      // Fallback to active workspace of user
      if (!organizationId && userId) {
        const { data: user } = await supabase
          .from('users')
          .select('active_workspace_id')
          .eq('id', userId)
          .single()
          
        organizationId = user?.active_workspace_id ?? null
      }

      // Last resort: create a new workspace automatically
      if (!organizationId) {
        const { data: workspace } = await supabase
          .from('workspaces')
          .insert([{
            name: storeName ?? `Zid Store ${storeId ?? 'New'}`,
            user_id: userId || null,
          }])
          .select()
          .single()
          
        if (workspace) {
          organizationId = workspace.id

          // Link active workspace to the user
          if (userId) {
            const { data: existingUser } = await supabase.from('users').select('id').eq('id', userId).single()
            if (existingUser) {
              await supabase.from('users').update({ active_workspace_id: organizationId }).eq('id', userId)
            } else {
              await supabase.from('users').insert([{
                id: userId,
                email: `${userId}@clerk.user`, // Temporary email, to be updated by webhooks
                name: storeName ?? 'Zid Merchant',
                active_workspace_id: organizationId,
              }])
            }
          }
        }
      }
    }
  }

  // ── Fetch Manager Profile for metadata ─────────────────────────────────────
  let managerName: string | null = null
  let managerEmail: string | null = null
  let managerUsername: string | null = null
  let managerId: string | null = null
  let managerUuid: string | null = null
  try {
    const meRes = await ZidAPI.account.me({
      authorization: `Bearer ${process.env.ZID_CLIENT_ID || process.env.NEXT_PUBLIC_ZID_CLIENT_ID}`,
      managerToken: tokens.access_token,
    })
    const manager = meRes.data?.user || meRes.data
    managerId = manager?.id ? String(manager.id) : null
    managerName = manager?.name ?? null
    managerEmail = manager?.email ?? null
    managerUsername = manager?.username ?? null
    managerUuid = manager?.uuid ?? null
  } catch (err) {
    console.error('[Zid OAuth] Could not fetch manager info:', err)
  }

  // ── Upsert MerchantToken record ───────────────────────────────────────────
  try {
    const merchantId = managerId ?? storeId ?? 'unknown_merchant'
    const tokenData = {
      merchant_id: merchantId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in ? tokens.expires_in : null,
      token_type: tokens.token_type,
      authorization_token: code,
      updated_at: new Date().toISOString(),
      store_id: storeId,
      workspace_id: organizationId,
      name: storeName ?? managerName,
      email: managerEmail,
      username: managerUsername,
      uuid: storeUuid ?? managerUuid ?? null,
      old_id: storeId ? Number(storeId) : null,
    }
    
    // Check if token exists
    const { data: existingToken } = await supabase
      .from('merchant_tokens')
      .select('merchant_id')
      .eq('merchant_id', merchantId)
      .maybeSingle()

    if (existingToken) {
      await supabase
        .from('merchant_tokens')
        .update(tokenData)
        .eq('merchant_id', merchantId)
    } else {
      await supabase
        .from('merchant_tokens')
        .insert([tokenData])
    }
  } catch (err) {
    console.error('[Zid OAuth] Failed to save merchant token:', err)
    return redirect(`/dashboard/integrations?error=zid_db_error`)
  }

  return redirect(`/dashboard/integrations?success=zid_connected&store=${storeName ?? storeId ?? ''}`)
}
