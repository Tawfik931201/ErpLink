'use client'

import {
  AlertCircle,
  Archive,
  Banknote,
  CalendarPlus,
  CheckCircle2,
  Eye,
  Loader2,
  Printer,
  Receipt,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  addSubscriptionPayment,
  archiveSubscription,
  cancelSubscription,
  detectAffiliateForClient,
  extendSubscription,
  registerSubscription,
  restoreSubscription,
  type AffiliatePick,
  type ClientStatementPayment,
  type ClientStatementSubscription,
} from '@/app/actions/subscription-actions'
import { cn } from '@/lib/utils'

interface Props {
  lang: string
  userId: string
  clientEmail: string
  workspaces: { id: string; name: string; subscription_number: string | null }[]
  subscriptions: ClientStatementSubscription[]
  payments: ClientStatementPayment[]
  affiliates: AffiliatePick[]
}

type Modal =
  | { type: 'register' }
  | { type: 'extend'; sub: ClientStatementSubscription }
  | { type: 'cancel'; sub: ClientStatementSubscription }
  | { type: 'details'; sub: ClientStatementSubscription }
  | { type: 'addPayment'; sub: ClientStatementSubscription }
  | null

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const inputCls =
  'w-full h-8 rounded border border-border bg-background px-3 text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
const actionBtn =
  'inline-flex items-center gap-1.5 rounded border border-border bg-background px-2 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40'

