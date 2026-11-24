import { DOCS_SECTIONS, getAllDocSlugs, findAdjacentArticles } from '@/lib/documentation/docs-navigation'
import { DOCS_REGISTRY, getDocArticleBySlug, getAllDocArticles } from '@/lib/documentation/docs-registry'
import { searchDocs, normalizeSearchText } from '@/lib/documentation/docs-search-index'
import { docsMetadata, docsArticleStructuredData } from '@/lib/documentation/docs-seo'
import { publicMarkdown, isAgentPublicPath } from '@/lib/public-agent-content'

describe('Documentation Center Engine & Registry', () => {
  it('registers exactly 26 distinct verified documentation articles', () => {
    const articles = getAllDocArticles()
    expect(articles.length).toBe(26)
    const slugs = new Set(articles.map((a) => a.slug))
    expect(slugs.size).toBe(26)
  })

  it('provides bilingual title, description, and content for every article', () => {
    for (const article of DOCS_REGISTRY) {
      expect(article.title.ar).toBeTruthy()
      expect(article.title.en).toBeTruthy()
      expect(article.description.ar).toBeTruthy()
      expect(article.description.en).toBeTruthy()
      expect(article.content.ar.length).toBeGreaterThan(100)
      expect(article.content.en.length).toBeGreaterThan(100)
      expect(article.headings.length).toBeGreaterThan(0)
    }
  })

  it('organizes articles into 7 core navigation sections', () => {
    expect(DOCS_SECTIONS.length).toBe(7)
    const navSlugs = getAllDocSlugs()
    expect(navSlugs.length).toBe(26)
    for (const slug of navSlugs) {
      const found = getDocArticleBySlug(slug)
      expect(found).toBeDefined()
    }
  })

  it('calculates adjacent articles correctly', () => {
    const { prev, next } = findAdjacentArticles('getting-started')
    expect(prev).toBeNull()
    expect(next?.slug).toBe('create-account')

    const lastSlug = DOCS_SECTIONS[DOCS_SECTIONS.length - 1].items.slice(-1)[0].slug
    const adjacentLast = findAdjacentArticles(lastSlug)
    expect(adjacentLast.next).toBeNull()
    expect(adjacentLast.prev).toBeDefined()
  })

  it('normalizes Arabic search tokens properly', () => {
    expect(normalizeSearchText('الضَّرِيبَةُ', 'ar')).toBe('الضريبه')
    expect(normalizeSearchText('إدارة أوامر', 'ar')).toBe('اداره اوامر')
    expect(normalizeSearchText('إلغاء', 'ar')).toBe('الغاء')
  })

  it('searches documentation in memory without network or database', () => {
    const zidResults = searchDocs('Zid', 'en')
    expect(zidResults.length).toBeGreaterThan(0)
    expect(zidResults[0].record.slug).toContain('zid')

    const odooResultsAr = searchDocs('أودوو', 'ar')
    expect(odooResultsAr.length).toBeGreaterThan(0)

    const taxResults = searchDocs('ضريبة', 'ar')
    expect(taxResults.length).toBeGreaterThan(0)
    expect(taxResults.some((r) => r.record.slug === 'taxes')).toBe(true)
  })

  it('generates valid canonical SEO metadata and TechArticle schema', () => {
    const article = getDocArticleBySlug('connect/zid')!
    const meta = docsMetadata(article, 'ar')
    expect(meta.title).toContain('ربط متجر زد')
    expect(meta.alternates?.canonical).toBe('https://erplink.bizsahla.com/ar-sa/docs/connect/zid')

    const schema = docsArticleStructuredData(article, 'en')
    expect(schema['@context']).toBe('https://schema.org')
    const graph = schema['@graph'] as Array<Record<string, unknown>>
    expect(graph.some((item) => item['@type'] === 'TechArticle')).toBe(true)
    expect(graph.some((item) => item['@type'] === 'BreadcrumbList')).toBe(true)
  })

  it('renders safe public Markdown representation without private leaks', () => {
    expect(isAgentPublicPath('/docs')).toBe(true)
    expect(isAgentPublicPath('/docs/connect/zid')).toBe(true)
    expect(isAgentPublicPath('/app/settings')).toBe(false)

    const indexMarkdown = publicMarkdown('/docs', 'ar')
    expect(indexMarkdown).toContain('# مركز التوثيق الرسمي')
    expect(indexMarkdown).toContain('info@bizsahla.com')
    expect(indexMarkdown).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(indexMarkdown).not.toContain('ENCRYPTION_KEY')

    const articleMarkdown = publicMarkdown('/docs/connect/odoo', 'en')
    expect(articleMarkdown).toContain('XML-RPC')
    expect(articleMarkdown).toContain('Odoo Version Compatibility Matrix')
  })
})
