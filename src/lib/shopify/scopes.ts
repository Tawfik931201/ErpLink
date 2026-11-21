/**
 * Scope contract shared by Shopify OAuth and required TOML configuration.
 * The Shopify version must be deployed separately using Shopify CLI.
 */
export const SHOPIFY_REQUIRED_SCOPES = [
  'read_products',
  'write_products',
  'read_orders',
  'read_inventory',
  'read_locations',
  'read_customers',
  'write_customers',
] as const

export const SHOPIFY_REQUIRED_SCOPE_STRING = SHOPIFY_REQUIRED_SCOPES.join(',')

/**
 * Shopify may report a write scope without its implied read scope.
 * Fail closed if any required grant is missing from the token response.
 */
export function hasRequiredShopifyScopes(granted: unknown): boolean {
  if (typeof granted !== 'string' || !granted.trim()) return false
  const actual = new Set(granted.split(',').map((part) => part.trim()))
  return SHOPIFY_REQUIRED_SCOPES.every((required) => {
    if (actual.has(required)) return true
    if (required.startsWith('read_')) {
      return actual.has('write_' + required.slice('read_'.length))
    }
    return false
  })
}
