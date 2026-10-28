/**
 * GET /api/zid/connect — المسار Canonical لبدء ربط زد (OAuth).
 *
 * المسار القديم /api/auth/zid/authorize مجرد shim يعيد التوجيه إلى هنا
 * (لا منطق مكرر). صيغة state:
 *   - "<orgId>:<random>" عند تمرير ?organizationId= (تدفق سوق زد / متعدد)
 *   - "<random>" otherwise
 * تُحفظ القيمة الكاملة في كوكي zid_oauth_state ويتحقق منها /api/zid/callback
 * بالمساواة التامة — فيصلح state mismatch بين المسارين القديم والجديد.
 */
import crypto from 'crypto'

import { auth } from '@clerk/nextjs/server'
import { type NextRequest, NextResponse } from 'next/server'

import { getAppBaseUrl } from '@/lib/app-url'
import { supabase } from '@/lib/supabase'
import { buildAuthorizationUrl } from '@/lib/zid/auth'
import { ZidOAuthError } from '@/lib/zid/types'

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      const signInUrl = new URL('/sign-in', getAppBaseUrl(req))
      const returnUrl = req.nextUrl.pathname + req.nextUrl.search
      signInUrl.searchParams.set('redirect_url', returnUrl)
      return NextResponse.redirect(signInUrl)
    }

    const organizationId = req.nextUrl.searchParams.get('organizationId')?.trim()
    const storeIdParam = req.nextUrl.searchParams.get('store_id')?.trim()
    let storeId = storeIdParam

    // Auto-detect store_id from active workspace's tokens if not explicitly passed
    if (!storeId) {
      const { data: userDb } = await supabase
        .from('users')
        .select('active_workspace_id')
        .eq('id', userId)
        .maybeSingle()

      if (userDb?.active_workspace_id) {
        const { data: token } = await supabase
          .from('merchant_tokens')
          .select('store_id, merchant_id')
          .eq('workspace_id', userDb.active_workspace_id)
          .eq('platform', 'zid')
          .maybeSingle()

        if (token?.store_id || token?.merchant_id) {
          storeId = String(token.store_id || token.merchant_id)
        }
      }
    }

    if (!storeId && process.env.ZID_DEBUG_STORE_ID) {
      storeId = process.env.ZID_DEBUG_STORE_ID.trim()
    }

    const random = crypto.randomBytes(16).toString('hex')
    const state = organizationId ? `${organizationId}:${random}` : random
    const response = NextResponse.redirect(buildAuthorizationUrl(state, storeId))

    response.cookies.set('zid_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60,
      path: '/',
    })

    return response
  } catch (error) {
    const status = error instanceof ZidOAuthError ? error.status ?? 500 : 500

    return NextResponse.json(
      {
        error: 'authorization_failed',
        message: 'Could not start Zid authorization.',
      },
      { status }
    )
  }
}
