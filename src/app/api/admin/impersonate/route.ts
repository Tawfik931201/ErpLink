import { auth } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { recordAudit } from '@/lib/audit-logs'
import { isAdmin } from '@/lib/auth'

/**
 * A Clerk user id: the literal prefix `user_` followed by base62 characters.
 * Validating the shape on both the confirmation page and the POST means an
 * attacker-controlled value can never be reflected as markup into an
 * `text/html` response served from the app's own origin, where the admin
 * session and the impersonation cookie live.
 */
const CLERK_USER_ID_RE = /^user_[0-9a-zA-Z]{6,64}$/

function isClerkUserId(value: unknown): value is string {
  return typeof value === 'string' && CLERK_USER_ID_RE.test(value)
}

/** HTML text/attribute escaping. Used for every interpolated value below. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => {
    switch (c) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

/**
 * API route to start user impersonation.
 * GET shows a confirmation page (mitigates CSRF via <img> tags).
 * POST sets the impersonation cookie and redirects to /app/dashboard.
 */
export async function GET(request: NextRequest) {
  const { userId: realUserId } = await auth()

  if (!realUserId || !isAdmin(realUserId)) {
    return new NextResponse('Unauthorized - Admin access required', { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const targetUserId = searchParams.get('userId')

  if (!isClerkUserId(targetUserId)) {
    return new NextResponse('Bad Request - userId is not a valid user id', { status: 400 })
  }

  const safeTargetUserId = escapeHtml(targetUserId)

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>تأكيد محاكاة حساب العميل - ErpLink</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 1rem; padding: 2rem; max-width: 440px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }
    h1 { font-size: 1.25rem; margin-bottom: 0.75rem; color: #38bdf8; }
    p { font-size: 0.875rem; color: #94a3b8; line-height: 1.5; margin-bottom: 1.5rem; }
    .actions { display: flex; gap: 0.75rem; justify-content: center; }
    button, a { font-family: inherit; font-size: 0.875rem; font-weight: 600; padding: 0.625rem 1.25rem; border-radius: 0.5rem; text-decoration: none; cursor: pointer; border: none; }
    .btn-confirm { background: #0284c7; color: white; }
    .btn-confirm:hover { background: #0369a1; }
    .btn-cancel { background: #334155; color: #cbd5e1; }
    .btn-cancel:hover { background: #475569; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚠️ تأكيد محاكاة حساب العميل</h1>
    <p>أنت على وشك الدخول إلى لوحة التحكم بصلاحية العميل: <br><strong style="color:#f8fafc; word-break: break-all;">${safeTargetUserId}</strong>.<br>هل ترغب في المتابعة؟</p>
    <form method="POST" action="/api/admin/impersonate" class="actions">
      <input type="hidden" name="userId" value="${safeTargetUserId}" />
      <button type="submit" class="btn-confirm">تأكيد الدخول كعميل</button>
      <a href="/admin" class="btn-cancel">إلغاء</a>
    </form>
  </div>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  })
}

export async function POST(request: NextRequest) {
  const { userId: realUserId } = await auth()

  if (!realUserId || !isAdmin(realUserId)) {
    return new NextResponse('Unauthorized - Admin access required', { status: 401 })
  }

  let targetUserId: string | null = null
  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    targetUserId = formData.get('userId') as string
  } else if (contentType.includes('application/json')) {
    const json = await request.json()
    targetUserId = json.userId
  } else {
    const { searchParams } = new URL(request.url)
    targetUserId = searchParams.get('userId')
  }

  if (!isClerkUserId(targetUserId)) {
    return new NextResponse('Bad Request - userId is not a valid user id', { status: 400 })
  }

  const cookieStore = cookies()
  cookieStore.set({
    name: 'impersonated_user_id',
    value: targetUserId,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 3600, // 1 hour
    path: '/',
  })

  // Starting impersonation grants access to another tenant's data, so it is a
  // privileged action and belongs in the security audit trail.
  await recordAudit({
    actorId: realUserId,
    actorRole: 'admin',
    action: 'impersonation.start',
    entityType: 'user',
    entityId: targetUserId,
  })

  const baseUrl = new URL(request.url).origin
  return NextResponse.redirect(`${baseUrl}/app/dashboard`, 303)
}
