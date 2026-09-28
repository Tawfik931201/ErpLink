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
const isProtectedRoute = createRouteMatcher(['/app(.*)'])

// The dashboard tree moved under /app/*. Links, OAuth callbacks and bookmarks
// created before the move still target /dashboard/*, so redirect them instead
// of 404-ing. Sub-paths were reshuffled during the move (not a pure prefix
// rename), hence the explicit map. Longest prefix wins, so order matters.
const LEGACY_ROUTE_MAP: ReadonlyArray<readonly [string, string]> = [
  ['/dashboard/connect-store', '/app/connect-store'],
  ['/dashboard/connect-odoo', '/app/connect-odoo'],
  ['/dashboard/initial-transfer', '/app/initial-transfer'],
  ['/dashboard/mapping-center', '/app/mapping-center'],
  ['/dashboard/settings', '/app/settings'],
  ['/dashboard/integrations', '/app/dashboard/integrations'],
  ['/dashboard/workspace', '/app/settings/workspace'],
  ['/dashboard/tickets', '/app/tickets'],
  ['/dashboard', '/app/dashboard'],
]

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

  let needsRewrite = false
  let langFromUrl: string | null = null

  // Server Actions, action forward fetches, and mutation requests (POST/PUT/DELETE)
  // must NEVER be redirected (HTTP 307/308). Redirecting a POST drops/corrupts the
  // body, breaks internal Next.js action forwarding, causes 5-minute UND_ERR_HEADERS_TIMEOUT
  // socket deadlocks, and exhausts the Node.js memory heap.
  const isPostOrMutation = req.method !== 'GET' && req.method !== 'HEAD'
  const isServerAction =
    req.method === 'POST' &&
    (req.headers.has('next-action') || req.headers.has('x-action-forwarded') || req.headers.has('rsc'))

  // --- LEGACY /dashboard/* -> /app/* ---
  // Runs before locale handling so both /dashboard and /ar-sa/dashboard land on
  // a real route.
  if (!isApiRoute(req)) {
    const segments = pathname.split('/').filter(Boolean)
    const first = segments[0]?.toLowerCase() ?? ''
    const hasLocale = SUPPORTED_URL_LOCALES.includes(first)

    const barePath = hasLocale ? `/${segments.slice(1).join('/')}` : pathname
    const match = LEGACY_ROUTE_MAP.find(
      ([from]) => barePath === from || barePath.startsWith(`${from}/`)
    )

    if (match) {
      const [from, to] = match
      const target = `${to}${barePath.slice(from.length)}`
      if (isPostOrMutation) {
        // Rewrite POST/mutations internally instead of redirecting
        req.nextUrl.pathname = target
        needsRewrite = true
      } else {
        const localePrefix = hasLocale
          ? `/${first}`
          : `/${getUrlLocaleFromLanguage(req.cookies.get(LOCALE_COOKIE)?.value || DEFAULT_LANG)}`
        return NextResponse.redirect(new URL(`${localePrefix}${target}${search}`, req.url))
      }
    }
  }

  // --- LOCALE HANDLING ---

  const pathParts = pathname.split('/').filter(Boolean)
  const firstSegment = pathParts[0]?.toLowerCase()

  if (firstSegment && SUPPORTED_URL_LOCALES.includes(firstSegment)) {
    // URL has locale prefix → extract language, strip locale internally
    langFromUrl = getLanguageFromUrlLocale(firstSegment)
    const newPath = stripLocaleFromPathname(pathname)
    req.nextUrl.pathname = newPath
    needsRewrite = true
  } else if (!isApiRoute(req) && !isPostOrMutation && !isServerAction) {
    // No locale prefix (and not an API route or POST) → redirect to locale-prefixed URL for browser GET/HEAD
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
