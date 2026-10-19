import {
  countdownParts,
  formatCountdownAr,
  formatCountdownEn,
  msToCountdownParts,
  subscriptionRemainingMs,
} from '@/lib/subscription-countdown'

/**
 * The top strip's ticking countdown (d/h/m/s, every second) is what tells a
 * client exactly when the workspace will close, so the math and both display
 * strings are pinned here. `end_date` is inclusive: the target is the start
 * of the NEXT day (UTC), matching the component's documented behaviour.
 *
 * Source under test: src/lib/subscription-countdown.ts
 * Consumed by: src/components/subscription/SubscriptionBanner.tsx (client).
 *
 * `now` is injected in every test — no fake timers, no clock flakiness.
 */

const TARGET = Date.parse('2026-10-26T00:00:00Z') // end_date 2026-10-25 + 1 day

describe('subscriptionRemainingMs', () => {
  it('counts to the START of the day after the inclusive end_date', () => {
    // Exactly 7 days before the target.
    const now = TARGET - 7 * 86_400_000
    expect(subscriptionRemainingMs('2026-10-25', now)).toBe(7 * 86_400_000)
  })

  it('keeps seconds — the strip ticks every second, not every minute', () => {
    expect(subscriptionRemainingMs('2026-10-25', TARGET - 1_000)).toBe(1_000)
  })

  it('is 0 exactly at the target (expiry is the last millisecond of end_date)', () => {
    expect(subscriptionRemainingMs('2026-10-25', TARGET)).toBe(0)
  })

  it('clamps at 0 for a past end_date — never a negative countdown', () => {
    expect(subscriptionRemainingMs('2026-10-25', TARGET + 86_400_000)).toBe(0)
  })

  it('returns 0 for an unparseable date instead of NaN', () => {
    expect(subscriptionRemainingMs('not-a-date', TARGET)).toBe(0)
  })
})

describe('countdownParts', () => {
  it('splits into day/hour/minute/second', () => {
    const rem = 6 * 86_400_000 + 5 * 3_600_000 + 12 * 60_000 + 30 * 1_000
    expect(countdownParts('2026-10-25', TARGET - rem)).toEqual({
      days: 6,
      hours: 5,
      minutes: 12,
      seconds: 30,
    })
  })

  it('a whole-day remainder is 7 days flat', () => {
    expect(countdownParts('2026-10-25', TARGET - 7 * 86_400_000)).toEqual({
      days: 7,
      hours: 0,
      minutes: 0,
      seconds: 0,
    })
  })

  it('an expired subscription is all zeros', () => {
    expect(countdownParts('2026-10-25', TARGET + 1)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    })
  })
})

describe('msToCountdownParts', () => {
  // The trial countdown targets an exact created_at + 7d timestamp (not a
  // date-only end_date), so it computes its own remaining ms and feeds them
  // in here — the same chunks the subscription path produces.
  it('splits a raw duration into day/hour/minute/second', () => {
    const rem = 6 * 86_400_000 + 5 * 3_600_000 + 12 * 60_000 + 30 * 1_000
    expect(msToCountdownParts(rem)).toEqual({ days: 6, hours: 5, minutes: 12, seconds: 30 })
  })

  it('a whole 7-day duration is 7 days flat (fresh trial)', () => {
    expect(msToCountdownParts(7 * 86_400_000)).toEqual({
      days: 7,
      hours: 0,
      minutes: 0,
      seconds: 0,
    })
  })

  it('clamps a negative duration to all zeros', () => {
    expect(msToCountdownParts(-1)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 })
  })

  it('zero stays zero', () => {
    expect(msToCountdownParts(0)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 })
  })
})

describe('formatCountdownAr', () => {
  it('renders all four units with Arabic joiners', () => {
    // Plural rule is the codebase's loose `n === 1 ? singular : plural` with
    // the number kept ("12 دقائق", not MSA "12 دقيقة") — same as the
    // dashboard card's "ينتهي بعد 5 يوم". Pinned as-is on purpose.
    expect(formatCountdownAr({ days: 6, hours: 5, minutes: 12, seconds: 30 })).toBe(
      '6 أيام و 5 ساعات و 12 دقائق و 30 ثواني',
    )
  })

  it('uses singulars for 1', () => {
    expect(formatCountdownAr({ days: 1, hours: 1, minutes: 1, seconds: 1 })).toBe(
      '1 يوم و 1 ساعة و 1 دقيقة و 1 ثانية',
    )
  })

  it('skips zero units but keeps the ticking seconds', () => {
    expect(formatCountdownAr({ days: 0, hours: 0, minutes: 2, seconds: 5 })).toBe(
      '2 دقائق و 5 ثواني',
    )
  })

  it('all-zero reads as "less than a second", never an empty string', () => {
    expect(formatCountdownAr({ days: 0, hours: 0, minutes: 0, seconds: 0 })).toBe('أقل من ثانية')
  })
})

describe('formatCountdownEn', () => {
  it('renders all four units', () => {
    expect(formatCountdownEn({ days: 6, hours: 5, minutes: 12, seconds: 30 })).toBe(
      '6 days, 5 hours, 12 minutes and 30 seconds',
    )
  })

  it('joins a single remaining unit without a conjunction', () => {
    expect(formatCountdownEn({ days: 0, hours: 0, minutes: 0, seconds: 45 })).toBe('45 seconds')
  })

  it('uses singulars for 1', () => {
    expect(formatCountdownEn({ days: 1, hours: 0, minutes: 0, seconds: 1 })).toBe(
      '1 day and 1 second',
    )
  })

  it('all-zero reads as "less than a second", never an empty string', () => {
    expect(formatCountdownEn({ days: 0, hours: 0, minutes: 0, seconds: 0 })).toBe(
      'less than a second',
    )
  })
})
