'use client'

import { SignIn } from '@clerk/nextjs'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

import EmbeddedStorageGate from '@/components/embedded-storage-gate'
import { getClerkAppearance } from '@/lib/clerk-appearance'

export function SignInClient({ signUpUrl, redirectToZid = false }: { signUpUrl: string; redirectToZid?: boolean }) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = mounted ? resolvedTheme === 'dark' : false

  return (
    <EmbeddedStorageGate><SignIn
      fallbackRedirectUrl="/app/dashboard"
      forceRedirectUrl={redirectToZid ? "/connect/zid" : undefined}
      signUpUrl={signUpUrl}
      appearance={getClerkAppearance(isDark)}
    /></EmbeddedStorageGate>
  )
}
