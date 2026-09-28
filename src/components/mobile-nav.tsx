'use client'

import { Menu, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { Logo } from '@/components/ui/logo'
import { cn } from '@/lib/utils'

export interface MobileNavSectionItem {
  href: string
  icon: string
  label: string
}

export interface MobileNavSection {
  items: MobileNavSectionItem[]
}

/** Mobile-only hamburger navigation that mirrors the desktop sidebar links. */
export default function MobileNav({
  sections,
  dir,
}: {
  sections: MobileNavSection[]
  dir: 'rtl' | 'ltr'
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <div className="md:hidden border-b border-border bg-sidebar">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-background text-foreground"
        >
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
        <Link href="/app/dashboard" className="flex items-center" aria-label="ErpLink Dashboard">
          <Logo variant="horizontal" size="sm" priority />
        </Link>
      </div>

      {open && (
        <nav className="px-3 pb-3 space-y-2" dir={dir}>
          {sections.map((section, i) => (
            <div key={i} className="space-y-1">
              {section.items.map((item) => {
                const active = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
                      active ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted'
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
      )}
    </div>
  )
}