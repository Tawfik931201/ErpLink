import { cookies } from 'next/headers'

import { LanguageProvider } from '@/components/language-provider'
import { resolveLanguage } from '@/lib/translations'

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)

  return <LanguageProvider initialLang={lang}>{children}</LanguageProvider>
}
