'use client'

import React, { createContext, useContext, useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { translations, Language } from '@/lib/translations'

interface LanguageContextProps {
  lang: Language
  dir: 'rtl' | 'ltr'
  setLang: (lang: Language) => void
  t: (key: keyof typeof translations['ar'] | string, defaultText?: string) => string
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined)

export function LanguageProvider({
  children,
  initialLang,
}: {
  children: React.ReactNode
  initialLang: Language
}) {
  const [lang, setLangState] = useState<Language>(initialLang)
  const router = useRouter()
  const [, startTransition] = useTransition()

  // Derived direction
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  // Function to switch language
  const setLang = (newLang: Language) => {
    if (newLang === lang) return

    setLangState(newLang)

    // Save to cookies with 1 year expiration
    document.cookie = `lang=${newLang}; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`

    // Update document root immediately for smooth visual shift
    document.documentElement.lang = newLang
    document.documentElement.dir = newLang === 'ar' ? 'rtl' : 'ltr'

    // Refresh page components from server to get new translations
    startTransition(() => {
      router.refresh()
    })
  }

  // Effect to ensure client matches state on initial mount/changes
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }, [lang])

  // Translation helper
  const t = (key: string, defaultText?: string): string => {
    const dict = translations[lang] as Record<string, string>
    if (dict && dict[key]) {
      return dict[key]
    }
    // Fallback dictionary
    const fallbackDict = translations['ar'] as Record<string, string>
    if (fallbackDict && fallbackDict[key]) {
      return fallbackDict[key]
    }
    return defaultText || key
  }

  return (
    <LanguageContext.Provider value={{ lang, dir, setLang, t }}>
      <div dir={dir}>{children}</div>
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
