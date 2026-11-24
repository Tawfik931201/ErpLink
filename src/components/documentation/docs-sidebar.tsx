'use client'

import {
  ChevronDown,
  Search,
  Rocket,
  Link2,
  GitBranch,
  ShoppingCart,
  Activity,
  Users,
  LifeBuoy,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useState, useEffect } from 'react'

import { DOCS_SECTIONS } from '@/lib/documentation/docs-navigation'
import type { Language } from '@/lib/translations'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Rocket,
  Link2,
  GitBranch,
  ShoppingCart,
  Activity,
  Users,
  LifeBuoy,
}

export function DocsSidebar({
  lang,
  onOpenSearch,
  isMobileDrawer = false,
  onCloseMobile,
}: {
  lang: Language
  onOpenSearch: () => void
  isMobileDrawer?: boolean
  onCloseMobile?: () => void
}) {
  const pathname = usePathname()
  const isAr = lang === 'ar'

  // Normalize pathname to stripped version
  const currentPath = pathname.replace(/^\/(?:ar-sa|en-us)/, '') || '/docs'

  // State of open category sections
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    DOCS_SECTIONS.forEach((sec) => {
      // By default open all or open matching
      const hasActiveChild = sec.items.some((item) => item.href === currentPath)
      initial[sec.category] = hasActiveChild || true
    })
    return initial
  })

  // Auto-expand section if path changes
  useEffect(() => {
    DOCS_SECTIONS.forEach((sec) => {
      const hasActiveChild = sec.items.some((item) => item.href === currentPath)
      if (hasActiveChild) {
        setOpenSections((prev) => ({ ...prev, [sec.category]: true }))
      }
    })
  }, [currentPath])

  const toggleSection = (category: string) => {
    setOpenSections((prev) => ({ ...prev, [category]: !prev[category] }))
  }

  return (
    <aside
      className={`flex flex-col ${
        isMobileDrawer
          ? 'w-full h-full p-4'
          : 'w-64 xl:w-72 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto overscroll-contain py-6 ps-4 pe-3 border-e border-border'
      }`}
    >
      {/* Search Bar Button Trigger */}
      <div className="mb-6 px-1">
        <button
          type="button"
          onClick={onOpenSearch}
          className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg border border-border bg-card/60 hover:bg-card hover:border-primary/40 text-muted-foreground transition-all shadow-sm"
          aria-label={isAr ? 'البحث في التوثيق' : 'Search documentation'}
        >
          <div className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{isAr ? 'ابحث في التوثيق...' : 'Search docs...'}</span>
          </div>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] bg-muted px-1.5 py-0.5 rounded border border-border font-mono">
            <span>⌘</span>
            <span>K</span>
          </kbd>
        </button>
      </div>

      {/* Navigation Sections */}
      <nav
        aria-label={isAr ? 'قائمة التوثيق الجانبية' : 'Documentation navigation'}
        className="space-y-5 text-xs flex-1"
      >
        {DOCS_SECTIONS.map((section) => {
          const isOpen = openSections[section.category] ?? true
          const SectionIcon = ICON_MAP[section.iconName] || Rocket

          return (
            <div key={section.category} className="space-y-1">
              <button
                type="button"
                onClick={() => toggleSection(section.category)}
                className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-bold text-foreground/80 hover:text-foreground rounded-md transition-colors"
                aria-expanded={isOpen}
              >
                <div className="flex items-center gap-2">
                  <SectionIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>{section.title[lang]}</span>
                </div>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${
                    isOpen ? 'rotate-0' : '-rotate-90'
                  }`}
                />
              </button>

              {isOpen && (
                <ul className="space-y-0.5 border-s border-border ps-2 ms-3.5 my-1">
                  {section.items.map((item) => {
                    const isActive = currentPath === item.href
                    return (
                      <li key={item.slug}>
                        <Link
                          href={item.href}
                          onClick={() => {
                            if (isMobileDrawer && onCloseMobile) onCloseMobile()
                          }}
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-[11px] font-medium leading-snug transition-colors ${
                            isActive
                              ? 'bg-primary/10 text-primary font-bold'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                          }`}
                        >
                          <span className="truncate">{item.title[lang]}</span>
                          {item.badge && (
                            <span
                              className={`ms-1.5 px-1.5 py-0.2 rounded text-[9px] font-bold shrink-0 ${
                                item.badge.variant === 'brand'
                                  ? 'bg-primary/15 text-primary'
                                  : item.badge.variant === 'success'
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {item.badge.text[lang]}
                            </span>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
