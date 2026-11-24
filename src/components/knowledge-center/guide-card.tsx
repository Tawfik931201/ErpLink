import { ArrowLeft, ArrowRight, Clock } from 'lucide-react'
import Link from 'next/link'

import { guideCategories } from '@/lib/knowledge-center/categories'
import type { GuideContent } from '@/lib/knowledge-center/types'
import type { Language } from '@/lib/translations'

interface GuideCardProps {
  guide: GuideContent
  lang: Language
  featured?: boolean
}

export function GuideCard({ guide, lang, featured }: GuideCardProps) {
  const isAr = lang === 'ar'
  const category = guideCategories[guide.meta.category]
  const Arrow = isAr ? ArrowLeft : ArrowRight

  return (
    <article
      className={`group relative flex flex-col justify-between rounded-2xl border transition-all duration-200 hover:shadow-lg ${
        featured
          ? 'border-primary/40 bg-card hover:border-primary'
          : 'border-border bg-card/70 hover:border-border/80 hover:bg-card'
      } p-6`}
    >
      <div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="inline-flex items-center rounded-full bg-secondary/80 px-2.5 py-1 font-semibold text-secondary-foreground">
            {category?.title[lang] || guide.meta.category}
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>
              {guide.meta.readingTimeMinutes} {isAr ? 'دقائق قراءة' : 'min read'}
            </span>
          </span>
        </div>

        <h3 className="mt-4 text-lg font-bold leading-snug tracking-tight text-foreground transition-colors group-hover:text-primary">
          <Link href={`/guides/${guide.meta.slug}`} className="focus:outline-none focus:underline">
            {guide.meta.title[lang]}
          </Link>
        </h3>

        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground line-clamp-3">
          {guide.meta.description[lang]}
        </p>
      </div>

      <div className="mt-6 pt-4 border-t border-border/50 flex items-center justify-between">
        <Link
          href={`/guides/${guide.meta.slug}`}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-primary transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
        >
          <span>{isAr ? 'اقرأ الدليل' : 'Read Guide'}</span>
          <Arrow className="h-3.5 w-3.5" />
        </Link>
        {guide.meta.featured && (
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-primary/80">
            {isAr ? 'دليل مميز' : 'Featured'}
          </span>
        )}
      </div>
    </article>
  )
}
