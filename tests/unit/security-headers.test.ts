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
    expect(cspHeader.value).toContain('https://zid.sa')
    expect(cspHeader.value).toContain('https://*.zid.store')

    // Must allow Salla & Shopify
    expect(cspHeader.value).toContain('https://*.salla.sa')
    expect(cspHeader.value).toContain('https://*.myshopify.com')
  })
})
