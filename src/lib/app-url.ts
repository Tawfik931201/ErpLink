import { type NextRequest } from 'next/server'

/**
 * Resolves the public base URL of the application.
 *
 * In containerized / reverse proxy environments (Docker, Nginx, CapRover, Coolify),
 * `req.url` or `req.nextUrl.origin` may resolve to internal socket addresses like
 * `http://0.0.0.0:3000` or `http://127.0.0.1:3000`. This helper resolves the
 * actual client-facing public URL by inspecting:
 *   1. NEXT_PUBLIC_APP_URL / NEXTAUTH_URL (canonical production config)
 *   2. X-Forwarded-Host + X-Forwarded-Proto headers
 *   3. Host header
 *   4. request.nextUrl.origin (if not 0.0.0.0)
 *   5. fallback: http://localhost:3000
 */
export function getAppBaseUrl(request?: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXTAUTH_URL?.trim()
  if (envUrl) {
    return envUrl.replace(/\/$/, '')
  }

  if (request) {
    const forwardedHost = request.headers.get('x-forwarded-host')?.trim()
    const host = forwardedHost || request.headers.get('host')?.trim()
    const forwardedProto = request.headers.get('x-forwarded-proto')?.trim()
    const proto = forwardedProto || (host && !host.includes('localhost') ? 'https' : 'http')

    if (host && !host.startsWith('0.0.0.0')) {
      return `${proto}://${host}`
    }

    const origin = request.nextUrl?.origin
    if (origin && !origin.includes('0.0.0.0')) {
      return origin.replace(/\/$/, '')
    }
  }

  return 'http://localhost:3000'
}
