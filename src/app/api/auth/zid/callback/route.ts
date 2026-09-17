/**
 * GET /api/auth/zid/callback — مسار قديم (DEPRECATED).
 *
 * Canonical: GET /api/zid/callback — كل منطق تبادل الكود وحفظ التوكن
 * وتسجيل webhooks الأساسية يعيش هناك. هذا الملف مجرد shim يعيد التوجيه
 * مع نفس query params (?code=&state=&error=) — لا منطق مكرر، لا state
 * mismatch. حدّث Redirect URI في لوحة زد إلى /api/zid/callback.
 */
import { type NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const target = new URL('/api/zid/callback', req.url)
  req.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value)
  })

  return NextResponse.redirect(target, 307)
}
