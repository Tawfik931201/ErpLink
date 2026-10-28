/**
 * GET /api/auth/zid/authorize — مسار قديم (DEPRECATED).
 *
 * Canonical: GET /api/zid/connect — كل منطق OAuth يعيش هناك (state + كوكي
 * CSRF بصيغة موحدة). هذا الملف مجرد shim يعيد التوجيه مع الحفاظ على
 * ?organizationId= — لا تبنِ OAuth URL هنا حتى لا ينشأ state mismatch.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { getAppBaseUrl } from '@/lib/app-url'
import { getActiveUserId } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const userId = await getActiveUserId()
  if (!userId) {
    return NextResponse.redirect(new URL('/sign-in', getAppBaseUrl(req)))
  }

  const organizationId = req.nextUrl.searchParams.get('organizationId')?.trim()
  const target = new URL('/api/zid/connect', getAppBaseUrl(req))
  if (organizationId) target.searchParams.set('organizationId', organizationId)

  return NextResponse.redirect(target, 307)
}
