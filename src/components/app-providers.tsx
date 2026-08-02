'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState } from 'react'

import { LanguageProvider } from '@/components/language-provider'
import { Toaster } from '@/components/ui/toaster'
import type { Language } from '@/lib/translations'

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
          {children}
          <Toaster />
        </ThemeProvider>
      </QueryClientProvider>
    </LanguageProvider>
  )
}
