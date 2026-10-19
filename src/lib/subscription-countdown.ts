/**
 * Pure countdown helpers for the subscription-expiry strip.
 *
 * `end_date` is inclusive — the subscription stays valid through the entire
 * day (UTC), so the countdown target is the start of the NEXT day. Kept in a
 * normal (non-'use server', non-'use client') module so it is unit-testable
 * without a browser or a database; the banner is the only consumer.
 */

export type CountdownParts = {
  days: number
  hours: number
  minutes: number
  seconds: number
}

/**
 * Milliseconds left until the subscription stops being valid.
 * Clamped at 0 — a past end date counts as "no time left", never negative.
 * `now` is injectable purely so tests are deterministic.
 */
export function subscriptionRemainingMs(endDate: string, now: number = Date.now()): number {
  const end = new Date(`${endDate}T00:00:00Z`).getTime() + 86_400_000
  if (Number.isNaN(end)) return 0
  return Math.max(0, end - now)
}

/** Break the remaining time into day/hour/minute/second chunks. */
export function countdownParts(endDate: string, now: number = Date.now()): CountdownParts {
  const rem = subscriptionRemainingMs(endDate, now)
  return {
    days: Math.floor(rem / 86_400_000),
    hours: Math.floor((rem % 86_400_000) / 3_600_000),
    minutes: Math.floor((rem % 3_600_000) / 60_000),
    seconds: Math.floor((rem % 60_000) / 1_000),
  }
}

/**
 * "6 أيام و 5 ساعات و 12 دقيقة و 30 ثانية" — zero units are skipped, and an
 * all-zero countdown reads as "أقل من ثانية" rather than an empty string.
 * The plural rule (`=== 1 ? singular : plural`) matches the codebase's
 * existing date strings; Arabic dual (يومان) is deliberately not special-cased.
 */
export function formatCountdownAr(p: CountdownParts): string {
  const units: string[] = []
  if (p.days > 0) units.push(`${p.days} ${p.days === 1 ? 'يوم' : 'أيام'}`)
  if (p.hours > 0) units.push(`${p.hours} ${p.hours === 1 ? 'ساعة' : 'ساعات'}`)
  if (p.minutes > 0) units.push(`${p.minutes} ${p.minutes === 1 ? 'دقيقة' : 'دقائق'}`)
  if (p.seconds > 0) units.push(`${p.seconds} ${p.seconds === 1 ? 'ثانية' : 'ثواني'}`)
  if (units.length === 0) return 'أقل من ثانية'
  return units.join(' و ')
}

/** "6 days, 5 hours, 12 minutes and 30 seconds" — same skip-zero rules. */
export function formatCountdownEn(p: CountdownParts): string {
  const units: string[] = []
  if (p.days > 0) units.push(`${p.days} day${p.days === 1 ? '' : 's'}`)
  if (p.hours > 0) units.push(`${p.hours} hour${p.hours === 1 ? '' : 's'}`)
  if (p.minutes > 0) units.push(`${p.minutes} minute${p.minutes === 1 ? '' : 's'}`)
  if (p.seconds > 0) units.push(`${p.seconds} second${p.seconds === 1 ? '' : 's'}`)
  if (units.length === 0) return 'less than a second'
  if (units.length === 1) return units[0]
  return `${units.slice(0, -1).join(', ')} and ${units[units.length - 1]}`
}
