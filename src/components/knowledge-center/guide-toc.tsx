'use client'

import { List } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { GuideSection } from '@/lib/knowledge-center/types'
import type { Language } from '@/lib/translations'

interface GuideTocProps {
  sections: GuideSection[]
  lang: Language
}

export function GuideToc({ sections, lang }: GuideTocProps) {
  const [activeId, setActiveId] = useState<string>('')
  const isAr = lang === 'ar'

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 120
      for (let i = sections.length - 1; i >= 0; i--) {
        const el = document.getElementById(sections[i].id)
        if (el && el.offsetTop <= scrollPosition) {
          setActiveId(sections[i].id)
          return
        }
      }
      if (sections.length > 0 && window.scrollY < 200) {
        setActiveId(sections[0].id)
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [sections])

  return (
    <nav
      aria-label={isAr ? 'فهرس محتويات الدليل' : 'Table of contents'}
      className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 border-b border-border pb-3 text-xs font-bold uppercase tracking-wider text-foreground">
        <List className="h-4 w-4 text-primary" />
        <span>{isAr ? 'محتويات هذا الدليل' : 'In this guide'}</span>
      </div>

      <ol className="mt-3.5 space-y-2 text-xs leading-relaxed">
        {sections.map((section, idx) => {
          const isActive = activeId === section.id
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className={`block rounded-lg px-2.5 py-1.5 transition-colors ${
                  isActive
                    ? 'bg-primary/10 font-bold text-primary'
                    : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                }`}
              >
                <span className="font-mono text-[10px] me-1.5 opacity-60">0{idx + 1}.</span>
                <span>{section.title[lang]}</span>
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
