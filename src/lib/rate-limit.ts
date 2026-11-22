import { isIP } from 'node:net'

/**
 * Minimal in-process rate limiter (per key + window).
 *
 * Shared-hosting safe: no Redis, no dependency. Map is pruned on each check.
 * For multi-instance deployments this is best-effort per process — still
 * stops a single script from drowning one Node process.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

function prune(now: number): void {
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k)
  }
  // Hard cap so the map itself cannot grow unbounded.
  if (buckets.size > 5000) {
    const oldest = [...buckets.keys()].slice(0, 1000)
    for (const k of oldest) buckets.delete(k)
  }
}

export interface RateLimit {
  allowed: boolean
  remaining: number
  resetMs: number
}

/**
 * Sliding-window counter: max `limit` hits per `windowMs` for `key`.
 * Returns `allowed: false` when the limit is exceeded.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimit {
  const now = Date.now()
  prune(now)
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, resetMs: windowMs }
  }
  if (b.count >= limit) {
    return { allowed: false, remaining: 0, resetMs: b.resetAt - now }
  }
  b.count += 1
  return { allowed: true, remaining: limit - b.count, resetMs: b.resetAt - now }
}

/**
 * Rate-limit identity derived ONLY from a reverse proxy that the operator
 * explicitly trusts. In particular, x-forwarded-for is client-controlled if
 * the origin is reachable directly or the proxy does not strip input values.
 *
 * Defaults to a SHARED anonymous bucket instead of trusting spoofable headers.
 * On an isolated Hostinger/proxy ingress, set WEBHOOK_TRUSTED_PROXY_IP_HEADER
 * only after proving the edge overwrites the named header on every request.
 */
export function rateLimitKeyFromHeaders(getHeader: (name: string) => string | null, prefix: string): string {
  const configured = (process.env.WEBHOOK_TRUSTED_PROXY_IP_HEADER ?? '').trim().toLowerCase()
  const allowedHeaders = new Set(['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip'])
  if (!allowedHeaders.has(configured)) return `${prefix}:unidentified`

  const raw = getHeader(configured) ?? ''
  if (raw.length > 256) return `${prefix}:unidentified`
  // A trusted edge MUST append/overwrite X-Forwarded-For. The rightmost entry
  // is the edge-visible peer; the first entry is attacker-injectable.
  const candidate = configured === 'x-forwarded-for'
    ? raw.split(',').at(-1)?.trim() ?? ''
    : raw.trim()
  const address = candidate.startsWith('[') && candidate.endsWith(']')
    ? candidate.slice(1, -1)
    : candidate
  return isIP(address) ? `${prefix}:${address.toLowerCase()}` : `${prefix}:unidentified`
}

/** Test seam: clear all buckets. */
export function resetRateLimits(): void {
  buckets.clear()
}
