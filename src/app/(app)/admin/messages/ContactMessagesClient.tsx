'use client'

import {
  Archive,
  ArchiveRestore,
  Check,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  MoreHorizontal,
  RefreshCw,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { getContactMessages, updateContactMessageStatus } from '@/app/actions/contact-messages'
import { Button } from '@/components/ui/button'
import type { ContactMessageListRow, ContactMessageStatus } from '@/lib/contact-messages'
import type { Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

import { contactStatusMeta, formatContactDate } from './message-ui'

type Filter = 'all' | ContactMessageStatus

const PAGE_SIZE = 50

const FILTERS: { value: Filter; labelAr: string; labelEn: string }[] = [
  { value: 'new', labelAr: 'جديدة', labelEn: 'New' },
  { value: 'read', labelAr: 'مقروءة', labelEn: 'Read' },
  { value: 'all', labelAr: 'الكل', labelEn: 'All' },
  { value: 'archived', labelAr: 'مؤرشفة', labelEn: 'Archived' },
]

export default function ContactMessagesClient({
  initialRows,
  initialTotal,
  newCount,
  initialError = null,
  lang,
}: {
  initialRows: ContactMessageListRow[]
  initialTotal: number
  newCount: number
  initialError?: string | null
  lang: Language
}) {
  const isAr = lang === 'ar'
  const router = useRouter()

  const [filter, setFilter] = useState<Filter>('all')
  const [rows, setRows] = useState<ContactMessageListRow[]>(initialRows)
  const [total, setTotal] = useState(initialTotal)
  const [unread, setUnread] = useState(newCount)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  async function load(nextFilter: Filter, append = false) {
    setLoading(true)
    setError(null)

    const offset = append ? rows.length : 0
    const result = await getContactMessages({ status: nextFilter, limit: PAGE_SIZE, offset })

    if (!result.success) {
      setError(result.error || 'load_failed')
      setLoading(false)
      return
    }

    setRows((prev) => (append ? [...prev, ...result.rows] : result.rows))
    setTotal(result.total)
    setLoading(false)
  }

  async function changeFilter(next: Filter) {
    setFilter(next)
    await load(next)
  }

  function openMessage(id: string) {
    router.push(`/admin/messages/${id}`)
  }

  async function setStatus(row: ContactMessageListRow, status: ContactMessageStatus) {
    setBusyId(row.id)
    setError(null)

    const result = await updateContactMessageStatus(row.id, status)
    if (!result.success) {
      setError(result.error || 'update_failed')
      setBusyId(null)
      return
    }

    const wasNew = row.status === 'new'
    const isNew = status === 'new'
    if (wasNew && !isNew) setUnread((prev) => Math.max(prev - 1, 0))
    if (!wasNew && isNew) setUnread((prev) => prev + 1)

    // Only archiving/restoring moves a row out of the tab you are looking at.
    // Marking a message read keeps it in place: a row must not disappear from
    // the "new" tab the moment you touch it.
    const leavesView =
      (status === 'archived' && filter !== 'archived') ||
      (status !== 'archived' && filter === 'archived')

    setRows((prev) =>
      leavesView
        ? prev.filter((item) => item.id !== row.id)
        : prev.map((item) => (item.id === row.id ? { ...item, status } : item)),
    )
    if (leavesView) setTotal((prev) => Math.max(prev - 1, 0))

    setBusyId(null)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-base font-bold text-foreground">
            <Inbox className="h-4 w-4 text-muted-foreground" />
            {isAr ? 'رسائل نموذج التواصل' : 'Contact form messages'}
          </h1>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {isAr
              ? 'كل رسالة تُرسل من صفحة «اتصل بنا» تُحفظ هنا أولاً، ثم تُحوّل إلى تذكرة في أودوو.'
              : 'Every message from the contact page is saved here first, then turned into an Odoo ticket.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 border px-2.5 py-1 text-[10px] font-bold',
              unread > 0
                ? 'border-primary/25 bg-primary/10 text-primary'
                : 'border-border bg-muted text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                unread > 0 ? 'bg-primary' : 'bg-muted-foreground/40',
              )}
            />
            {unread > 0
              ? isAr
                ? `${unread} غير مقروءة`
                : `${unread} unread`
              : isAr
                ? 'لا جديد'
                : 'nothing new'}
          </span>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load(filter)}
            disabled={loading}
            className="h-7 gap-1.5 rounded-none px-2.5 text-[10px] font-bold"
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
            {isAr ? 'تحديث' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => void changeFilter(item.value)}
            className={cn(
              'border px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
              filter === item.value
                ? 'border-border bg-muted/60 text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground',
            )}
          >
            {isAr ? item.labelAr : item.labelEn}
          </button>
        ))}
        <span className="ms-auto font-mono text-[10px] text-muted-foreground">
          {total} {isAr ? 'رسالة' : 'messages'}
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-[11px] font-medium text-destructive"
        >
          {isAr ? 'تعذر الاتصال بصندوق الدعم في أودوو: ' : 'Odoo support inbox unavailable: '}
          {error}
        </div>
      )}

      {/* Odoo-style list: a header row and clean records, no cell borders. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-y border-border bg-muted/60 text-[10px] uppercase tracking-wide text-foreground/70">
              <th className="w-6 px-2 py-2.5" />
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                {isAr ? 'الاسم' : 'Name'}
              </th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                {isAr ? 'الشركة' : 'Company'}
              </th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                {isAr ? 'البريد' : 'Email'}
              </th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                {isAr ? 'الحالة' : 'Status'}
              </th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                {isAr ? 'تذكرة أودوو' : 'Odoo ticket'}
              </th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                {isAr ? 'التاريخ' : 'Date'}
              </th>
              <th className="w-10 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`skeleton-${i}`}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="px-2 py-3">
                        <div className="h-3 animate-pulse bg-muted/60" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => {
                  const meta = contactStatusMeta(row.status, isAr)
                  return (
                    <tr
                      key={row.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => openMessage(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          openMessage(row.id)
                        }
                      }}
                      className="cursor-pointer transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
                    >
                      <td className="px-2 py-2.5">
                        <span className={cn('block h-1.5 w-1.5 rounded-full', meta.dot)} aria-hidden />
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <span
                          className={cn(
                            'block max-w-[180px] truncate',
                            row.status === 'new'
                              ? 'font-bold text-foreground'
                              : 'font-medium text-foreground/85',
                          )}
                        >
                          {row.name}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap text-muted-foreground">
                        <span className="block max-w-[160px] truncate">{row.company}</span>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <span
                          dir="ltr"
                          className="block max-w-[200px] truncate font-mono text-foreground/80"
                        >
                          {row.email}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <span
                          className={cn(
                            'inline-flex items-center border px-2 py-0.5 text-[10px] font-bold',
                            meta.cls,
                          )}
                        >
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        {row.odoo_ticket_id == null ? (
                          <span
                            className="inline-flex items-center border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400"
                            title={
                              isAr
                                ? 'لم تُنشأ تذكرة في أودوو لهذه الرسالة'
                                : 'No Odoo ticket was created for this message'
                            }
                          >
                            {isAr ? 'بلا تذكرة' : 'no ticket'}
                          </span>
                        ) : (
                          <span className="font-mono text-foreground/80">
                            #{row.odoo_ticket_id}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap text-muted-foreground">
                        {formatContactDate(row.created_at, isAr)}
                      </td>
                      <td className="px-2 py-2.5 text-end">
                        <RowActions
                          row={row}
                          isAr={isAr}
                          busy={busyId === row.id}
                          onOpen={() => openMessage(row.id)}
                          onStatus={(status) => void setStatus(row, status)}
                        />
                      </td>
                    </tr>
                  )
                })}
          </tbody>
        </table>

        {!loading && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <MailOpen className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-xs font-bold text-muted-foreground">
              {isAr ? 'لا رسائل في هذا التبويب' : 'No messages in this tab'}
            </p>
            <p className="mt-1 max-w-xs text-[10px] leading-relaxed text-muted-foreground">
              {isAr
                ? 'حين يُرسل أحد النموذج في صفحة «اتصل بنا»، يظهر صفّه هنا مباشرة.'
                : 'When someone submits the contact form, its row appears here.'}
            </p>
          </div>
        )}

        {loading && rows.length > 0 && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {rows.length < total && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void load(filter, true)}
            className="h-7 gap-1.5 rounded-none px-3 text-[10px] font-bold"
          >
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            {isAr ? 'تحميل المزيد' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * The per-row action menu. It stops the click from bubbling, because the whole
 * row is a link to the record: an action must never navigate.
 */
function RowActions({
  row,
  isAr,
  busy,
  onOpen,
  onStatus,
}: {
  row: ContactMessageListRow
  isAr: boolean
  busy: boolean
  onOpen: () => void
  onStatus: (status: ContactMessageStatus) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onDocumentClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onDocumentClick)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onDocumentClick)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  const item = (onClick: () => void, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        setOpen(false)
        onClick()
      }}
      className="flex w-full items-center gap-2 px-3 py-2 text-start text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )

  return (
    <div className="relative flex justify-end" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={isAr ? 'إجراءات' : 'Actions'}
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((prev) => !prev)
        }}
        className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div
          role="menu"
          onClick={(event) => event.stopPropagation()}
          className="absolute end-0 top-full z-50 mt-1 w-40 border border-border bg-card py-1 shadow-card"
        >
          {item(onOpen, <MailOpen className="h-3.5 w-3.5" />, isAr ? 'فتح الرسالة' : 'Open message')}

          {row.status === 'new'
            ? item(() => onStatus('read'), <Check className="h-3.5 w-3.5" />, isAr ? 'مقروءة' : 'Mark read')
            : item(() => onStatus('new'), <Mail className="h-3.5 w-3.5" />, isAr ? 'غير مقروءة' : 'Mark unread')}

          {row.status === 'archived'
            ? item(
                () => onStatus('read'),
                <ArchiveRestore className="h-3.5 w-3.5" />,
                isAr ? 'استعادة' : 'Restore',
              )
            : item(
                () => onStatus('archived'),
                <Archive className="h-3.5 w-3.5" />,
                isAr ? 'أرشفة' : 'Archive',
              )}
        </div>
      )}
    </div>
  )
}
