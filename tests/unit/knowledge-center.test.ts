import {
  allGuides,
  categoryList,
  getFeaturedGuides,
  getGuideBySlug,
  getGuidesByCategory,
  getRelatedGuides,
  getRelatedGuidesForPlatform,
  guideCategories,
  guideSlugAllowlist,
  isGuideSlug,
} from '@/lib/knowledge-center'
import {
  agentGuideList,
  isAgentPublicPath,
  publicMarkdown,
} from '@/lib/public-agent-content'
import { handlePublicMcp } from '@/lib/public-mcp'
import {
  guideArticleStructuredData,
  knowledgeCenterStructuredData,
} from '@/lib/public-structured-data'

const SITE = 'https://erplink.bizsahla.com'

describe('Knowledge Center architecture, content integrity, and SEO/GEO readiness', () => {
  it('registers all 7 guides with complete metadata and bilingual integrity', () => {
    expect(allGuides).toHaveLength(7)
    expect(guideSlugAllowlist).toHaveLength(7)

    const slugs = new Set<string>()
    for (const guide of allGuides) {
      expect(slugs.has(guide.meta.slug)).toBe(false)
      slugs.add(guide.meta.slug)

      expect(guide.meta.title.ar).toBeTruthy()
      expect(guide.meta.title.en).toBeTruthy()
      expect(guide.meta.h1Title.ar).toBeTruthy()
      expect(guide.meta.h1Title.en).toBeTruthy()
      expect(guide.meta.description.ar).toBeTruthy()
      expect(guide.meta.description.en).toBeTruthy()
      expect(guide.meta.summary.ar).toBeTruthy()
      expect(guide.meta.summary.en).toBeTruthy()
      expect(guide.meta.primaryKeyword.ar).toBeTruthy()
      expect(guide.meta.primaryKeyword.en).toBeTruthy()
      expect(guide.meta.readingTimeMinutes).toBeGreaterThan(0)
      expect(guide.meta.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(guide.meta.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)

      expect(guideCategories[guide.meta.category]).toBeDefined()
      expect(guide.sections.length).toBeGreaterThan(0)
      expect(guide.faqs.length).toBeGreaterThan(0)
    }
  })

  it('strictly validates guide slugs against the allowlist', () => {
    for (const slug of guideSlugAllowlist) {
      expect(isGuideSlug(slug)).toBe(true)
    }
    expect(isGuideSlug('non-existent-guide')).toBe(false)
    expect(isGuideSlug('../../etc/passwd')).toBe(false)
    expect(isGuideSlug('/admin')).toBe(false)
    expect(isGuideSlug('')).toBe(false)
  })

  it('guarantees no empty categories and proper categorization', () => {
    expect(categoryList).toHaveLength(6)
    for (const cat of categoryList) {
      const guidesInCat = getGuidesByCategory(cat.slug)
      expect(guidesInCat.length).toBeGreaterThan(0)
    }
  })

  it('retrieves guides by slug, featured list, and platform relations', () => {
    const setupGuide = getGuideBySlug('zid-odoo-setup')
    expect(setupGuide).toBeDefined()
    expect(setupGuide?.meta.category).toBe('zid-odoo')

    const featured = getFeaturedGuides()
    expect(featured.length).toBeGreaterThan(0)
    expect(featured.some((g) => g.meta.slug === 'zid-odoo-setup')).toBe(true)

    const zidGuides = getRelatedGuidesForPlatform('zid')
    expect(zidGuides.length).toBeGreaterThanOrEqual(4)

    const sallaGuides = getRelatedGuidesForPlatform('salla')
    expect(sallaGuides.length).toBeGreaterThanOrEqual(1)

    const shopifyGuides = getRelatedGuidesForPlatform('shopify')
    expect(shopifyGuides.length).toBeGreaterThanOrEqual(1)

    const related = getRelatedGuides('zid-odoo-setup')
    expect(related.length).toBeGreaterThan(0)
  })

  it.each([
    ['ar', 'ar-sa', 'ar-SA'],
    ['en', 'en-us', 'en-US'],
  ] as const)('generates valid CollectionPage structured data for /guides in %s', (lang, locale, language) => {
    const data = knowledgeCenterStructuredData(lang)
    const graph = data['@graph']
    const breadcrumb = graph[0]
    const collection = graph[1]
    const itemList = graph[2]

    expect(breadcrumb['@type']).toBe('BreadcrumbList')
    expect(breadcrumb.itemListElement).toHaveLength(2)
    expect(breadcrumb.itemListElement[1].item).toBe(`${SITE}/${locale}/guides`)

    expect(collection['@type']).toBe('CollectionPage')
    expect(collection.url).toBe(`${SITE}/${locale}/guides`)
    expect(collection.inLanguage).toBe(language)

    expect(itemList['@type']).toBe('ItemList')
    expect(itemList.itemListElement).toHaveLength(allGuides.length)
  })

  it.each([
    ['ar', 'ar-sa', 'ar-SA'],
    ['en', 'en-us', 'en-US'],
  ] as const)('generates valid TechArticle structured data for individual guides in %s', (lang, locale, language) => {
    for (const guide of allGuides.filter((g) => g.meta.slug !== 'zid-odoo-checklist')) {
      const data = guideArticleStructuredData(guide, lang)
      const graph = data['@graph']
      const breadcrumb = graph[0]
      const article = graph[1]
      const webpage = graph[2]

      expect(breadcrumb['@type']).toBe('BreadcrumbList')
      expect(breadcrumb.itemListElement).toHaveLength(3)
      expect(breadcrumb.itemListElement[1].item).toBe(`${SITE}/${locale}/guides`)
      expect(breadcrumb.itemListElement[2].item).toBe(`${SITE}/${locale}/guides/${guide.meta.slug}`)

      expect(article['@type']).toBe('TechArticle')
      expect(article.headline).toBe(guide.meta.h1Title[lang])
      expect(article.description).toBe(guide.meta.description[lang])
      expect(article.datePublished).toBe(guide.meta.publishedAt)
      expect(article.dateModified).toBe(guide.meta.updatedAt)
      expect(article.inLanguage).toBe(language)
      expect(article.author).toEqual({ '@id': `${SITE}/#organization` })
      expect(article.publisher).toEqual({ '@id': `${SITE}/#organization` })

      expect(webpage['@type']).toBe('WebPage')
      expect(webpage.mainEntity).toEqual({ '@id': `${SITE}/${locale}/guides/${guide.meta.slug}#article` })
      expect(JSON.stringify(graph)).not.toMatch(/reviewRating|aggregateRating|priceCurrency|customerEmail|token/)
    }
  })

  it('publishes list_public_guides and reads all guide pages via MCP', () => {
    const listRes = handlePublicMcp({
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: { name: 'list_public_guides', arguments: { language: 'ar' } },
    })
    expect(listRes).toEqual(
      expect.objectContaining({
        id: 101,
        result: expect.objectContaining({
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'text',
              text: expect.stringContaining('zid-odoo-setup'),
            }),
          ]),
          isError: false,
        }),
      })
    )

    expect(agentGuideList('ar')).toHaveLength(allGuides.length)
    expect(agentGuideList('en')).toHaveLength(allGuides.length)

    const res = listRes as { result?: { content?: { text: string }[] } }
    const listData = JSON.parse(res.result?.content?.[0]?.text ?? '[]')
    expect(listData).toHaveLength(allGuides.length)

    for (const slug of guideSlugAllowlist) {
      const path = `/guides/${slug}`
      expect(isAgentPublicPath(path)).toBe(true)

      const readRes = handlePublicMcp({
        jsonrpc: '2.0',
        id: 102,
        method: 'tools/call',
        params: { name: 'read_public_page', arguments: { path, language: 'en' } },
      })
      expect(readRes).toEqual(
        expect.objectContaining({
          id: 102,
          result: expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'text',
                text: expect.stringContaining('ERP Link'),
              }),
            ]),
            isError: false,
          }),
        })
      )
    }
  })

  it('generates high quality Markdown representations for agent discovery', () => {
    const hubMarkdown = publicMarkdown('/guides', 'ar')
    expect(hubMarkdown).toContain('# مركز معرفة ERP Link')
    expect(hubMarkdown).toContain('zid-odoo-setup')

    const setupMarkdown = publicMarkdown('/guides/zid-odoo-setup', 'ar')
    expect(setupMarkdown).toContain('كيفية ربط متجر زد بنظام أودوو')
    expect(setupMarkdown).toContain('SKU')
    expect(setupMarkdown).toContain('الأسئلة الشائعة')

    const stockMarkdown = publicMarkdown('/guides/zid-odoo-stock-sync', 'en')
    expect(stockMarkdown).toContain('Mastering Stock Sync')
    expect(stockMarkdown).toContain('Quantity On Hand')
  })
})
