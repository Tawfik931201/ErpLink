import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')
const base = 'https://erplink.bizsahla.com'
const paths = ['', 'about', 'pricing', 'contact', 'privacy', 'terms', 'integrations', 'integrations/zid-odoo', 'integrations/salla-odoo', 'integrations/shopify-odoo', 'guides/zid-odoo-checklist']
const locales = ['ar-sa', 'en-us']
const sitemap = read('public/sitemap.xml')
const robots = read('public/robots.txt')
const llms = read('public/llms.txt')

// A Google Search Console HTML verification file must be served byte-for-byte
// under the exact root filename. Do not index it as a marketing page.
assert.equal(read('public/google5f56418af287a69f.html').trim(), 'google-site-verification: google5f56418af287a69f.html')

assert.match(sitemap, /<urlset\s/)
assert.equal((sitemap.match(/<url>/g) || []).length, paths.length * locales.length)
for (const p of paths) {
  const suffix = p ? `/${p}` : ''
  for (const locale of locales) {
    assert.ok(sitemap.includes(`<loc>${base}/${locale}${suffix}</loc>`), `missing ${locale}${suffix}`)
  }
  assert.equal((sitemap.match(new RegExp(`hreflang="ar-SA" href="${base}/ar-sa${suffix.replaceAll('/', '\\/')}"`, 'g')) || []).length, 2)
  assert.equal((sitemap.match(new RegExp(`hreflang="en-US" href="${base}/en-us${suffix.replaceAll('/', '\\/')}"`, 'g')) || []).length, 2)
}
assert.doesNotMatch(sitemap, /\/(?:app|admin|api|sign-in|sign-up|embedded|invoice|onboarding)\b/)
assert.ok(robots.includes(`Sitemap: ${base}/sitemap.xml`))
for (const area of ['app', 'admin', 'api', 'sign-in', 'sign-up']) {
  assert.ok(robots.includes(`Disallow: /${area}`))
}
assert.match(llms, /Private dashboards, support tickets, customer records/)
for (const [route, path] of [
  ['/', 'src/app/(public)/page.tsx'],
  ['/about', 'src/app/(public)/about/page.tsx'],
  ['/pricing', 'src/app/(public)/pricing/page.tsx'],
  ['/contact', 'src/app/(public)/contact/page.tsx'],
  ['/privacy', 'src/app/(public)/privacy/page.tsx'],
  ['/terms', 'src/app/(public)/terms/page.tsx'],
  ['/integrations', 'src/app/(public)/integrations/page.tsx'],
  ['/integrations/zid-odoo', 'src/app/(public)/integrations/zid-odoo/page.tsx'],
  ['/integrations/salla-odoo', 'src/app/(public)/integrations/salla-odoo/page.tsx'],
  ['/integrations/shopify-odoo', 'src/app/(public)/integrations/shopify-odoo/page.tsx'],
  ['/guides/zid-odoo-checklist', 'src/app/(public)/guides/zid-odoo-checklist/page.tsx'],
]) {
  assert.ok(read(path).includes(`publicPageMetadata('${route}')`), `missing public metadata: ${route}`)
}
assert.ok(read('src/app/(public)/page.tsx').includes('application/ld+json'))
assert.ok(read('src/components/public-site-footer.tsx').includes('href="/about"'))
assert.equal(read('src/lib/public-contact.ts').includes("export const PUBLIC_CONTACT_EMAIL = 'info@bizsahla.com'"), true)
assert.ok(read('src/components/public-site-footer.tsx').includes('mailto:${PUBLIC_CONTACT_EMAIL}'))
assert.ok(read('src/lib/public-seo.ts').includes('email: PUBLIC_CONTACT_EMAIL'))
assert.ok(read('src/lib/public-agent-content.ts').includes('PUBLIC_CONTACT_EMAIL'))
assert.ok(read('src/app/(public)/contact/page.tsx').includes('mailto:${PUBLIC_CONTACT_EMAIL}'))
for (const platform of ['zid', 'salla', 'shopify']) {
  assert.ok(read('src/app/(public)/page.tsx').includes(`/integrations/${platform}-odoo`))
  assert.ok(read('src/components/public-site-footer.tsx').includes(`href="/integrations/${platform}-odoo"`))
}
assert.ok(read('src/components/public-site-header.tsx').includes('href="/integrations"'))
assert.ok(read('src/app/(public)/guides/zid-odoo-checklist/page.tsx').includes('scenarios.map'))

const semanticSchema = read('src/lib/public-structured-data.ts')
const integrationRender = read('src/components/public-integration-detail.tsx')
const hubRender = read('src/app/(public)/integrations/page.tsx')
const guideRender = read('src/app/(public)/guides/zid-odoo-checklist/page.tsx')
assert.ok(integrationRender.includes('integrationPageStructuredData(platform, lang)'))
assert.ok(hubRender.includes('integrationsIndexStructuredData(lang)'))
assert.ok(guideRender.includes('zidOdooGuideStructuredData(lang)'))
for (const route of [integrationRender, hubRender, guideRender]) {
  assert.ok(route.includes('application/ld+json'), 'Missing structured data render')
  assert.ok(route.includes('JSON.stringify(structuredData)'), 'Structured data render must be derived from public content')
}
for (const type of ['BreadcrumbList', 'Service', 'CollectionPage', 'ItemList', 'Article', 'WebPage']) {
  assert.ok(semanticSchema.includes(`'@type': '${type}'`), `Missing supported public schema type: ${type}`)
}
assert.ok(semanticSchema.includes("provider: { '@id': ORGANIZATION }"))
assert.ok(semanticSchema.includes("author: { '@id': ORGANIZATION }"))
assert.doesNotMatch(semanticSchema, /customerId|webhookSecret|SUPABASE_SERVICE_ROLE_KEY|order_id/)

console.log('Public SEO checks passed: 22 localized URLs, private-route exclusions, intent pages, metadata and structured data.')
