'use client'

import {
  AlertCircle,
  Archive,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  archiveQueueItems,
  getDeadItems,
  getOrphanItems,
  getQueueArchives,
  getQueueItems,
  getQueueOverview,
  replayAllDeadItems,
  replayOrphanItems,
  restoreQueueArchive,
  retryFrozenItems,
  sendNowWorkspace,
  type QueueArchiveRow,
  type QueueRow,
} from '@/app/actions/queue-dashboard'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { queueArchiveDaysLeft } from '@/lib/queue-archive'
import { cn } from '@/lib/utils'

import {
  formatQueueDate,
  QUEUE_KINDS,
  QueueStatusBadge,
  queueKindDot,
  queueKindLabel,
  queuePlatformDot,
  queuePlatformLabel,
  type QueueKind,
} from './queue-ui'

const LIMIT = 20

type Row = QueueRow & {
  original_id?: string | null
  died_at?: string | null
  received_at?: string | null
  dedup_key?: string | null
  attempts?: number | null
  payload?: unknown
}

interface QueueOverview {
  pending: number | null
  frozen: number | null
  orphans: number | null | undefined
  dead: number | null
  archived: number | null | undefined
}

/**
 * طابور الإرسال — نفس تصميم شاشة السجلات (Odoo-style list):
 * شرائح حالة + أزرار على نفس الصف ⇒ جدول بلا حدود خلايا ⇒ ترقيم صفحات،
 * وكل صف يفتح سجلّه الخاص على `/app/queue/<id>`.
 *
 * الأرشفة: الصف لا يُحذف مباشرة — يُنسخ إلى `queue_archives` ثم يُحذف من
 * مصدره، ويبقى قابلاً للاستعادة 7 أيام (يظهر داخل تبويب «الأرشيف»).
 */
