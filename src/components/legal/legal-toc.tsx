'use client'

import { ListCollapse, ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

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
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const navContainerRef = useRef<HTMLDivElement>(null)
  const isAr = lang === 'ar'

  // Scroll spy to highlight active section in real time
  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 220
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

  // Auto-scroll active pill into view in the horizontal strip
  useEffect(() => {
    if (!activeId) return
    const activePill = document.getElementById(`toc-pill-${activeId}`)
    if (activePill && scrollContainerRef.current) {
      activePill.scrollIntoView({
        behavior: 'smooth',
        inline: 'nearest',
        block: 'nearest',
      })
    }
  }, [activeId])

  // Close dropdown on Escape key or click outside
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDropdownOpen(false)
    }
    const handleClickOutside = (e: MouseEvent) => {
      if (navContainerRef.current && !navContainerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  return (
    <div
      ref={navContainerRef}
      className={cn(
        'sticky top-14 z-40 w-full bg-background/95 backdrop-blur-md border-y border-border shadow-xs transition-colors',
        className
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-12 h-14 flex items-center justify-between gap-3">
        {/* Toggle Dropdown Button */}
        <button
          type="button"
          onClick={() => setDropdownOpen((prev) => !prev)}
          className={cn(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold shrink-0 transition-all shadow-2xs cursor-pointer',
            dropdownOpen
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-card hover:bg-muted text-foreground'
          )}
          aria-expanded={dropdownOpen}
          aria-label={isAr ? 'عرض فهرس جميع الأقسام' : 'View all sections table of contents'}
        >
          <ListCollapse className="h-4 w-4 text-primary shrink-0" />
          <span className="hidden sm:inline">
            {isAr ? 'فهرس الأقسام' : 'Table of Contents'}
          </span>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-bold">
            {items.length}
          </span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform duration-200', dropdownOpen && 'rotate-180')}
          />
        </button>

        {/* Full-width Horizontal Scrollable Strip of Section Pills */}
        <nav
          aria-label={isAr ? 'شريط فهرس الأقسام السريع' : 'Quick section table of contents'}
          ref={scrollContainerRef}
          className="flex-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth py-1 px-1"
        >
          {items.map((item) => {
            const isActive = activeId === item.id
            return (
              <Link
                key={item.id}
                id={`toc-pill-${item.id}`}
                href={`#${item.id}`}
                onClick={() => setDropdownOpen(false)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium shrink-0 transition-all whitespace-nowrap',
                  isActive
                    ? 'bg-primary text-primary-foreground font-semibold shadow-xs scale-[1.02]'
                    : 'bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground'
                )}
              >
                <span
                  className={cn(
                    'font-mono text-[10px]',
                    isActive ? 'text-primary-foreground/90 font-bold' : 'text-muted-foreground/80'
                  )}
                >
                  {String(item.number).padStart(2, '0')}.
                </span>
                <span>{item.title}</span>
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Expandable Full-Width Dropdown Drawer */}
      {dropdownOpen && (
        <div className="border-t border-border bg-card/98 backdrop-blur-xl shadow-xl animate-in fade-in-0 slide-in-from-top-2 duration-200">
          <div className="max-w-7xl mx-auto p-4 sm:p-6 md:px-12 max-h-[65vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-border/80 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <span>{isAr ? 'الانتقال المباشر لأي قسم' : 'Jump directly to any section'}</span>
              <span className="font-mono text-primary font-bold">
                {isAr ? `${items.length} قسماً قانونياً` : `${items.length} Legal Sections`}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {items.map((item) => {
                const isActive = activeId === item.id
                return (
                  <Link
                    key={item.id}
                    href={`#${item.id}`}
                    onClick={() => setDropdownOpen(false)}
                    className={cn(
                      'group flex items-start gap-2.5 p-3 rounded-xl border text-xs transition-all',
                      isActive
                        ? 'border-primary/50 bg-primary/10 text-primary font-semibold shadow-xs'
                        : 'border-border/70 hover:border-border hover:bg-muted/50 text-foreground'
                    )}
                  >
                    <span
                      className={cn(
                        'font-mono text-[11px] font-bold px-1.5 py-0.5 rounded-md shrink-0 mt-0.5',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground group-hover:text-foreground'
                      )}
                    >
                      {String(item.number).padStart(2, '0')}
                    </span>
                    <span className="line-clamp-2 leading-relaxed">{item.title}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
