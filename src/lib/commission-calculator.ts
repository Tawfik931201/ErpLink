export interface CommissionReleaseStats {
  totalMonths: number
  elapsedMonths: number
  releasedAmount: number
  futureAmount: number
}

/**
 * Calculates the portion of a commission that has been released (available)
 * up to the current date, and the portion that remains in the future.
 * 
 * - If today is before the start date, released = 0, future = total.
 * - If today is after the end date, released = total, future = 0.
 * - Otherwise, computes the proportion based on elapsed calendar months.
 */
export function calculateRelease(
  commissionAmount: number | string,
  periodStart: string | Date,
  periodEnd: string | Date,
  now: Date = new Date()
): CommissionReleaseStats {
  const amt = Number(commissionAmount)
  const start = new Date(periodStart)
  const end = new Date(periodEnd)

  if (Number.isNaN(amt) || amt <= 0) {
    return { totalMonths: 1, elapsedMonths: 0, releasedAmount: 0, futureAmount: 0 }
  }

  // 1. Total calendar months in the period (inclusive of start and end month)
  const yDiff = end.getUTCFullYear() - start.getUTCFullYear()
  const mDiff = end.getUTCMonth() - start.getUTCMonth()
  const totalMonths = Math.max(1, yDiff * 12 + mDiff + 1)

  // 2. Elapsed calendar months up to 'now'
  let elapsedMonths = 0
  if (now >= start) {
    if (now > end) {
      elapsedMonths = totalMonths
    } else {
      const eyDiff = now.getUTCFullYear() - start.getUTCFullYear()
      const emDiff = now.getUTCMonth() - start.getUTCMonth()
      elapsedMonths = Math.min(totalMonths, Math.max(1, eyDiff * 12 + emDiff + 1))
    }
  }

  const releasedAmount = Math.round((amt * (elapsedMonths / totalMonths)) * 100) / 100
  const futureAmount = Math.round((amt - releasedAmount) * 100) / 100

  return {
    totalMonths,
    elapsedMonths,
    releasedAmount,
    futureAmount,
  }
}
