'use client'

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  FileQuestion,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  getQueueItemById,
  replayDeadItem,
  replayOrphanItems,
  retryFrozenItems,
  sendNowWorkspace,
  type QueueItemDetail,
} from '@/app/actions/queue-dashboard'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { hasQueuePayload } from '@/lib/queue-item'
import { cn } from '@/lib/utils'

import { PayloadViewer } from '../../logs/payload-viewer'
import {
  formatQueueDate,
  QueueStatusBadge,
  queueEntityLabel,
  queueEventEntity,
  queueKindDescription,
  queueKindLabel,
  queuePlatformLabel,
} from '../queue-ui'

/**
 * سجلّ صفّ واحد في الطابور، مع **الحمولة الكاملة** كما في `/app/logs`.
 *
 * القراءة عبر `getQueueItemById` وحدها: تجلب الصف كاملاً بحمولته من الجدول
 * الصحيح (طابور / أرشيف / إيصالات) بعد تقييده بمساحة العمل. لا تمسح صفحات
 * القائمة ولا تُنزّل حمولات صفوف لا يفتحها التاجر.
 */
interface ActionResult {
  success?: boolean
  error?: string
  revived?: number
  processed?: number
  succeeded?: number
  retried?: number
  replayed?: number
}

interface LoadResult {
  success?: boolean
  item?: QueueItemDetail
  error?: string
}

function InfoField({
  label,
  children,
  mono = false,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className={cn('mt-1 break-all text-xs text-foreground', mono && 'font-mono')}>{children}</div>
    </div>
  )
}

