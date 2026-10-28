'use client'

import { SignIn } from '@clerk/nextjs'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

import { getClerkAppearance } from '@/lib/clerk-appearance'

export function SignInClient({ signUpUrl }: { signUpUrl: string }) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = mounted ? resolvedTheme === 'dark' : false

  return (
    <SignIn
      fallbackRedirectUrl="/app/dashboard"
      signUpUrl={signUpUrl}
      appearance={getClerkAppearance(isDark)}
    />
  )
}
