'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserPlus, CheckCircle2, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { createClientInvitation } from '@/app/actions/partner-actions'

interface Props {
  partnerId: string
  lang: string
}

export default function InviteClientButton({ partnerId, lang }: Props) {
  const router = useRouter()
  const isAr = lang === 'ar'
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !name.trim()) return
    setBusy(true)
    setError(null)
    setSuccess(false)

    const res = await createClientInvitation({
      partnerId,
      clientEmail: email.trim(),
      clientName: name.trim(),
    })

    if (res.success) {
      setSuccess(true)
      setEmail('')
      setName('')
      setTimeout(() => {
        setOpen(false)
        setSuccess(false)
      }, 1500)
      router.refresh()
    } else {
      const errorMessage = res.error === 'client_not_found' 
        ? (isAr ? 'العميل غير موجود في النظام. يرجى إنشاء حساب أولاً قبل إضافته في مساحة العمل.' : 'Client not found in the system. Please create an account first before adding them to the workspace.')
        : (res.error || 'error')
      setError(errorMessage)
    }
    setBusy(false)
  }

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className="rounded-xl font-bold"
      >
        <UserPlus className="h-4 w-4" />
        {isAr ? 'دعوة عميل جديد' : 'Invite New Client'}
      </Button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={isAr ? 'البريد الإلكتروني للعميل' : 'Client email'}
        required
        className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={isAr ? 'اسم العميل' : 'Client name'}
        required
        className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
      />

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{error}</p>
            {error.includes('غير موجود') && (
              <a 
                href="/sign-up" 
                target="_blank" 
                className="inline-block mt-1 text-primary font-bold hover:underline"
              >
                {isAr ? 'اضغط هنا لإنشاء حساب جديد' : 'Click here to create a new account'}
              </a>
            )}
          </div>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {isAr ? 'تم إرسال الدعوة بنجاح' : 'Invitation sent successfully'}
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="rounded-xl font-bold flex-1">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isAr ? (
            'إرسال الدعوة'
          ) : (
            'Send Invitation'
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => { setOpen(false); setError(null); setSuccess(false) }}
          className="rounded-xl"
        >
          {isAr ? 'إلغاء' : 'Cancel'}
        </Button>
      </div>
    </form>
  )
}
