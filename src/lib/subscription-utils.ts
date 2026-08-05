/** Whether an active subscription is currently expired. */
export function isSubscriptionExpired(sub: { end_date: string }): boolean {
  const today = new Date().toISOString().slice(0, 10)
  return sub.end_date < today
}

/** Whole days between today and end_date (negative when expired). */
export function daysUntilExpiry(endDate: string): number {
  const end = new Date(`${endDate}T00:00:00Z`)
  const now = new Date()
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000)
}
