'use server'

import { cookies } from 'next/headers'

const PARTNER_INTENT_COOKIE = 'partner_intent'

const COOKIE_BASE = {
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
}

/**
 * Persist a signup intent so subsequent pages know to redirect the
 * user to a specific onboarding flow.
 */
export async function setSignupIntent(intent: 'partner'): Promise<void> {
  cookies().set({
    ...COOKIE_BASE,
    name: PARTNER_INTENT_COOKIE,
    value: intent,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  })
}

/**
 * Read the currently-saved signup intent (if any).
 */
export async function getSignupIntent(): Promise<string | null> {
  return cookies().get(PARTNER_INTENT_COOKIE)?.value ?? null
}

/**
 * Clear the signup intent. Call this once the user has reached
 * `/onboarding/partner` so we don't accidentally loop the user
 * back into partner flow if they sign out and back in later.
 */
export async function clearSignupIntent(): Promise<void> {
  cookies().set({
    ...COOKIE_BASE,
    name: PARTNER_INTENT_COOKIE,
    value: '',
    maxAge: 0,
  })
}
