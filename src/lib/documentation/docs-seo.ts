import type { Metadata } from 'next'

import type { Language } from '@/lib/translations'

import type { DocArticle } from './docs-types'

const SITE_URL = 'https://erplink.bizsahla.com'
const ORGANIZATION_ID = `${SITE_URL}/#organization`

export function getDocsCanonicalUrl(slug: string, lang: Language): string {
  const locale = lang === 'ar' ? 'ar-sa' : 'en-us'
  const path = slug ? `/docs/${slug}` : '/docs'
  return `${SITE_URL}/${locale}${path}`
}

export function docsMetadata(article?: DocArticle, lang: Language = 'ar'): Metadata {
  const isHome = !article
  const title = isHome
    ? lang === 'ar'
      ? 'مركز التوثيق ودليل الاستخدام الرسمي | ERP Link'
      : 'Official Documentation & User Guide | ERP Link'
    : `${article.title[lang]} | ${lang === 'ar' ? 'توثيق ERP Link' : 'ERP Link Docs'}`

  const description = isHome
    ? lang === 'ar'
      ? 'مركز التوثيق الرسمي لمنصة ERP Link: أدلة ربط متاجر زد وسلة وشوبيفاي بنظام أودوو (14-20)، ضبط المطابقة القياسية، مزامنة الطلبات والمخزون والمرتجعات.'
      : 'Official ERP Link Documentation: Integration guides for Zid, Salla, and Shopify with Odoo (14-20), standard mapping, orders, inventory, and returns.'
    : article.description[lang]

  const slug = article ? article.slug : ''
  const arUrl = getDocsCanonicalUrl(slug, 'ar')
  const enUrl = getDocsCanonicalUrl(slug, 'en')
  const currentUrl = lang === 'ar' ? arUrl : enUrl

  return {
    title,
    description,
    alternates: {
      canonical: currentUrl,
      languages: {
        'ar-SA': arUrl,
        'en-US': enUrl,
        'x-default': arUrl,
      },
    },
    openGraph: {
      title,
      description,
      url: currentUrl,
      siteName: 'ERP Link',
      locale: lang === 'ar' ? 'ar_SA' : 'en_US',
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export function docsArticleStructuredData(article: DocArticle, lang: Language) {
  const url = getDocsCanonicalUrl(article.slug, lang)
  const isAr = lang === 'ar'

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: isAr ? 'الرئيسية' : 'Home',
            item: `${SITE_URL}/${isAr ? 'ar-sa' : 'en-us'}`,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: isAr ? 'التوثيق' : 'Documentation',
            item: getDocsCanonicalUrl('', lang),
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: article.title[lang],
            item: url,
          },
        ],
      },
      {
        '@type': 'TechArticle',
        '@id': `${url}#article`,
        isPartOf: {
          '@type': 'WebSite',
          '@id': `${SITE_URL}/#website`,
          name: 'ERP Link',
          url: SITE_URL,
        },
        headline: article.title[lang],
        description: article.description[lang],
        url,
        inLanguage: isAr ? 'ar-SA' : 'en-US',
        dateModified: article.lastUpdated,
        datePublished: '2026-10-01',
        publisher: {
          '@id': ORGANIZATION_ID,
        },
        author: {
          '@id': ORGANIZATION_ID,
        },
        mainEntityOfPage: url,
      },
    ],
  }
}
