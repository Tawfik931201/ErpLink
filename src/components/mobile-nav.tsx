'use client'

import { Menu, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { PendingTicketsBadge } from '@/components/pending-tickets-badge'
import { Logo } from '@/components/ui/logo'
import { cn } from '@/lib/utils'

export interface MobileNavSectionItem {
  href: string
  icon: string
  label: string
  children?: MobileNavSectionItem[]
}

export interface MobileNavSection {
  items: MobileNavSectionItem[]
}

/** Mobile-only hamburger navigation that mirrors the desktop sidebar links. */
export default function MobileNav({
  sections,
  dir,
  children,
}: {
  sections: MobileNavSection[]
  dir: 'rtl' | 'ltr'
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <div className="md:hidden border-b border-border bg-sidebar">
      <div className="flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-background text-foreground hover:bg-muted active:scale-95 transition-all shrink-0"
        >
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
        <Link href="/app/dashboard" className="flex items-center shrink-0" aria-label="ErpLink Dashboard">
          <Logo variant="horizontal" size="sm" priority />
        </Link>
        <div className="ms-auto min-w-0 flex items-center gap-1.5 sm:gap-2">{children}</div>
      </div>

      {open && (
        <nav className="max-h-[70dvh] overflow-y-auto px-3 pb-3 space-y-2 border-t border-border/50 pt-2 animate-in slide-in-from-top-1 duration-150" dir={dir}>
          {sections.map((section, i) => (
            <div key={i} className="space-y-1">
              {section.items.map((item) => {
                if (item.children && item.children.length > 0) {
                  return (
                    <div key={item.href} className="space-y-1">
                      <span className="flex items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {item.label}
                      </span>
                      {item.children.map((child) => {
                        const childActive = pathname === child.href
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={() => setOpen(false)}
                            className={cn(
                              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors active:bg-muted/80',
                              childActive ? 'bg-foreground text-background font-bold' : 'text-foreground hover:bg-muted'
                            )}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                            {child.label}
                          </Link>
                        )
                      })}
                    </div>
                  )
                }
                const active = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors active:bg-muted/80',
                      active ? 'bg-foreground text-background font-bold' : 'text-foreground hover:bg-muted'
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                    <span className="flex-1">{item.label}</span>
                    {item.href === '/app/tickets' && <PendingTicketsBadge />}
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
