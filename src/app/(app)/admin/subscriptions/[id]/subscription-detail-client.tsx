'use client'

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  Check,
  Copy,
  CreditCard,
  Loader2,
  XCircle,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  cancelSubscription,
  extendSubscription,
  type SubscriptionDetail,
} from '@/app/actions/subscription-actions'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import {
  formatMoney,
  formatSubDate,
  formatSubDateTime,
  subscriptionStateMeta,
} from '../subscription-ui'

function InfoField({
  label,
  children,
  mono = false,
  wide = false,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
  wide?: boolean
}) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className={cn('mt-1 break-words text-xs text-foreground', mono && 'font-mono')}>
        {children}
      </div>
    </div>
  )
}

const inputCls =
  'w-full h-8 rounded border border-border bg-background px-3 text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'

export default function SubscriptionDetailClient({
  detail,
  ar,
}: {
  detail: SubscriptionDetail
  ar: boolean
}) {
  const { subscription: sub, workspace, client, payments, history, totals } = detail

  const router = useRouter()
  const { toast } = useToast()

  const [status, setStatus] = useState(sub.status)
  const [extending, setExtending] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [months, setMonths] = useState(sub.isExpired ? 0 : 1)
  const [days, setDays] = useState(0)
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const state = subscriptionStateMeta(
    { status, isExpired: sub.isExpired, daysRemaining: sub.daysRemaining },
    ar,
  )
  const BackIcon = ar ? ArrowRight : ArrowLeft

  async function copyId() {
    try {
      await navigator.clipboard.writeText(sub.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast({
        title: ar ? 'تعذر النسخ' : 'Copy failed',
        description: ar
          ? 'المتصفح منع الوصول إلى الحافظة.'
          : 'The browser blocked clipboard access.',
        variant: 'destructive',
      })
    }
  }

  async function submitExtend(event: React.FormEvent) {
    event.preventDefault()
    if (months <= 0 && days <= 0) {
      setError(ar ? 'أدخل عدد الشهور أو الأيام' : 'Enter months or days')
      return
    }

    setBusy(true)
    setError(null)
    const result = await extendSubscription({
      subscriptionId: sub.id,
      months: months > 0 ? months : undefined,
      days: days > 0 ? days : undefined,
      amountPaid: Number(amount) || 0,
      notes: notes || null,
    })

    if (!result.success) {
      setError(
        ('message' in result && result.message) ||
          result.error ||
          (ar ? 'تعذر التمديد' : 'Extension failed'),
      )
      setBusy(false)
      return
    }

    toast({
      title: ar ? 'تم التمديد' : 'Extended',
      description: ar ? 'حُدّث تاريخ الانتهاء وسُجّلت الدفعة.' : 'End date updated and payment recorded.',
    })
    setExtending(false)
    setNotes('')
    setAmount('')
    setBusy(false)
    router.refresh()
  }

  async function doCancel() {
    setBusy(true)
    setError(null)
    const result = await cancelSubscription({ subscriptionId: sub.id })

    if (!result.success) {
      setError(result.error || (ar ? 'تعذر الإلغاء' : 'Cancellation failed'))
      setBusy(false)
      return
    }

    toast({
      title: ar ? 'أُلغي الاشتراك' : 'Subscription cancelled',
      description: ar
        ? 'الحالة الآن ملغاة، وتاريخ الانتهاء بقي كما هو (هو المصدر).'
        : 'Status is now cancelled; the end date is unchanged and remains the source of truth.',
    })
    setStatus('cancelled')
    setConfirmCancel(false)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="space-y-5">
      {/* Breadcrumb — the record id is the URL segment, so each subscription has its own page. */}
      <div className="flex items-center gap-1.5 text-[11px]">
        <Link
          href="/admin/subscriptions"
          className="inline-flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <BackIcon className="h-3.5 w-3.5" />
          {ar ? 'العودة إلى الاشتراكات' : 'Back to subscriptions'}
        </Link>
        <span className="text-muted-foreground/30">/</span>
        <span className="font-mono text-foreground/70">{sub.id.slice(0, 8)}</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-bold text-foreground">
              {workspace?.name || client?.name || (ar ? 'اشتراك' : 'Subscription')}
            </h1>
            <span
              className={cn(
                'inline-flex items-center border px-2 py-0.5 text-[10px] font-bold',
                state.pill,
              )}
            >
              {state.label}
            </span>
            {sub.archived_at && (
              <span className="inline-flex items-center border border-border bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                {ar ? 'مؤرشف في الكشف' : 'Hidden from statement'}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            {workspace?.subscription_number && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {workspace.subscription_number}
              </span>
            )}
            <span className="break-all font-mono text-[11px] text-muted-foreground/70">
              {sub.id}
            </span>
            <button
              type="button"
              onClick={() => void copyId()}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={ar ? 'نسخ المعرّف' : 'Copy ID'}
            >
              {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status === 'active' && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setExtending((prev) => !prev)
                setConfirmCancel(false)
                setError(null)
              }}
              className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              {ar ? 'تمديد' : 'Extend'}
            </Button>
          )}
          {status === 'active' && !sub.isExpired && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setConfirmCancel(true)
                setExtending(false)
                setError(null)
              }}
              className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold text-destructive"
            >
              <XCircle className="h-3.5 w-3.5" />
              {ar ? 'إلغاء' : 'Cancel'}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-[11px] font-medium text-destructive"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Extend — inline form, because the record page is where the numbers live. */}
      {extending && (
        <form onSubmit={submitExtend} className="space-y-3 border border-border bg-card p-4">
          <p className="text-[11px] font-bold text-foreground">
            {ar ? 'تمديد الاشتراك' : 'Extend subscription'}
          </p>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {sub.isExpired
              ? ar
                ? 'الاشتراك منتهٍ: التمديد بالأيام يبدأ من اليوم، والأشهر تتطلب تسجيل اشتراك جديد.'
                : 'Subscription expired: days extend from today, months require a new registration.'
              : ar
                ? 'تُضاف الشهور على تاريخ الانتهاء الحالي، ثم تُضاف الأيام بعده.'
                : 'Months are added to the current end date, then days on top.'}
          </p>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {ar ? 'شهور' : 'Months'}
              </label>
              <input
                type="number"
                min={0}
                max={120}
                value={months}
                onChange={(event) => setMonths(Math.max(0, Number(event.target.value) || 0))}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {ar ? 'أيام' : 'Days'}
              </label>
              <input
                type="number"
                min={0}
                max={3650}
                value={days}
                onChange={(event) => setDays(Math.max(0, Math.min(3650, Number(event.target.value) || 0)))}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {ar ? 'المبلغ (USD)' : 'Amount (USD)'}
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {ar ? 'ملاحظات' : 'Notes'}
              </label>
              <input
                type="text"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {Number(amount) === 0 && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              {ar
                ? 'تنبيه: بمبلغ 0 لن تُسجل أي دفعة عن فترة التمديد.'
                : 'Note: with amount 0 no payment is recorded for the extension.'}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setExtending(false)}
              className="h-7 rounded-none px-3 text-[10px]"
            >
              {ar ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={busy}
              className="h-7 gap-1 rounded-none px-3 text-[10px] font-bold"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CalendarPlus className="h-3 w-3" />}
              {ar ? 'تنفيذ التمديد' : 'Extend'}
            </Button>
          </div>
        </form>
      )}

      {confirmCancel && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-destructive/30 bg-destructive/[0.06] px-4 py-3">
          <p className="text-[11px] font-medium text-destructive">
            {ar
              ? 'إلغاء الاشتراك يوقف حالة «نشط» ولا يغيّر تاريخ الانتهاء. متابعة؟'
              : 'Cancelling stops the “active” status and does not change the end date. Continue?'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirmCancel(false)}
              className="h-7 rounded-none px-3 text-[10px]"
            >
              {ar ? 'رجوع' : 'Back'}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void doCancel()}
              className="h-7 gap-1 rounded-none bg-destructive px-3 text-[10px] font-bold text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
              {ar ? 'تأكيد الإلغاء' : 'Confirm'}
            </Button>
          </div>
        </div>
      )}

      {/* Basic record data */}
      <div className="border border-border bg-card p-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <InfoField label={ar ? 'العميل' : 'Client'}>
            {client?.name || '—'}
            {client?.email && (
              <a
                href={`mailto:${client.email}`}
                dir="ltr"
                className="mt-0.5 block truncate font-mono text-[10px] text-primary underline-offset-4 hover:underline"
              >
                {client.email}
              </a>
            )}
          </InfoField>
          <InfoField label={ar ? 'مساحة العمل' : 'Workspace'}>
            {workspace?.name || '—'}
          </InfoField>
          <InfoField label={ar ? 'رقم الاشتراك' : 'Subscription no.'} mono>
            {workspace?.subscription_number || '—'}
          </InfoField>
          <InfoField label={ar ? 'الحالة' : 'Status'}>{state.label}</InfoField>

          <InfoField label={ar ? 'تاريخ البداية' : 'Start date'}>
            {formatSubDate(sub.start_date, ar)}
          </InfoField>
          <InfoField label={ar ? 'تاريخ النهاية' : 'End date'}>
            {formatSubDate(sub.end_date, ar)}
          </InfoField>
          <InfoField label={ar ? 'الشهور المدفوعة' : 'Months paid'} mono>
            {sub.months_paid}
          </InfoField>
          <InfoField label={ar ? 'المتبقي' : 'Remaining'}>
            {sub.isExpired
              ? ar
                ? 'انتهى'
                : 'Expired'
              : ar
                ? `${sub.daysRemaining} يوم`
                : `${sub.daysRemaining} days`}
          </InfoField>

          <InfoField label={ar ? 'إجمالي amount_paid' : 'Total on record'}>
            {formatMoney(sub.amount_paid)} {sub.currency}
          </InfoField>
          <InfoField label={ar ? 'إجمالي الدفعات المسجّلة' : 'Sum of payments'}>
            {formatMoney(totals.paid)} {sub.currency}
            <span className="ms-1 text-[10px] text-muted-foreground">
              ({totals.payments_count} {ar ? 'دفعة' : 'payments'})
            </span>
          </InfoField>
          <InfoField label={ar ? 'تاريخ التسجيل' : 'Created'}>
            {formatSubDateTime(sub.created_at, ar)}
          </InfoField>
          <InfoField label={ar ? 'آخر تحديث' : 'Updated'}>
            {formatSubDateTime(sub.updated_at, ar)}
          </InfoField>

          <InfoField label={ar ? 'أنشأه (أدمن)' : 'Created by (admin)'} mono>
            {sub.created_by || '—'}
          </InfoField>
          <InfoField label={ar ? 'مؤرشف' : 'Archived'}>
            {sub.archived_at ? formatSubDateTime(sub.archived_at, ar) : '—'}
          </InfoField>
          <InfoField label={ar ? 'المعرّف' : 'Record ID'} mono wide>
            {sub.id}
          </InfoField>

          <InfoField label={ar ? 'ملاحظات' : 'Notes'} wide>
            {sub.notes ? (
              <span className="whitespace-pre-wrap">{sub.notes}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </InfoField>
        </div>
      </div>

      {/* Payments */}
      <div className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground">
            <CreditCard className="h-3 w-3" />
            {ar ? 'الدفعات' : 'Payments'}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {formatMoney(totals.paid)} {sub.currency}
          </span>
        </div>

        {payments.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            {ar ? 'لا توجد دفعات مسجّلة لهذا الاشتراك.' : 'No payments recorded for this subscription.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-foreground/70">
                  <th className="px-3 py-2 text-start font-bold">{ar ? 'التاريخ' : 'Date'}</th>
                  <th className="px-3 py-2 text-start font-bold">{ar ? 'المبلغ' : 'Amount'}</th>
                  <th className="px-3 py-2 text-start font-bold">{ar ? 'ملاحظات' : 'Notes'}</th>
                  <th className="px-3 py-2 text-start font-bold">{ar ? 'سجّلها' : 'Recorded by'}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {formatSubDate(payment.paid_at, ar)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-foreground">
                      {formatMoney(payment.amount)} {payment.currency}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{payment.notes || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-[10px] text-muted-foreground">
                      {payment.created_by || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Other subscriptions on the same workspace */}
      <div className="border border-border bg-card">
        <div className="border-b border-border bg-muted px-3 py-1.5">
          <span className="text-[10px] font-bold text-muted-foreground">
            {ar ? 'اشتراكات أخرى على نفس المساحة' : 'Other subscriptions on this workspace'}
          </span>
        </div>

        {history.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            {ar ? 'لا يوجد سجل اشتراكات آخر.' : 'No other subscriptions.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-foreground/70">
                  <th className="px-3 py-2 text-start font-bold">{ar ? 'البداية' : 'Start'}</th>
                  <th className="px-3 py-2 text-start font-bold">{ar ? 'النهاية' : 'End'}</th>
                  <th className="px-3 py-2 text-start font-bold">{ar ? 'الشهور' : 'Months'}</th>
                  <th className="px-3 py-2 text-start font-bold">{ar ? 'المبلغ' : 'Amount'}</th>
                  <th className="px-3 py-2 text-start font-bold">{ar ? 'الحالة' : 'Status'}</th>
                  <th className="w-8 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {history.map((row) => {
                  const rowState = subscriptionStateMeta(row, ar)
                  return (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        <Link href={`/admin/subscriptions/${row.id}`} className="block">
                          {formatSubDate(row.start_date, ar)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        <Link href={`/admin/subscriptions/${row.id}`} className="block">
                          {formatSubDate(row.end_date, ar)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-muted-foreground">
                        <Link href={`/admin/subscriptions/${row.id}`} className="block">
                          {row.months_paid}
                        </Link>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-foreground">
                        <Link href={`/admin/subscriptions/${row.id}`} className="block">
                          {formatMoney(row.amount_paid)} {row.currency}
                        </Link>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link href={`/admin/subscriptions/${row.id}`} className="block">
                          <span
                            className={cn(
                              'inline-flex items-center border px-2 py-0.5 text-[10px] font-bold',
                              rowState.pill,
                            )}
                          >
                            {rowState.label}
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-end text-muted-foreground">
                        <Link href={`/admin/subscriptions/${row.id}`} className="block">
                          <ArrowRight className={cn('inline h-3.5 w-3.5', !ar && 'rotate-180')} />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
