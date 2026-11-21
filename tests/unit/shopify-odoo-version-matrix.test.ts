import { parseOdooVersionInfo } from '@/lib/odoo/version'
import { resolveEventOperation } from '@/lib/event-operation'
import { SHOPIFY_CORE_TOPICS } from '@/lib/shopify-topics'

/**
 * Contract tests only. Live compatibility requires an authenticated instance
 * of EACH Odoo major version and verification of installed modules/fields.
 */
describe('Shopify to Odoo 14-20 compatibility preflight', () => {
  it.each([14, 15, 16, 17, 18, 19, 20])(
    'recognizes Odoo %i version metadata without assuming newer model fields',
    (version) => {
      expect(parseOdooVersionInfo({
        server_version: `${version}.0+e`,
        server_version_info: [version, 0, 0, 'final', 0, ''],
        server_serie: `${version}.0`,
      }).majorVersion).toBe(version)
    }
  )

  it('classifies the supported Shopify core event set independently of Odoo version', () => {
    for (const topic of SHOPIFY_CORE_TOPICS) {
      const mapping = resolveEventOperation(topic, 'shopify')
      expect(mapping).not.toBeNull()
      expect(['products', 'orders', 'customers', 'categories']).toContain(mapping?.entityType)
    }
  })

  it('does not assume Shopify refunds are already supported by the Odoo engine', () => {
    expect(resolveEventOperation('refunds/create', 'shopify')).toBeNull()
  })
})
