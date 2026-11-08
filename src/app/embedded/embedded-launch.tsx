'use client'

import { useClerk, useSignIn } from '@clerk/nextjs'
import { useEffect, useRef, useState } from 'react'

export default function EmbeddedLaunch() {
  const { isLoaded } = useSignIn()
  const clerk = useClerk()
  const started = useRef(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!isLoaded || !clerk.client || started.current) return
    started.current = true
    async function launch() {
      const params = new URLSearchParams(window.location.search)
      const token = params.get('token')
      const locale = params.get('language')?.startsWith('en') ? 'en-us' : 'ar-sa'
      if (!token) throw new Error('Missing embedded token')
      // Keep the bearer UUID out of subsequent navigations and referrers.
      window.history.replaceState(null, '', '/embedded')
      const response = await fetch('/api/zid/embedded/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }), cache: 'no-store',
      })
      if (!response.ok) throw new Error('Embedded session failed')
      const { ticket } = await response.json()
      // Never reuse a different workspace/account's already active session.
      if (clerk.session) await clerk.signOut(() => {}, { sessionId: clerk.session.id })
      const attempt = await clerk.client!.signIn.create({ strategy: 'ticket', ticket })
      if (attempt.status !== 'complete' || !attempt.createdSessionId) throw new Error('Incomplete session')
      await clerk.setActive({ session: attempt.createdSessionId })
      window.location.replace(`/${locale}/app/dashboard`)
    }
    launch().catch(() => setError(true))
  }, [isLoaded, clerk])

  return <section className="w-full max-w-md rounded-xl border border-border p-5 text-center">
    {error ? <p role="alert">تعذر فتح جلسة المتجر. أعد فتح التطبيق من قائمة تطبيقات زد، أو اطلب من مالك مساحة العمل تفعيل الدخول المضمن.
      / Unable to open this store. Reopen the app from Zid, or ask the workspace owner to enable embedded access.</p>
      : <p role="status">جارٍ فتح مساحة متجرك… / Opening your store workspace…</p>}
  </section>
}
