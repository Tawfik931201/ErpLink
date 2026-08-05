'use client'

import { CheckCircle2, XCircle, Loader2, DollarSign, CreditCard, Eye } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { reviewPayoutRequest } from '@/app/actions/partner-admin'
import PaginationControls from '@/components/PaginationControls'
import { cn } from '@/lib/utils'

interface PayoutRow {
  id: string
  partner_id: string
  amount: number
  status: string
  payment_reference: string | null
  review_note: string | null
  requested_at: string
  requested_by: string
}

interface Props {
  payouts: PayoutRow[]
  lang: string
}

const actionBtn =
  'inline-flex items-center gap-1.5 rounded border border-border bg-background px-2 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors'

export default function PayoutsReviewClient({ payouts, lang }: Props) {
  const router = useRouter()
  const isAr = lang === 'ar'
  const [busyId, setBusyId] = useState<string | null>(null)
  const [modal, setModal] = useState<{ payout: PayoutRow; action: 'approve' | 'pay' | 'reject' } | null>(null)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)

  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'paid'>('all')
  const [page, setPage] = useState(1)
  const list = filter === 'all' ? payouts : payouts.filter((p) => p.status === filter)

  const PAGE_SIZE = 20
  useEffect(() => {
    setPage(1)
  }, [filter])
  const pagedList = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  async function handleAction() {
    if (!modal) return
    setBusyId(modal.payout.id)
    setModalError(null)

    const res = await reviewPayoutRequest({
      payoutId: modal.payout.id,
      action: modal.action,
      paymentReference: modal.action === 'pay' ? reference || null : null,
      note: note || null,
    })

    if (res.success) {
      setModal(null)
      setReference('')
      setNote('')
      router.refresh()
    } else {
      setModalError(res.error || 'error')
    }
    setBusyId(null)
  }

  const statusDot = (status: string) => {
    const dot: Record<string, string> = {
      pending: 'bg-muted-foreground/50',
      approved: 'bg-foreground/60',
      paid: 'bg-foreground',
      rejected: 'bg-destructive/70',
    }
    const txt: Record<string, string> = {
      pending: 'text-muted-foreground',
      approved: 'text-foreground',
      paid: 'text-foreground',
      rejected: 'text-destructive',
    }
    return { dotClass: dot[status] || 'bg-muted-foreground/30', textClass: txt[status] || 'text-muted-foreground' }
  }

  const fmt = (n: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 p-1 bg-muted/40 rounded border border-border/50 w-fit">
        {(
          [
            ['all', isAr ? 'الكل' : 'All', payouts.length],
            ['pending', isAr ? 'قيد المراجعة' : 'Pending', payouts.filter((p) => p.status === 'pending').length],
            ['approved', isAr ? 'معتمد' : 'Approved', payouts.filter((p) => p.status === 'approved').length],
            ['paid', isAr ? 'تم التحويل' : 'Paid', payouts.filter((p) => p.status === 'paid').length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              'px-3 py-1.5 rounded text-[11px] font-medium transition-colors',
              filter === key ? 'bg-card text-foreground border border-border' : 'text-muted-foreground',
            )}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      <div className="border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/30">
          <span className="text-[11px] font-medium text-foreground">
            {isAr ? 'طلبات الصرف' : 'Payout Requests'}
          </span>
          <span className="text-[11px] text-muted-foreground">{list.length}</span>
        </div>

        {list.length === 0 ? (
          <div className="px-6 py-16 text-center text-xs text-muted-foreground">
            <CreditCard className="h-5 w-5 mx-auto mb-2 opacity-40" />
            {isAr ? 'لا توجد طلبات' : 'No requests found'}
          </div>
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'المبلغ' : 'Amount'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'الأفلييت' : 'Affiliate'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'الحالة' : 'Status'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'مرجع الصرف' : 'Reference'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'الإجراء' : 'Action'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? '' : ''}</th>
                </tr>
              </thead>
              <tbody>
                {pagedList.map((p) => {
                  const { dotClass, textClass } = statusDot(p.status)
                  return (
                    <tr key={p.id} className="border-b border-border/50 transition-colors hover:bg-muted/30">
                      <td className="px-3 py-2.5 font-mono font-medium text-foreground">{fmt(Number(p.amount))}</td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">
                        {p.partner_id.slice(0, 8)}...
                      </td>
                      <td className="px-3 py-2.5">
                        <div className={cn('flex items-center gap-1.5', textClass)}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
                          <span>{p.status}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">
                        {p.payment_reference || '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        {p.status === 'pending' && (
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setModal({ payout: p, action: 'approve' })}
                              className={actionBtn}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              {isAr ? 'اعتماد' : 'Approve'}
                            </button>
                            <button
                              onClick={() => setModal({ payout: p, action: 'pay' })}
                              className={actionBtn}
                            >
                              <DollarSign className="h-3 w-3" />
                              {isAr ? 'صرف' : 'Pay'}
                            </button>
                            <button
                              onClick={() => setModal({ payout: p, action: 'reject' })}
                              className={actionBtn}
                            >
                              <XCircle className="h-3 w-3" />
                              {isAr ? 'رفض' : 'Reject'}
                            </button>
                          </div>
                        )}
                        {p.status === 'approved' && (
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setModal({ payout: p, action: 'pay' })}
                              className={actionBtn}
                            >
                              <DollarSign className="h-3 w-3" />
                              {isAr ? 'صرف' : 'Pay'}
                            </button>
                            <button
                              onClick={() => setModal({ payout: p, action: 'reject' })}
                              className={actionBtn}
                            >
                              <XCircle className="h-3 w-3" />
                              {isAr ? 'رفض' : 'Reject'}
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/admin/commissions/payouts/${p.id}`}
                          className={cn(actionBtn, 'whitespace-nowrap')}
                        >
                          <Eye className="h-3 w-3" />
                          {isAr ? 'عرض التفاصيل' : 'View details'}
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <PaginationControls
            page={page}
            pageSize={PAGE_SIZE}
            total={list.length}
            onPageChange={setPage}
            isAr={isAr}
          />
          </>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div className="bg-card border border-border max-w-md w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground">
              {modal.action === 'approve' && (isAr ? 'اعتماد الطلب' : 'Approve Request')}
              {modal.action === 'pay' && (isAr ? 'تأكيد الصرف' : 'Confirm Payment')}
              {modal.action === 'reject' && (isAr ? 'رفض الطلب' : 'Reject Request')}
            </h3>

            <p className="text-[11px]">
              <strong className="font-mono text-foreground">{fmt(Number(modal.payout.amount))}</strong>
            </p>

            {modal.action === 'pay' && (
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">
                  {isAr ? 'مرجع الصرف' : 'Payment Reference'}
                </label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={isAr ? 'رقم التحويل أو المرجع' : 'Transfer number or reference'}
                  className="w-full h-8 rounded border border-border bg-background px-3 text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[11px] font-medium text-muted-foreground">
                {isAr ? 'ملاحظات' : 'Notes'}
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full rounded border border-border bg-background px-3 py-2 text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={isAr ? 'ملاحظات داخلية...' : 'Internal notes...'}
              />
            </div>

            {modalError && (
              <div className="flex items-start gap-2 border border-border bg-card p-2.5">
                <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
                <span className="text-[11px] text-muted-foreground">{modalError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setModal(null)}
                className="inline-flex items-center rounded border border-border bg-background px-3 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                onClick={handleAction}
                disabled={busyId === modal.payout.id}
                className="inline-flex items-center rounded border border-foreground/20 bg-background px-3 h-7 text-[11px] font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              >
                {busyId === modal.payout.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  modal.action
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
