import {
  integrationPageStructuredData,
  integrationsIndexStructuredData,
  zidOdooGuideStructuredData,
} from '@/lib/public-structured-data'

const site = 'https://erplink.bizsahla.com'

describe('public entity context for SEO and answer engines', () => {
  it.each([
    ['ar', 'ar-sa', 'ar-SA'],
    ['en', 'en-us', 'en-US'],
  ] as const)('publishes locale-correct integration facts for %s', (lang, locale, language) => {
    for (const platform of ['zid', 'salla', 'shopify'] as const) {
      const url = `${site}/${locale}/integrations/${platform}-odoo`
      const graph = integrationPageStructuredData(platform, lang)['@graph']
      const breadcrumb = graph[0]
      const service = graph[1]
      const webpage = graph[2]

      expect(breadcrumb['@type']).toBe('BreadcrumbList')
      expect(breadcrumb.itemListElement).toHaveLength(3)
      expect(breadcrumb.itemListElement[2].item).toBe(url)
      expect(service['@type']).toBe('Service')
      expect(service['@id']).toBe(`${url}#integration-service`)
      expect(service.url).toBe(url)
      expect(service.provider).toEqual({ '@id': `${site}/#organization` })
      expect(webpage['@type']).toBe('WebPage')
      expect(webpage.inLanguage).toBe(language)
      expect(webpage.mainEntity).toEqual({ '@id': service['@id'] })
      expect(JSON.stringify(graph)).not.toMatch(/reviewRating|aggregateRating|priceCurrency|customerEmail|token/)
    }
  })

  it.each([
    ['ar', 'ar-sa', 'ar-SA'],
    ['en', 'en-us', 'en-US'],
  ] as const)('makes the integrations hub a linked 3-item collection in %s', (lang, locale, language) => {
    const graph = integrationsIndexStructuredData(lang)['@graph']
    const index = graph[0]
    const items = graph[1]
    expect(index['@type']).toBe('CollectionPage')
    expect(index.url).toBe(`${site}/${locale}/integrations`)
    expect(index.inLanguage).toBe(language)
    expect(items['@type']).toBe('ItemList')
    expect(items.itemListElement.map(x => x.position)).toEqual([1, 2, 3])
    expect(items.itemListElement.map(x => x.url)).toEqual([
      `${site}/${locale}/integrations/zid-odoo`,
      `${site}/${locale}/integrations/salla-odoo`,
      `${site}/${locale}/integrations/shopify-odoo`,
    ])
  })

  it.each([
    ['ar', 'ar-sa'],
    ['en', 'en-us'],
  ] as const)('marks the actual Zid testing guide as an Organization-authored Article in %s', (lang, locale) => {
    const graph = zidOdooGuideStructuredData(lang)['@graph']
    const url = `${site}/${locale}/guides/zid-odoo-checklist`
    const breadcrumb = graph[0]
    const article = graph[1]
    const webpage = graph[2]
    expect(breadcrumb['@type']).toBe('BreadcrumbList')
    expect(breadcrumb.itemListElement[2].item).toBe(url)
    expect(article['@type']).toBe('Article')
    expect(article.url).toBe(url)
    expect(article.author).toEqual({ '@id': `${site}/#organization` })
    expect(article.publisher).toEqual({ '@id': `${site}/#organization` })
    expect(article.about).toEqual({
      '@id': `${site}/${locale}/integrations/zid-odoo#integration-service`,
    })
    expect(webpage.mainEntity).toEqual({ '@id': `${url}#article` })
    expect('datePublished' in article).toBe(false)
    expect('dateModified' in article).toBe(false)
  })
})
