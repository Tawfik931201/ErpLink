import fs from 'fs'
import path from 'path'

describe('Shopify OAuth workspace ownership guard', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/shopify/callback/route.ts'),
    'utf8'
  )

  it('checks existing shop ownership before exchanging OAuth code', () => {
    expect(source).toContain(".select('shop_domain, workspace_id')")
    expect(source).toContain('existingToken.workspace_id !== activeWorkspaceId')
    expect(source).toContain("error: 'shopify_store_already_linked'")
    expect(source.indexOf('existingToken.workspace_id !== activeWorkspaceId'))
      .toBeLessThan(source.indexOf('axios.post('))
  })

  it('awaits webhook registration in bounded batches and reports missing subscriptions', () => {
    expect(source).toContain('offset += 4')
    expect(source).toContain('await Promise.all(')
    expect(source).toContain("warning: 'shopify_webhooks_partial'")
    expect(source).not.toContain('registerShopifyWebhook(shop, topic, access_token).catch(() => {})')
  })

  it('preserves sync settings when reconnecting the same shop', () => {
    expect(source).toContain('const { sync_settings: _ignore, ...updateData } = tokenData')
  })
})
