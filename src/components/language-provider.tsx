'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'

import {
  SUPPORTED_URL_LOCALES,
  getUrlLocaleFromLanguage,
} from '@/lib/locale'
import type { Language } from '@/lib/translations'
import { translations } from '@/lib/translations'

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
  const [lang] = useState<Language>(initialLang)

  // Derived direction
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  // Function to switch language — does a full page reload to the new locale URL
  const setLang = (newLang: Language) => {
    if (newLang === lang) return

    // Save to cookies before navigating (middleware will also set it)
    document.cookie = `lang=${newLang}; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`
    document.documentElement.lang = newLang
    document.documentElement.dir = newLang === 'ar' ? 'rtl' : 'ltr'

    // Build new URL with locale prefix
    const currentPath = window.location.pathname
    const search = window.location.search
    const newUrlLocale = getUrlLocaleFromLanguage(newLang)

    const firstSegment = currentPath.split('/').filter(Boolean)[0]?.toLowerCase()
    let newPath: string
    if (SUPPORTED_URL_LOCALES.includes(firstSegment)) {
      newPath = currentPath.replace(/^\/[^/]+/, '/' + newUrlLocale)
    } else {
      newPath = '/' + newUrlLocale + (currentPath === '/' ? '' : currentPath)
    }

    window.location.href = newPath + search
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
