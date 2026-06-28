import crypto from 'crypto'

import { NextResponse } from 'next/server'

import { buildAuthorizationUrl } from '@/lib/zid/auth'
import { ZidOAuthError } from '@/lib/zid/types'

export async function GET() {
  try {
    const state = crypto.randomBytes(16).toString('hex')
    console.info('[Zid OAuth] Starting authorization')
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
    console.error('[Zid OAuth] Authorization failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })

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
