'use client'

import { AlertCircle, CheckCircle2, HelpCircle, Loader2 } from 'lucide-react'

import { useLanguage } from '@/components/language-provider'
import { cn } from '@/lib/utils'

/** Status pill shared by the list (basic columns) and the record page. */
export function SyncStatusBadge({
  status,
  resolvedManually = false,
}: {
  status: string | null
  resolvedManually?: boolean | null
}) {
  const { t, lang } = useLanguage()
  const ar = lang === 'ar'

  if (resolvedManually) {
    return (
      <span className="inline-flex items-center gap-1 border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
        <CheckCircle2 className="h-3 w-3" />
        {t('log.resolvedManually')}
      </span>
    )
  }

  switch (status) {
    case 'success':
      return (
        <span className="inline-flex items-center gap-1 border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">
          <CheckCircle2 className="h-3 w-3" />
          {t('log.success')}
        </span>
      )
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 border border-destructive/20 bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
          <AlertCircle className="h-3 w-3" />
          {t('log.failed')}
        </span>
      )
    case 'skipped':
      return (
        <span className="inline-flex items-center gap-1 border border-border/60 bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
          <HelpCircle className="h-3 w-3" />
          {t('log.skipped')}
        </span>
      )
    case 'processing':
      return (
        <span className="inline-flex items-center gap-1 border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
          <Loader2 className="h-3 w-3 animate-spin" />
          {ar ? 'جاري المزامنة...' : 'Syncing...'}
        </span>
      )
    default:
      return <span className="text-[10px] text-muted-foreground">—</span>
  }
}

/** Manual / automatic trigger pill. */
export function SyncTriggerBadge({ triggerType }: { triggerType: string | null }) {
  const { t } = useLanguage()
  const isManual = triggerType === 'manual'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border px-2 py-0.5 text-[10px] font-bold',
        isManual
          ? 'border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-400'
          : 'border-primary/20 bg-primary/10 text-primary'
      )}
    >
      {isManual ? t('log.manual') : t('log.automatic')}
    </span>
  )
}

/**
 * Success logs are purged after 72h, everything else after 7 days.
 * Shared by the list (as a secondary line) and the record page.
 */
export function getDeletionCountdown(createdAtStr: string | null, status: string | null, ar: boolean): string {
  if (!createdAtStr) return ''
  const createdAt = new Date(createdAtStr).getTime()
  if (Number.isNaN(createdAt)) return ''
  const duration = status === 'success' ? 72 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
  const remainingMs = createdAt + duration - Date.now()
  if (remainingMs <= 0) return ar ? 'جاري الحذف...' : 'Deleting soon...'
  const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000))
  if (remainingHours >= 24) {
    const days = Math.floor(remainingHours / 24)
    const hours = remainingHours % 24
    return ar ? `الحذف بعد: ${days} يوم و ${hours} ساعة` : `Deletes in: ${days}d ${hours}h`
  }
  const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000))
  return ar
    ? `الحذف بعد: ${remainingHours} ساعة و ${minutes} دقيقة`
    : `Deletes in: ${remainingHours}h ${minutes}m`
}

export type LogEntity = 'product' | 'order' | 'customer' | 'category' | 'other'

/** sync_logs has no entity column — derive it from the event slug. */
export function eventEntity(event: string | null): LogEntity {
  const e = (event || '').toLowerCase()
  if (e.startsWith('product') || e.startsWith('products/')) return 'product'
  if (e.startsWith('order') || e.startsWith('orders/')) return 'order'
  if (e.startsWith('customer') || e.startsWith('customers/')) return 'customer'
  if (e.startsWith('category') || e.startsWith('collections/')) return 'category'
  return 'other'
}
