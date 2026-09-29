/**
 * Pure subscription date arithmetic.
 *
 * Deliberately NOT in `src/app/actions/subscription-actions.ts`: that file is
 * `'use server'`, and Next.js requires every export from such a module to be an
 * async function. Keeping this logic here makes it directly unit-testable.
 *
 * All functions work in UTC. A local-time implementation would shift an
 * expiry by a day depending on the server's timezone.
 */

/** Add `months` calendar months to a YYYY-MM-DD date, return YYYY-MM-DD. */
export function addMonthsToDate(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

/**
 * end_date = start_date + months - 1 day (inclusive period).
 *
 * ⚠️ Known edge case, pinned by tests/unit/subscription-dates.test.ts:
 * a month-end start with no equivalent target day (e.g. 2026-01-31 + 1 month)
 * overflows into the following month instead of clamping. Changing this is a
 * billing behaviour change and needs an explicit product decision.
 */
export function computeSubscriptionEndDate(startDate: string, months: number): string {
  const d = new Date(`${startDate}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + months)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** True only for a real, exactly-formatted YYYY-MM-DD calendar date. */
export function isValidIsoDate(dateStr: string): boolean {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr
}
