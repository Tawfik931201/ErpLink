/**
 * GET /api/auth/zid/authorize
 *
 * Initiates the Zid OAuth 2.0 flow.
 * Redirects the merchant to https://oauth.zid.sa to grant consent.
 *
 * Zid App Registration details:
 *   Client ID       : 6784
 *   OAuth Base      : https://oauth.zid.sa
 *   Redirect URI    : https://33c8-102-184-228-54.ngrok-free.app/api/auth/zid/callback
 *
 * Query params:
 *   - organizationId : the organization connecting Zid (from our DB)
 */
import crypto from 'crypto'

import { type NextRequest, NextResponse } from 'next/server'

import { buildZidOAuthUrl } from '@/lib/zid-client'

export async function GET(req: NextRequest) {
  // TEMPORARY: Bypass authentication to allow testing the Zid integration directly.
  // const session = await getServerSession(authOptions)
  // if (!session?.user?.id) {
  //   return NextResponse.redirect(new URL('/auth/login', req.url))
  // }

  const organizationId = req.nextUrl.searchParams.get('organizationId') || 'default'

  // CSRF state token — format: "<orgId>:<random_hex>"
  const state = `${organizationId}:${crypto.randomBytes(16).toString('hex')}`

  const authorizeUrl = buildZidOAuthUrl({
    clientId: process.env.ZID_CLIENT_ID || process.env.NEXT_PUBLIC_ZID_CLIENT_ID!,   // 6784
    redirectUri: process.env.ZID_OAUTH_REDIRECT_URI!,   // https://33c8-...ngrok.../api/auth/zid/callback
    state,
  })

  return NextResponse.redirect(authorizeUrl)
}
