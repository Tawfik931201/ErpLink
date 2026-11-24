import fs from 'fs'
import path from 'path'

import { SHOPIFY_EVENTS, SHOPIFY_FIELDS } from '@/lib/platforms/shopify/fields'
import { normalizeShopifyMetafields } from '@/lib/shopify/enrichment'
import { SHOPIFY_CORE_TOPICS } from '@/lib/shopify-client'

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('Shopify platform isolation and custom data', () => {
  it('normalizes metafields into nested mapping paths and JSON', () => {
    const result = normalizeShopifyMetafields([
      { namespace: 'custom', key: 'external_code', value: 'ABC', type: 'single_line_text_field' },
      { namespace: 'erp', key: 'priority', value: '5', type: 'number_integer' },
    ])

    expect(result.metafields.custom.external_code).toBe('ABC')
    expect(result.metafields.erp.priority).toBe('5')
    expect(JSON.parse(result.metafields_json)).toEqual(result.metafields)
    expect(result.metafield_rows).toHaveLength(2)
  })

  it('exposes every core Shopify topic in Mapping Center', () => {
    const events = new Set(SHOPIFY_EVENTS.map((event) => event.id))
    for (const topic of SHOPIFY_CORE_TOPICS) {
      expect(events.has(topic)).toBe(true)
    }
  })

  it('gives every core Shopify topic a source field catalogue', () => {
    for (const topic of SHOPIFY_CORE_TOPICS) {
      expect(SHOPIFY_FIELDS[topic]?.length).toBeGreaterThan(0)
    }
  })

  it('keeps Shopify platform modules independent of Zid modules', () => {
    for (const rel of [
      'src/lib/shopify-client.ts',
      'src/lib/shopify-topics.ts',
      'src/lib/shopify/products.ts',
      'src/lib/shopify/customers.ts',
      'src/lib/shopify/enrichment.ts',
      'src/lib/platforms/shopify/fields.ts',
      'src/app/api/shopify/connect/route.ts',
      'src/app/api/shopify/callback/route.ts',
      'src/app/api/webhooks/shopify/route.ts',
    ]) {
      expect(read(rel)).not.toMatch(/from ['"]@\/lib\/zid(?:\/|-client)/)
    }
  })

  it('routes Shopify deliveries through Shopify enrichment only', () => {
    const webhook = read('src/lib/sync/webhook.ts')
    expect(webhook).toContain("import { prepareShopifyWebhookData } from '@/lib/shopify/enrichment'")
    expect(webhook).toContain("syncPlatform === 'shopify'")
    expect(webhook).toContain('prepareShopifyWebhookData(data, storeIdStr, event)')
  })

  it('targets the currently supported Shopify API version', () => {
    expect(read('shopify.app.toml')).toContain('api_version = "2026-10"')
    expect(read('src/lib/shopify-client.ts')).toContain("'2026-10'")
    expect(read('.env.example')).toContain('SHOPIFY_API_VERSION=2026-10')
  })
})
