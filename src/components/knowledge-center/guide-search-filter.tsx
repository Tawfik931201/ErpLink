'use client'

import { Search, X, Layers, Box, FileText, RotateCcw, ShoppingBag, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { GuideCategory, GuideCategorySlug, GuideContent } from '@/lib/knowledge-center/types'
import type { Language } from '@/lib/translations'

import { GuideCard } from './guide-card'

interface GuideSearchFilterProps {
  guides: GuideContent[]
  categories: GuideCategory[]
  lang: Language
}

const iconMap = {
  ShoppingBag,
  RefreshCw,
  Layers,
  Box,
  FileText,
  RotateCcw,
}

export function GuideSearchFilter({ guides, categories, lang }: GuideSearchFilterProps) {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<GuideCategorySlug | 'all'>('all')

  const isAr = lang === 'ar'

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: guides.length }
    for (const cat of categories) {
      counts[cat.slug] = guides.filter((g) => g.meta.category === cat.slug).length
    }
    return counts
  }, [guides, categories])

  const filteredGuides = useMemo(() => {
    const q = query.trim().toLowerCase()
    return guides.filter((guide) => {
      if (activeCategory !== 'all' && guide.meta.category !== activeCategory) {
        return false
      }
      if (!q) return true

      const title = guide.meta.title[lang].toLowerCase()
      const desc = guide.meta.description[lang].toLowerCase()
      const primaryKw = guide.meta.primaryKeyword[lang].toLowerCase()
      const secondaryKws = guide.meta.secondaryKeywords[lang].map((k) => k.toLowerCase()).join(' ')
      const categorySlug = guide.meta.category.toLowerCase()

      return (
        title.includes(q) ||
        desc.includes(q) ||
        primaryKw.includes(q) ||
        secondaryKws.includes(q) ||
        categorySlug.includes(q)
      )
    })
  }, [guides, query, activeCategory, lang])

  const handleClear = () => {
    setQuery('')
    setActiveCategory('all')
  }

  return (
    <div className="space-y-8">
      {/* Search Bar & Stats */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-lg">
          <label htmlFor="guide-search" className="sr-only">
            {isAr ? 'ابحث في مركز المعرفة' : 'Search knowledge center'}
          </label>
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="guide-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isAr
                ? 'ابحث عن دليل (مثل: ربط زد، مزامنة المخزون، ضريبة 15%، سلة)...'
                : 'Search guides (e.g. Zid setup, stock sync, VAT 15%, webhooks)...'
            }
            className="h-11 w-full rounded-xl border border-border bg-card pe-10 ps-10 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={isAr ? 'مسح البحث' : 'Clear search'}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{filteredGuides.length}</span>
          <span>
            {isAr
              ? `دليل متوفر${filteredGuides.length !== guides.length ? ` من أصل ${guides.length}` : ''}`
              : `guides available${filteredGuides.length !== guides.length ? ` of ${guides.length}` : ''}`}
          </span>
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={isAr ? 'تصنيفات الأدلة' : 'Guide categories'}>
        <button
          type="button"
          role="tab"
          aria-selected={activeCategory === 'all'}
          onClick={() => setActiveCategory('all')}
          className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            activeCategory === 'all'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'border border-border bg-card/60 text-muted-foreground hover:bg-card hover:text-foreground'
          }`}
        >
          <span>{isAr ? 'جميع الأدلة' : 'All Guides'}</span>
          <span className="rounded-full bg-background/20 px-1.5 py-0.2 text-[10px] font-mono">
            {categoryCounts.all}
          </span>
        </button>

        {categories.map((cat) => {
          const Icon = iconMap[cat.iconName] || Layers
          const count = categoryCounts[cat.slug] || 0
          const isSelected = activeCategory === cat.slug

          return (
            <button
              key={cat.slug}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setActiveCategory(cat.slug)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                isSelected
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'border border-border bg-card/60 text-muted-foreground hover:bg-card hover:text-foreground'
              }`}
            >
              <Icon className="h-3 w-3" />
              <span>{cat.title[lang]}</span>
              <span className="rounded-full bg-background/20 px-1.5 py-0.2 text-[10px] font-mono">
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Grid of Results */}
      {filteredGuides.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredGuides.map((guide) => (
            <GuideCard key={guide.meta.slug} guide={guide} lang={lang} featured={guide.meta.featured} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-12 text-center">
          <p className="text-base font-bold text-foreground">
            {isAr ? 'لم نعثر على أي أدلة مطابقة لبحثك' : 'No matching guides found'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {isAr
              ? 'جرب البحث بكلمات أخرى أو تصفح جميع التصنيفات المتاحة.'
              : 'Try searching with different keywords or reset the category filter.'}
          </p>
          <button
            type="button"
            onClick={handleClear}
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-secondary px-4 py-2 text-xs font-bold text-secondary-foreground hover:bg-secondary/80"
          >
            {isAr ? 'عرض جميع الأدلة' : 'Show all guides'}
          </button>
        </div>
      )}
    </div>
  )
}
