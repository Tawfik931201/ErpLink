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

import { type NextRequest, NextResponse } from 'next/server'

import { buildAuthorizationUrl } from '@/lib/zid/auth'
import { ZidOAuthError } from '@/lib/zid/types'

export async function GET(req: NextRequest) {
  try {
    const organizationId = req.nextUrl.searchParams.get('organizationId')?.trim()
    const random = crypto.randomBytes(16).toString('hex')
    const state = organizationId ? `${organizationId}:${random}` : random
    const response = NextResponse.redirect(buildAuthorizationUrl(state))

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
