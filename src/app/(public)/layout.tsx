import { cookies } from 'next/headers'
import { ThemeProvider } from 'next-themes'
import Script from 'next/script'

import { LanguageProvider } from '@/components/language-provider'
import { ScrollReveal } from '@/components/ui/scroll-reveal'
import { resolveLanguage } from '@/lib/translations'

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)

  return (
    <LanguageProvider initialLang={lang}>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem={true}
        disableTransitionOnChange
      >
        {children}
        <ScrollReveal />
        <Script src="/agent-tools.js" strategy="afterInteractive" />
      </ThemeProvider>
    </LanguageProvider>
  )
}
