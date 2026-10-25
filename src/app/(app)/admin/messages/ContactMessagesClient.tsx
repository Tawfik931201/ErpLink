'use client'

import {
  Archive,
  ArchiveRestore,
  Building2,
  Check,
  ChevronDown,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  Phone,
  RefreshCw,
} from 'lucide-react'
import { useState } from 'react'

import { getContactMessages, updateContactMessageStatus } from '@/app/actions/contact-messages'
import { Button } from '@/components/ui/button'
import type { ContactMessageRow, ContactMessageStatus } from '@/lib/contact-messages'
import type { Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

type Filter = 'all' | ContactMessageStatus

const PAGE_SIZE = 50

const FILTERS: { value: Filter; labelAr: string; labelEn: string }[] = [
  { value: 'new', labelAr: 'جديدة', labelEn: 'New' },
  { value: 'read', labelAr: 'مقروءة', labelEn: 'Read' },
  { value: 'all', labelAr: 'الكل', labelEn: 'All' },
  { value: 'archived', labelAr: 'مؤرشفة', labelEn: 'Archived' },
]

/**
 * Gregorian calendar + Latin digits on purpose: the admin list is scanned for
 * timestamps, and `ar-SA` alone resolves to Hijri dates, which cannot be
 * compared with the `created_at` values in the database.
 */
const dateLocale = (isAr: boolean) => (isAr ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB')

export default function ContactMessagesClient({
  initialRows,
  initialTotal,
  newCount,
  initialError = null,
  lang,
}: {
  initialRows: ContactMessageRow[]
  initialTotal: number
  newCount: number
  initialError?: string | null
  lang: Language
}) {
  const isAr = lang === 'ar'

  const [filter, setFilter] = useState<Filter>('all')
  const [rows, setRows] = useState<ContactMessageRow[]>(initialRows)
  const [total, setTotal] = useState(initialTotal)
  const [unread, setUnread] = useState(newCount)
  const [expandedId, setExpandedId] = useState<string | null>(null)
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
    setExpandedId(null)
    await load(next)
  }

  async function setStatus(row: ContactMessageRow, status: ContactMessageStatus) {
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

    // Only archiving/restoring removes a row from view. Marking a message read
    // keeps it on screen: in the "new" tab the row you just opened must not
    // vanish under the cursor before you have read it.
    const leavesView =
      (status === 'archived' && filter !== 'archived') ||
      (status !== 'archived' && filter === 'archived')

    setRows((prev) =>
      leavesView
        ? prev.filter((item) => item.id !== row.id)
        : prev.map((item) => (item.id === row.id ? { ...item, status } : item)),
    )
    if (leavesView) setTotal((prev) => Math.max(prev - 1, 0))

    if (status === 'archived') setExpandedId(null)
    setBusyId(null)
  }

  /** Opening a message is the moment it has been read — no second click. */
  function toggleExpanded(row: ContactMessageRow) {
    const next = expandedId === row.id ? null : row.id
    setExpandedId(next)
    if (next && row.status === 'new') {
      void setStatus(row, 'read')
    }
  }

  const formatDate = (value: string) => {
    try {
      return new Date(value).toLocaleString(dateLocale(isAr), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    } catch {
      return value
    }
  }

  const statusMeta = (status: ContactMessageStatus) => {
    if (status === 'new') {
      return { label: isAr ? 'جديدة' : 'New', cls: 'bg-primary/10 text-primary border-primary/20' }
    }
    if (status === 'read') {
      return {
        label: isAr ? 'مقروءة' : 'Read',
        cls: 'bg-secondary text-muted-foreground border-border',
      }
    }
    return {
      label: isAr ? 'مؤرشفة' : 'Archived',
      cls: 'bg-muted text-muted-foreground border-border',
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
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
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold',
              unread > 0
                ? 'border-primary/25 bg-primary/10 text-primary'
                : 'border-border bg-secondary text-muted-foreground',
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
            className="h-8 gap-1.5 px-2.5 text-[11px]"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
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
              'rounded px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
              filter === item.value
                ? 'bg-secondary/80 text-foreground'
                : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
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
          className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-[11px] font-medium text-destructive"
        >
          {error === 'migration_missing' ? (
            isAr ? (
              <>
                جدول الرسائل غير موجود بعد. طبّق الترحيل{' '}
                <span className="font-mono">20261025_contact_messages.sql</span> في محرر SQL
                بسوبابيز، ثم اضغط «تحديث». حتى ذلك الحين تُحفظ الرسائل في أودوو فقط.
              </>
            ) : (
              <>
                The messages table does not exist yet. Apply migration{' '}
                <span className="font-mono">20261025_contact_messages.sql</span> in the Supabase SQL
                editor, then press Refresh. Until then messages are only stored in Odoo.
              </>
            )
          ) : (
            <>
              {isAr ? 'تعذر تنفيذ العملية: ' : 'Operation failed: '}
              {error}
            </>
          )}
        </div>
      )}

      {/* List */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 border border-dashed border-border bg-card px-6 py-14 text-center">
          <MailOpen className="h-6 w-6 text-muted-foreground/50" />
          <p className="text-sm font-semibold">
            {isAr ? 'لا رسائل في هذا التبويب' : 'No messages in this tab'}
          </p>
          <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
            {isAr
              ? 'حين يُرسل أحد النموذج في صفحة «اتصل بنا»، تظهر رسالته هنا مباشرة.'
              : 'When someone submits the contact form, their message appears here.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border border border-border bg-card">
          {rows.map((row) => {
            const meta = statusMeta(row.status)
            const expanded = expandedId === row.id
            const busy = busyId === row.id

            return (
              <li key={row.id} className={cn('transition-colors', expanded && 'bg-secondary/20')}>
                <div className="flex items-start gap-3 px-4 py-3">
                  <span
                    className={cn(
                      'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                      row.status === 'new' ? 'bg-primary' : 'bg-muted-foreground/25',
                    )}
                    aria-hidden
                  />

                  <button
                    type="button"
                    onClick={() => toggleExpanded(row)}
                    className="min-w-0 flex-1 text-start"
                    aria-expanded={expanded}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={cn(
                          'truncate text-sm',
                          row.status === 'new'
                            ? 'font-bold text-foreground'
                            : 'font-semibold text-foreground/85',
                        )}
                      >
                        {row.name}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        · {row.company}
                      </span>
                      <span
                        className={cn('rounded-full border px-1.5 py-0.5 text-[9px] font-bold', meta.cls)}
                      >
                        {meta.label}
                      </span>
                      {row.odoo_ticket_id == null && (
                        <span
                          className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400"
                          title={
                            isAr
                              ? 'لم تُنشأ تذكرة في أودوو لهذه الرسالة'
                              : 'No Odoo ticket was created for this message'
                          }
                        >
                          {isAr ? 'بلا تذكرة' : 'no ticket'}
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        <span dir="ltr">{row.email}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        <span dir="ltr">{row.phone}</span>
                      </span>
                      <span className="font-mono text-[10px]">{formatDate(row.created_at)}</span>
                    </div>

                    {!expanded && (
                      <p className="mt-1.5 line-clamp-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground/80">
                        {row.message}
                      </p>
                    )}
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(row)}
                      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      aria-label={isAr ? 'عرض الرسالة' : 'Show message'}
                    >
                      <ChevronDown
                        className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')}
                      />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setStatus(row, row.status === 'archived' ? 'read' : 'archived')}
                      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                      aria-label={
                        row.status === 'archived'
                          ? isAr
                            ? 'استعادة'
                            : 'Restore'
                          : isAr
                            ? 'أرشفة'
                            : 'Archive'
                      }
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : row.status === 'archived' ? (
                        <ArchiveRestore className="h-3.5 w-3.5" />
                      ) : (
                        <Archive className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="space-y-3 border-t border-border/60 bg-background/40 px-4 py-3">
                    <div className="grid gap-2 text-[11px] sm:grid-cols-3">
                      <div>
                        <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {isAr ? 'البريد' : 'Email'}
                        </p>
                        <a
                          href={`mailto:${row.email}`}
                          dir="ltr"
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {row.email}
                        </a>
                      </div>
                      <div>
                        <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {isAr ? 'الجوال' : 'Phone'}
                        </p>
                        <a
                          href={`tel:${row.phone}`}
                          dir="ltr"
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {row.phone}
                        </a>
                      </div>
                      <div>
                        <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {isAr ? 'الشركة' : 'Company'}
                        </p>
                        <p className="inline-flex items-center gap-1 font-medium">
                          <Building2 className="h-3 w-3 text-muted-foreground" />
                          {row.company}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-card p-3">
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                        {row.message}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="font-mono">
                        {isAr ? 'أودوو:' : 'Odoo:'}{' '}
                        {row.odoo_ticket_id ? `#${row.odoo_ticket_id}` : '—'}
                      </span>
                      <span>·</span>
                      <span>
                        {row.is_new_customer == null
                          ? isAr
                            ? 'تصنيف غير معروف'
                            : 'classification unknown'
                          : row.is_new_customer
                            ? isAr
                              ? 'عميل جديد'
                              : 'new customer'
                            : isAr
                              ? 'عميل مسجّل'
                              : 'existing customer'}
                      </span>
                      {row.read_at && (
                        <>
                          <span>·</span>
                          <span className="font-mono">
                            {isAr ? 'قُرئت ' : 'read '}
                            {formatDate(row.read_at)}
                          </span>
                        </>
                      )}

                      <div className="ms-auto flex items-center gap-1.5">
                        {row.status === 'new' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void setStatus(row, 'read')}
                            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 font-semibold transition-colors hover:bg-secondary disabled:opacity-40"
                          >
                            <Check className="h-3 w-3" />
                            {isAr ? 'مقروءة' : 'Mark read'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void setStatus(row, 'new')}
                            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 font-semibold transition-colors hover:bg-secondary disabled:opacity-40"
                          >
                            <Mail className="h-3 w-3" />
                            {isAr ? 'غير مقروءة' : 'Mark unread'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {rows.length < total && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void load(filter, true)}
            className="h-8 gap-1.5 px-3 text-[11px]"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isAr ? 'تحميل المزيد' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}
