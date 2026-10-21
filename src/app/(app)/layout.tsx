import { cookies } from 'next/headers'
import NextTopLoader from 'nextjs-toploader'

import ImpersonationBanner from '@/components/ImpersonationBanner'
import AppProviders from '@/components/app-providers'
import { resolveLanguage } from '@/lib/translations'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)

  return (
    <AppProviders initialLang={lang}>
      <div className="calm-ui min-h-screen bg-background text-foreground">
        <NextTopLoader showSpinner={false} color="hsl(var(--foreground))" height={3} />
        <ImpersonationBanner />
        {children}
      </div>
    </AppProviders>
  )
}
