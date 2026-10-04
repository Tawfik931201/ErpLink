import { cookies } from 'next/headers'

import { LanguageProvider } from '@/components/language-provider'
import { resolveLanguage } from '@/lib/translations'

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)

  return <LanguageProvider initialLang={lang}>{children}</LanguageProvider>
}
