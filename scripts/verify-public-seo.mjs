import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')
const base = 'https://erplink.bizsahla.com'
const paths = ['', 'about', 'pricing', 'contact', 'privacy', 'terms']
const locales = ['ar-sa', 'en-us']
const sitemap = read('public/sitemap.xml')
const robots = read('public/robots.txt')
const llms = read('public/llms.txt')

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
]) {
  assert.ok(read(path).includes(`publicPageMetadata('${route}')`), `missing public metadata: ${route}`)
}
assert.ok(read('src/app/(public)/page.tsx').includes('application/ld+json'))
assert.ok(read('src/components/public-site-footer.tsx').includes('href="/about"'))
assert.ok(read('src/components/public-site-footer.tsx').includes('mailto:support@erplinks.com'))
console.log('Public SEO checks passed: 12 localized URLs, private-route exclusions, metadata and structured data.')
