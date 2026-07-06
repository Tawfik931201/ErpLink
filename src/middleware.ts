import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Protect dashboard routes, keeping API endpoints and callbacks public
const isProtectedRoute = createRouteMatcher(['/dashboard((?!/connect-zid).*)'])

// Webhook routes must be excluded completely from Clerk - it consumes the body stream
const isWebhookRoute = createRouteMatcher(['/api/webhooks/(.*)'])

export default clerkMiddleware(async (auth, req) => {
  // Skip Clerk entirely for webhook routes to prevent consuming the request body
  if (isWebhookRoute(req)) {
    return NextResponse.next()
  }

  if (isProtectedRoute(req)) {
    await auth().protect()
  }

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-pathname', req.nextUrl.pathname)

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
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
