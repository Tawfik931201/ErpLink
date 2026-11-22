import fs from 'fs'
import path from 'path'

jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }))

import { resolveZidWebhookMigrationSettings } from '@/lib/zid/webhook-auth-migration'

describe('one-time Zid merchant webhook auth migration', () => {
  it('uses core events for a pre-settings/legacy store', () => {
    const settings = resolveZidWebhookMigrationSettings(null)
    expect(settings.order_create?.zid2odoo).toBe(true)
    expect(settings.product_update?.zid2odoo).toBe(true)
    expect(settings.customer_create?.zid2odoo).toBe(true)
  })

  it('preserves disabled events without re-enabling them', () => {
    const settings = resolveZidWebhookMigrationSettings({
      order_create: { zid2odoo: false, odoo2zid: true },
      product_update: { zid2odoo: false, odoo2zid: false },
      unrelated_secret: 'not-an-event',
    })
    expect(settings.order_create).toEqual({ zid2odoo: false, odoo2zid: true })
    expect(settings.product_update).toEqual({ zid2odoo: false, odoo2zid: false })
    expect(settings).not.toHaveProperty('unrelated_secret')
    expect(Object.values(settings).every(s => s.zid2odoo === false)).toBe(true)
  })

  it('preserves individually configured sync directions', () => {
    const settings = resolveZidWebhookMigrationSettings({
      order_create: { zid2odoo: true, odoo2zid: false },
      product_update: { zid2odoo: false, odoo2zid: true },
    })
    expect(settings.order_create).toEqual({ zid2odoo: true, odoo2zid: false })
    expect(settings.product_update).toEqual({ zid2odoo: false, odoo2zid: true })
  })

  it('claims rows atomically and commits v2 only after verified registration', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/zid/webhook-auth-migration.ts'), 'utf8'
    )
    expect(source).toContain(".lt('zid_webhook_auth_version', 2)")
    expect(source).toContain(".select('merchant_id, store_id, sync_settings')")
    expect(source).toContain("const cleanup = await unregisterAllZidWebhooks(merchantId)")
    expect(source).toContain("const registered = await syncWebhooksWithSettings(merchantId, settings)")
    expect(source).toContain('zid_webhook_auth_version: 2')
    expect(source).toContain("zid_webhook_auth_last_error: failure")
  })
})
