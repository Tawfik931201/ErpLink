import type { ContactMessageStatus } from '@/lib/contact-messages'

/**
 * Presentation rules shared by the list and the record page.
 *
 * Plain module on purpose: both surfaces are client components and both must
 * agree on the label, the colour and the date format, or the same message would
 * read differently depending on where you look at it.
 */

/**
 * Gregorian calendar + Latin digits even in Arabic. The admin panel is scanned
 * for timestamps, and a bare `ar-SA` resolves to Hijri dates, which cannot be
 * compared with a `created_at` value in the database.
 */
const arDateLocale = 'ar-SA-u-ca-gregory-nu-latn'

export function formatContactDate(
  value: string | null | undefined,
  ar: boolean,
  withTime = true,
): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString(ar ? arDateLocale : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  })
}

export function contactStatusMeta(
  status: ContactMessageStatus,
  ar: boolean,
): { label: string; cls: string; dot: string } {
  if (status === 'new') {
    return {
      label: ar ? 'جديدة' : 'New',
      cls: 'border-primary/25 bg-primary/10 text-primary',
      dot: 'bg-primary',
    }
  }
  if (status === 'read') {
    return {
      label: ar ? 'مقروءة' : 'Read',
      cls: 'border-border bg-secondary text-muted-foreground',
      dot: 'bg-muted-foreground/50',
    }
  }
  return {
    label: ar ? 'مؤرشفة' : 'Archived',
    cls: 'border-border bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground/30',
  }
}

/** `unknown` is a real state: Odoo may not have answered at all. */
export function customerKindLabel(isNewCustomer: boolean | null, ar: boolean): string {
  if (isNewCustomer == null) return ar ? 'غير معروف' : 'Unknown'
  return isNewCustomer ? (ar ? 'عميل جديد' : 'New customer') : ar ? 'عميل مسجّل' : 'Existing customer'
}
