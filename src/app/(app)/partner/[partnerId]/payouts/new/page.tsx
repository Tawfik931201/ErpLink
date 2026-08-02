'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, AlertCircle, CheckCircle2, DollarSign } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useLanguage } from '@/components/language-provider'

interface Props {
  params: { partnerId: string }
}

export default function NewPayoutPage({ params }: Props) {
  const router = useRouter()
  const { lang } = useLanguage()
  const isAr = lang === 'ar'

  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const num = parseFloat(amount)
    if (isNaN(num) || num <= 0) return

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
        setError(data.error || 'error')
      }
    } catch (err: any) {
      setError(err.message || 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6" dir={isAr ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="text-xl font-black text-foreground">
          {isAr ? 'طلب صرف جديد' : 'New Payout Request'}
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          {isAr ? 'أدخل المبلغ الذي ترغب في صرفه' : 'Enter the amount you wish to withdraw'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-bold text-muted-foreground">
            {isAr ? 'المبلغ (USD)' : 'Amount (USD)'}
          </label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="number"
              step="0.01"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="w-full rounded-xl border border-input bg-background pl-10 pr-4 py-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
              placeholder="0.00"
            />
          </div>
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

        <Button type="submit" disabled={busy} className="w-full rounded-xl font-bold">
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
