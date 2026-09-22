import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import {
  SUPPORTED_URL_LOCALES,
  getLanguageFromUrlLocale,
  getUrlLocaleFromLanguage,
  stripLocaleFromPathname,
  DEFAULT_LANG,
} from '@/lib/locale'

const LOCALE_COOKIE = 'lang'

// Protect dashboard routes, keeping API endpoints and callbacks public
const isProtectedRoute = createRouteMatcher(['/dashboard((?!/connect-store).*)'])

// Admin routes get a separate, lighter protection: they're public at the
// middleware level, but the layouts themselves guard with isAdmin().
const isAdminRoute = createRouteMatcher(['/admin((?!/api).*)'])

// Onboarding/accept is allowed for unauthenticated users (Clerk sign-up).
const isOnboardingRoute = createRouteMatcher(['/onboarding(.*)'])

// Webhook routes must be excluded completely from Clerk - it consumes the body stream
const isWebhookRoute = createRouteMatcher(['/api/webhooks/(.*)'])

// API routes: skip locale redirect but still need x-pathname
const isApiRoute = createRouteMatcher(['/api/(.*)'])

export default clerkMiddleware(async (auth, req) => {
  const { pathname, search } = req.nextUrl

  // Skip Clerk + locale entirely for webhook routes
  if (isWebhookRoute(req)) {
    return NextResponse.next()
  }

  // Server Actions (and the internal forwarding requests Next.js issues for
  // them) must never be locale-redirected: after a rewrite, the action
  // forward re-enters this middleware against the un-prefixed route
  // (e.g. POST /dashboard). Redirecting that to /ar-sa/dashboard bounces the
  // forward and produces "failed to forward action response" + a 404 for the
  // client-side action POST. Locale-prefixed action requests are still
  // rewritten below.
  const isServerAction =
    req.method === 'POST' &&
    (req.headers.has('next-action') || req.headers.has('x-action-forwarded'))

  // --- LOCALE HANDLING ---
  let needsRewrite = false
  let langFromUrl: string | null = null

  const pathParts = pathname.split('/').filter(Boolean)
  const firstSegment = pathParts[0]?.toLowerCase()

  if (firstSegment && SUPPORTED_URL_LOCALES.includes(firstSegment)) {
    // URL has locale prefix → extract language, strip locale internally
    langFromUrl = getLanguageFromUrlLocale(firstSegment)
    const newPath = stripLocaleFromPathname(pathname)
    req.nextUrl.pathname = newPath
    needsRewrite = true
  } else if (!isApiRoute(req) && !isServerAction) {
    // No locale prefix (and not an API route) → redirect to locale-prefixed URL
    const lang = req.cookies.get(LOCALE_COOKIE)?.value || DEFAULT_LANG
    const urlLocale = getUrlLocaleFromLanguage(lang)
    const suffix = pathname === '/' ? '' : pathname
    return NextResponse.redirect(new URL(`/${urlLocale}${suffix}${search}`, req.url))
  }

  // --- CLERK: Protect routes ---
  if (isProtectedRoute(req) || isAdminRoute(req) || isOnboardingRoute(req)) {
    await auth().protect()
  }

  // --- HEADERS ---
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-pathname', req.nextUrl.pathname)

  // --- RESPONSE ---
  if (needsRewrite && langFromUrl) {
    const response = NextResponse.rewrite(req.nextUrl, {
      request: { headers: requestHeaders },
    })
    response.cookies.set(LOCALE_COOKIE, langFromUrl, {
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
      sameSite: 'lax',
    })
    return response
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  })
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.[\\w]+$|_next/image|_next/static|favicon.ico).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
