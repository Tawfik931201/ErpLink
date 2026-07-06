import crypto from 'crypto'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const clientId = process.env.SALLA_CLIENT_ID
    const redirectUri = process.env.SALLA_REDIRECT_URI

    if (!clientId || !redirectUri) {
      console.error('[Salla OAuth] Missing client configuration', { clientId, redirectUri })
      return NextResponse.json(
        { error: 'missing_config', message: 'Salla OAuth environment variables not configured.' },
        { status: 500 }
      )
    }

    const state = crypto.randomBytes(16).toString('hex')
    console.info('[Salla OAuth] Starting Salla authorization flow')

    // Construct Salla Auth URL
    const authUrl = new URL('https://accounts.salla.sa/oauth2/auth')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', 'offline_access')
    authUrl.searchParams.set('state', state)

    const response = NextResponse.redirect(authUrl.toString())

    response.cookies.set('salla_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60, // 10 minutes
      path: '/',
    })

    return response
  } catch (error) {
    console.error('[Salla OAuth] Connect route failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: 'authorization_failed', message: 'Could not start Salla authorization.' },
      { status: 500 }
    )
  }
}
