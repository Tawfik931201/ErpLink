'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Avoid hydration mismatch by waiting for client-side mount
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="flex h-8.5 w-8.5 items-center justify-center rounded-xl border border-slate-200/40 bg-white shadow-sm text-slate-400 select-none p-0 pointer-events-none"
        disabled
      >
        <Moon className="h-4 w-4 shrink-0" />
      </Button>
    )
  }

  const isDark = theme === 'dark'

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="flex h-8.5 w-8.5 items-center justify-center rounded-xl border border-border bg-card shadow-sm text-muted-foreground hover:text-foreground hover:bg-secondary select-none p-0 transition-all duration-300"
      title={isDark ? 'تفعيل الوضع المضيء' : 'تفعيل الوضع الداكن'}
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-amber-500 shrink-0" />
      ) : (
        <Moon className="h-4 w-4 text-primary shrink-0" />
      )}
    </Button>
  )
}
