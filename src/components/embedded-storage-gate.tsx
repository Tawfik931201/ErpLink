'use client'

import { useEffect, useState } from 'react'

/** Keep the sign-in attempt intact by asking for storage BEFORE Clerk starts it. */
export default function EmbeddedStorageGate({ children }: { children?: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'ready' | 'blocked'>('checking')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    async function check() {
      if (window.self === window.top) return 'ready' as const
      if (!document.hasStorageAccess) return 'ready' as const
      return (await document.hasStorageAccess()) ? 'ready' as const : 'blocked' as const
    }
    check().then(value => { if (active) setState(value) }).catch(() => {
      if (active) setState('blocked')
    })
    return () => { active = false }
  }, [])

  async function allowStorage() {
    setBusy(true)
    setError(false)
    try {
      if (!document.requestStorageAccess) throw new Error('Storage access unavailable')
      // Must run directly from a user gesture; do not move behind a fetch/effect.
      await document.requestStorageAccess()
      window.location.reload()
    } catch {
      setError(true)
      setBusy(false)
    }
  }

  if (state === 'ready') return <>{children}</>
  if (state === 'checking') return <p role="status">جارٍ التحقق من جلسة الدخول… / Checking session…</p>
  return (
    <section className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-5 text-center">
      <h1 className="text-lg font-bold">تفعيل الجلسة داخل زد / Enable embedded session</h1>
      <p className="text-sm text-muted-foreground">
        يحتاج تسجيل الدخول إلى السماح بملفات الارتباط لهذا التطبيق داخل لوحة زد.
        سيبقى التطبيق داخل زد.
      </p>
      <p className="text-sm text-muted-foreground" lang="en" dir="ltr">
        Allow this app to access its sign-in cookies inside Zid to continue here.
      </p>
      <button type="button" onClick={allowStorage} disabled={busy}
        className="w-full rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
        {busy ? 'جارٍ التفعيل… / Enabling…' : 'متابعة داخل زد / Continue inside Zid'}
      </button>
      {error && <p role="alert" className="text-sm text-destructive">
        لم يسمح المتصفح بحفظ الجلسة. تحقق من أذونات ملفات الارتباط لهذا التطبيق ثم حاول مجددًا.
        / The browser denied session storage. Check cookie permissions for this app and retry.
      </p>}
    </section>
  )
}
