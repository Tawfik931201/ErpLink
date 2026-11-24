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
  const [activeId, setActiveId] = useState<string>(items[0]?.id || '')
  const [mobileOpen, setMobileOpen] = useState(false)
  const isAr = lang === 'ar'

  // Scroll spy to highlight active section in real time
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
      if (items[0]) {
        setActiveId(items[0].id)
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [items])

  const activeItem = items.find((item) => item.id === activeId) || items[0]

  return (
    <div className={className}>
      {/* Mobile Collapsible Drawer (Full width on mobile) */}
      <div className="lg:hidden mb-6 w-full">
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className="w-full flex items-center justify-between p-3.5 rounded-xl border border-border bg-card shadow-xs text-xs font-semibold text-foreground transition-all cursor-pointer"
          aria-expanded={mobileOpen}
          aria-label={isAr ? 'عرض فهرس الأقسام' : 'Toggle table of contents'}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <ListCollapse className="h-4 w-4 text-primary shrink-0" />
            <span className="font-bold shrink-0">
              {isAr ? 'فهرس الأقسام' : 'Table of Contents'}
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold shrink-0">
              {items.length}
            </span>
            {activeItem && (
              <span className="text-[11px] text-muted-foreground truncate border-s border-border ps-2 ms-0.5 font-normal">
                {activeItem.title}
              </span>
            )}
          </div>
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200',
              mobileOpen && 'rotate-180'
            )}
          />
        </button>

        {mobileOpen && (
          <nav
            aria-label={isAr ? 'فهرس الأقسام للهاتف' : 'Mobile table of contents'}
            className="mt-2 p-3 rounded-xl border border-border/80 bg-card/98 backdrop-blur-md shadow-md max-h-80 overflow-y-auto animate-in fade-in-0 slide-in-from-top-1 duration-150"
          >
            <ul className="space-y-1 text-xs">
              {items.map((item) => {
                const isActive = activeId === item.id
                return (
                  <li key={item.id}>
                    <Link
                      href={`#${item.id}`}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        'flex items-center gap-2 py-2 px-2.5 rounded-lg transition-colors',
                        isActive
                          ? 'bg-primary/10 text-primary font-bold'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                      )}
                    >
                      <span
                        className={cn(
                          'font-mono text-[10px] px-1.5 py-0.5 rounded shrink-0',
                          isActive
                            ? 'bg-primary text-primary-foreground font-bold'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {String(item.number).padStart(2, '0')}
                      </span>
                      <span className="truncate">{item.title}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        )}
      </div>

      {/* Desktop Sticky Sidebar Navigation (Pinned alongside the scrolling content) */}
      <nav
        aria-label={isAr ? 'فهرس محتويات الوثيقة' : 'Document table of contents'}
        className="hidden lg:block rounded-2xl bg-card border border-border p-4 shadow-xs max-h-[calc(100vh-6.5rem)] overflow-y-auto"
      >
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-border/70">
          <div className="flex items-center gap-2">
            <ListCollapse className="h-4 w-4 text-primary shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider text-foreground">
              {isAr ? 'فهرس المحتويات' : 'Table of Contents'}
            </span>
          </div>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold">
            {items.length}
          </span>
        </div>

        <ul className="space-y-1 text-xs">
          {items.map((item) => {
            const isActive = activeId === item.id
            return (
              <li key={item.id}>
                <Link
                  href={`#${item.id}`}
                  className={cn(
                    'group flex items-start gap-2 py-1.5 px-2.5 rounded-lg transition-all leading-relaxed',
                    isActive
                      ? 'bg-primary/10 text-primary font-bold shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                  )}
                >
                  <span
                    className={cn(
                      'font-mono text-[10px] shrink-0 mt-0.5 rounded px-1.5 py-0.5 transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground font-bold'
                        : 'text-muted-foreground/80 bg-muted group-hover:bg-muted/80 group-hover:text-foreground'
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
