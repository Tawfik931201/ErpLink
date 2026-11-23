import { readFileSync } from 'fs'
import path from 'path'

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), 'utf8')

describe('ERP Link branded and long-tail search discovery', () => {
  const seo = read('src', 'lib', 'public-seo.ts')
  const homepage = read('src', 'app', '(public)', 'page.tsx')
  const hub = read('src', 'app', '(public)', 'integrations', 'page.tsx')

  it('keeps brand spelling consistent between public metadata and company identity', () => {
    expect(seo).toContain("'ERP Link (إي آر بي لينك) | ربط زد وسلة وشوبيفاي بأودوو'")
    expect(seo).toContain("'ERP Link (ErpLink) | Zid, Salla & Shopify Odoo Integration'")
    expect(seo).toContain("alternateName: ['ErpLink', 'ERPLink', 'إي آر بي لينك']")
    expect(seo).toContain("alternateName: ['ErpLink', 'إي آر بي لينك']")
    expect(seo).toContain("url: PUBLIC_SITE_URL")
    expect(seo).toContain("logo: `${PUBLIC_SITE_URL}/logo.png`")
  })

  it('places real brand and high-intent integration terms in visible human-readable content', () => {
    expect(homepage).toContain('ERP Link: ربط متجرك بأودوو')
    expect(homepage).toContain('زد وسلة وشوبيفاي في مكان واحد')
    expect(homepage).toContain('ERP Link: Connect your store to Odoo')
    expect(homepage).toContain('ERP Link (إي آر بي لينك) منصة ربط المتاجر الإلكترونية')
    expect(homepage).toContain('ربط زد وسلة وشوبيفاي')
    expect(homepage).toContain("href: '/integrations/zid-odoo'")
    expect(homepage).toContain("href: '/integrations/salla-odoo'")
    expect(homepage).toContain("href: '/integrations/shopify-odoo'")
  })

  it('uses descriptive links for crawlable category and guide navigation', () => {
    expect(homepage).toContain('اقرأ دليل ${item.title}')
    expect(hub).toContain('تفاصيل ربط ${details.platformName} بأودوو')
    expect(hub).toContain('Explore ${details.platformName} Odoo integration')
  })

  it('leaves private application, integration callbacks and webhooks unchanged', () => {
    expect(homepage).not.toContain('X-Robots-Tag')
    expect(seo).toContain('Never generate indexable metadata for app, admin, OAuth or API routes.')
    const robots = read('public', 'robots.txt')
    for (const protectedArea of ['/app', '/admin', '/api/', '/sign-in', '/sign-up']) {
      expect(robots).toContain('Disallow: ' + protectedArea)
    }
  })
})
