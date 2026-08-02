export const URL_LOCALE_MAP: Record<string, string> = {
  'ar-sa': 'ar',
  'en-us': 'en',
}

export const LANG_TO_URL_LOCALE: Record<string, string> = {
  ar: 'ar-sa',
  en: 'en-us',
}

export const SUPPORTED_URL_LOCALES = Object.keys(URL_LOCALE_MAP)
export const DEFAULT_LANG = 'ar'
export const DEFAULT_URL_LOCALE = 'ar-sa'

export function getLanguageFromUrlLocale(urlLocale: string): string {
  return URL_LOCALE_MAP[urlLocale.toLowerCase()] || DEFAULT_LANG
}

export function getUrlLocaleFromLanguage(lang: string): string {
  return LANG_TO_URL_LOCALE[lang] || DEFAULT_URL_LOCALE
}

export function getUrlLocaleFromPathname(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length > 0 && SUPPORTED_URL_LOCALES.includes(parts[0].toLowerCase())) {
    return parts[0].toLowerCase()
  }
  return null
}

export function stripLocaleFromPathname(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length > 0 && SUPPORTED_URL_LOCALES.includes(parts[0].toLowerCase())) {
    return '/' + parts.slice(1).join('/')
  }
  return pathname
}
