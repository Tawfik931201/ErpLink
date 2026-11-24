import { ArrowLeft, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import React from 'react'

import type { DocNavItem } from '@/lib/documentation/docs-types'
import type { Language } from '@/lib/translations'

export function DocsPagination({
  prev,
  next,
  lang,
}: {
  prev: DocNavItem | null
  next: DocNavItem | null
  lang: Language
}) {
  const isAr = lang === 'ar'
  const PrevIcon = isAr ? ArrowRight : ArrowLeft
  const NextIcon = isAr ? ArrowLeft : ArrowRight

  if (!prev && !next) return null

  return (
    <div className="mt-12 pt-6 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-4">
      {prev ? (
        <Link
          href={prev.href}
          className="group flex flex-col p-4 rounded-xl border border-border bg-card/40 hover:bg-card hover:border-primary/40 transition-all text-start"
        >
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground mb-1 group-hover:text-primary transition-colors">
            <PrevIcon className="h-3.5 w-3.5" />
            <span>{isAr ? 'الدليل السابق' : 'Previous'}</span>
          </span>
          <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors line-clamp-1">
            {prev.title[lang]}
          </span>
        </Link>
      ) : (
        <div aria-hidden="true" className="hidden sm:block" />
      )}

      {next && (
        <Link
          href={next.href}
          className="group flex flex-col p-4 rounded-xl border border-border bg-card/40 hover:bg-card hover:border-primary/40 transition-all text-end sm:ms-auto w-full"
        >
          <span className="flex items-center justify-end gap-1.5 text-[11px] font-semibold text-muted-foreground mb-1 group-hover:text-primary transition-colors">
            <span>{isAr ? 'الدليل التالي' : 'Next'}</span>
            <NextIcon className="h-3.5 w-3.5" />
          </span>
          <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors line-clamp-1">
            {next.title[lang]}
          </span>
        </Link>
      )}
    </div>
  )
}
