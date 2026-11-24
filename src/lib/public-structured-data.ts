import { integrations, type IntegrationPlatform, type SiteLanguage } from '@/lib/integration-content'
import { allGuides, type GuideContent } from '@/lib/knowledge-center'

const SITE = 'https://erplink.bizsahla.com'
const ORGANIZATION = `${SITE}/#organization`
const WEBSITE = `${SITE}/#website`

const localeOf = (lang: SiteLanguage) => lang === 'ar' ? 'ar-sa' : 'en-us'
const languageOf = (lang: SiteLanguage) => lang === 'ar' ? 'ar-SA' : 'en-US'
const canonical = (lang: SiteLanguage, suffix: string) => `${SITE}/${localeOf(lang)}${suffix}`

/**
 * Strictly describe what the visible public page already states.
 * Avoid unverified dates, reviews, pricing, locations, partner certifications,
 * customer records or inferred company identities.
 */
export function integrationPageStructuredData(platform: IntegrationPlatform, lang: SiteLanguage) {
  const details = integrations[platform]
  const path = `/integrations/${platform}-odoo`
  const url = canonical(lang, path)
  const service = `${url}#integration-service`

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: lang === 'ar' ? 'الرئيسية' : 'Home', item: canonical(lang, '') },
          { '@type': 'ListItem', position: 2, name: lang === 'ar' ? 'التكاملات' : 'Integrations', item: canonical(lang, '/integrations') },
          { '@type': 'ListItem', position: 3, name: `${details.platformName} + Odoo`, item: url },
        ],
      },
      {
        '@type': 'Service',
        '@id': service,
        name: details.title[lang],
        serviceType: `${details.platformName} and Odoo integration`,
        description: details.summary[lang],
        url,
        provider: { '@id': ORGANIZATION },
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: details.title[lang],
        description: details.summary[lang],
        inLanguage: languageOf(lang),
        isPartOf: { '@id': WEBSITE },
        mainEntity: { '@id': service },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
    ],
  } as const
}

export function integrationsIndexStructuredData(lang: SiteLanguage) {
  const url = canonical(lang, '/integrations')
  const platforms: IntegrationPlatform[] = ['zid', 'salla', 'shopify']

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${url}#webpage`,
        url,
        name: lang === 'ar' ? 'ربط المتاجر الإلكترونية بأودوو وأنظمة ERP' : 'Connect Online Stores with Odoo and ERP',
        inLanguage: languageOf(lang),
        isPartOf: { '@id': WEBSITE },
        mainEntity: { '@id': `${url}#integrations` },
      },
      {
        '@type': 'ItemList',
        '@id': `${url}#integrations`,
        itemListElement: platforms.map((platform, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: integrations[platform].title[lang],
          url: canonical(lang, `/integrations/${platform}-odoo`),
        })),
      },
    ],
  } as const
}

export function zidOdooGuideStructuredData(lang: SiteLanguage) {
  const url = canonical(lang, '/guides/zid-odoo-checklist')
  const headline = lang === 'ar'
    ? 'كيفية تجهيز واختبار ربط زد بأودوو خطوة بخطوة'
    : 'Zid–Odoo Connection: Setup and Test Checklist'
  const description = lang === 'ar'
    ? 'الربط الناجح ليس مجرد وصول أول طلب. هذا الدليل يوضح القرارات التي يجب حسمها والاختبارات التي تكشف مشكلات الفواتير والمخزون والمرتجعات قبل التشغيل الحقيقي.'
    : 'A connection is not complete when the first order arrives. This checklist covers the decisions and tests that reveal invoicing, inventory and return issues before production.'

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: lang === 'ar' ? 'الرئيسية' : 'Home', item: canonical(lang, '') },
          { '@type': 'ListItem', position: 2, name: 'Zid + Odoo', item: canonical(lang, '/integrations/zid-odoo') },
          { '@type': 'ListItem', position: 3, name: lang === 'ar' ? 'دليل الاختبار' : 'Testing guide', item: url },
        ],
      },
      {
        '@type': 'Article',
        '@id': `${url}#article`,
        headline,
        description,
        url,
        inLanguage: languageOf(lang),
        author: { '@id': ORGANIZATION },
        publisher: { '@id': ORGANIZATION },
        mainEntityOfPage: { '@id': `${url}#webpage` },
        about: { '@id': `${canonical(lang, '/integrations/zid-odoo')}#integration-service` },
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: headline,
        inLanguage: languageOf(lang),
        isPartOf: { '@id': WEBSITE },
        mainEntity: { '@id': `${url}#article` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
    ],
  } as const
}

export function knowledgeCenterStructuredData(lang: SiteLanguage) {
  const url = canonical(lang, '/guides')
  const headline = lang === 'ar' ? 'مركز معرفة ERP Link' : 'ERP Link Knowledge'
  const description = lang === 'ar'
    ? 'أدلة عملية وتطبيقية لفهم ربط المتاجر الإلكترونية بأنظمة ERP، ومزامنة الطلبات والمخزون والضرائب والمرتجعات.'
    : 'Practical, in-depth guides to connecting e-commerce stores with ERP systems: orders, inventory, taxes, and returns.'

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: lang === 'ar' ? 'الرئيسية' : 'Home', item: canonical(lang, '') },
          { '@type': 'ListItem', position: 2, name: lang === 'ar' ? 'مركز المعرفة' : 'Knowledge', item: url },
        ],
      },
      {
        '@type': 'CollectionPage',
        '@id': `${url}#webpage`,
        url,
        name: headline,
        description,
        inLanguage: languageOf(lang),
        isPartOf: { '@id': WEBSITE },
        mainEntity: { '@id': `${url}#guides` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        '@type': 'ItemList',
        '@id': `${url}#guides`,
        itemListElement: allGuides.map((guide, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: guide.meta.title[lang],
          url: canonical(lang, `/guides/${guide.meta.slug}`),
        })),
      },
    ],
  } as const
}

export function guideArticleStructuredData(guide: GuideContent, lang: SiteLanguage) {
  const url = canonical(lang, `/guides/${guide.meta.slug}`)
  const headline = guide.meta.h1Title[lang]
  const description = guide.meta.description[lang]

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: lang === 'ar' ? 'الرئيسية' : 'Home', item: canonical(lang, '') },
          { '@type': 'ListItem', position: 2, name: lang === 'ar' ? 'مركز المعرفة' : 'Knowledge', item: canonical(lang, '/guides') },
          { '@type': 'ListItem', position: 3, name: guide.meta.title[lang], item: url },
        ],
      },
      {
        '@type': 'TechArticle',
        '@id': `${url}#article`,
        headline,
        description,
        url,
        inLanguage: languageOf(lang),
        datePublished: guide.meta.publishedAt,
        dateModified: guide.meta.updatedAt,
        author: { '@id': ORGANIZATION },
        publisher: { '@id': ORGANIZATION },
        mainEntityOfPage: { '@id': `${url}#webpage` },
        ...(guide.meta.relatedIntegrationPath
          ? { about: { '@id': `${canonical(lang, guide.meta.relatedIntegrationPath)}#integration-service` } }
          : {}),
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: headline,
        description,
        inLanguage: languageOf(lang),
        isPartOf: { '@id': WEBSITE },
        mainEntity: { '@id': `${url}#article` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
    ],
  } as const
}
