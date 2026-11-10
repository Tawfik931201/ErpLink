/** Public App Market entry: OAuth precedes ERPlink account setup. */
import { type NextRequest, NextResponse } from 'next/server'

import { checkRateLimit, rateLimitKeyFromHeaders } from '@/lib/rate-limit'
import { buildAuthorizationUrl } from '@/lib/zid/auth'
import { beginZidAuthorization, oauthCookieOptions } from '@/lib/zid/oauth-pending'
import { ZidOAuthError } from '@/lib/zid/types'

export async function GET(req: NextRequest) {
  const limit = checkRateLimit(rateLimitKeyFromHeaders(n => req.headers.get(n), 'oauth-zid-connect'), 30, 60_000)
  if (!limit.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  try {
    buildAuthorizationUrl()
    const state = await beginZidAuthorization()
    const response = NextResponse.redirect(buildAuthorizationUrl(state))

    response.cookies.set('zid_oauth_state', state, oauthCookieOptions(10 * 60))
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')

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