export default function QueueClient() {
  const { lang, dir } = useLanguage()
  const ar = lang === 'ar'
  const router = useRouter()

  const [overview, setOverview] = useState<QueueOverview | null>(null)
  const [kind, setKind] = useState<QueueKind>('pending')
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [replaying, setReplaying] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)

  /** الصفوف المحدَّدة — معرّفات الجدول المعروض فقط (التبويب الواحد). */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [archives, setArchives] = useState<QueueArchiveRow[]>([])

  const [notice, setNotice] = useState('')
  const [noticeIsError, setNoticeIsError] = useState(false)

  const notify = (text: string, isError = false) => {
    setNotice(text)
    setNoticeIsError(isError)
  }

  async function loadTab(t: QueueKind, offsetToUse: number): Promise<{ rows: Row[]; total: number }> {
    if (t === 'pending' || t === 'frozen') {
      const res = await getQueueItems({ kind: t, limit: LIMIT, offset: offsetToUse })
      if (!res.success) {
        notify(res.error || '', true)
        return { rows: [], total: 0 }
      }
      return { rows: (res.rows || []) as Row[], total: res.totalCount || 0 }
    }
    if (t === 'orphans') {
      const res = await getOrphanItems(LIMIT)
      if (!res.success) {
        notify(res.error || '', true)
        return { rows: [], total: 0 }
      }
      return { rows: (res.rows || []) as Row[], total: res.totalCount || 0 }
    }
    const res = await getDeadItems({ limit: LIMIT, offset: offsetToUse })
    if (!res.success) {
      notify(res.error || '', true)
      return { rows: [], total: 0 }
    }
    return { rows: (res.rows || []) as Row[], total: res.totalCount || 0 }
  }

  async function loadOverview() {
    const ov = await getQueueOverview()
    if (ov.success) setOverview((ov.overview ?? null) as QueueOverview | null)
    else notify(ov.error || '', true)
  }

  /** الأرشيف اليدوي يُعرض داخل تبويب «الأرشيف» فقط — لا تبويب خامس. */
  async function loadArchives() {
    const res = await getQueueArchives(100)
    if (res.success) setArchives((res.rows || []) as QueueArchiveRow[])
    else setArchives([])
  }

  async function fetchAt(t: QueueKind, offsetToUse: number, clearNotice = true) {
    setLoading(true)
    if (clearNotice) setNotice('')
    // يتيمة لا تدعم ترقيم صفحات حقيقياً (تُقرأ بدفعة واحدة).
    const safeOffset = t === 'orphans' ? 0 : Math.max(0, offsetToUse)
    const items = await loadTab(t, safeOffset)
    setRows(items.rows)
    setTotal(items.total)
    setOffset(safeOffset)
    setSelected(new Set())
    if (t === 'dead') await loadArchives()
    else setArchives([])
    setLoading(false)
  }

  useEffect(() => {
    loadOverview()
    fetchAt('pending', 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function switchKind(t: QueueKind) {
    if (t === kind) return
    setKind(t)
    await fetchAt(t, 0)
  }

  async function refreshAll() {
    await loadOverview()
    await fetchAt(kind, offset)
  }

  /** Reload after an action without wiping the message that explains it. */
  async function afterMutation(text: string) {
    await loadOverview()
    await fetchAt(kind, 0, false)
    notify(text)
  }

  async function handleSendNow() {
    setSending(true)
    setNotice('')
    const res = await sendNowWorkspace()
    setSending(false)
    if (res.success && 'processed' in res) {
      if (res.processed === 0 && (overview?.frozen ?? 0) > 0) {
        notify(
          ar
            ? `لا توجد طلبات معلقة (لديك ${overview?.frozen} طلبات في قسم "مجمدة" — اضغط زر "إعادة تشغيل المجمد" لإعادتها للطابور).`
            : `No pending items (you have ${overview?.frozen} items in "Frozen" — click "Retry frozen" to revive them).`
        )
        await fetchAt(kind, offset, false)
        return
      }
      await afterMutation(
        ar
          ? `تم: عولج ${res.processed} — نجح ${res.succeeded} وأُعيدت جدولة ${res.retried}.`
          : `Done: processed ${res.processed} — ${res.succeeded} succeeded, ${res.retried} rescheduled.`
      )
    } else {
      notify(res.error || '', true)
    }
  }

  async function handleRetryFrozen() {
    setRetrying(true)
    setNotice('')
    const res = await retryFrozenItems()
    setRetrying(false)
    if (res.success && 'revived' in res) {
      await afterMutation(ar ? `أُعيد ${res.revived} صفاً مجمداً إلى الطابور.` : `Revived ${res.revived} frozen rows.`)
    } else {
      notify(res.error || '', true)
    }
  }

  async function handleReplayAllDead() {
    if (!confirm(ar ? 'إعادة إرسال كل الطلبات في الأرشيف إلى الطابور؟' : 'Replay every dead-lettered item to the queue?')) return
    setReplaying('all')
    const res = await replayAllDeadItems(100)
    setReplaying(null)
    if (res.success) {
      await afterMutation(ar ? `أُعيد ${res.replayed} طلباً إلى الطابور.` : `Replayed ${res.replayed} items to the queue.`)
    } else {
      notify(res.error || '', true)
    }
  }

  async function handleReplayOrphans() {
    setReplaying('orphans')
    const res = await replayOrphanItems()
    setReplaying(null)
    if (res.success) {
      await afterMutation(ar ? `أُعيد ${res.replayed} حدثاً يتيم إلى الطابور.` : `Replayed ${res.replayed} orphaned events.`)
    } else {
      notify(res.error || '', true)
    }
  }

  /** أرشفة صف واحد أو المحدَّد — نسخة كاملة تبقى 7 أيام ثم تُحذف. */
  async function handleArchive(ids: string[]) {
    const list = ids.filter(Boolean)
    if (list.length === 0) return
    const message = ar
      ? `أرشفة ${list.length} عنصر؟\n\nسيخرج من الطابور فوراً ولن يُرسل إلى أودوو. تبقى نسخة كاملة في الأرشيف 7 أيام (قابلة للاستعادة)، ثم تُحذف نهائياً تلقائياً.\n\nأرشِف فقط ما تعرف أنه مكرر أو أُرسل سابقاً.`
      : `Archive ${list.length} item(s)?\n\nThey leave the queue immediately and will not be sent to Odoo. A full copy stays in the archive for 7 days (restorable), then is permanently deleted automatically.\n\nArchive only what you know is a duplicate or was already sent.`
    if (!confirm(message)) return

    setArchiving(true)
    setNotice('')
    const res = await archiveQueueItems(list.map((id) => ({ id, kind })))
    setArchiving(false)

    if (res.success && 'archived' in res) {
      setSelected(new Set())
      await afterMutation(
        ar
          ? `أُرشف ${res.archived} عنصر — يمكن استعادته من تبويب "الأرشيف" خلال 7 أيام.`
          : `Archived ${res.archived} item(s) — restorable from the "Archive" tab for 7 days.`
      )
    } else {
      notify(res.error || (ar ? 'فشلت الأرشفة' : 'Archive failed'), true)
    }
  }

  async function handleRestore(archiveId: string) {
    const message = ar
      ? 'استعادة هذا العنصر إلى الطابور؟ سيُرسل إلى أودوو في الدورة القادمة.'
      : 'Restore this item to the queue? It will be sent to Odoo on the next run.'
    if (!confirm(message)) return

    setRestoring(archiveId)
    const res = await restoreQueueArchive(archiveId)
    setRestoring(null)
    if (res.success) {
      setSelected(new Set())
      await loadOverview()
      await loadArchives()
      notify(ar ? 'أُعيد العنصر إلى الطابور.' : 'The item was restored to the queue.')
    } else {
      notify(('error' in res && res.error) || (ar ? 'فشلت الاستعادة' : 'Restore failed'), true)
    }
  }

  const counts: Record<QueueKind, number | null | undefined> = {
    pending: overview?.pending,
    frozen: overview?.frozen,
    orphans: overview?.orphans,
    // تبويب «الأرشيف» يعرض أرشيف الموتى + ما أرشفه التاجر يدوياً.
    dead:
      overview?.dead == null && overview?.archived == null
        ? null
        : (overview?.dead ?? 0) + (overview?.archived ?? 0),
  }
  const frozenCount = overview?.frozen ?? 0
  const orphanCount = overview?.orphans ?? 0

  const openItem = (id: string) => {
    // `kind` is only a hint: the record page falls back to the other tables, so
    // a direct URL still opens. The record itself is fetched by id, not from the
    // list page, so paging does not have to be reproduced there.
    router.push(`/app/queue/${id}?kind=${kind}`)
  }

  const pageIds = rows.map((r) => r.id)
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const someOnPageSelected = pageIds.some((id) => selected.has(id))
  const selectedCount = selected.size

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllOnPage = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })
  }

  const isFirstPage = offset === 0
  const isLastPage = kind === 'orphans' || offset + rows.length >= total
  const PrevIcon = dir === 'rtl' ? ChevronRight : ChevronLeft
  const NextIcon = dir === 'rtl' ? ChevronLeft : ChevronRight
  const OpenIcon = dir === 'rtl' ? ChevronLeft : ChevronRight
  const tabColSpan = 9

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-foreground">
          {ar ? 'طابور الإرسال إلى أودوو' : 'Odoo Send Queue'}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {ar
            ? 'كل طلب وصلك من المتجر يظهر هنا حتى يُسجَّل في أودوو — لا شيء يضيع بصمت.'
            : 'Every store order appears here until registered in Odoo — nothing is lost silently.'}
        </p>
      </div>

      {notice && (
        <div
          className={cn(
            'border px-3 py-2 text-xs',
            noticeIsError
              ? 'border-destructive/20 bg-destructive/5 text-destructive'
              : 'border-border bg-card text-foreground'
          )}
        >
          {notice}
        </div>
      )}

      {/* Status chips + every action on the same row. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {QUEUE_KINDS.map(k => {
          const isActive = kind === k
          return (
            <button
              key={k}
              type="button"
              onClick={() => switchKind(k)}
              className={cn(
                'inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] transition-colors',
                isActive
                  ? 'border-foreground/30 bg-muted/60 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted/40'
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', queueKindDot(k))} />
              <span className="font-medium">{queueKindLabel(k, ar)}</span>
              <span className="font-bold tabular-nums text-foreground">{counts[k] ?? '—'}</span>
            </button>
          )
        })}

        <div className="ms-auto flex flex-wrap items-center gap-1.5">
          {kind === 'dead' && total > 1 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleReplayAllDead}
              disabled={replaying === 'all'}
              className="h-7 rounded-none px-3 text-[10px] font-bold"
            >
              {replaying === 'all'
                ? (ar ? 'جارٍ…' : 'Working…')
                : (ar ? `إعادة إرسال الكل (${total})` : `Replay all (${total})`)}
            </Button>
          )}
          {frozenCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRetryFrozen}
              disabled={retrying}
              className="h-7 rounded-none px-3 text-[10px] font-bold"
            >
              {retrying
                ? (ar ? 'جارٍ…' : 'Working…')
                : (ar ? `إعادة تشغيل المجمد (${frozenCount})` : `Retry frozen (${frozenCount})`)}
            </Button>
          )}
          {orphanCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleReplayOrphans}
              disabled={replaying === 'orphans'}
              className="h-7 rounded-none px-3 text-[10px] font-bold"
            >
              {replaying === 'orphans'
                ? (ar ? 'جارٍ…' : 'Working…')
                : (ar ? `استرجاع الأيتام (${orphanCount})` : `Replay orphans (${orphanCount})`)}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => refreshAll()}
            disabled={loading}
            className="h-7 rounded-none px-3 text-[10px] font-bold"
          >
            {/* No spin: the list greys out while loading, the icon stays still. */}
            <RefreshCw className="h-3 w-3 me-1" />
            {ar ? 'تحديث' : 'Refresh'}
          </Button>
          <Button
            size="sm"
            onClick={handleSendNow}
            disabled={sending}
            className="h-7 rounded-none px-3 text-[10px] font-bold"
          >
            {sending ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : (ar ? 'إرسال الآن' : 'Send now')}
          </Button>
        </div>
      </div>

      {/* Selection bar — only while something is ticked. */}
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 border border-border bg-muted/40 px-3 py-2">
          <span className="text-[11px] font-bold text-foreground">
            {ar ? `محدَّد: ${selectedCount}` : `Selected: ${selectedCount}`}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleArchive([...selected])}
            disabled={archiving}
            className="h-7 rounded-none px-3 text-[10px] font-bold"
          >
            <Archive className="h-3 w-3 me-1" />
            {archiving
              ? (ar ? 'جارٍ الأرشفة…' : 'Archiving…')
              : (ar ? `أرشفة المحدد (${selectedCount})` : `Archive selected (${selectedCount})`)}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
            disabled={archiving}
            className="h-7 rounded-none px-2 text-[10px] font-bold text-muted-foreground"
          >
            <X className="h-3 w-3 me-1" />
            {ar ? 'إلغاء التحديد' : 'Clear'}
          </Button>
          <span className="text-[10px] text-muted-foreground">
            {ar
              ? 'الأرشفة تُخرج العنصر من الطابور وتُبقيه 7 أيام قابلاً للاستعادة.'
              : 'Archiving removes the item from the queue and keeps it restorable for 7 days.'}
          </span>
        </div>
      )}

      {/* Manually archived rows live in the Archive tab (7-day window). */}
      {kind === 'dead' && archives.length > 0 && (
        <div className="border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/70">
              {ar ? 'مؤرشف يدوياً — يُحذف نهائياً بعد 7 أيام' : 'Archived by hand — deleted after 7 days'}
            </span>
            <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{archives.length}</span>
          </div>
          <ul className="divide-y divide-border">
            {archives.map((a) => {
              const daysLeft = queueArchiveDaysLeft(a.expires_at)
              const ref = a.entity_id || a.original_id || a.source_id
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11px]"
                >
                  <span className="inline-flex items-center gap-1 border border-border bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                    <Archive className="h-3 w-3" />
                    {ar ? 'مؤرشف' : 'Archived'}
                  </span>
                  <span className="max-w-[220px] truncate font-mono font-semibold text-foreground" title={a.event || ''}>
                    {a.event || '—'}
                  </span>
                  <span className="max-w-[200px] truncate font-mono text-muted-foreground" dir="ltr" title={ref}>
                    {ref}
                  </span>
                  <span className="text-muted-foreground">{formatQueueDate(a.archived_at, ar)}</span>
                  <span
                    className={cn(
                      'tabular-nums',
                      daysLeft === 0 ? 'text-destructive' : 'text-muted-foreground'
                    )}
                  >
                    {daysLeft === null
                      ? '—'
                      : ar
                        ? `يُحذف بعد ${daysLeft} يوم`
                        : `${daysLeft}d left`}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRestore(a.id)}
                    disabled={restoring === a.id}
                    className="ms-auto h-6 rounded-none px-2 text-[10px] font-bold"
                  >
                    <RotateCcw className="h-3 w-3 me-1" />
                    {restoring === a.id
                      ? (ar ? 'جارٍ…' : 'Working…')
                      : (ar ? 'استعادة' : 'Restore')}
                  </Button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Odoo-style list: a header row and clean records, no cell borders. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-y border-border bg-muted/60 text-[10px] uppercase tracking-wide text-foreground/70">
              <th className="w-8 px-2 py-2.5 text-start">
                <input
                  type="checkbox"
                  aria-label={ar ? 'تحديد كل ما في الصفحة' : 'Select all on this page'}
                  checked={allOnPageSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someOnPageSelected && !allOnPageSelected
                  }}
                  onChange={toggleAllOnPage}
                  disabled={rows.length === 0}
                  className="h-3.5 w-3.5 cursor-pointer accent-foreground disabled:opacity-40"
                />
              </th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{ar ? 'الحالة' : 'Status'}</th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{ar ? 'المنصة' : 'Platform'}</th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{ar ? 'الحدث' : 'Event'}</th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{ar ? 'العنصر' : 'Item'}</th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{ar ? 'المحاولات' : 'Retries'}</th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{ar ? 'السبب / الخطأ' : 'Reason / error'}</th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{ar ? 'الوقت' : 'Time'}</th>
              <th className="w-16 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`skeleton-${i}`}>
                    {Array.from({ length: tabColSpan }).map((__, j) => (
                      <td key={j} className="px-2 py-3">
                        <div className="h-3 bg-muted/60 animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map(row => {
                  const itemRef = row.entity_id || row.original_id || row.dedup_key || ''
                  const retries = row.retry_count ?? row.attempts ?? null
                  const stamp = row.created_at ?? row.received_at ?? row.died_at ?? null
                  const isChecked = selected.has(row.id)
                  return (
                    <tr
                      key={row.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => openItem(row.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openItem(row.id)
                        }
                      }}
                      className={cn(
                        'cursor-pointer transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none',
                        isChecked && 'bg-muted/50'
                      )}
                    >
                      <td className="px-2 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={ar ? 'تحديد العنصر' : 'Select item'}
                          checked={isChecked}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleRow(row.id)}
                          className="h-3.5 w-3.5 cursor-pointer accent-foreground"
                        />
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <QueueStatusBadge kind={kind} />
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={cn('h-1.5 w-1.5 rounded-full', queuePlatformDot(row.platform))} />
                          {queuePlatformLabel(row.platform, ar)}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <div
                          className="max-w-[220px] truncate font-mono font-semibold text-foreground"
                          title={row.event || ''}
                        >
                          {row.event || '—'}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <div
                          className="max-w-[200px] truncate font-mono text-muted-foreground"
                          dir="ltr"
                          title={itemRef}
                        >
                          {itemRef || '—'}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground">
                        {retries ?? '—'}
                        {row.max_retries != null ? `/${row.max_retries}` : ''}
                      </td>
                      <td className="px-2 py-2.5">
                        <div
                          className="max-w-[260px] truncate text-muted-foreground"
                          title={row.error_message || ''}
                        >
                          {row.error_message || '—'}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap text-muted-foreground">
                        {formatQueueDate(stamp, ar)}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleArchive([row.id])
                            }}
                            disabled={archiving}
                            title={ar ? 'أرشفة (تُستعاد خلال 7 أيام)' : 'Archive (restorable for 7 days)'}
                            aria-label={ar ? 'أرشفة العنصر' : 'Archive item'}
                            className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </button>
                          <OpenIcon className="h-3.5 w-3.5 inline-block text-muted-foreground" />
                        </div>
                      </td>
                    </tr>
                  )
                })}
          </tbody>
        </table>

        {!loading && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <AlertCircle className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-xs font-bold text-muted-foreground">
              {kind === 'pending'
                ? (ar ? 'لا عناصر — كل شيء مرسل.' : 'Empty — everything is sent.')
                : (ar ? 'لا عناصر في هذا القسم.' : 'Nothing in this view.')}
            </p>
            <p className="mt-1 max-w-xs text-[10px] leading-relaxed text-muted-foreground">
              {kind === 'pending'
                ? (ar
                    ? 'سيظهر هنا أي طلب قادم من المتجر حتى يُسجَّل في أودوو.'
                    : 'Any store event will appear here until it is registered in Odoo.')
                : kind === 'frozen'
                  ? (ar
                      ? 'لا صفوف استُنفدت محاولاتها — وهذا هو الوضع الطبيعي.'
                      : 'No row has exhausted its retries — that is the normal state.')
                  : kind === 'orphans'
                    ? (ar
                        ? 'لا إيصالات بلا مساحة عمل لهذه المتاجر.'
                        : 'No receipts without a workspace for these stores.')
                    : (ar
                        ? 'أرشيف الموتى فارغ — لم يُستنفد أي طلب نهائياً.'
                        : 'The dead-letter archive is empty — nothing was exhausted.')}
            </p>
          </div>
        )}

        {loading && rows.length > 0 && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-[10px] text-muted-foreground font-semibold">
            {ar ? `إجمالي العناصر: ${total}` : `Total items: ${total}`}
          </span>
          <div className="flex items-center gap-2 border border-border bg-card p-1 text-xs font-medium">
            <span className="px-2 text-muted-foreground select-none font-mono">
              {offset + 1}-{Math.min(offset + rows.length, total)} / {total}
            </span>
            <div className="flex items-center gap-0.5 border-e border-border pe-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => fetchAt(kind, Math.max(0, offset - LIMIT))}
                disabled={isFirstPage || loading}
                className="h-7 w-7 rounded-none hover:bg-muted text-muted-foreground disabled:opacity-40"
                title={ar ? 'الصفحة السابقة' : 'Previous page'}
              >
                <PrevIcon className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => fetchAt(kind, offset + LIMIT)}
                disabled={isLastPage || loading}
                className="h-7 w-7 rounded-none hover:bg-muted text-muted-foreground disabled:opacity-40"
                title={ar ? 'الصفحة التالية' : 'Next page'}
              >
                <NextIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
