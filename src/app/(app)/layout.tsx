import { cookies } from 'next/headers'
import { Language } from '@/lib/translations'

import { LanguageProvider } from '@/components/language-provider'
import ImpersonationBanner from '@/components/ImpersonationBanner'
import NextTopLoader from 'nextjs-toploader'
import AppProviders from '@/components/app-providers'

export const dynamic = 'force-dynamic'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language

  return (
    <AppProviders initialLang={lang}>
      <NextTopLoader showSpinner={false} color="hsl(var(--foreground))" height={3} />
      <ImpersonationBanner />
      {children}
    </AppProviders>
  )
}
