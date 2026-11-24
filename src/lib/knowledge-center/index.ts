import { guideCategories, categoryList } from './categories'
import { sallaOdooOrderMappingGuide } from './content/salla-odoo-order-mapping'
import { shopifyOdooWebhooksGuide } from './content/shopify-odoo-webhooks'
import { zidOdooChecklistGuide } from './content/zid-odoo-checklist'
import { zidOdooReturnsGuide } from './content/zid-odoo-returns'
import { zidOdooSetupGuide } from './content/zid-odoo-setup'
import { zidOdooStockSyncGuide } from './content/zid-odoo-stock-sync'
import { zidOdooVat15Guide } from './content/zid-odoo-vat-15'
import type { GuideCategory, GuideCategorySlug, GuideContent, GuideMeta, GuideSlug } from './types'

export type { GuideCategory, GuideCategorySlug, GuideContent, GuideMeta, GuideSlug }
export { guideCategories, categoryList }

export const allGuides: GuideContent[] = [
  zidOdooSetupGuide,
  zidOdooStockSyncGuide,
  zidOdooVat15Guide,
  zidOdooReturnsGuide,
  sallaOdooOrderMappingGuide,
  shopifyOdooWebhooksGuide,
  zidOdooChecklistGuide,
]

export const guideSlugAllowlist: readonly GuideSlug[] = [
  'zid-odoo-setup',
  'zid-odoo-stock-sync',
  'zid-odoo-vat-15',
  'zid-odoo-returns',
  'salla-odoo-order-mapping',
  'shopify-odoo-webhooks',
  'zid-odoo-checklist',
] as const

export function isGuideSlug(value: string): value is GuideSlug {
  return (guideSlugAllowlist as readonly string[]).includes(value)
}

export function getAllGuides(): GuideContent[] {
  return allGuides
}

export function getGuideBySlug(slug: string): GuideContent | undefined {
  return allGuides.find((guide) => guide.meta.slug === slug)
}

export function getGuidesByCategory(category: GuideCategorySlug): GuideContent[] {
  return allGuides.filter((guide) => guide.meta.category === category)
}

export function getFeaturedGuides(): GuideContent[] {
  return allGuides.filter((guide) => guide.meta.featured)
}

export function getRelatedGuides(slug: GuideSlug): GuideContent[] {
  const current = getGuideBySlug(slug)
  if (!current) return []
  return current.meta.relatedGuideSlugs
    .map((relatedSlug) => getGuideBySlug(relatedSlug))
    .filter((g): g is GuideContent => !!g)
}

export function getRelatedGuidesForPlatform(platform: 'zid' | 'salla' | 'shopify'): GuideContent[] {
  return allGuides.filter((guide) => guide.meta.relatedPlatform === platform)
}
