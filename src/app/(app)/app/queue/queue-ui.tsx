'use client'

import { AlertTriangle, Archive, Clock, HelpCircle } from 'lucide-react'

import { useLanguage } from '@/components/language-provider'

/**
 * Queue rows live in three tables, so the list and the record page share the
 * same vocabulary: a kind (which table) and a pill (how it looks).
 *
 * The pill intentionally mirrors `SyncStatusBadge` in `../logs/log-ui.tsx` — the
 * two list pages must look like one product without either importing the other.
 */
export type QueueKind = 'pending' | 'frozen' | 'orphans' | 'dead'

export const QUEUE_KINDS: QueueKind[] = ['pending', 'frozen', 'orphans', 'dead']

export const isQueueKind = (value: string | null | undefined): value is QueueKind =>
  value === 'pending' || value === 'frozen' || value === 'orphans' || value === 'dead'

/** Short label — used by the status chips and the filter dropdown. */
export function queueKindLabel(kind: QueueKind, ar: boolean): string {
  switch (kind) {
    case 'pending':
      return ar ? 'معلقة' : 'Pending'
    case 'frozen':
      return ar ? 'مجمدة' : 'Frozen'
    case 'orphans':
      return ar ? 'يتيمة' : 'Orphans'
    case 'dead':
      return ar ? 'الأرشيف' : 'Dead'
  }
}

/** Long label — used in the page subtitle of the record view. */
export function queueKindDescription(kind: QueueKind, ar: boolean): string {
  switch (kind) {
    case 'pending':
      return ar ? 'في انتظار الإرسال إلى أودوو' : 'Waiting to be sent to Odoo'
    case 'frozen':
      return ar ? 'استُنفدت المحاولات وتحتاج تدخلاً' : 'Retries exhausted — needs action'
    case 'orphans':
      return ar ? 'وصلت قبل ربط المتجر' : 'Arrived before the store was linked'
    case 'dead':
      return ar ? 'في أرشيف الموتى' : 'In the dead-letter archive'
  }
}

export function queueKindDot(kind: QueueKind): string {
  switch (kind) {
    case 'pending':
      return 'bg-primary'
    case 'frozen':
      return 'bg-destructive'
    case 'orphans':
      return 'bg-amber-500'
    case 'dead':
      return 'bg-muted-foreground'
  }
}

/** Status pill shared by the list (basic columns) and the record page. */
export function QueueStatusBadge({ kind }: { kind: QueueKind }) {
  const { lang } = useLanguage()
  const ar = lang === 'ar'

  switch (kind) {
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
          <Clock className="h-3 w-3" />
          {ar ? 'معلّق' : 'Pending'}
        </span>
      )
    case 'frozen':
      return (
        <span className="inline-flex items-center gap-1 border border-destructive/20 bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
          <AlertTriangle className="h-3 w-3" />
          {ar ? 'مجمّد' : 'Frozen'}
        </span>
      )
    case 'orphans':
      return (
        <span className="inline-flex items-center gap-1 border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
          <HelpCircle className="h-3 w-3" />
          {ar ? 'يتيم' : 'Orphan'}
        </span>
      )
    case 'dead':
      return (
        <span className="inline-flex items-center gap-1 border border-border/60 bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
          <Archive className="h-3 w-3" />
          {ar ? 'أرشيف' : 'Dead'}
        </span>
      )
  }
}

export function queuePlatformLabel(platform: string | null | undefined, ar: boolean): string {
  if (!platform) return '—'
  if (platform === 'zid') return ar ? 'زد (Zid)' : 'Zid'
  if (platform === 'salla') return ar ? 'سلة (Salla)' : 'Salla'
  if (platform === 'shopify') return ar ? 'شوبيفاي (Shopify)' : 'Shopify'
  if (platform === 'odoo') return ar ? 'أودوو (Odoo)' : 'Odoo'
  return platform
}

export function queuePlatformDot(platform: string | null | undefined): string {
  if (platform === 'zid') return 'bg-zid-500'
  if (platform === 'salla') return 'bg-orange-500'
  if (platform === 'shopify') return 'bg-emerald-500'
  if (platform === 'odoo') return 'bg-violet-500'
  return 'bg-muted-foreground'
}

export type QueueEntity = 'product' | 'order' | 'customer' | 'category' | 'other'

/** Queue rows have no entity column — derive it from the event slug. */
export function queueEventEntity(event: string | null | undefined): QueueEntity {
  const e = (event || '').toLowerCase()
  if (e.startsWith('product') || e.startsWith('products/')) return 'product'
  if (e.startsWith('order') || e.startsWith('orders/')) return 'order'
  if (e.startsWith('customer') || e.startsWith('customers/')) return 'customer'
  if (e.startsWith('category') || e.startsWith('collections/')) return 'category'
  return 'other'
}

export function queueEntityLabel(entity: QueueEntity, ar: boolean): string {
  switch (entity) {
    case 'product':
      return ar ? 'منتج' : 'Product'
    case 'order':
      return ar ? 'طلب' : 'Order'
    case 'customer':
      return ar ? 'عميل' : 'Customer'
    case 'category':
      return ar ? 'تصنيف' : 'Category'
    default:
      return ar ? 'أخرى' : 'Other'
  }
}

/**
 * One formatter for both views: the list wants a short stamp, the record page
 * wants the full one. Identical output style to the logs list/detail so the two
 * record pages cannot drift apart.
 */
export function formatQueueDate(
  value: string | null | undefined,
  ar: boolean,
  long = false
): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(ar ? 'ar-EG' : 'en-US', long
    ? {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }
    : {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

/** "منذ 12 د" — the age readout under the chips. */
export function formatQueueAge(sec: number | null | undefined, ar: boolean): string {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '—'
  if (sec < 60) return ar ? `منذ ${sec} ث` : `${sec}s ago`
  const m = Math.round(sec / 60)
  if (m < 60) return ar ? `منذ ${m} د` : `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return ar ? `منذ ${h} س` : `${h}h ago`
  return ar ? `منذ ${Math.round(h / 24)} ي` : `${Math.round(h / 24)}d ago`
}
