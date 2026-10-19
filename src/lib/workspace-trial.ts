/**
 * Free-trial math for workspaces — pure, no I/O.
 *
 * Policy (added 2026-10-19): every workspace gets an automatic 7-day free
 * trial starting at its `workspaces.created_at` timestamp. The trial exists
 * only while the workspace has NO non-expired active subscription — the moment
 * a paid subscription is registered, the subscription lifecycle takes over and
 * trial state is irrelevant. When the trial runs out with no subscription the
 * workspace is closed (archived) and the admin must register a subscription to
 * reopen it.
 *
 * The clock derives from `workspaces.created_at` — no extra column, no
 * migration. A workspace with a NULL / unparseable `created_at` has NO trial
 * information (`null`): the caller falls back to the plain "no subscription"
 * strip, and the archive pass skips it (never auto-archive on unknown age).
 *
 * Kept in a normal module so it is unit-testable; consumers are
 * `subscription-actions.ts`, `workspace-archive.ts` and the banner (indirectly).
 */

/** Free-trial length in days. */
export const TRIAL_DAYS = 7

const DAY_MS = 86_400_000

/**
 * Trial end as epoch ms: `created_at + TRIAL_DAYS`.
 * Returns null when there is no usable `created_at`.
 */
export function trialEndMs(createdAt: string | null | undefined): number | null {
  if (!createdAt) return null
  const created = Date.parse(createdAt)
  if (Number.isNaN(created)) return null
  return created + TRIAL_DAYS * DAY_MS
}

/**
 * Milliseconds left in the trial. Clamped at 0 — an overdue trial counts as
 * "no time left", never negative. Returns null when `created_at` is missing
 * or unparseable (no trial information at all).
 */
export function trialRemainingMs(
  createdAt: string | null | undefined,
  now: number = Date.now(),
): number | null {
  const end = trialEndMs(createdAt)
  if (end == null) return null
  return Math.max(0, end - now)
}

/**
 * Whether the trial has already run out. A missing / unparseable
 * `created_at` is NOT "expired" — it is "unknown", and the caller treats
 * unknown as the plain no-subscription state (fail-open, matching
 * `isWorkspaceArchived`'s handling of the pending migration).
 */
export function isTrialExpired(createdAt: string | null | undefined, now: number = Date.now()): boolean {
  const remaining = trialRemainingMs(createdAt, now)
  return remaining != null && remaining <= 0
}

/** Whole days left in the trial (0 when expired / unknown). */
export function trialDaysRemaining(createdAt: string | null | undefined, now: number = Date.now()): number {
  const remaining = trialRemainingMs(createdAt, now)
  if (remaining == null) return 0
  return Math.floor(remaining / DAY_MS)
}

/** Trial end as a YYYY-MM-DD (UTC) date string, for display. Null when unknown. */
export function trialEndDate(createdAt: string | null | undefined): string | null {
  const end = trialEndMs(createdAt)
  if (end == null) return null
  return new Date(end).toISOString().slice(0, 10)
}
