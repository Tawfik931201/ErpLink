/**
 * Pure URL helpers for the Zid Embedded launch.
 *
 * Zid appends `?token=<uuid>&language=<locale>` to whichever Application URL
 * is configured in the Partner Dashboard. If that URL is not `/embedded`
 * (e.g. it still points at the homepage, as in production on 2026-11-09),
 * the merchant lands on the public site / the normal Clerk sign-in form
 * inside a cross-site iframe. Clerk's Frontend API then rejects the
 * sign-in attempt with `authorization_invalid` ("Unauthorized request"),
 * because a normal password/OAuth sign-in cannot establish a session in
 * that third-party-cookie context.
 *
 * The fix is to route any request carrying a Zid embedded token to
 * `/embedded`, where the token is exchanged for a one-use Clerk ticket
 * (see `src/lib/zid/embedded.ts`). This module is import-free so the rule
 * can be unit-tested without Next/Clerk/Supabase.
 *
 * The token pattern is shared with `embeddedTokenHash` — a single source
 * of truth, so a token the middleware redirects on is exactly a token the
 * session route will accept.
 */
export const ZID_EMBEDDED_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isZidEmbeddedToken(value: unknown): value is string {
  return typeof value === 'string' && ZID_EMBEDDED_TOKEN_PATTERN.test(value)
}

const LANGUAGE_PATTERN = /^[a-z]{2}(?:-[a-z0-9]{2,})?$/i

/**
 * Returns the `/embedded` target (with locale prefix) when `token` is a
 * Zid embedded token and the current bare pathname is not already
 * `/embedded`; otherwise null.
 *
 * `localePrefix` is the URL locale already present in the request
 * (`ar-sa` / `en-us`) or the resolved default locale — always inject
 * it so the redirect does not bounce through the locale middleware.
 */
export function getZidEmbeddedRedirectTarget(input: {
  pathname: string
  token: string | null
  language?: string | null
  localePrefix: string
}): string | null {
  if (!isZidEmbeddedToken(input.token)) return null
  const bare = input.pathname === '/' ? '/' : input.pathname.replace(/\/$/, '') || '/'
  if (bare === '/embedded') return null
  const params = new URLSearchParams()
  params.set('token', input.token)
  if (typeof input.language === 'string' && LANGUAGE_PATTERN.test(input.language)) {
    params.set('language', input.language)
  }
  return `/${input.localePrefix}/embedded?${params.toString()}`
}
