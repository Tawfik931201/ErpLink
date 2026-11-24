export type GuideCategorySlug =
  | 'zid-odoo'
  | 'salla-odoo'
  | 'shopify-odoo'
  | 'stock'
  | 'vat'
  | 'returns'

export type GuideSlug =
  | 'zid-odoo-setup'
  | 'zid-odoo-stock-sync'
  | 'zid-odoo-vat-15'
  | 'zid-odoo-returns'
  | 'salla-odoo-order-mapping'
  | 'shopify-odoo-webhooks'
  | 'zid-odoo-checklist'

export interface GuideCategory {
  slug: GuideCategorySlug
  title: { ar: string; en: string }
  description: { ar: string; en: string }
  iconName: 'ShoppingBag' | 'RefreshCw' | 'Layers' | 'Box' | 'FileText' | 'RotateCcw'
}

export interface GuideFaq {
  question: { ar: string; en: string }
  answer: { ar: string; en: string }
}

export interface GuideTable {
  headers: { ar: string; en: string }[]
  rows: { ar: string; en: string }[][]
}

export interface GuideCallout {
  type: 'note' | 'warning' | 'tip'
  title: { ar: string; en: string }
  text: { ar: string; en: string }
}

export interface GuideSection {
  id: string
  title: { ar: string; en: string }
  subsections?: {
    id: string
    title: { ar: string; en: string }
    paragraphs: { ar: string; en: string }[]
    steps?: { title: { ar: string; en: string }; text: { ar: string; en: string } }[]
    bullets?: { ar: string; en: string }[]
    table?: GuideTable
    callout?: GuideCallout
  }[]
  paragraphs?: { ar: string; en: string }[]
  steps?: { title: { ar: string; en: string }; text: { ar: string; en: string } }[]
  bullets?: { ar: string; en: string }[]
  table?: GuideTable
  callout?: GuideCallout
}

export interface GuideMeta {
  slug: GuideSlug
  title: { ar: string; en: string }
  h1Title: { ar: string; en: string }
  description: { ar: string; en: string }
  summary: { ar: string; en: string }
  category: GuideCategorySlug
  primaryKeyword: { ar: string; en: string }
  secondaryKeywords: { ar: string[]; en: string[] }
  readingTimeMinutes: number
  publishedAt: string
  updatedAt: string
  relatedPlatform?: 'zid' | 'salla' | 'shopify'
  relatedIntegrationPath?: string
  relatedGuideSlugs: GuideSlug[]
  featured?: boolean
}

export interface GuideContent {
  meta: GuideMeta
  sections: GuideSection[]
  faqs: GuideFaq[]
  summaryKeyTakeaways: { ar: string[]; en: string[] }
  officialDocLinks?: { label: { ar: string; en: string }; url: string }[]
}
