'use client'

import { Sun, Moon, Monitor, ChevronDown } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState, useRef } from 'react'

import { useLanguage } from './language-provider'

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const { lang } = useLanguage()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

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

  if (!mounted) {
    return (
      <div
        className="flex h-[38px] items-center justify-center gap-1.5 rounded-lg border border-border bg-card shadow-sm text-muted-foreground select-none px-2.5"
        aria-hidden
      >
        <Moon className="h-4 w-4 shrink-0" />
      </div>
    )
  }

  const options = [
    { value: 'light', label: lang === 'ar' ? 'فاتح' : 'Light', icon: Sun },
    { value: 'dark', label: lang === 'ar' ? 'داكن' : 'Dark', icon: Moon },
    { value: 'system', label: lang === 'ar' ? 'النظام' : 'System', icon: Monitor },
  ] as const

  const current = options.find((o) => o.value === theme) || options[0]
  const CurrentIcon = current.icon

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-[38px] items-center justify-center gap-1.5 rounded-lg border border-border bg-card shadow-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-300 select-none px-2.5"
        title={lang === 'ar' ? 'تغيير المظهر' : 'Toggle theme'}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <CurrentIcon className="h-4 w-4 shrink-0" />
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
            const Icon = opt.icon
            const isActive = opt.value === theme
            return (
              <button
                key={opt.value}
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  setTheme(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-secondary text-foreground/80'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
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

function cn(...args: (string | false | undefined | null)[]) {
  return args.filter(Boolean).join(' ')
}
