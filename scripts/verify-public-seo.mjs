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
assert.ok(read('src/components/public-site-footer.tsx').includes('mailto:support@erplinks.com'))
for (const platform of ['zid', 'salla', 'shopify']) {
  assert.ok(read('src/app/(public)/page.tsx').includes(`/integrations/${platform}-odoo`))
  assert.ok(read('src/components/public-site-footer.tsx').includes(`href="/integrations/${platform}-odoo"`))
}
assert.ok(read('src/components/public-site-header.tsx').includes('href="/integrations"'))
assert.ok(read('src/app/(public)/guides/zid-odoo-checklist/page.tsx').includes('scenarios.map'))
console.log('Public SEO checks passed: 22 localized URLs, private-route exclusions, intent pages, metadata and structured data.')
