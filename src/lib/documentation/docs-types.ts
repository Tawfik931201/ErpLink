import type { Language } from '@/lib/translations'

export type DocCategory =
  | 'getting-started'
  | 'connect'
  | 'mapping'
  | 'orders'
  | 'operations'
  | 'accounts'
  | 'troubleshooting'

export interface DocHeading {
  id: string
  text: Record<Language, string>
  level: 2 | 3
}

export interface DocBadge {
  text: Record<Language, string>
  variant?: 'brand' | 'success' | 'warning' | 'neutral'
}

export interface DocArticle {
  slug: string // e.g. "getting-started", "connect/zid", "mapping/orders"
  category: DocCategory
  title: Record<Language, string>
  description: Record<Language, string>
  lastUpdated: string // YYYY-MM-DD
  readTimeMinutes: number
  badge?: DocBadge
  headings: DocHeading[]
  content: Record<Language, string>
  keywords: string[]
  relatedSlugs?: string[]
  prevSlug?: string
  nextSlug?: string
}

export interface DocNavItem {
  slug: string
  href: string
  title: Record<Language, string>
  badge?: DocBadge
}

export interface DocNavSection {
  category: DocCategory
  title: Record<Language, string>
  iconName: string
  items: DocNavItem[]
}

export interface DocSearchRecord {
  id: string
  slug: string
  anchor?: string
  category: DocCategory
  categoryTitle: Record<Language, string>
  title: Record<Language, string>
  heading?: Record<Language, string>
  content: Record<Language, string>
  keywords: string[]
}
