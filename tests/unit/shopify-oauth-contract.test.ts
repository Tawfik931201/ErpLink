import fs from 'fs'
import path from 'path'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Shopify OAuth contract and workspace isolation', () => {
  it('uses standalone authorization code grant, not embedded token exchange', () => {
    const config = read('shopify.app.toml')
    expect(config).toContain('embedded = false')
    expect(config).toContain('use_legacy_install_flow = true')
    expect(config).toContain('compliance_topics = [')
  })

  it('never sends Shopify access tokens to the connect-store browser component', () => {
    const actions = read('src/app/actions/workspaces.ts')
    const start = actions.indexOf('const getCachedShopifyTokens')
    const end = actions.indexOf('export async function getActiveWorkspaceShopifyTokens', start)
    const query = actions.slice(start, end)
    expect(query).not.toContain(".select('*')")
    expect(query).not.toContain('access_token')
  })

  it('binds the OAuth callback to one user, store, and workspace', () => {
    const callback = read('src/app/api/shopify/callback/route.ts')
    expect(callback).toContain('readShopifyOAuthContext(')
    expect(callback).toContain('userId !== context.userId')
    expect(callback).toContain('context.workspaceId')
    expect(callback).toContain(".eq('workspace_id', workspaceId)")
    expect(callback).toContain('revalidateTag(')
    expect(callback).toContain('failedSubscriptions > 0')
  })

  it('does not unregister Shopify webhooks for a store in another workspace', () => {
    const actions = read('src/app/actions/workspaces.ts')
    const start = actions.indexOf('export async function disconnectShopifyStore')
    const end = actions.indexOf('export async function updateShopifySyncSettings', start)
    const part = actions.slice(start, end)
    expect(part.indexOf(".eq('workspace_id', user.active_workspace_id)"))
      .toBeLessThan(part.indexOf('await unregisterShopifyWebhooks(shopDomain)'))
  })
})
