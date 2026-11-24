import { ChevronRight, ChevronLeft, Home } from 'lucide-react'
import Link from 'next/link'
import React from 'react'

import type { Language } from '@/lib/translations'

export interface BreadcrumbItem {
  label: string
  href?: string
}

export function DocsBreadcrumbs({
  items,
  lang,
}: {
  items: BreadcrumbItem[]
  lang: Language
}) {
  const isAr = lang === 'ar'
  const Chevron = isAr ? ChevronLeft : ChevronRight

  return (
    <nav
      aria-label={isAr ? 'مسار التصفح' : 'Breadcrumbs'}
      className="flex items-center gap-1.5 text-xs text-muted-foreground mb-6 flex-wrap"
    >
      <Link
        href="/"
        className="flex items-center gap-1 hover:text-foreground transition-colors"
        aria-label={isAr ? 'الرئيسية' : 'Home'}
      >
        <Home className="h-3.5 w-3.5" />
      </Link>
      <Chevron className="h-3 w-3 text-muted-foreground/50 shrink-0" aria-hidden="true" />
      <Link href="/docs" className="hover:text-foreground transition-colors">
        {isAr ? 'التوثيق' : 'Documentation'}
      </Link>

      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <React.Fragment key={index}>
            <Chevron className="h-3 w-3 text-muted-foreground/50 shrink-0" aria-hidden="true" />
            {isLast || !item.href ? (
              <span className="font-medium text-foreground truncate max-w-[200px] sm:max-w-[300px]">
                {item.label}
              </span>
            ) : (
              <Link href={item.href} className="hover:text-foreground transition-colors truncate max-w-[150px]">
                {item.label}
              </Link>
            )}
          </React.Fragment>
        )
      })}
    </nav>
  )
}
