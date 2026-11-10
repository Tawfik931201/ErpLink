/**
 * Tests for Next.js security headers — specifically clickjacking & embedded app support.
 *
 * Zid, Salla, and Shopify load installed partner apps inside an iframe in their merchant dashboards
 * (e.g. https://dashboard.zid.sa/en-sa/stores/<store_id>/apps/<app_id>/embedded).
 * If `X-Frame-Options: DENY` or `frame-ancestors 'none'` is present, the merchant browser displays:
 * "erplink.bizsahla.com refused to connect" (ERR_BLOCKED_BY_RESPONSE).
 *
 * This suite guarantees:
 * 1. `X-Frame-Options` is NOT set to DENY/SAMEORIGIN.
 * 2. `frame-ancestors` explicitly allows Zid (`https://*.zid.sa`, `https://zid.sa`, `https://*.zid.store`, etc.),
 *    Salla, and Shopify.
 * 3. `frame-ancestors 'none'` is not present.
 */

describe('next.config.js security headers for embedded apps', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nextConfig = require('../../next.config.js')

  it('does not send X-Frame-Options: DENY or SAMEORIGIN (which breaks embedded iframes)', async () => {
    const headerRules = await nextConfig.headers()
    const globalRule = headerRules.find((r: { source: string }) => r.source === '/:path*')
    expect(globalRule).toBeDefined()

    const xFrameOptions = globalRule.headers.find(
      (h: { key: string }) => h.key.toLowerCase() === 'x-frame-options'
    )
    expect(xFrameOptions).toBeUndefined()
  })

  it('keeps launch credentials out of referrers and caches after global headers apply', async () => {
    const rules = await nextConfig.headers()
    const globalIndex = rules.findIndex((r: { source: string }) => r.source === '/:path*')
    const embeddedIndex = rules.findIndex((r: { source: string }) => r.source.endsWith('/embedded'))
    expect(embeddedIndex).toBeGreaterThan(globalIndex)
    const headers = rules[embeddedIndex].headers
    expect(headers).toContainEqual({ key: 'Referrer-Policy', value: 'no-referrer' })
    expect(headers).toContainEqual({ key: 'Cache-Control', value: 'private, no-store' })
  })

  it('configures CSP frame-ancestors to allow Zid, Salla, and Shopify merchant dashboards', async () => {
    const headerRules = await nextConfig.headers()
    const globalRule = headerRules.find((r: { source: string }) => r.source === '/:path*')
    expect(globalRule).toBeDefined()

    const cspHeader = globalRule.headers.find(
      (h: { key: string }) => h.key.toLowerCase() === 'content-security-policy'
    )
    expect(cspHeader).toBeDefined()
    expect(cspHeader.value).not.toContain("frame-ancestors 'none'")

    // Must allow Zid dashboard
    expect(cspHeader.value).toContain('https://*.zid.sa')
    expect(cspHeader.value).toContain('https://*.zid.dev')
    expect(cspHeader.value).toContain('https://zid.sa')
    expect(cspHeader.value).toContain('https://*.zid.store')

    // Must allow Salla & Shopify
    expect(cspHeader.value).toContain('https://*.salla.sa')
    expect(cspHeader.value).toContain('https://*.myshopify.com')
  })

  it('preserves Origin on the Zid confirmation form while hiding external referrers', async () => {
    const rules = await nextConfig.headers()
    const rule = rules.find((r: { source: string }) => r.source.endsWith('/connect/zid'))
    expect(rule.headers).toContainEqual({ key: 'Referrer-Policy', value: 'same-origin' })
    expect(rule.headers).toContainEqual({ key: 'Cache-Control', value: 'private, no-store' })
    // HTML metadata can override the header, so both must agree.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs')
    const page = fs.readFileSync('src/app/(public)/connect/zid/page.tsx', 'utf8')
    expect(page).toContain("referrer: 'same-origin'")
    expect(page).not.toContain("referrer: 'no-referrer'")
  })
})
