import { type NextRequest, NextResponse } from 'next/server'

import { getAppBaseUrl } from '@/lib/app-url'
import { checkRateLimit, rateLimitKeyFromHeaders } from '@/lib/rate-limit'
import { createEmbeddedTicket } from '@/lib/zid/embedded'

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }
  if (request.headers.get('origin') !== new URL(getAppBaseUrl(request)).origin) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403, headers })
  }
  const limit = checkRateLimit(rateLimitKeyFromHeaders(n => request.headers.get(n), 'zid-embedded'), 30, 60_000)
  if (!limit.allowed) return NextResponse.json({ error: 'Try again shortly' }, { status: 429, headers })
  const input = await request.json().catch(() => null)
  if (typeof input?.token !== 'string') return NextResponse.json({ error: 'Invalid token' }, { status: 401, headers })
  try {
    const ticket = await createEmbeddedTicket(input.token)
    if (!ticket) return NextResponse.json({ error: 'Invalid or revoked embedded token' }, { status: 401, headers })
    return NextResponse.json({ ticket }, { headers })
  } catch {
    return NextResponse.json({ error: 'Embedded sign-in temporarily unavailable' }, { status: 503, headers })
  }
}
