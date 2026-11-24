// Browser-native WebMCP: public-only tools, no auth, no network, no mutations.
// Older browsers that do not support document.modelContext retain normal UX.
(() => {
  if (!('modelContext' in document) || !document.modelContext ||
      typeof document.modelContext.registerTool !== 'function') return

  const platformDetails = {
    zid: { ar: 'ربط زد بأودوو', en: 'Zid Odoo integration', slug: 'zid-odoo' },
    salla: { ar: 'ربط سلة بأودوو', en: 'Salla Odoo integration', slug: 'salla-odoo' },
    shopify: { ar: 'ربط شوبيفاي بأودوو', en: 'Shopify Odoo integration', slug: 'shopify-odoo' },
  }
  const controller = new AbortController()
  const options = { signal: controller.signal }

  const register = (tool) => {
    try {
      Promise.resolve(document.modelContext.registerTool(tool, options)).catch(() => {})
    } catch {
      // Experimental browser feature: never interfere with site navigation.
    }
  }

  register({
    name: 'find_erplink_integration',
    description: 'Find the official public ERP Link integration guide for a store platform and Odoo.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['zid', 'salla', 'shopify'], description: 'Store platform to connect with Odoo.' },
        language: { type: 'string', enum: ['ar', 'en'], description: 'Preferred language.' },
      },
      required: ['platform'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    execute(input) {
      const platform = input && typeof input === 'object' ? input.platform : undefined
      const details = Object.prototype.hasOwnProperty.call(platformDetails, platform)
        ? platformDetails[platform] : undefined
      if (!details) return { error: 'Choose zid, salla, or shopify.' }
      const lang = input && input.language === 'en' ? 'en' : 'ar'
      return {
        name: details[lang],
        url: `https://erplink.bizsahla.com/${lang === 'ar' ? 'ar-sa' : 'en-us'}/integrations/${details.slug}`,
        category: 'Public product integration guide',
      }
    },
  })

  register({
    name: 'get_erplink_public_contact',
    description: 'Get the public contact email and contact-page URL for ERP Link.',
    inputSchema: {
      type: 'object',
      properties: { language: { type: 'string', enum: ['ar', 'en'] } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    execute(input) {
      const lang = input && input.language === 'en' ? 'en-us' : 'ar-sa'
      return {
        email: 'info@bizsahla.com',
        contactUrl: `https://erplink.bizsahla.com/${lang}/contact`,
      }
    },
  })

  window.addEventListener('pagehide', () => controller.abort(), { once: true })
})()
