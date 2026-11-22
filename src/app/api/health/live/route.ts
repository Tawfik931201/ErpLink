import { NextResponse } from 'next/server'

/**
 * Public, low-cost release marker for deployment verification.
 * Does not query Supabase, disclose environment variables, credentials, or
 * internal deployment topology. Do not equate this marker with DB health.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    { ok: true, release: 'erplink-security-prelaunch-20261123-r1' },
    { headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' } },
  )
}
