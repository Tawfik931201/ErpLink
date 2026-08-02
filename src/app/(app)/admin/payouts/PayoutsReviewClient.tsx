'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, XCircle, Loader2, DollarSign, CreditCard } from 'lucide-react'

import { reviewPayoutRequest } from '@/app/actions/partner-admin'
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

export default function PayoutsReviewClient({ payouts, lang }: Props) {
  const router = useRouter()
  const isAr = lang === 'ar'
  const [busyId, setBusyId] = useState<string | null>(null)
  const [modal, setModal] = useState<{ payout: PayoutRow; action: 'approve' | 'pay' | 'reject' } | null>(null)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)

  const pending = payouts.filter((p) => p.status === 'pending')
  const reviewed = payouts.filter((p) => p.status !== 'pending')

  const [tab, setTab] = useState<'pending' | 'all'>('pending')
  const list = tab === 'pending' ? pending : payouts

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

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 bg-secondary/20 rounded-xl border border-border/40 w-fit" dir="ltr">
        <button
          onClick={() => setTab('pending')}
          className={cn(
            'px-4 py-2 rounded-lg text-xs font-bold transition-all',
            tab === 'pending' ? 'bg-card shadow-sm text-foreground border border-border' : 'text-muted-foreground',
          )}
        >
          {isAr ? 'قيد المراجعة' : 'Pending'} ({pending.length})
        </button>
        <button
          onClick={() => setTab('all')}
          className={cn(
            'px-4 py-2 rounded-lg text-xs font-bold transition-all',
            tab === 'all' ? 'bg-card shadow-sm text-foreground border border-border' : 'text-muted-foreground',
          )}
        >
          {isAr ? 'الكل' : 'All'} ({payouts.length})
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {list.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            <CreditCard className="h-8 w-8 mx-auto mb-2 opacity-40" />
            {isAr ? 'لا توجد طلبات' : 'No requests found'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground bg-secondary/30">
              <tr>
                <th className="px-5 py-3 text-start">{isAr ? 'المبلغ' : 'Amount'}</th>
                <th className="px-5 py-3 text-start">{isAr ? 'الشريك' : 'Partner'}</th>
                <th className="px-5 py-3 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                <th className="px-5 py-3 text-start">{isAr ? 'مرجع الصرف' : 'Reference'}</th>
                <th className="px-5 py-3 text-start">{isAr ? 'الإجراء' : 'Action'}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="border-t border-border/40">
                  <td className="px-5 py-3 font-mono font-bold">
                    ${Number(p.amount).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-xs font-mono text-muted-foreground">
                    {p.partner_id.slice(0, 8)}...
                  </td>
                  <td className="px-5 py-3">
                    <span className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border',
                      p.status === 'pending' && 'bg-amber-50 border-amber-200 text-amber-700',
                      (p.status === 'approved' || p.status === 'paid') && 'bg-emerald-50 border-emerald-200 text-emerald-700',
                      p.status === 'rejected' && 'bg-red-50 border-red-200 text-red-700',
                    )}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-[10px] font-mono text-muted-foreground">
                    {p.payment_reference || '—'}
                  </td>
                  <td className="px-5 py-3">
                    {p.status === 'pending' && (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setModal({ payout: p, action: 'approve' })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold hover:bg-emerald-100 transition"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          {isAr ? 'اعتماد' : 'Approve'}
                        </button>
                        <button
                          onClick={() => setModal({ payout: p, action: 'pay' })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-bold hover:bg-blue-100 transition"
                        >
                          <DollarSign className="h-3 w-3" />
                          {isAr ? 'صرف' : 'Pay'}
                        </button>
                        <button
                          onClick={() => setModal({ payout: p, action: 'reject' })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[10px] font-bold hover:bg-red-100 transition"
                        >
                          <XCircle className="h-3 w-3" />
                          {isAr ? 'رفض' : 'Reject'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div className="bg-card border border-border rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-foreground">
              {modal.action === 'approve' && (isAr ? 'اعتماد الطلب' : 'Approve Request')}
              {modal.action === 'pay' && (isAr ? 'تأكيد الصرف' : 'Confirm Payment')}
              {modal.action === 'reject' && (isAr ? 'رفض الطلب' : 'Reject Request')}
            </h3>

            <p className="text-sm">
              <strong>${Number(modal.payout.amount).toLocaleString()}</strong>
            </p>

            {modal.action === 'pay' && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground">
                  {isAr ? 'مرجع الصرف' : 'Payment Reference'}
                </label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={isAr ? 'رقم التحويل أو المرجع' : 'Transfer number or reference'}
                  className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground">
                {isAr ? 'ملاحظات' : 'Notes'}
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
                placeholder={isAr ? 'ملاحظات داخلية...' : 'Internal notes...'}
              />
            </div>

            {modalError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{modalError}</div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(null)} className="px-4 py-2 rounded-xl text-xs font-bold border border-border hover:bg-secondary transition-all">
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                onClick={handleAction}
                disabled={busyId === modal.payout.id}
                className={cn(
                  'px-4 py-2 rounded-xl text-xs font-bold text-white transition-all',
                  modal.action === 'approve' && 'bg-emerald-600 hover:bg-emerald-700',
                  modal.action === 'pay' && 'bg-blue-600 hover:bg-blue-700',
                  modal.action === 'reject' && 'bg-red-600 hover:bg-red-700',
                )}
              >
                {busyId === modal.payout.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
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
