'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider, useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

import { LanguageProvider } from '@/components/language-provider'
import BrowserNotifications from '@/components/browser-notifications'
import { Toaster } from '@/components/ui/toaster'
import { writePreferenceCookie } from '@/lib/preference-cookie'
import type { Language } from '@/lib/translations'

function ThemeCookieSync() {
  const { resolvedTheme } = useTheme()
  useEffect(() => {
    if (resolvedTheme) {
      writePreferenceCookie('theme', resolvedTheme)
    }
  }, [resolvedTheme])
  return null
}

export default function AppProviders({
  children,
  initialLang,
}: {
  children: React.ReactNode
  initialLang: Language
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      })
  )

  return (
    <LanguageProvider initialLang={initialLang}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={true}
          disableTransitionOnChange
        >
          <ThemeCookieSync />
          {children}
          <Toaster />
          <BrowserNotifications />
        </ThemeProvider>
      </QueryClientProvider>
    </LanguageProvider>
  )
}
