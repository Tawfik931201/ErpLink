import type { Language } from '@/lib/translations'

import { DOCS_REGISTRY } from './docs-registry'
import type { DocArticle, DocSearchRecord } from './docs-types'

export function normalizeSearchText(input: string, lang: Language): string {
  if (!input) return ''
  let text = input.trim().toLowerCase()
  if (lang === 'ar') {
    text = text
      .replace(/[\u064B-\u065F\u0670]/g, '') // remove harakat
      .replace(/[أإآ]/g, 'ا') // unify alif
      .replace(/ة/g, 'ه') // taa marbuta -> haa
      .replace(/ى/g, 'ي') // alif maksura -> yaa
      .replace(/[^\w\s\u0600-\u06FF]/gi, ' ') // strip punctuation
      .replace(/\s+/g, ' ')
  } else {
    text = text.replace(/[^\w\s]/gi, ' ').replace(/\s+/g, ' ')
  }
  return text.trim()
}

export function buildSearchIndex(articles: DocArticle[]): DocSearchRecord[] {
  const records: DocSearchRecord[] = []

  for (const article of articles) {
    // 1. Article main record
    records.push({
      id: `${article.slug}#root`,
      slug: article.slug,
      category: article.category,
      categoryTitle: {
        ar: getCategoryTitle(article.category, 'ar'),
        en: getCategoryTitle(article.category, 'en'),
      },
      title: article.title,
      content: article.description,
      keywords: article.keywords,
    })

    // 2. Headings records
    for (const h of article.headings) {
      records.push({
        id: `${article.slug}#${h.id}`,
        slug: article.slug,
        anchor: h.id,
        category: article.category,
        categoryTitle: {
          ar: getCategoryTitle(article.category, 'ar'),
          en: getCategoryTitle(article.category, 'en'),
        },
        title: article.title,
        heading: h.text,
        content: article.description,
        keywords: article.keywords,
      })
    }
  }

  return records
}

function getCategoryTitle(category: string, lang: Language): string {
  const titles: Record<string, { ar: string; en: string }> = {
    'getting-started': { ar: 'البداية والتشغيل السريع', en: 'Getting Started' },
    connect: { ar: 'ربط المتاجر وأنظمة ERP', en: 'Store & ERP Connections' },
    mapping: { ar: 'مركز الخرائط والمطابقة', en: 'Mapping Center' },
    orders: { ar: 'الطلبات والمخزون والفواتير', en: 'Orders, Inventory & VAT' },
    operations: { ar: 'المراقبة والموثوقية والتشغيل', en: 'Operations & Reliability' },
    accounts: { ar: 'إدارة الفريق والاشتراكات والدعم', en: 'Team, Billing & Support' },
    troubleshooting: { ar: 'استكشاف الأخطاء والأسئلة الشائعة', en: 'Troubleshooting & FAQ' },
  }
  return titles[category]?.[lang] || category
}

export function searchDocs(
  query: string,
  lang: Language,
  limit: number = 8
): Array<{
  record: DocSearchRecord
  score: number
}> {
  const normalizedQuery = normalizeSearchText(query, lang)
  if (!normalizedQuery || normalizedQuery.length < 2) return []

  const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean)
  const index = buildSearchIndex(DOCS_REGISTRY)
  const scored: Array<{ record: DocSearchRecord; score: number }> = []

  for (const record of index) {
    let score = 0
    const titleNorm = normalizeSearchText(record.title[lang], lang)
    const headingNorm = record.heading ? normalizeSearchText(record.heading[lang], lang) : ''
    const contentNorm = normalizeSearchText(record.content[lang], lang)
    const keywordsNorm = record.keywords.map((k) => normalizeSearchText(k, lang))

    // Term checks
    for (const term of queryTerms) {
      if (titleNorm === term) score += 100
      else if (titleNorm.includes(term)) score += 60

      if (headingNorm === term) score += 50
      else if (headingNorm.includes(term)) score += 35

      if (keywordsNorm.some((k) => k === term)) score += 40
      else if (keywordsNorm.some((k) => k.includes(term))) score += 25

      if (contentNorm.includes(term)) score += 15
    }

    if (score > 0) {
      scored.push({ record, score })
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}
