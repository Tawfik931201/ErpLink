import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

import type { Language } from '@/lib/translations'

interface BreadcrumbItem {
  name: string
  href?: string
}

interface GuideBreadcrumbsProps {
  items: BreadcrumbItem[]
  lang: Language
}

export function GuideBreadcrumbs({ items, lang }: GuideBreadcrumbsProps) {
  const isAr = lang === 'ar'
  const Chevron = isAr ? ChevronLeft : ChevronRight

  return (
    <nav
      aria-label={isAr ? 'مسار التصفح' : 'Breadcrumbs'}
      className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1
        return (
          <div key={idx} className="flex items-center gap-1.5">
            {idx > 0 && <Chevron className="h-3.5 w-3.5 opacity-40 shrink-0" />}
            {item.href && !isLast ? (
              <Link href={item.href} className="transition-colors hover:text-foreground">
                {item.name}
              </Link>
            ) : (
              <span className={isLast ? 'font-medium text-foreground truncate max-w-xs sm:max-w-md' : ''}>
                {item.name}
              </span>
            )}
          </div>
        )
      })}
    </nav>
  )
}
