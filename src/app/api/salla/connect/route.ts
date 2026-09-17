import crypto from 'crypto'

import { NextResponse } from 'next/server'

import { SALLA_OAUTH_SCOPES } from '@/lib/salla-client'

export async function GET() {
  try {
    const clientId = process.env.SALLA_CLIENT_ID
    const redirectUri = process.env.SALLA_REDIRECT_URI

    if (!clientId || !redirectUri) {
      return NextResponse.json(
        {
          error: 'missing_config',
          message: 'Salla OAuth environment variables not configured.',
          message_ar: 'إعدادات ربط سلة غير مكتملة في السيرفر (SALLA_CLIENT_ID / SALLA_REDIRECT_URI). تواصل مع الدعم.',
        },
        { status: 500 }
      )
    }

    // redirect_uri must EXACTLY match the URL registered in the Salla Partners
    // Portal (including https and trailing-slash form), otherwise Salla
    // rejects the flow with redirect_uri_mismatch.
    if (process.env.NODE_ENV === 'production' && !redirectUri.startsWith('https://')) {
      return NextResponse.json(
        {
          error: 'invalid_redirect_uri',
          message: 'SALLA_REDIRECT_URI must use https in production.',
          message_ar: 'رابط إعادة التوجيه (SALLA_REDIRECT_URI) يجب أن يبدأ بـ https في بيئة الإنتاج. تواصل مع الدعم.',
        },
        { status: 500 }
      )
    }

    const state = crypto.randomBytes(16).toString('hex')

    // Construct Salla Auth URL (scopes are the shared SALLA_OAUTH_SCOPES
    // constant — keep them in sync with the Portal approval).
    const authUrl = new URL('https://accounts.salla.sa/oauth2/auth')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', SALLA_OAUTH_SCOPES)
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
  } catch {
    return NextResponse.json(
      {
        error: 'authorization_failed',
        message: 'Could not start Salla authorization.',
        message_ar: 'تعذر بدء ربط متجر سلة. حاول مجدداً، وإن تكررت المشكلة تواصل مع الدعم.',
      },
      { status: 500 }
    )
  }
}
