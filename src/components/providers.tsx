'use client'

import { ClerkProvider } from '@clerk/nextjs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState } from 'react'

import { Toaster } from '@/components/ui/toaster'
import { LanguageProvider } from '@/components/language-provider'
import { Language } from '@/lib/translations'

export default function Providers({ 
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
            staleTime: 60 * 1000, // 1 minute
            retry: 1,
          },
        },
      })
  )

  return (
    <ClerkProvider>
      <LanguageProvider initialLang={initialLang}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
            {children}
            <Toaster />
          </ThemeProvider>
        </QueryClientProvider>
      </LanguageProvider>
    </ClerkProvider>
  )
}
