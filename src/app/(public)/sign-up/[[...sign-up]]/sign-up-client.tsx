'use client'

import { SignUp } from '@clerk/nextjs'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

import EmbeddedStorageGate from '@/components/embedded-storage-gate'
import { getClerkAppearance } from '@/lib/clerk-appearance'

export function SignUpClient({ signInUrl }: { signInUrl: string }) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = mounted ? resolvedTheme === 'dark' : false

  return (
    <EmbeddedStorageGate><SignUp
      fallbackRedirectUrl="/app/dashboard"
      signInUrl={signInUrl}
      appearance={getClerkAppearance(isDark)}
    /></EmbeddedStorageGate>
  )
}
