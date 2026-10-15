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

/** Client identity for rate limiting: forwarded IP, else `x-forwarded-for`, else `anonymous`. */
export function rateLimitKeyFromHeaders(getHeader: (name: string) => string | null, prefix: string): string {
  const ip =
    (getHeader('x-forwarded-for') ?? '').split(',')[0]?.trim() ||
    (getHeader('x-real-ip') ?? '').trim() ||
    'anonymous'
  return `${prefix}:${ip}`
}

/** Test seam: clear all buckets. */
export function resetRateLimits(): void {
  buckets.clear()
}
