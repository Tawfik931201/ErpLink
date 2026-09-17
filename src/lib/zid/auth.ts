import { getZidConfig } from './config'

export function buildAuthorizationUrl(state?: string): string {
  const config = getZidConfig()
  const url = new URL(config.authUrl)

  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')

  // Request the scopes needed for orders/products/customers/categories/webhooks.
  // Zid accepts a space-separated scope string; broad scopes keep sync working
  // without forcing the user to re-authorize later.
  const scope =
    process.env.ZID_OAUTH_SCOPE ||
    `store.managers.read store.managers.write store.products.read store.products.write store.orders.read store.orders.write store.customers.read store.webhooks.write`
  url.searchParams.set('scope', scope)

  if (state) {
    url.searchParams.set('state', state)
  }

  return url.toString()
}