export default function ClientStatementClient({
  lang,
  userId,
  clientEmail,
  workspaces,
  subscriptions,
  payments,
  affiliates,
}: Props) {
  const router = useRouter()
  const isAr = lang === 'ar'
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  const [tab, setTab] = useState<'subscriptions' | 'payments'>('subscriptions')
  const [modal, setModal] = useState<Modal>(null)
  const [busy, setBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null)

  // Register / renew form
  const [workspaceId, setWorkspaceId] = useState('')
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [affiliateId, setAffiliateId] = useState('')
  const [autoAffiliate, setAutoAffiliate] = useState<AffiliatePick | null>(null)
  const [manualAffiliate, setManualAffiliate] = useState(false)
  const [detectingAffiliate, setDetectingAffiliate] = useState(false)
  const [startDate, setStartDate] = useState(today())
  const [months, setMonths] = useState(1)
  const [amount, setAmount] = useState('')
  const [cancelExisting, setCancelExisting] = useState(false)
  const [notes, setNotes] = useState('')

  // Extend form
  const [extMonths, setExtMonths] = useState(1)
  const [extAmount, setExtAmount] = useState('')
  const [extNotes, setExtNotes] = useState('')

  // Payment form
  const [paySubscriptionId, setPaySubscriptionId] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(today())
  const [payNotes, setPayNotes] = useState('')

  useEffect(() => {
    let cancelled = false
    setDetectingAffiliate(true)
    detectAffiliateForClient({ userId, workspaceId: workspaceId || null }).then((res) => {
      if (cancelled) return
      setDetectingAffiliate(false)
      if (res.success && res.affiliate) {
        setAutoAffiliate(res.affiliate)
        if (!manualAffiliate) setAffiliateId(res.affiliate!.id)
      } else {
        setAutoAffiliate(null)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, manualAffiliate])

  const openRegister = (sub?: ClientStatementSubscription | null) => {
    const targetWs = sub
      ? workspaces.find((w) => w.id === sub.workspace_id)
      : workspaces[0]
    setWorkspaceId(targetWs?.id ?? '')
    setNewWorkspaceName('')
    setAffiliateId(sub?.affiliate_id || '')
    setManualAffiliate(false)
    setStartDate(today())
    setMonths(1)
    setAmount('')
    setCancelExisting(false)
    setNotes('')
    setModalError(null)
    setModal({ type: 'register' })
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId && !newWorkspaceName.trim()) {
      setModalError(isAr ? 'اختر مساحة عمل أو اكتب اسم مساحة جديدة' : 'Choose a workspace or enter a new workspace name')
      return
    }
    setBusy(true)
    setModalError(null)
    const res = await registerSubscription({
      clientEmail,
      workspaceId: workspaceId || null,
      newWorkspaceName: newWorkspaceName.trim() || null,
      affiliateId: affiliateId || null,
      startDate,
      monthsPaid: months,
      amountPaid: Number(amount) || 0,
      cancelExisting,
      notes: notes || null,
    })
    if (res.success) {
      setModal(null)
      router.refresh()
    } else {
      setModalError(res.message || res.error || 'error')
    }
    setBusy(false)
  }

  async function handleExtend(e: React.FormEvent) {
    e.preventDefault()
    if (!modal || modal.type !== 'extend') return
    setBusy(true)
    setModalError(null)
    const res = await extendSubscription({
      subscriptionId: modal.sub.id,
      months: extMonths,
      amountPaid: Number(extAmount) || 0,
      notes: extNotes || null,
    })
    if (res.success) {
      setModal(null)
      router.refresh()
    } else {
      setModalError(res.error || 'error')
    }
    setBusy(false)
  }

  async function handleCancel() {
    if (!modal || (modal.type !== 'cancel' && modal.type !== 'details')) return
    setBusy(true)
    setModalError(null)
    const res = await cancelSubscription({ subscriptionId: modal.sub.id })
    if (res.success) {
      setModal(null)
      router.refresh()
    } else {
      setModalError(res.error || 'error')
    }
    setBusy(false)
  }

  async function handleAddPayment(e: React.FormEvent) {
    e.preventDefault()
    if (!paySubscriptionId) {
      setModalError(isAr ? 'اختر الاشتراك' : 'Select a subscription')
      return
    }
    if (!(Number(payAmount) > 0)) {
      setModalError(isAr ? 'أدخل مبلغ الدفعة' : 'Enter the payment amount')
      return
    }
    setBusy(true)
    setModalError(null)
    const res = await addSubscriptionPayment({
      subscriptionId: paySubscriptionId,
      amount: Number(payAmount),
      paidAt: payDate,
      notes: payNotes || null,
    })
    if (res.success) {
      setModal(null)
      router.refresh()
    } else {
      setModalError(res.error || 'error')
    }
    setBusy(false)
  }

  const openAddPayment = (sub: ClientStatementSubscription) => {
    setPaySubscriptionId(sub.id)
    setPayAmount('')
    setPayDate(today())
    setPayNotes('')
    setModalError(null)
    setModal({ type: 'addPayment', sub })
  }

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '—'
    try {
      return new Date(`${d}T00:00:00Z`).toLocaleDateString(isAr ? 'ar-SA' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return d
    }
  }

  const fmtMoney = (n: number | string) =>
    `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const subStatus = (sub: ClientStatementSubscription) => {
    if (sub.status === 'cancelled') {
      return { text: isAr ? 'ملغى' : 'Cancelled', cls: 'text-muted-foreground' }
    }
    if (sub.isExpired) {
      return { text: isAr ? 'منتهٍ' : 'Expired', cls: 'text-red-600' }
    }
    if (sub.daysRemaining <= 7) {
      return { text: isAr ? `ينتهي بعد ${sub.daysRemaining} يوم` : `Ends in ${sub.daysRemaining}d`, cls: 'text-amber-600' }
    }
    return { text: isAr ? 'نشط' : 'Active', cls: 'text-emerald-600' }
  }

  const isActionable = (sub: ClientStatementSubscription) => sub.status === 'active' && !sub.isExpired

  const archivedSubs = subscriptions.filter((s) => s.archived_at)
  const visibleSubs = showArchived ? subscriptions : subscriptions.filter((s) => !s.archived_at)

  async function handleArchive(sub: ClientStatementSubscription) {
    setArchiveBusyId(sub.id)
    setModalError(null)
    const res = sub.archived_at
      ? await restoreSubscription({ subscriptionId: sub.id })
      : await archiveSubscription({ subscriptionId: sub.id })
    if (res.success) {
      router.refresh()
    } else {
      setModalError(res.error || 'error')
    }
    setArchiveBusyId(null)
  }

  const paymentsBySub = (subId: string) => payments.filter((p) => p.subscription_id === subId)
  const paymentsTotal = (subId: string) =>
    paymentsBySub(subId).reduce((s, p) => s + Number(p.amount), 0)
  const detailSub = modal?.type === 'details' || modal?.type === 'addPayment' ? modal.sub : null

  return (
    <div className="max-w-6xl mx-auto space-y-4" dir={dir}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            {isAr ? 'كشف حساب العميل' : 'Client Statement'}
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
            {isAr
              ? 'جميع الاشتراكات والدفعات المسجلة لهذا العميل — يمكن التجديد أو التمديد أو إضافة دفعة من هنا.'
              : 'All subscriptions and payments for this client — renew, extend, or add a payment here.'}
          </p>
        </div>
        <button
          onClick={() => openRegister()}
          className="inline-flex items-center gap-1.5 rounded border border-foreground/20 bg-background px-2.5 h-8 text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
        >
          <CalendarPlus className="h-3 w-3" />
          {isAr ? 'إضافة اشتراك جديد / تجديد' : 'Add / Renew Subscription'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 p-1 bg-muted/40 rounded border border-border/50 w-fit">
          <button
            onClick={() => setTab('subscriptions')}
            className={cn(
              'px-3 py-1.5 rounded text-[11px] font-medium transition-colors',
              tab === 'subscriptions' ? 'bg-card text-foreground border border-border' : 'text-muted-foreground',
            )}
          >
            {isAr ? 'الاشتراكات' : 'Subscriptions'} ({visibleSubs.length})
          </button>
          <button
            onClick={() => setTab('payments')}
            className={cn(
              'px-3 py-1.5 rounded text-[11px] font-medium transition-colors',
              tab === 'payments' ? 'bg-card text-foreground border border-border' : 'text-muted-foreground',
            )}
          >
            {isAr ? 'الدفعات' : 'Payments'} ({payments.length})
          </button>
        </div>
        {archivedSubs.length > 0 && (
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded border px-2.5 h-7 text-[11px] font-medium transition-colors',
              showArchived
                ? 'border-foreground/20 bg-background text-foreground'
                : 'border-border bg-background text-muted-foreground hover:text-foreground',
            )}
          >
            <Archive className="h-3 w-3" />
            {isAr
              ? `${showArchived ? 'إخفاء المؤرشفة' : `إظهار المؤرشفة (${archivedSubs.length})`}`
              : `${showArchived ? 'Hide archived' : `Show archived (${archivedSubs.length})`}`}
          </button>
        )}
      </div>

      {/* ── Subscriptions table ────────────────────────────── */}
      {tab === 'subscriptions' && (
        <div className="border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/30">
            <span className="text-[11px] font-medium text-foreground">{isAr ? 'سجل الاشتراكات' : 'Subscription History'}</span>
            <span className="text-[11px] text-muted-foreground">{visibleSubs.length}</span>
          </div>

          {visibleSubs.length === 0 ? (
            <div className="px-6 py-16 text-center text-xs text-muted-foreground">
              <CalendarPlus className="h-5 w-5 mx-auto mb-2 opacity-40" />
              {isAr ? 'لا توجد اشتراكات مسجلة لهذا العميل بعد — سجل اشتراكاً جديداً.' : 'No subscriptions recorded for this client yet — register a new one.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'الحالة' : 'Status'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'المساحة / الرقم' : 'Workspace / Sub #'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'البداية' : 'Start'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'النهاية' : 'End'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'الشهور' : 'Months'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'المبلغ الإجمالي' : 'Total Amount'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'الأفلييت' : 'Affiliate'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'فاتورة' : 'Invoice'}</th>
                    <th className="px-3 py-2 text-end font-medium">{isAr ? 'إجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSubs.map((sub) => {
                    const st = subStatus(sub)
                    return (
                      <tr
                        key={sub.id}
                        className={cn(
                          'border-b border-border/50 transition-colors hover:bg-muted/30',
                          sub.archived_at && 'opacity-50',
                        )}
                      >
                        <td className="px-3 py-2.5">
                          <span className={cn('font-semibold whitespace-nowrap', st.cls)}>{st.text}</span>
                          {sub.archived_at && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                              <Archive className="h-2.5 w-2.5" />
                              {isAr ? 'مؤرشف' : 'Archived'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-foreground">{sub.workspace_name || '—'}</p>
                          {sub.subscription_number && (
                            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{sub.subscription_number}</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{formatDate(sub.start_date)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{formatDate(sub.end_date)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{sub.months_paid}</td>
                        <td className="px-3 py-2.5 font-mono font-semibold text-foreground whitespace-nowrap">
                          {fmtMoney(sub.amount_paid)} {sub.currency}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{sub.affiliate_name || '—'}</td>
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/invoice/${sub.id}`}
                            className={cn(actionBtn, 'whitespace-nowrap')}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Printer className="h-3 w-3" />
                            {isAr ? 'الفاتورة' : 'Invoice'}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => {
                                setModalError(null)
                                setModal({ type: 'details', sub })
                              }}
                              className={actionBtn}
                            >
                              <Eye className="h-3 w-3" />
                              {isAr ? 'تفاصيل' : 'Details'}
                            </button>
                            {!sub.archived_at && !isActionable(sub) && (
                              <button
                                onClick={() => handleArchive(sub)}
                                disabled={archiveBusyId === sub.id}
                                title={isAr ? 'أرشفة الاشتراك القديم (إخفاؤه من الكشف)' : 'Archive old subscription (hide from statement)'}
                                className={actionBtn}
                              >
                                {archiveBusyId === sub.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Archive className="h-3 w-3" />
                                )}
                                {isAr ? 'أرشفة' : 'Archive'}
                              </button>
                            )}
                            {sub.archived_at && (
                              <button
                                onClick={() => handleArchive(sub)}
                                disabled={archiveBusyId === sub.id}
                                title={isAr ? 'إعادة الاشتراك للكشف' : 'Restore to statement'}
                                className={actionBtn}
                              >
                                {archiveBusyId === sub.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3 w-3" />
                                )}
                                {isAr ? 'استعادة' : 'Restore'}
                              </button>
                            )}
                            {isActionable(sub) && (
                              <>
                                <button
                                  onClick={() => {
                                    setExtMonths(1)
                                    setExtAmount('')
                                    setExtNotes('')
                                    setModalError(null)
                                    setModal({ type: 'extend', sub })
                                  }}
                                  className={actionBtn}
                                >
                                  <CalendarPlus className="h-3 w-3" />
                                  {isAr ? 'تمديد' : 'Extend'}
                                </button>
                                <button
                                  onClick={() => {
                                    setModalError(null)
                                    setModal({ type: 'cancel', sub })
                                  }}
                                  className={actionBtn}
                                >
                                  <XCircle className="h-3 w-3" />
                                  {isAr ? 'إلغاء' : 'Cancel'}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Payments table ──────────────────────────────────── */}
      {tab === 'payments' && (
        <div className="border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/30">
            <span className="text-[11px] font-medium text-foreground">{isAr ? 'سجل الدفعات' : 'Payments History'}</span>
            <span className="text-[11px] text-muted-foreground">{payments.length}</span>
          </div>

          {payments.length === 0 ? (
            <div className="px-6 py-16 text-center text-xs text-muted-foreground">
              <Receipt className="h-5 w-5 mx-auto mb-2 opacity-40" />
              {isAr ? 'لا توجد دفعات مسجلة بعد.' : 'No payments recorded yet.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'تاريخ الدفعة' : 'Payment Date'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'الاشتراك' : 'Subscription'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'المبلغ' : 'Amount'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'ملاحظات' : 'Notes'}</th>
                    <th className="px-3 py-2 text-end font-medium">{isAr ? 'إجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => {
                    const sub = subscriptions.find((s) => s.id === p.subscription_id)
                    return (
                      <tr key={p.id} className="border-b border-border/50 transition-colors hover:bg-muted/30">
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{formatDate(p.paid_at)}</td>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-foreground">{p.workspace_name || '—'}</p>
                          {p.subscription_number && (
                            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{p.subscription_number}</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono font-semibold text-emerald-600 whitespace-nowrap">
                          {fmtMoney(p.amount)} {p.currency}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground max-w-[240px] truncate" title={p.notes || ''}>
                          {p.notes || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-end">
                          {sub && (
                            <button
                              onClick={() => openAddPayment(sub)}
                              className={cn(actionBtn, 'whitespace-nowrap')}
                            >
                              <Banknote className="h-3 w-3" />
                              {isAr ? 'دفعة جديدة' : 'New Payment'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Register / renew modal ──────────────────────────── */}
      {modal?.type === 'register' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <form
            onSubmit={handleRegister}
            className="bg-card border border-border max-w-2xl w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">
              {isAr ? 'إضافة اشتراك جديد / تجديد' : 'Add / Renew Subscription'}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {isAr ? 'العميل:' : 'Client: '}
              <strong className="text-foreground">{clientEmail}</strong>
            </p>

            <div className="space-y-2">
              <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'مساحة العمل' : 'Workspace'}</label>
              <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className={inputCls}>
                <option value="">{isAr ? '— اختر مساحة موجودة —' : '— Choose existing —'}</option>
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                    {ws.subscription_number ? ` (${ws.subscription_number})` : ''}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={newWorkspaceName}
                onChange={(e) => {
                  setNewWorkspaceName(e.target.value)
                  if (e.target.value) setWorkspaceId('')
                }}
                placeholder={isAr ? 'أو اكتب اسم مساحة عمل جديدة (تُنشأ تلقائياً)' : 'Or enter a new workspace name (created automatically)'}
                className={inputCls}
              />
            </div>

            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={cancelExisting}
                onChange={(e) => setCancelExisting(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5"
              />
              <span className="text-[11px] text-muted-foreground leading-relaxed">
                {isAr
                  ? 'إلغاء الاشتراكات النشطة السابقة على هذه المساحة (اتركها فارغة لإضافة الاشتراك الجديد بجانب القديم)'
                  : 'Cancel previous active subscriptions on this workspace (leave unchecked to add the new one alongside the old one)'}
              </span>
            </label>

            <div className="space-y-2">
              <label className="text-[11px] font-medium text-muted-foreground">
                {isAr ? 'الأفلييت المرتبط (اكتشاف تلقائي)' : 'Linked Affiliate (auto-detected)'}
              </label>
              {detectingAffiliate ? (
                <div className="flex items-center gap-2 border border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {isAr ? 'جارٍ اكتشاف الأفلييت المرتبط...' : 'Detecting linked affiliate...'}
                </div>
              ) : autoAffiliate && !manualAffiliate ? (
                <div className="border border-border bg-muted/30 px-3 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">{autoAffiliate.display_name}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {Math.round(Number(autoAffiliate.commission_rate) * 100)}% ·{' '}
                      {isAr ? 'مرتبط تلقائياً — العمولة تُحسب له' : 'auto-linked — commission goes to this affiliate'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setManualAffiliate(true)}
                    className="text-[10px] font-medium text-muted-foreground hover:text-foreground shrink-0"
                  >
                    {isAr ? 'تغيير' : 'Change'}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <select value={affiliateId} onChange={(e) => setAffiliateId(e.target.value)} className={inputCls}>
                    <option value="">{isAr ? '— بدون أفلييت —' : '— No affiliate —'}</option>
                    {affiliates.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.display_name} · {Math.round(Number(a.commission_rate) * 100)}%
                      </option>
                    ))}
                  </select>
                  {autoAffiliate && (
                    <button
                      type="button"
                      onClick={() => {
                        setManualAffiliate(false)
                        setAffiliateId(autoAffiliate.id)
                      }}
                      className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      {isAr ? 'رجوع للاكتشاف التلقائي' : 'Back to auto-detected'}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'تاريخ البدء (يوم التحويل)' : 'Start date (transfer day)'}</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required className={inputCls} />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'عدد الشهور المدفوعة' : 'Months paid'}</label>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={months}
                  onChange={(e) => setMonths(Math.max(1, Number(e.target.value) || 1))}
                  required
                  className={inputCls}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'المبلغ المدفوع (USD)' : 'Amount paid (USD)'}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className={inputCls}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'تاريخ الانتهاء (تلقائي)' : 'End date (auto)'}</label>
                <input
                  type="date"
                  value={(() => {
                    if (!startDate || !months) return ''
                    const d = new Date(`${startDate}T00:00:00Z`)
                    d.setUTCMonth(d.getUTCMonth() + months)
                    d.setUTCDate(d.getUTCDate() - 1)
                    return d.toISOString().slice(0, 10)
                  })()}
                  disabled
                  className={cn(inputCls, 'bg-muted text-muted-foreground')}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'ملاحظات (اختياري)' : 'Notes (optional)'}</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className={cn(inputCls, 'h-auto py-2')}
                placeholder={isAr ? 'مثال: تحويل بنكي بتاريخ...' : 'e.g. bank transfer on...'}
              />
            </div>

            {modalError && (
              <div className="flex items-start gap-2 border border-border bg-card p-2.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
                <span className="text-[11px] text-muted-foreground">{modalError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="inline-flex items-center rounded border border-border bg-background px-3 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded border border-foreground/20 bg-background px-3 h-7 text-[11px] font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {isAr ? 'حفظ الاشتراك' : 'Save Subscription'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Extend modal ─────────────────────────────────────── */}
      {modal?.type === 'extend' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <form
            onSubmit={handleExtend}
            className="bg-card border border-border max-w-md w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">{isAr ? 'تمديد الاشتراك' : 'Extend Subscription'}</h3>
            <p className="text-[11px] text-muted-foreground">
              {isAr ? 'ينتهي حالياً في ' : 'Currently ends '}
              <strong className="text-foreground">{formatDate(modal.sub.end_date)}</strong>
            </p>
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'عدد الشهور' : 'Months'}</label>
                <input
                  type="number"
                  min={1}
                  value={extMonths}
                  onChange={(e) => setExtMonths(Math.max(1, Number(e.target.value) || 1))}
                  className={inputCls}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'المبلغ المدفوع (USD)' : 'Amount paid (USD)'}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={extAmount}
                  onChange={(e) => setExtAmount(e.target.value)}
                  placeholder="0.00"
                  className={inputCls}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'ملاحظات' : 'Notes'}</label>
                <textarea value={extNotes} onChange={(e) => setExtNotes(e.target.value)} rows={2} className={cn(inputCls, 'h-auto py-2')} />
              </div>
            </div>
            {modalError && (
              <div className="flex items-start gap-2 border border-border bg-card p-2.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
                <span className="text-[11px] text-muted-foreground">{modalError}</span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="inline-flex items-center rounded border border-border bg-background px-3 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded border border-foreground/20 bg-background px-3 h-7 text-[11px] font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />}
                {isAr ? 'تمديد' : 'Extend'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Cancel modal ─────────────────────────────────────── */}
      {modal?.type === 'cancel' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div className="bg-card border border-border max-w-md w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground">{isAr ? 'إلغاء الاشتراك' : 'Cancel Subscription'}</h3>
            <p className="text-[11px] text-muted-foreground">
              {isAr
                ? `هل أنت متأكد من إلغاء الاشتراك (${modal.sub.workspace_name || '—'}) الذي ينتهي في ${formatDate(modal.sub.end_date)}؟`
                : `Cancel the subscription (${modal.sub.workspace_name || '—'}) ending on ${formatDate(modal.sub.end_date)}?`}
            </p>
            {modalError && (
              <div className="flex items-start gap-2 border border-border bg-card p-2.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
                <span className="text-[11px] text-muted-foreground">{modalError}</span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setModal(null)}
                className="inline-flex items-center rounded border border-border bg-background px-3 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
              >
                {isAr ? 'رجوع' : 'Back'}
              </button>
              <button
                onClick={handleCancel}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded border border-foreground/20 bg-background px-3 h-7 text-[11px] font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                {isAr ? 'تأكيد الإلغاء' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Subscription details modal ──────────────────────── */}
      {detailSub && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="bg-card border border-border max-w-3xl w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {isAr ? 'تفاصيل الاشتراك' : 'Subscription Details'}
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {detailSub.workspace_name || '—'}
                  {detailSub.subscription_number ? ` · ${detailSub.subscription_number}` : ''}
                </p>
              </div>
              <span className={cn('text-[11px] font-semibold', subStatus(detailSub).cls)}>
                {subStatus(detailSub).text}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border border-border bg-muted/20 p-3">
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">{isAr ? 'البداية' : 'Start'}</p>
                <p className="text-[11px] font-semibold text-foreground mt-0.5">{formatDate(detailSub.start_date)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">{isAr ? 'النهاية' : 'End'}</p>
                <p className="text-[11px] font-semibold text-foreground mt-0.5">{formatDate(detailSub.end_date)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">{isAr ? 'الشهور' : 'Months'}</p>
                <p className="text-[11px] font-semibold text-foreground mt-0.5">{detailSub.months_paid}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">{isAr ? 'المبلغ الإجمالي' : 'Total Amount'}</p>
                <p className="text-[11px] font-semibold text-foreground mt-0.5 font-mono">
                  {fmtMoney(detailSub.amount_paid)} {detailSub.currency}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">{isAr ? 'الأفلييت' : 'Affiliate'}</p>
                <p className="text-[11px] font-semibold text-foreground mt-0.5">{detailSub.affiliate_name || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">{isAr ? 'إجمالي الدفعات المسجلة' : 'Recorded payments'}</p>
                <p className="text-[11px] font-semibold text-emerald-600 mt-0.5 font-mono">
                  {fmtMoney(paymentsTotal(detailSub.id))}
                </p>
              </div>
            </div>

            {detailSub.notes && (
              <p className="text-[11px] text-muted-foreground border border-border bg-muted/20 px-3 py-2">
                {isAr ? 'ملاحظات: ' : 'Notes: '}
                <span className="text-foreground">{detailSub.notes}</span>
              </p>
            )}

            {/* Payments of this subscription */}
            <div className="border border-border overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-muted/30">
                <span className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                  {isAr ? `دفعات هذا الاشتراك (${paymentsBySub(detailSub.id).length})` : `Payments for this subscription (${paymentsBySub(detailSub.id).length})`}
                </span>
                <button onClick={() => openAddPayment(detailSub)} className={actionBtn}>
                  <Banknote className="h-3 w-3" />
                  {isAr ? 'تسجيل دفعة' : 'Add Payment'}
                </button>
              </div>
              {paymentsBySub(detailSub.id).length === 0 ? (
                <div className="px-4 py-10 text-center text-xs text-muted-foreground">
                  {isAr ? 'لا توجد دفعات مسجلة لهذا الاشتراك.' : 'No payments recorded for this subscription.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="px-3 py-2 text-start font-medium">{isAr ? 'التاريخ' : 'Date'}</th>
                        <th className="px-3 py-2 text-start font-medium">{isAr ? 'المبلغ' : 'Amount'}</th>
                        <th className="px-3 py-2 text-start font-medium">{isAr ? 'ملاحظات' : 'Notes'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentsBySub(detailSub.id).map((p) => (
                        <tr key={p.id} className="border-b border-border/50">
                          <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{formatDate(p.paid_at)}</td>
                          <td className="px-3 py-2.5 font-mono font-semibold text-emerald-600 whitespace-nowrap">
                            {fmtMoney(p.amount)} {p.currency}
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground max-w-[240px] truncate" title={p.notes || ''}>
                            {p.notes || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Link
                href={`/invoice/${detailSub.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded border border-border bg-background px-3 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
              >
                <Printer className="h-3.5 w-3.5" />
                {isAr ? 'الفاتورة' : 'Invoice'}
              </Link>
              {isActionable(detailSub) && (
                <>
                  <button
                    onClick={() => {
                      setExtMonths(1)
                      setExtAmount('')
                      setExtNotes('')
                      setModalError(null)
                      setModal({ type: 'extend', sub: detailSub })
                    }}
                    className="inline-flex items-center gap-1.5 rounded border border-foreground/20 bg-background px-3 h-7 text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    <CalendarPlus className="h-3.5 w-3.5" />
                    {isAr ? 'تمديد' : 'Extend'}
                  </button>
                  <button
                    onClick={() => {
                      setModalError(null)
                      setModal({ type: 'cancel', sub: detailSub })
                    }}
                    className="inline-flex items-center gap-1.5 rounded border border-foreground/20 bg-background px-3 h-7 text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                </>
              )}
              <button
                onClick={() => setModal(null)}
                className="inline-flex items-center rounded border border-border bg-background px-3 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
              >
                {isAr ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add payment modal ────────────────────────────────── */}
      {modal?.type === 'addPayment' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <form
            onSubmit={handleAddPayment}
            className="bg-card border border-border max-w-md w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">{isAr ? 'تسجيل دفعة جديدة' : 'Record New Payment'}</h3>
            <div className="space-y-2">
              <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'الاشتراك' : 'Subscription'}</label>
              <select value={paySubscriptionId} onChange={(e) => setPaySubscriptionId(e.target.value)} className={inputCls}>
                <option value="">{isAr ? '— اختر —' : '— Select —'}</option>
                {subscriptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.workspace_name || '—'} · {formatDate(s.start_date)} → {formatDate(s.end_date)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'تاريخ الدفعة' : 'Payment date'}</label>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} required className={inputCls} />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'المبلغ (USD)' : 'Amount (USD)'}</label>
                <input
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="0.00"
                  required
                  className={inputCls}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'ملاحظات (اختياري)' : 'Notes (optional)'}</label>
              <textarea
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                rows={2}
                className={cn(inputCls, 'h-auto py-2')}
                placeholder={isAr ? 'مثال: فرق ترقية الباقة...' : 'e.g. package upgrade difference...'}
              />
            </div>
            {modalError && (
              <div className="flex items-start gap-2 border border-border bg-card p-2.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
                <span className="text-[11px] text-muted-foreground">{modalError}</span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="inline-flex items-center rounded border border-border bg-background px-3 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded border border-foreground/20 bg-background px-3 h-7 text-[11px] font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {isAr ? 'حفظ الدفعة' : 'Save Payment'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
