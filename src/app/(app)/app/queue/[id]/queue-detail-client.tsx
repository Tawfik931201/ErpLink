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
  getDeadItems,
  getOrphanItems,
  getQueueItems,
  replayDeadItem,
  replayOrphanItems,
  retryFrozenItems,
  sendNowWorkspace,
} from '@/app/actions/queue-dashboard'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import { PayloadViewer } from '../../logs/payload-viewer'
import {
  formatQueueDate,
  isQueueKind,
  QUEUE_KINDS,
  QueueStatusBadge,
  queueEntityLabel,
  queueEventEntity,
  queueKindDescription,
  queueKindLabel,
  queuePlatformLabel,
  type QueueKind,
} from '../queue-ui'

/**
 * The queue row is fetched by id because the list pages are paginated: a row can
 * be on page 7 of its tab, and its URL must still open on its own.
 *
 * Only existing read actions are used — `getQueueItems` / `getDeadItems`
 * (paged) and `getOrphanItems` (single page). The `kind` hint from the list
 * makes the common case one query; a cold URL falls back to scanning the other
 * tables.
 */
const SCAN_PAGE = 100
const SCAN_MAX_PAGES = 3

type ItemRow = {
  id: string
  platform?: string | null
  event?: string | null
  store_id?: string | null
  entity_id?: string | null
  retry_count?: number | null
  max_retries?: number | null
  error_message?: string | null
  next_retry_at?: string | null
  created_at?: string | null
  original_id?: string | null
  died_at?: string | null
  received_at?: string | null
  dedup_key?: string | null
  attempts?: number | null
  payload?: unknown
}

interface ReadResult {
  success?: boolean
  rows?: ItemRow[]
  error?: string
}

interface ActionResult {
  success?: boolean
  error?: string
  revived?: number
  processed?: number
  succeeded?: number
  retried?: number
  replayed?: number
}

interface FoundItem {
  kind: QueueKind
  row: ItemRow
}

async function fetchPage(kind: QueueKind, offset: number): Promise<ItemRow[] | null> {
  if (kind === 'orphans') {
    // `getOrphanItems` has no paging — the receipt list is a single page.
    const res = (await getOrphanItems(SCAN_PAGE)) as unknown as ReadResult
    if (!res.success) return null
    return res.rows || []
  }

  const res = (kind === 'dead'
    ? await getDeadItems({ limit: SCAN_PAGE, offset })
    : await getQueueItems({ kind: kind as 'pending' | 'frozen', limit: SCAN_PAGE, offset })) as unknown as ReadResult
  if (!res.success) return null
  return res.rows || []
}

async function scanKind(kind: QueueKind, id: string): Promise<ItemRow | null> {
  if (kind === 'orphans') {
    const rows = await fetchPage('orphans', 0)
    return rows?.find(r => r.id === id) ?? null
  }

  for (let page = 0; page < SCAN_MAX_PAGES; page++) {
    const rows = await fetchPage(kind, page * SCAN_PAGE)
    if (!rows) return null
    const hit = rows.find(r => r.id === id)
    if (hit) return hit
    // A short page is the last page — stop instead of walking the list.
    if (rows.length < SCAN_PAGE) return null
  }
  return null
}

