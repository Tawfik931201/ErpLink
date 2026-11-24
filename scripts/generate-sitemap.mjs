import fs from 'node:fs'

const base = 'https://erplink.bizsahla.com'
export const allSitemapPaths = [
  '',
  'about',
  'pricing',
  'contact',
  'privacy',
  'terms',
  'integrations',
  'integrations/zid-odoo',
  'integrations/salla-odoo',
  'integrations/shopify-odoo',
  'guides',
  'guides/zid-odoo-checklist',
  'guides/zid-odoo-setup',
  'guides/zid-odoo-stock-sync',
  'guides/zid-odoo-vat-15',
  'guides/zid-odoo-returns',
  'guides/salla-odoo-order-mapping',
  'guides/shopify-odoo-webhooks',
  'docs',
  'docs/getting-started',
  'docs/create-account',
  'docs/workspaces',
  'docs/connect/zid',
  'docs/connect/salla',
  'docs/connect/shopify',
  'docs/connect/odoo',
  'docs/mapping/overview',
  'docs/mapping/orders',
  'docs/mapping/products',
  'docs/mapping/customers',
  'docs/mapping/categories',
  'docs/mapping/custom-fields',
  'docs/orders',
  'docs/inventory',
  'docs/taxes',
  'docs/returns',
  'docs/logs',
  'docs/queue',
  'docs/initial-transfer',
  'docs/notifications',
  'docs/team',
  'docs/billing',
  'docs/support',
  'docs/troubleshooting',
  'docs/faq',
]

const locales = ['ar-sa', 'en-us']

let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'

for (const p of allSitemapPaths) {
  const suffix = p ? `/${p}` : ''
  for (const locale of locales) {
    xml += '  <url>\n'
    xml += `    <loc>${base}/${locale}${suffix}</loc>\n`
    xml += `    <xhtml:link rel="alternate" hreflang="ar-SA" href="${base}/ar-sa${suffix}" />\n`
    xml += `    <xhtml:link rel="alternate" hreflang="en-US" href="${base}/en-us${suffix}" />\n`
    xml += '  </url>\n'
  }
}
xml += '</urlset>\n'
fs.writeFileSync('public/sitemap.xml', xml, 'utf8')
console.log(`Generated sitemap with ${allSitemapPaths.length * locales.length} URLs`)
