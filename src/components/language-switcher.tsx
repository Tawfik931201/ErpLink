'use client'

import { useLanguage } from './language-provider'
import { Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function LanguageSwitcher() {
  const { lang, setLang } = useLanguage()

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
      className="flex items-center gap-2 rounded-xl text-muted-foreground hover:text-foreground border border-border bg-card shadow-sm hover:bg-secondary transition-all duration-300 select-none text-xs font-bold py-1.5 px-3.5 h-8.5"
    >
      <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
      <span>{lang === 'ar' ? 'English' : 'العربية'}</span>
    </Button>
  )
}
