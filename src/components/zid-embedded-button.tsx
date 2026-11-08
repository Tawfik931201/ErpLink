'use client'

import { useState } from 'react'

export default function ZidEmbeddedButton({ merchantId, lang }: { merchantId: string; lang: string }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function enable() {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/zid/embedded/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId }),
      })
      const result = await response.json()
      setMessage(response.ok
        ? (lang === 'ar' ? 'تم التفعيل. افتح التطبيق من قائمة تطبيقات زد.' : 'Enabled. Open this app from Zid’s apps list.')
        : result.error || 'Embedded setup failed')
    } catch {
      setMessage(lang === 'ar' ? 'تعذر التفعيل. حاول مجددًا.' : 'Could not enable. Please retry.')
    } finally { setBusy(false) }
  }
  return <div className="space-y-2">
    <button type="button" disabled={busy} onClick={enable}
      className="rounded-lg border border-border px-3 py-2 text-xs font-medium disabled:opacity-50">
      {busy ? '…' : lang === 'ar' ? 'تفعيل الدخول من داخل زد' : 'Enable sign-in inside Zid'}
    </button>
    {message && <p role="status" className="max-w-md break-words text-xs">{message}</p>}
  </div>
}
