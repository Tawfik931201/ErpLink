import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/sign-up-intent/set — removed (affiliate system cancelled 2026-09-10).
 * Manual payments only, no Stripe, no affiliate attribution.
 * Kept as a redirect shim so old links don't 404.
 */
export async function GET(req: NextRequest) {
  const base = new URL(req.url).origin
  return NextResponse.redirect(`${base}/sign-up`, 302)
}
