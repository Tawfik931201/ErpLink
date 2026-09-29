import {
  addMonthsToDate,
  computeSubscriptionEndDate,
  isValidIsoDate,
} from '@/lib/subscription-dates'

/**
 * Billing is manual (no Stripe), so `end_date` decides when a client's access
 * lapses. `computeSubscriptionEndDate` is the single source of truth for that
 * boundary and is therefore the highest-value thing in the app to pin down.
 *
 * Source under test: src/lib/subscription-dates.ts
 * Consumed by: src/app/actions/subscription-actions.ts (a 'use server' module,
 * which cannot export sync functions — hence the separate file).
 */

describe('computeSubscriptionEndDate', () => {
  it('is an INCLUSIVE period: start + months - 1 day', () => {
    // 1 month paid on 2026-01-15 expires 2026-02-14, not 2026-02-15.
    expect(computeSubscriptionEndDate('2026-01-15', 1)).toBe('2026-02-14')
  })

  it('handles a full year', () => {
    expect(computeSubscriptionEndDate('2026-03-01', 12)).toBe('2027-02-28')
  })

  it('handles a multi-month purchase', () => {
    expect(computeSubscriptionEndDate('2026-01-10', 3)).toBe('2026-04-09')
  })

  it('crosses a year boundary', () => {
    expect(computeSubscriptionEndDate('2025-11-20', 3)).toBe('2026-02-19')
  })

  it('is timezone-stable (uses UTC, never local time)', () => {
    // A local-time implementation would shift the result by a day west of UTC.
    expect(computeSubscriptionEndDate('2026-01-01', 1)).toBe('2026-01-31')
  })

  it('rolls a month-end start forward (known quirk, see note below)', () => {
    // ⚠️ ANOMALY, pinned on purpose. Jan 31 + 1 month has no "Feb 31", so JS
    // overflows to Mar 3, minus 1 day = Mar 2. A customer paying on 2026-01-31
    // therefore gets 30 days, not 28. The usual convention would clamp to
    // 2026-02-27/28.
    //
    // This is a billing behaviour change, so it is NOT fixed here — it needs an
    // explicit product decision (see AGENTS.md → Billing date edge case).
    // This test exists to make any future change visible and deliberate.
    expect(computeSubscriptionEndDate('2026-01-31', 1)).toBe('2026-03-02')
  })

  it('is a no-op for a zero-month period', () => {
    expect(computeSubscriptionEndDate('2026-05-10', 0)).toBe('2026-05-09')
  })
})

describe('addMonthsToDate', () => {
  it('adds whole months', () => {
    expect(addMonthsToDate('2026-01-15', 1)).toBe('2026-02-15')
    expect(addMonthsToDate('2026-01-15', 6)).toBe('2026-07-15')
    expect(addMonthsToDate('2026-01-15', 12)).toBe('2027-01-15')
  })

  it('is what extendSubscription chains on top of the existing end_date', () => {
    // 6 months paid, then 6 more: the second call must start from the first end.
    const first = computeSubscriptionEndDate('2026-01-15', 6)
    expect(first).toBe('2026-07-14')
    expect(addMonthsToDate(first, 6)).toBe('2027-01-14')
  })

  it('rolls a leap day forward (same known quirk)', () => {
    // 2028-02-29 + 12 months overflows into March instead of clamping to
    // 2029-02-28. Pinned for the same reason as computeSubscriptionEndDate above.
    expect(addMonthsToDate('2028-02-29', 12)).toBe('2029-03-01')
  })
})

describe('isValidIsoDate', () => {
  it('accepts a well-formed YYYY-MM-DD date', () => {
    expect(isValidIsoDate('2026-01-15')).toBe(true)
  })

  it('rejects an impossible date', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false)
    expect(isValidIsoDate('2026-13-01')).toBe(false)
  })

  it('rejects a malformed or partial date', () => {
    expect(isValidIsoDate('')).toBe(false)
    expect(isValidIsoDate('not-a-date')).toBe(false)
    expect(isValidIsoDate('2026-1-5')).toBe(false)
  })

  it('rejects a full timestamp (only the date part is expected)', () => {
    expect(isValidIsoDate('2026-01-15T10:00:00Z')).toBe(false)
  })
})
