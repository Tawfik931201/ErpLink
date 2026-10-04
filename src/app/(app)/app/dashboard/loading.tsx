import { cookies } from 'next/headers'
import React from 'react'

import { resolveLanguage } from '@/lib/translations'

// Async on purpose: `cookies()` is async since Next 15. See the note in
// src/components/ImpersonationBanner.tsx.
export default async function Loading() {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const text = lang === 'en' ? 'Loading...' : 'جاري التحميل...'

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2 bg-card/90 backdrop-blur-md border border-border rounded-full px-3 py-1.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="h-3.5 w-3.5 rounded-full border-2 border-foreground border-t-transparent animate-spin" />
      <span className="text-[11px] font-bold text-foreground select-none">
        {text}
      </span>
    </div>
  )
}
