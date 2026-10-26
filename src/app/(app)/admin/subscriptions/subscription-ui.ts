/**
 * Presentation rules shared by the admin subscription list and its record page.
 *
 * Plain module (no `'use client'`): the same label must not read differently in
 * the table and on the record, and the money format is the one that ships to the
 * client's statement, so it lives in exactly one place.
 */

const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
]

/**
 * `start_date` / `end_date` are plain `YYYY-MM-DD`, while `created_at` /
 * `paid_at` are timestamps. Both go through here: a bare `new Date('2026-10-25')`
 * is parsed as UTC midnight and then rendered in local time, which shifts the day
 * backwards for anyone west of Greenwich — the explicit `T00:00:00Z` + UTC
 * getters below keep the calendar day that is stored in the database.
 */
export function formatSubDate(value: string | null | undefined, ar: boolean): string {
  if (!value) return '—'
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return value

  if (!dateOnly) {
    return date.toLocaleDateString(ar ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const day = date.getUTCDate()
  const month = date.getUTCMonth()
  const year = date.getUTCFullYear()
  return ar ? `${day} ${MONTHS_AR[month]} ${year}` : `${MONTHS_EN[month]} ${day}, ${year}`
}

export function formatSubDateTime(value: string | null | undefined, ar: boolean): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(ar ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function formatMoney(amount: number | string | null | undefined): string {
  const num = Number(amount) || 0
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export interface SubscriptionStateInput {
  status: string
  isExpired: boolean
  daysRemaining: number
}

export function subscriptionStateMeta(
  state: SubscriptionStateInput,
  ar: boolean,
): { label: string; pill: string; dot: string } {
  if (state.status === 'none') {
    return {
      label: ar ? 'بدون اشتراك' : 'No subscription',
      pill: 'border-border bg-secondary text-muted-foreground',
      dot: 'bg-muted-foreground/30',
    }
  }
  if (state.status === 'cancelled') {
    return {
      label: ar ? 'ملغى' : 'Cancelled',
      pill: 'border-border bg-muted text-muted-foreground',
      dot: 'bg-muted-foreground/50',
    }
  }
  if (state.isExpired) {
    return {
      label: ar ? 'منتهٍ' : 'Expired',
      pill: 'border-destructive/20 bg-destructive/10 text-destructive',
      dot: 'bg-destructive/70',
    }
  }
  if (state.daysRemaining <= 7) {
    return {
      label: ar ? `ينتهي بعد ${state.daysRemaining} يوم` : `Ends in ${state.daysRemaining}d`,
      pill: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
      dot: 'bg-amber-500/70',
    }
  }
  return {
    label: ar ? 'نشط' : 'Active',
    pill: 'border-primary/25 bg-primary/10 text-primary',
    dot: 'bg-primary',
  }
}
