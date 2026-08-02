import { cookies } from 'next/headers'

import { LanguageProvider } from '@/components/language-provider'
import type { Language } from '@/lib/translations'


export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language

  return <LanguageProvider initialLang={lang}>{children}</LanguageProvider>
}