async function resolveItem(
  id: string,
  hint?: string,
  offsetHint = 0
): Promise<FoundItem | null> {
  // Fast path: the list handed us the tab and the page the row was on.
  if (isQueueKind(hint)) {
    const rows = await fetchPage(hint, hint === 'orphans' ? 0 : offsetHint)
    const hit = rows?.find(r => r.id === id)
    if (hit) return { kind: hint, row: hit }
  }

  const order: QueueKind[] = isQueueKind(hint)
    ? [hint, ...QUEUE_KINDS.filter(k => k !== hint)]
    : [...QUEUE_KINDS]

  for (const kind of order) {
    const row = await scanKind(kind, id)
    if (row) return { kind, row }
  }
  return null
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
  initialOffset = 0,
}: {
  id: string
  initialKind?: string
  initialOffset?: number
}) {
  const { lang, dir } = useLanguage()
  const ar = lang === 'ar'
  const router = useRouter()
  const { toast } = useToast()

  const [item, setItem] = useState<FoundItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [acting, setActing] = useState(false)
  const [copiedId, setCopiedId] = useState(false)

  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft

  useEffect(() => {
    let alive = true
    setLoading(true)
    setItem(null)
    setNotFound(false)
    ;(async () => {
      const found = await resolveItem(id, initialKind, initialOffset)
      if (!alive) return
      if (found) setItem(found)
      else setNotFound(true)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [id, initialKind, initialOffset])

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
      if (kind === 'dead') res = (await replayDeadItem(item.row.id)) as unknown as ActionResult
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

  if (notFound || !item) {
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
            {ar
              ? 'قد يكون هذا العنصر قد أُرسل بنجاح، أو استُرجع إلى الطابور، أو حُذف بعد المعالجة.'
              : 'It may have been sent successfully, replayed to the queue, or purged after processing.'}
          </p>
        </div>
      </div>
    )
  }

  const { kind, row } = item
  const entityId = row.entity_id || row.original_id || row.dedup_key || ''
  const retries = row.retry_count ?? row.attempts ?? null
  const errorMessage = row.error_message || ''
  const payload = row.payload
  const hasPayload =
    payload !== null && payload !== undefined &&
    (typeof payload !== 'object' || Object.keys(payload as Record<string, unknown>).length > 0)

  // The store id column is generic; name it after the platform that owns it.
  const itemRefLabel =
    row.platform === 'salla'
      ? (ar ? 'معرف العنصر في سلة' : 'Salla entity ID')
      : row.platform === 'shopify'
        ? (ar ? 'معرف العنصر في شوبيفاي' : 'Shopify entity ID')
        : row.platform === 'zid'
          ? (ar ? 'معرف العنصر في زد' : 'Zid entity ID')
          : (ar ? 'معرف العنصر في المتجر' : 'Store entity ID')

  const timeLabel =
    kind === 'dead'
      ? (ar ? 'تاريخ الأرشفة' : 'Archived at')
      : kind === 'orphans'
        ? (ar ? 'وقت الاستلام' : 'Received at')
        : (ar ? 'تاريخ الإنشاء' : 'Created at')
  const timeValue =
    kind === 'dead' ? row.died_at : kind === 'orphans' ? row.received_at : row.created_at

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
            <span className="break-all font-mono text-[11px] text-muted-foreground">{row.id}</span>
            <button
              type="button"
              onClick={() => copy(row.id)}
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

        <div className="flex items-center gap-2">
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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <InfoField label={ar ? 'الحدث' : 'Event'} mono>
            {row.event || '—'}
          </InfoField>
          <InfoField label={ar ? 'النوع' : 'Type'}>
            {queueEntityLabel(queueEventEntity(row.event), ar)}
          </InfoField>
          <InfoField label={ar ? 'المنصة' : 'Platform'}>
            {queuePlatformLabel(row.platform, ar)}
          </InfoField>
          <InfoField label={ar ? 'الحالة' : 'Status'}>
            {queueKindLabel(kind, ar)}
          </InfoField>
          <InfoField label={itemRefLabel} mono>
            {entityId || '—'}
          </InfoField>
          <InfoField label={ar ? 'معرف المتجر' : 'Store'} mono>
            {row.store_id || '—'}
          </InfoField>
          <InfoField label={ar ? 'المحاولات' : 'Retries'}>
            {retries ?? '—'}
            {row.max_retries != null ? `/${row.max_retries}` : ''}
          </InfoField>
          <InfoField label={ar ? 'المحاولة القادمة' : 'Next attempt'}>
            {row.next_retry_at ? formatQueueDate(row.next_retry_at, ar, true) : '—'}
          </InfoField>
          <InfoField label={timeLabel}>{formatQueueDate(timeValue, ar, true)}</InfoField>
          {kind === 'orphans' && (
            <InfoField label={ar ? 'مفتاح الإيصال' : 'Dedup key'} mono>
              {row.dedup_key || '—'}
            </InfoField>
          )}
          <InfoField label={ar ? 'رقم العنصر' : 'Item number'} mono>
            {row.id}
          </InfoField>
          {row.original_id && (
            <InfoField label={ar ? 'المعرّف الأصلي' : 'Original id'} mono>
              {row.original_id}
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

      {/* Payload — available for receipts (orphans); the queue/dead reads used
          by this screen do not expose it, and the sync log keeps it after sync. */}
      {hasPayload ? (
        <PayloadViewer payload={payload} platform={row.platform} event={row.event} />
      ) : (
        <div className="border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          {ar
            ? 'الحمولة الكاملة (payload) تظهر في سجل المزامنة بعد معالجة العنصر.'
            : 'The full payload appears in the sync log once the item is processed.'}
        </div>
      )}
    </div>
  )
}
