import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

const PARTNER_INTENT_COOKIE = 'partner_intent'

/**
 * GET /api/sign-up-intent/set?intent=partner
 * Persists a cookie for the given signup intent so the signup page knows
 * where to redirect after Clerk finishes onboarding.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const intent = url.searchParams.get('intent')

  if (intent !== 'partner') {
    return NextResponse.json({ ok: false, error: 'invalid intent' }, { status: 400 })
  }

  cookies().set({
    name: PARTNER_INTENT_COOKIE,
    value: intent,
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })

  const base = new URL(req.url).origin
  return NextResponse.redirect(`${base}/sign-up?intent=partner`, 302)
}
