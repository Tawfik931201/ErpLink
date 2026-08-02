'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, AlertCircle, CheckCircle2, DollarSign } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { addCommission } from '@/app/actions/partner-admin'

interface Partner {
  id: string
  display_name: string
  tier: string
  commission_rate: number
}

interface Props {
  partners: Partner[]
  lang: string
}

export default function AddCommissionForm({ partners, lang }: Props) {
  const router = useRouter()
  const isAr = lang === 'ar'

  const [partnerId, setPartnerId] = useState('')
  const [clientUserId, setClientUserId] = useState('')
  const [grossAmount, setGrossAmount] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const selectedPartner = partners.find((p) => p.id === partnerId)
  const estimatedCommission = selectedPartner && grossAmount
    ? Number(grossAmount) * Number(selectedPartner.commission_rate)
    : null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!partnerId || !clientUserId || !grossAmount) return

    setBusy(true)
    setError(null)
    setSuccess(false)

    const res = await addCommission({
      partnerId,
      workspaceId: '00000000-0000-0000-0000-000000000000', // placeholder — admin can edit
      clientUserId,
      grossAmount: parseFloat(grossAmount),
      description: description.trim() || null,
    })

    if (res.success) {
      setSuccess(true)
      setGrossAmount('')
      setDescription('')
      setTimeout(() => setSuccess(false), 2000)
      router.refresh()
    } else {
      setError(res.error || 'error')
    }
    setBusy(false)
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
      <h2 className="font-bold text-sm flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-muted-foreground" />
        {isAr ? 'إضافة عمولة' : 'Add Commission'}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-3">
        <select
          value={partnerId}
          onChange={(e) => { setPartnerId(e.target.value); setError(null) }}
          required
          className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
        >
          <option value="">{isAr ? 'اختر الشريك...' : 'Select partner...'}</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name} ({p.tier} — {Math.round(Number(p.commission_rate) * 100)}%)
            </option>
          ))}
        </select>

        <input
          type="text"
          value={clientUserId}
          onChange={(e) => setClientUserId(e.target.value)}
          placeholder={isAr ? 'معرف العميل (user_id)' : 'Client user ID'}
          required
          className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
        />

        <div className="relative">
          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="number"
            step="0.01"
            min="0"
            value={grossAmount}
            onChange={(e) => setGrossAmount(e.target.value)}
            placeholder={isAr ? 'المبلغ الإجمالي' : 'Gross amount'}
            required
            className="w-full rounded-xl border border-input bg-background pl-10 pr-4 py-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
          />
        </div>

        {estimatedCommission !== null && !isNaN(estimatedCommission) && (
          <p className="text-xs text-muted-foreground">
            {isAr ? 'العمولة المتوقعة: ' : 'Estimated commission: '}
            <strong className="text-emerald-600">${estimatedCommission.toFixed(2)}</strong>
          </p>
        )}

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder={isAr ? 'وصف (اختياري)' : 'Description (optional)'}
          className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
        />

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            {isAr ? 'تم إضافة العمولة بنجاح' : 'Commission added successfully'}
          </div>
        )}

        <Button type="submit" disabled={busy} className="w-full rounded-xl font-bold">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isAr ? (
            'إضافة العمولة'
          ) : (
            'Add Commission'
          )}
        </Button>
      </form>
    </div>
  )
}
