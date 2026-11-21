import {
  hasRequiredShopifyScopes,
  SHOPIFY_REQUIRED_SCOPE_STRING,
} from '@/lib/shopify/scopes'

describe('Shopify required OAuth scopes', () => {
  it('accepts all requested required scopes', () => {
    expect(hasRequiredShopifyScopes(SHOPIFY_REQUIRED_SCOPE_STRING)).toBe(true)
  })

  it('accepts Shopify write scopes that imply matching read scopes', () => {
    const granted = SHOPIFY_REQUIRED_SCOPE_STRING.replace('read_products,', '')
    expect(hasRequiredShopifyScopes(granted)).toBe(true)
  })

  it('denies missing independent mandatory scopes', () => {
    expect(hasRequiredShopifyScopes('read_products,write_products')).toBe(false)
    expect(hasRequiredShopifyScopes(SHOPIFY_REQUIRED_SCOPE_STRING.replace('read_orders,', ''))).toBe(false)
    expect(hasRequiredShopifyScopes(undefined)).toBe(false)
  })
})
