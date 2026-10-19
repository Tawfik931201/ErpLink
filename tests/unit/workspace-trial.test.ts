import {
  TRIAL_DAYS,
  isTrialExpired,
  trialDaysRemaining,
  trialEndDate,
  trialEndMs,
  trialRemainingMs,
} from '@/lib/workspace-trial'

/**
 * The 7-day free-trial clock, derived from `workspaces.created_at` — no
 * column, no migration. The banner's trial countdown and the periodic
 * workspace-closing pass both hang off this math, so it is pinned here with
 * an injected `now` (no clock flakiness).
 *
 * Source under test: src/lib/workspace-trial.ts
 * Consumers: subscription-actions.ts (getMyActiveSubscription), workspace-archive.ts
 * (archiveExpiredWorkspaces trial pass), SubscriptionBanner.tsx (via the action).
 *
 * Policy notes:
 * - Trial = created_at + 7 days, exact timestamp (not end-of-day like a
 *   subscription's inclusive end_date).
 * - A workspace with a paid subscription never consults trial state — the
 *   subscription lifecycle takes over.
 * - Missing / unparseable created_at → null (unknown), never "expired":
 *   fail-open, matching isWorkspaceArchived's handling of the pending
 *   migration. The archive pass also skips NULL created_at rows.
 */

const CREATED = Date.parse('2026-10-19T14:39:26Z')
const CREATED_ISO = '2026-10-19T14:39:26.000Z'
const END = CREATED + TRIAL_DAYS * 86_400_000 // 2026-10-26T14:39:26Z

describe('TRIAL_DAYS', () => {
  it('is 7 — the product decision, pinned', () => {
    expect(TRIAL_DAYS).toBe(7)
  })
})

describe('trialEndMs', () => {
  it('is created_at + 7 days as epoch ms', () => {
    expect(trialEndMs(CREATED_ISO)).toBe(END)
  })

  it('accepts a created_at without milliseconds', () => {
    expect(trialEndMs('2026-10-19T14:39:26Z')).toBe(END)
  })

  it('returns null for a missing created_at (unknown, not expired)', () => {
    expect(trialEndMs(null)).toBeNull()
    expect(trialEndMs(undefined)).toBeNull()
    expect(trialEndMs('')).toBeNull()
  })

  it('returns null for an unparseable created_at instead of NaN', () => {
    expect(trialEndMs('not-a-date')).toBeNull()
  })
})

describe('trialRemainingMs', () => {
  it('counts down from exactly 7 days at creation', () => {
    expect(trialRemainingMs(CREATED_ISO, CREATED)).toBe(7 * 86_400_000)
  })

  it('keeps sub-day precision — the strip ticks every second', () => {
    expect(trialRemainingMs(CREATED_ISO, END - 1_000)).toBe(1_000)
  })

  it('is 0 exactly at the trial end timestamp', () => {
    expect(trialRemainingMs(CREATED_ISO, END)).toBe(0)
  })

  it('clamps at 0 once the trial is past — never negative', () => {
    expect(trialRemainingMs(CREATED_ISO, END + 86_400_000)).toBe(0)
  })

  it('returns null (not 0) when created_at is missing — no trial info at all', () => {
    expect(trialRemainingMs(null, CREATED)).toBeNull()
  })
})

describe('isTrialExpired', () => {
  it('false while the trial is running (just before the end)', () => {
    expect(isTrialExpired(CREATED_ISO, END - 1)).toBe(false)
  })

  it('true at the exact end instant', () => {
    expect(isTrialExpired(CREATED_ISO, END)).toBe(true)
  })

  it('true long after the end', () => {
    expect(isTrialExpired(CREATED_ISO, END + 30 * 86_400_000)).toBe(true)
  })

  it('null created_at is NOT expired — unknown fails open', () => {
    // The archive pass and the banner both treat unknown age as the plain
    // no-subscription state; calling it "expired" would close workspaces
    // whose created_at we simply cannot read.
    expect(isTrialExpired(null, END)).toBe(false)
    expect(isTrialExpired('garbage', END)).toBe(false)
  })
})

describe('trialDaysRemaining', () => {
  it('is 7 whole days at creation', () => {
    expect(trialDaysRemaining(CREATED_ISO, CREATED)).toBe(7)
  })

  it('floors partial days', () => {
    // 6 days + 1 ms left → floors to 6
    expect(trialDaysRemaining(CREATED_ISO, END - 6 * 86_400_000 - 1)).toBe(6)
  })

  it('is 0 when expired or unknown', () => {
    expect(trialDaysRemaining(CREATED_ISO, END + 1)).toBe(0)
    expect(trialDaysRemaining(null, CREATED)).toBe(0)
  })
})

describe('trialEndDate', () => {
  it('renders the end as a YYYY-MM-DD (UTC) date string for display', () => {
    expect(trialEndDate(CREATED_ISO)).toBe('2026-10-26')
  })

  it('is null when created_at is missing or unparseable', () => {
    expect(trialEndDate(null)).toBeNull()
    expect(trialEndDate('nope')).toBeNull()
  })
})
