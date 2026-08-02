'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { claimPartnerWorkspace } from '@/app/actions/partner-admin'

interface Props {
  token: string
  lang: string
}

export default function ClaimWorkspaceForm({ token, lang }: Props) {
  const router = useRouter()
  const isAr = lang === 'ar'
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)

    const res = await claimPartnerWorkspace({ token, workspaceName: name.trim() })
    if (res.success) {
      setSuccess(true)
      setTimeout(() => router.push('/dashboard'), 1500)
    } else {
      setError(res.error || 'error')
    }
    setBusy(false)
  }

  if (success) {
    return (
      <div className="text-center space-y-3 py-6">
        <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-500" />
        <p className="text-sm font-bold">
          {isAr ? 'تم إنشاء مساحة العمل بنجاح!' : 'Workspace created successfully!'}
        </p>
        <p className="text-xs text-muted-foreground">
          {isAr ? 'جاري توجيهك إلى لوحة التحكم...' : 'Redirecting to dashboard...'}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-bold text-muted-foreground">
          {isAr ? 'اسم مساحة العمل' : 'Workspace Name'}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isAr ? 'مثلاً: متجري الإلكتروني' : 'e.g. My Online Store'}
          required
          className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" disabled={busy} className="w-full rounded-xl font-bold">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          isAr ? 'إنشاء مساحة العمل' : 'Create Workspace'
        )}
      </Button>
    </form>
  )
}
