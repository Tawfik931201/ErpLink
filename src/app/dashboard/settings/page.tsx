'use client'

import React, { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { useLanguage } from '@/components/language-provider'
import { Sun, Moon, Globe, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getUserSettings, updateUserSettings } from '@/app/actions/settings'

export default function GeneralSettingsPage() {
  const { theme, setTheme } = useTheme()
  const { lang, setLang } = useLanguage()
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Fetch settings from database on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await getUserSettings()
        if (res.success && res.settings) {
          const dbLang = res.settings.lang
          const dbTheme = res.settings.theme
          
          if (dbLang && dbLang !== lang) {
            setLang(dbLang as any)
          }
          if (dbTheme && dbTheme !== theme) {
            setTheme(dbTheme)
          }
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    loadSettings()
  }, [])

  const handleLanguageChange = async (newLang: 'ar' | 'en') => {
    if (newLang === lang) return
    setSaving(true)
    // Update client cookie/state immediately for visual response
    setLang(newLang)
    // Persist in Supabase
    await updateUserSettings(newLang, theme || 'light')
    setSaving(false)
  }

  const handleThemeChange = async (newTheme: string) => {
    if (newTheme === theme) return
    setSaving(true)
    // Update client state immediately for visual response
    setTheme(newTheme)
    // Persist in Supabase
    await updateUserSettings(lang, newTheme)
    setSaving(false)
  }

  const languages = [
    {
      code: 'ar',
      name: 'العربية',
      desc: 'واجهة باللغة العربية مع اتجاه RTL',
      flag: '🇸🇦'
    },
    {
      code: 'en',
      name: 'English',
      desc: 'English interface with LTR direction',
      flag: '🇺🇸'
    }
  ]

  const themes = [
    {
      code: 'light',
      name: lang === 'ar' ? 'الوضع المضيء' : 'Light Mode',
      desc: lang === 'ar' ? 'المظهر الافتراضي الساطع' : 'Default bright appearance',
      icon: Sun,
      colorClass: 'text-amber-500 bg-amber-500/10'
    },
    {
      code: 'dark',
      name: lang === 'ar' ? 'الوضع الداكن' : 'Dark Mode',
      desc: lang === 'ar' ? 'مظهر داكن مريح للعين' : 'Eye-friendly dark appearance',
      icon: Moon,
      colorClass: 'text-primary bg-primary/10'
    }
  ]

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Saving State Toast Indicator */}
      {saving && (
        <div className={cn(
          "fixed bottom-4 z-50 flex items-center gap-2 bg-card border border-border px-4 py-2.5 rounded-xl shadow-lg text-xs font-bold text-foreground",
          lang === 'ar' ? 'left-4' : 'right-4'
        )}>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>{lang === 'ar' ? 'جاري حفظ التفضيلات...' : 'Saving preferences...'}</span>
        </div>
      )}

      {/* Language Section */}
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Globe className="h-4.5 w-4.5 text-primary" />
            <span>{lang === 'ar' ? 'لغة التطبيق' : 'App Language'}</span>
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {lang === 'ar' ? 'اختر اللغة المفضلة لواجهة المستخدم.' : 'Choose your preferred language for the user interface.'}
          </p>
        </div>

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {languages.map((l) => {
            const isSelected = lang === l.code
            return (
              <button
                key={l.code}
                onClick={() => handleLanguageChange(l.code as any)}
                className={cn(
                  "relative flex items-start gap-3 p-3.5 rounded-xl border text-start transition-all duration-300 outline-none select-none w-full",
                  isSelected
                    ? "bg-primary/[0.02] border-primary/50 shadow-sm"
                    : "bg-card border-border hover:border-border/80 hover:bg-secondary/10"
                )}
              >
                <span className="text-xl shrink-0">{l.flag}</span>
                <div className={cn("space-y-0.5", lang === 'ar' ? "pr-1 pl-6" : "pl-1 pr-6")}>
                  <h3 className="font-bold text-xs text-foreground">{l.name}</h3>
                  <p className="text-[10px] text-muted-foreground leading-normal">{l.desc}</p>
                </div>
                {isSelected && (
                  <CheckCircle2 className={cn("absolute top-3.5", lang === 'ar' ? "left-3.5" : "right-3.5", "h-4 w-4 text-primary shrink-0")} />
                )}
              </button>
            )
          })}
        </div>
      </div>

      <hr className="border-border/40" />

      {/* Theme Section */}
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            {theme === 'dark' ? <Moon className="h-4.5 w-4.5 text-primary" /> : <Sun className="h-4.5 w-4.5 text-amber-500" />}
            <span>{lang === 'ar' ? 'مظهر التطبيق' : 'App Theme'}</span>
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {lang === 'ar' ? 'التبديل بين الوضع المضيء والوضع الداكن.' : 'Switch between Light Mode and Dark Mode.'}
          </p>
        </div>

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {themes.map((t) => {
            const isSelected = theme === t.code
            const Icon = t.icon
            return (
              <button
                key={t.code}
                onClick={() => handleThemeChange(t.code)}
                className={cn(
                  "relative flex items-start gap-3 p-3.5 rounded-xl border text-start transition-all duration-300 outline-none select-none w-full",
                  isSelected
                    ? "bg-primary/[0.02] border-primary/50 shadow-sm"
                    : "bg-card border-border hover:border-border/80 hover:bg-secondary/10"
                )}
              >
                <div className={cn("p-1.5 rounded-lg shrink-0", t.colorClass)}>
                  <Icon className="h-4 w-4 shrink-0" />
                </div>
                <div className={cn("space-y-0.5", lang === 'ar' ? "pr-1 pl-6" : "pl-1 pr-6")}>
                  <h3 className="font-bold text-xs text-foreground">{t.name}</h3>
                  <p className="text-[10px] text-muted-foreground leading-normal">{t.desc}</p>
                </div>
                {isSelected && (
                  <CheckCircle2 className={cn("absolute top-3.5", lang === 'ar' ? "left-3.5" : "right-3.5", "h-4 w-4 text-primary shrink-0")} />
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