export default function QueueDetailClient({
  id,
  initialKind,
}: {
  id: string
  initialKind?: string
}) {
  const { lang, dir } = useLanguage()
  const ar = lang === 'ar'
  const router = useRouter()
  const { toast } = useToast()

  const [item, setItem] = useState<QueueItemDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [acting, setActing] = useState(false)
  const [copiedId, setCopiedId] = useState(false)

  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft

  useEffect(() => {
    let alive = true
    setLoading(true)
    setItem(null)
    setLoadError('')
    ;(async () => {
      const res = (await getQueueItemById(id, initialKind)) as LoadResult
      if (!alive) return
      if (res?.success && res.item) setItem(res.item)
      else setLoadError(res?.error || '')
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [id, initialKind])

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 1500)
    } catch {
      toast({
        title: ar ? 'تعذر النسخ' : 'Copy failed',
        description: ar ? 'المتصفح منع الوصول إلى الحافظة.' : 'The browser blocked clipboard access.',
        variant: 'destructive',
      })
    }
  }

  const handleAction = async () => {
    if (!item) return
    const kind = item.kind
    setActing(true)
    try {
      let res: ActionResult | undefined
      if (kind === 'dead') res = (await replayDeadItem(item.id)) as unknown as ActionResult
      else if (kind === 'frozen') res = (await retryFrozenItems()) as unknown as ActionResult
      else if (kind === 'pending') res = (await sendNowWorkspace()) as unknown as ActionResult
      else res = (await replayOrphanItems()) as unknown as ActionResult

      if (res?.success) {
        let description = ''
        if (kind === 'dead') {
          description = ar ? 'أُعيد العنصر إلى طابور الإرسال.' : 'The item was replayed to the queue.'
        } else if (kind === 'frozen') {
          description = ar
            ? `أُعيد ${res.revived ?? 0} صفاً مجمداً إلى الطابور.`
            : `Revived ${res.revived ?? 0} frozen rows.`
        } else if (kind === 'pending') {
          description = ar
            ? `عولج ${res.processed ?? 0} — نجح ${res.succeeded ?? 0} وأُعيدت جدولة ${res.retried ?? 0}.`
            : `Processed ${res.processed ?? 0} — ${res.succeeded ?? 0} succeeded, ${res.retried ?? 0} rescheduled.`
        } else {
          description = ar
            ? `أُعيد ${res.replayed ?? 0} حدثاً يتيم إلى الطابور.`
            : `Replayed ${res.replayed ?? 0} orphaned events.`
        }
        toast({ title: ar ? 'تم' : 'Done', description })
        router.push('/app/queue')
        router.refresh()
      } else {
        toast({
          title: ar ? 'فشل الإجراء' : 'Action failed',
          description: res?.error || (ar ? 'حدث خطأ ما' : 'Something went wrong'),
          variant: 'destructive',
        })
      }
    } catch (err: unknown) {
      toast({
        title: ar ? 'خطأ' : 'Error',
        description: err instanceof Error && err.message
          ? err.message
          : (ar ? 'حدث خطأ ما' : 'Something went wrong'),
        variant: 'destructive',
      })
    } finally {
      setActing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="mb-2 h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground">
          {ar ? 'جارٍ فتح السجل…' : 'Opening record…'}
        </p>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="space-y-4">
        <Link
          href="/app/queue"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <BackIcon className="h-3.5 w-3.5" />
          {ar ? 'العودة إلى الطابور' : 'Back to the queue'}
        </Link>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <FileQuestion className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-xs font-bold text-muted-foreground">
            {ar ? 'العنصر غير موجود' : 'Item not found'}
          </p>
          <p className="mt-1 max-w-sm text-[10px] leading-relaxed text-muted-foreground">
            {loadError && loadError !== 'Not found'
              ? loadError
              : ar
                ? 'قد يكون هذا العنصر قد أُرسل بنجاح، أو استُرجع إلى الطابور، أو حُذف بعد المعالجة.'
                : 'It may have been sent successfully, replayed to the queue, or purged after processing.'}
          </p>
        </div>
      </div>
    )
  }

  const kind = item.kind
  const entityId = item.entity_id || item.original_id || item.dedup_key || ''
  const retries = item.retry_count ?? item.attempts ?? null
  const errorMessage = item.error_message || ''
  const payload = item.payload

  // The store id column is generic; name it after the platform that owns it.
  const itemRefLabel =
    item.platform === 'salla'
      ? (ar ? 'معرف العنصر في سلة' : 'Salla entity ID')
      : item.platform === 'shopify'
        ? (ar ? 'معرف العنصر في شوبيفاي' : 'Shopify entity ID')
        : item.platform === 'zid'
          ? (ar ? 'معرف العنصر في زد' : 'Zid entity ID')
          : (ar ? 'معرف العنصر في المتجر' : 'Store entity ID')

  const timeLabel =
    kind === 'dead'
      ? (ar ? 'تاريخ الأرشفة' : 'Archived at')
      : kind === 'orphans'
        ? (ar ? 'وقت الاستلام' : 'Received at')
        : (ar ? 'تاريخ الإنشاء' : 'Created at')
  const timeValue =
    kind === 'dead' ? item.died_at : kind === 'orphans' ? item.received_at : item.created_at

  const actionLabel =
    kind === 'dead'
      ? (ar ? 'إعادة إرسال' : 'Replay')
      : kind === 'frozen'
        ? (ar ? 'إعادة تشغيل المجمد' : 'Retry frozen')
        : kind === 'pending'
          ? (ar ? 'إرسال الآن' : 'Send now')
          : (ar ? 'استرجاع الأيتام' : 'Replay orphans')

  const actionIsWorkspaceWide = kind !== 'dead'

  return (
    <div className="space-y-5">
      {/* Breadcrumb — the record id is the URL segment, so each item is a page. */}
      <div className="flex items-center gap-1.5 text-[11px]">
        <Link
          href="/app/queue"
          className="inline-flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <BackIcon className="h-3.5 w-3.5" />
          {ar ? 'العودة إلى الطابور' : 'Back to the queue'}
        </Link>
        <span className="text-muted-foreground/30">/</span>
        <span className="font-mono text-foreground/70">{id.slice(0, 8)}</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-bold text-foreground">
              {ar ? 'تفاصيل عنصر الطابور' : 'Queue item details'}
            </h1>
            <QueueStatusBadge kind={kind} />
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="break-all font-mono text-[11px] text-muted-foreground">{item.id}</span>
            <button
              type="button"
              onClick={() => copy(item.id)}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={ar ? 'نسخ رقم العنصر' : 'Copy item id'}
            >
              {copiedId ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {queueKindLabel(kind, ar)} — {queueKindDescription(kind, ar)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleAction}
            disabled={acting}
            className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold"
            title={actionIsWorkspaceWide
              ? (ar ? 'يعمل الإجراء على كل صفوف هذه الحالة في مساحة العمل' : 'This action applies to every row in this state for the workspace')
              : undefined}
          >
            {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {actionLabel}
          </Button>
        </div>
      </div>

      {/* Basic record data */}
      <div className="border border-border bg-card p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <InfoField label={ar ? 'الحدث' : 'Event'} mono>
            {item.event || '—'}
          </InfoField>
          <InfoField label={ar ? 'النوع' : 'Type'}>
            {queueEntityLabel(queueEventEntity(item.event), ar)}
          </InfoField>
          <InfoField label={ar ? 'المنصة' : 'Platform'}>
            {queuePlatformLabel(item.platform, ar)}
          </InfoField>
          <InfoField label={ar ? 'الحالة' : 'Status'}>
            {queueKindLabel(kind, ar)}
          </InfoField>
          <InfoField label={itemRefLabel} mono>
            {entityId || '—'}
          </InfoField>
          <InfoField label={ar ? 'معرف المتجر' : 'Store'} mono>
            {item.store_id || '—'}
          </InfoField>
          <InfoField label={ar ? 'المحاولات' : 'Retries'}>
            {retries ?? '—'}
            {item.max_retries != null ? `/${item.max_retries}` : ''}
          </InfoField>
          <InfoField label={ar ? 'المحاولة القادمة' : 'Next attempt'}>
            {item.next_retry_at ? formatQueueDate(item.next_retry_at, ar, true) : '—'}
          </InfoField>
          <InfoField label={timeLabel}>{formatQueueDate(timeValue, ar, true)}</InfoField>
          {kind === 'orphans' && (
            <InfoField label={ar ? 'مفتاح الإيصال' : 'Dedup key'} mono>
              {item.dedup_key || '—'}
            </InfoField>
          )}
          <InfoField label={ar ? 'رقم العنصر' : 'Item number'} mono>
            {item.id}
          </InfoField>
          {item.original_id && (
            <InfoField label={ar ? 'المعرّف الأصلي' : 'Original id'} mono>
              {item.original_id}
            </InfoField>
          )}
        </div>
      </div>

      {/* Error / reason */}
      {errorMessage && (
        <div
          className={cn(
            'flex items-start gap-2 border p-3 text-xs',
            kind === 'frozen' || kind === 'dead'
              ? 'border-destructive/15 bg-destructive/5 text-destructive'
              : 'border-border bg-muted text-muted-foreground'
          )}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-0.5">
            <div className="font-bold">
              {kind === 'frozen' || kind === 'dead'
                ? (ar ? 'سبب التوقف' : 'Why it stopped')
                : (ar ? 'ملاحظات' : 'Notes')}
            </div>
            <div className="break-all font-mono text-[11px] leading-relaxed opacity-90">{errorMessage}</div>
          </div>
        </div>
      )}

      {/* Full payload — the same viewer as the sync-log record page, so the item
          can be identified (which order, which product, which customer). */}
      {hasQueuePayload(payload) ? (
        <PayloadViewer payload={payload} platform={item.platform} event={item.event} />
      ) : (
        <div className="border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          {ar
            ? 'لا توجد حمولة محفوظة لهذا الصف — بعض الصفوف القديمة كُتبت بلا حمولة كاملة (الحمولة الكاملة في سجل المزامنة بعد المعالجة).'
            : 'No payload stored for this row — some older rows were written without one (the full payload lives in the sync log once processed).'}
        </div>
      )}
    </div>
  )
}
