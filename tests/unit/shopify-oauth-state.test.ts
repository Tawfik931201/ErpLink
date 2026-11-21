import {
  createShopifyOAuthContext,
  readShopifyOAuthContext,
  SHOPIFY_OAUTH_MAX_AGE_SECONDS,
} from '@/lib/shopify/oauth-state'

const secret = 'test-only-secret-with-enough-entropy'
const shop = 'test-shop.myshopify.com'
const input = { shop, userId: 'user_123', workspaceId: 'workspace-123' }
const now = Date.parse('2026-11-21T12:00:00.000Z')

describe('Shopify signed OAuth context', () => {
  it('binds a random nonce to the exact shop, Clerk user, and workspace', () => {
    const { state, cookie } = createShopifyOAuthContext(input, secret, now)
    const decoded = readShopifyOAuthContext(cookie, secret, { shop, state }, now + 1000)
    expect(decoded).toMatchObject({ ...input, state })
    const next = createShopifyOAuthContext(input, secret, now)
    expect(next.state).not.toBe(state)
  })

  it('rejects a different store or nonce', () => {
    const { state, cookie } = createShopifyOAuthContext(input, secret, now)
    expect(readShopifyOAuthContext(cookie, secret, { shop: 'other.myshopify.com', state }, now)).toBeNull()
    expect(readShopifyOAuthContext(cookie, secret, { shop, state: 'not-the-nonce' }, now)).toBeNull()
  })

  it('rejects tampering, missing cookie, and a different secret', () => {
    const { state, cookie } = createShopifyOAuthContext(input, secret, now)
    expect(readShopifyOAuthContext(cookie + 'a', secret, { shop, state }, now)).toBeNull()
    expect(readShopifyOAuthContext(cookie, 'wrong-secret', { shop, state }, now)).toBeNull()
    expect(readShopifyOAuthContext(undefined, secret, { shop, state }, now)).toBeNull()
  })

  it('expires after ten minutes and rejects contexts from the future', () => {
    const { state, cookie } = createShopifyOAuthContext(input, secret, now)
    expect(readShopifyOAuthContext(
      cookie, secret, { shop, state }, now + SHOPIFY_OAUTH_MAX_AGE_SECONDS * 1000
    )).toBeNull()
    expect(readShopifyOAuthContext(cookie, secret, { shop, state }, now - 1000)).toBeNull()
  })
})
