'use client'

import { Loader2, AlertCircle, CheckCircle2, DollarSign, Wallet } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'

import { getMyEligibleBalance } from '@/app/actions/partner-actions'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'

interface Props {
  params: { partnerId: string }
}

export default function NewPayoutPage({ params }: Props) {
  const router = useRouter()
  const { lang } = useLanguage()
  const isAr = lang === 'ar'
  const dir = isAr ? 'rtl' : 'ltr'

  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [eligibleBalance, setEligibleBalance] = useState<number | null>(null)

  useEffect(() => {
    async function loadBalance() {
      try {
        const res = await getMyEligibleBalance(params.partnerId)
        if (res.success) {
          setEligibleBalance(res.eligibleBalance)
        } else {
          setError(res.error || 'Failed to load balance')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading balance')
      }
    }
    loadBalance()
  }, [params.partnerId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const num = parseFloat(amount)
    if (isNaN(num) || num <= 0) return

    if (eligibleBalance !== null && num > eligibleBalance) {
      setError(isAr ? 'المبلغ المطلوب يتجاوز الرصيد المتاح للسحب.' : 'The requested amount exceeds your available balance.')
      return
    }

    setBusy(true)
    setError(null)
    setSuccess(false)

    try {
      const res = await fetch('/api/partner/request-payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: params.partnerId, amount: num, notes: notes.trim() || null }),
      })
      const data = await res.json()
      if (data.success) {
        setSuccess(true)
        setTimeout(() => router.push(`/partner/${params.partnerId}/payouts`), 1200)
      } else {
        setError(data.message || data.error || 'error')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6" dir={dir}>
      {/* ── Page Header ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="h-6 w-1 rounded-full bg-foreground" />
          <h1 className="text-2xl font-bold tracking-tight">{isAr ? 'طلب صرف جديد' : 'New Payout Request'}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {isAr ? 'أدخل المبلغ الذي ترغب في صرفه' : 'Enter the amount you wish to withdraw'}
        </p>
      </div>

      {/* ── Balance summary ──────────────────────────────────── */}
      <div className="bg-card border p-5 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500" />
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
            {isAr ? 'الرصيد المتاح للسحب' : 'Available Balance'}
          </span>
          <div className="p-2 rounded-lg text-blue-500 bg-blue-500/10">
            <Wallet className="h-4 w-4" />
          </div>
        </div>
        <div className="text-2xl font-bold tracking-tight font-mono">
          {eligibleBalance === null
            ? '—'
            : `$${eligibleBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          {isAr
            ? 'العمولات المستحقة حتى الآن بعد خصم المدفوع والقيد المراجعة'
            : 'Commissions earned so far, after paid & under-review amounts'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-card border p-5 space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-bold text-muted-foreground">
            {isAr ? 'المبلغ (USD)' : 'Amount (USD)'}
          </label>
          <div className="relative">
            <DollarSign className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="number"
              step="0.01"
              min="1"
              max={eligibleBalance !== null ? eligibleBalance : undefined}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="w-full rounded-xl border border-input bg-background ps-10 pe-4 py-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all font-mono"
              placeholder="0.00"
            />
            {eligibleBalance !== null && eligibleBalance > 0 && (
              <button
                type="button"
                onClick={() => setAmount(String(eligibleBalance))}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-primary hover:underline"
              >
                {isAr ? 'الكل' : 'MAX'}
              </button>
            )}
          </div>
          {eligibleBalance !== null && eligibleBalance === 0 && (
            <p className="text-[10px] text-muted-foreground">
              {isAr ? 'لا يوجد رصيد متاح للسحب حالياً.' : 'No available balance right now.'}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-muted-foreground">
            {isAr ? 'ملاحظات (اختياري)' : 'Notes (optional)'}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
            placeholder={isAr ? 'أي معلومات إضافية...' : 'Any additional information...'}
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            {isAr ? 'تم إرسال الطلب بنجاح' : 'Request submitted successfully'}
          </div>
        )}

        <Button
          type="submit"
          disabled={busy || (eligibleBalance !== null && eligibleBalance <= 0)}
          className="w-full rounded-xl font-bold"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isAr ? (
            'إرسال الطلب'
          ) : (
            'Submit Request'
          )}
        </Button>
      </form>
    </div>
  )
}
