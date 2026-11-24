'use client'

import { AlignLeft, ChevronDown } from 'lucide-react'
import React, { useEffect, useState } from 'react'

import type { DocHeading } from '@/lib/documentation/docs-types'
import type { Language } from '@/lib/translations'

export function DocsTableOfContents({
  headings,
  lang,
}: {
  headings: DocHeading[]
  lang: Language
}) {
  const [activeId, setActiveId] = useState<string>('')
  const [isOpenMobile, setIsOpenMobile] = useState<boolean>(false)
  const isAr = lang === 'ar'

  useEffect(() => {
    if (!headings || headings.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        })
      },
      {
        rootMargin: '-80px 0% -60% 0%',
        threshold: 0.1,
      }
    )

    headings.forEach((h) => {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [headings])

  if (!headings || headings.length === 0) return null

  const scrollToHeading = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault()
    const target = document.getElementById(id)
    if (target) {
      const yOffset = -90 // header height offset
      const y = target.getBoundingClientRect().top + window.pageYOffset + yOffset
      window.scrollTo({ top: y, behavior: 'smooth' })
      setActiveId(id)
      history.pushState(null, '', `#${id}`)
      setIsOpenMobile(false)
    }
  }

  return (
    <>
      {/* Mobile Collapsible TOC */}
      <div className="xl:hidden my-6 border border-border rounded-lg bg-card/50 overflow-hidden">
        <button
          type="button"
          onClick={() => setIsOpenMobile(!isOpenMobile)}
          className="w-full flex items-center justify-between p-3.5 text-xs font-semibold text-foreground hover:bg-muted/30 transition-colors"
          aria-expanded={isOpenMobile}
        >
          <div className="flex items-center gap-2">
            <AlignLeft className="h-4 w-4 text-primary" />
            <span>{isAr ? 'محتويات هذا الدليل' : 'On this page'}</span>
          </div>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
              isOpenMobile ? 'rotate-180' : ''
            }`}
          />
        </button>
        {isOpenMobile && (
          <ul className="px-4 pb-4 pt-1 space-y-2 border-t border-border/50 text-xs text-muted-foreground">
            {headings.map((h) => (
              <li key={h.id} className={h.level === 3 ? 'ps-4' : ''}>
                <a
                  href={`#${h.id}`}
                  onClick={(e) => scrollToHeading(e, h.id)}
                  className={`block py-1 transition-colors ${
                    activeId === h.id ? 'text-primary font-bold' : 'hover:text-foreground'
                  }`}
                >
                  {h.text[lang]}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Desktop Sticky Right/Left Sidebar */}
      <nav
        aria-label={isAr ? 'فهرس المحتويات' : 'Table of Contents'}
        className="hidden xl:block sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto overscroll-contain py-2 text-xs"
      >
        <div className="flex items-center gap-2 font-bold text-foreground mb-3 px-2">
          <AlignLeft className="h-3.5 w-3.5 text-primary" />
          <span>{isAr ? 'في هذه الصفحة' : 'On this page'}</span>
        </div>
        <ul className="space-y-1.5 border-s border-border ps-2 ms-2">
          {headings.map((h) => {
            const isActive = activeId === h.id
            return (
              <li key={h.id} className={h.level === 3 ? 'ps-3' : ''}>
                <a
                  href={`#${h.id}`}
                  onClick={(e) => scrollToHeading(e, h.id)}
                  className={`block py-1 text-[11px] leading-snug transition-colors -ms-[9px] ps-3 border-s-2 ${
                    isActive
                      ? 'border-primary text-primary font-bold'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/50'
                  }`}
                >
                  {h.text[lang]}
                </a>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}
