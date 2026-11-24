'use client'

import { ListCollapse, ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { type Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

interface TocItem {
  id: string
  number: number
  title: string
}

interface LegalTableOfContentsProps {
  items: TocItem[]
  lang: Language
  className?: string
}

export function LegalTableOfContents({ items, lang, className }: LegalTableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const isAr = lang === 'ar'

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 160
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]
        const element = document.getElementById(item.id)
        if (element && element.offsetTop <= scrollPosition) {
          setActiveId(item.id)
          return
        }
      }
      if (window.scrollY < 200 && items[0]) {
        setActiveId(items[0].id)
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [items])

  return (
    <div className={className}>
      {/* Mobile Accordion */}
      <div className="lg:hidden mb-8 bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className="w-full flex items-center justify-between p-4 text-start font-semibold text-sm text-foreground hover:bg-muted/50 transition-colors"
          aria-expanded={mobileOpen}
          aria-label={isAr ? 'تبديل عرض فهرس المحتويات' : 'Toggle table of contents'}
        >
          <div className="flex items-center gap-2">
            <ListCollapse className="h-4 w-4 text-primary" />
            <span>
              {isAr ? `فهرس المحتويات (${items.length} أقسام)` : `Table of Contents (${items.length} Sections)`}
            </span>
          </div>
          <ChevronDown
            className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', mobileOpen && 'rotate-180')}
          />
        </button>

        {mobileOpen && (
          <nav
            aria-label={isAr ? 'فهرس المحتويات' : 'Table of Contents'}
            className="p-4 pt-1 border-t border-border/60 bg-muted/20 max-h-80 overflow-y-auto"
          >
            <ul className="space-y-1.5 text-xs">
              {items.map((item) => {
                const isActive = activeId === item.id
                return (
                  <li key={item.id}>
                    <Link
                      href={`#${item.id}`}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        'block py-1.5 px-2.5 rounded-md transition-colors',
                        isActive
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                      )}
                    >
                      <span className="font-mono opacity-60 me-1.5">{String(item.number).padStart(2, '0')}.</span>
                      {item.title}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        )}
      </div>

      {/* Desktop Sticky Sidebar */}
      <nav
        aria-label={isAr ? 'فهرس المحتويات' : 'Table of Contents'}
        className="hidden lg:block sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-2xl bg-card border border-border p-5 shadow-sm"
      >
        <div className="flex items-center gap-2 pb-3 mb-3 border-b border-border">
          <ListCollapse className="h-4 w-4 text-primary shrink-0" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
            {isAr ? 'فهرس المحتويات' : 'Table of Contents'}
          </h3>
        </div>

        <ul className="space-y-1 text-xs">
          {items.map((item) => {
            const isActive = activeId === item.id
            return (
              <li key={item.id}>
                <Link
                  href={`#${item.id}`}
                  className={cn(
                    'group flex items-start gap-2 py-1.5 px-2.5 rounded-lg transition-colors leading-relaxed',
                    isActive
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <span
                    className={cn(
                      'font-mono text-[10px] shrink-0 mt-0.5 rounded px-1 py-0.2',
                      isActive ? 'bg-primary/20 text-primary font-bold' : 'text-muted-foreground/70 bg-muted'
                    )}
                  >
                    {String(item.number).padStart(2, '0')}
                  </span>
                  <span className="line-clamp-2">{item.title}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
