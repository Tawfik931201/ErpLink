'use client'

import { Loader2, UserPlus, CheckCircle2, AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { registerClientWorkspace } from '@/app/actions/affiliate-actions'
import { Button } from '@/components/ui/button'

interface Props {
  lang: string
}

/** The affiliate registers a client workspace directly (attributed to them). */
export default function RegisterClientForm({ lang }: Props) {
  const router = useRouter()
  const isAr = lang === 'ar'
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [invited, setInvited] = useState(false)
  const [lastWorkspaceName, setLastWorkspaceName] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !name.trim()) return
    setBusy(true)
    setError(null)
    setSuccess(false)
    setInvited(false)

    const submittedName = name.trim()

    const res = await registerClientWorkspace({
      clientEmail: email.trim(),
      workspaceName: submittedName,
      clientPhone: phone.trim() || null,
    })

    if (res.success) {
      setSuccess(true)
      if ('invited' in res && res.invited) {
        setInvited(true)
        setLastWorkspaceName(submittedName)
      }
      setEmail('')
      setName('')
      setPhone('')
      setTimeout(() => {
        setOpen(false)
        setSuccess(false)
        setInvited(false)
      }, 3000)
      router.refresh()
    } else {
      const message = 'message' in res && typeof res.message === 'string' ? res.message : undefined
      const errorMsg = 'error' in res && typeof res.error === 'string' ? res.error : undefined
      setError(message || errorMsg || 'error')
    }
    setBusy(false)
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="rounded-xl font-bold">
        <UserPlus className="h-4 w-4" />
        {isAr ? 'تسجيل عميل جديد' : 'Register New Client'}
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
        placeholder={isAr ? 'اسم مساحة العمل (مثال: متجر العميل)' : 'Workspace name (e.g. Client Store)'}
        required
        className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
      />
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder={isAr ? 'جوال العميل (اختياري)' : 'Client phone (optional)'}
        className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
        dir="ltr"
      />

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <p className="flex-1">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            {invited ? (
              isAr ? (
                <p>
                  تم إرسال دعوة إلى العميل للانضمام. بمجرد إنشائه للحساب، ستُسجَّل مساحة العمل{' '}
                  <strong>{lastWorkspaceName}</strong> وتُسند إليك تلقائياً.
                </p>
              ) : (
                <p>
                  An invitation was sent to the client to sign up. Once they create their
                  account, the workspace will be registered and attributed to you automatically.
                </p>
              )
            ) : isAr ? (
              'تم تسجيل مساحة العمل وإسنادها إليك بنجاح'
            ) : (
              'Workspace registered and attributed to you successfully'
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="rounded-xl font-bold flex-1">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isAr ? (
            'تسجيل العميل'
          ) : (
            'Register Client'
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
