'use client'

import { useLanguage } from './language-provider'
import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export default function LanguageSwitcher() {
  const { lang, setLang } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const options = [
    { value: 'ar', label: 'العربية', flag: '🇸🇦' },
    { value: 'en', label: 'English', flag: '🇬🇧' },
  ] as const

  const current = options.find((o) => o.value === lang) || options[0]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-[38px] items-center justify-center gap-1.5 rounded-lg border border-border bg-card shadow-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-300 select-none px-2.5"
        title="تغيير اللغة"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="text-sm font-medium font-sans">{current.label}</span>
        <ChevronDown
          className={cn(
            'h-3 w-3 transition-transform duration-200',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute end-0 bottom-full mb-2 min-w-full rounded-xl bg-popover text-popover-foreground shadow-lg overflow-hidden z-50 animate-scale-in"
          dir="rtl"
        >
          {options.map((opt) => {
            const isActive = opt.value === lang
            return (
              <button
                key={opt.value}
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  setLang(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-secondary text-foreground/80'
                )}
              >
                <span className="text-base">{opt.flag}</span>
                <span className="flex-1 text-start">{opt.label}</span>
                {isActive && (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
