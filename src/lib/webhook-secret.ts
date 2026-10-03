import crypto from 'crypto'

/**
 * Constant-time comparison for shared webhook secrets.
 *
 * A plain `!==` leaks the expected secret's prefix through response timing,
 * which is enough to recover it byte by byte. `crypto.timingSafeEqual` throws
 * on length mismatch, so the length check happens first — length is not secret
 * (it is fixed by deployment config), and returning early is required for the
 * comparison to be well-defined.
 *
 * Lives here rather than in each route so there is exactly one implementation:
 * it was previously copy-pasted into both Odoo routes.
 */
export function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
