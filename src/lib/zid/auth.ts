import { getZidConfig } from './config'

export function buildAuthorizationUrl(state?: string, storeId?: string): string {
  const appId = process.env.ZID_APP_ID || process.env.NEXT_PUBLIC_ZID_APP_ID || '6958'

  // If a specific store ID is provided, route directly to the store's app management page in Zid Dashboard
  // to avoid Zid's OAuth gateway redirecting to stores/1/ and failing with error_code=EC4.
  if (storeId) {
    return `https://dashboard.zid.sa/en-sa/stores/${encodeURIComponent(storeId)}/apps/${appId}`
  }

  // If legacy oauth authorize is explicitly requested via env
  if (process.env.ZID_USE_LEGACY_OAUTH === 'true') {
    const config = getZidConfig()
    const url = new URL(config.authUrl)

    url.searchParams.set('client_id', config.clientId)
    url.searchParams.set('redirect_uri', config.redirectUri)
    url.searchParams.set('response_type', 'code')

    if (state) {
      url.searchParams.set('state', state)
    }

    return url.toString()
  }

  return `https://dashboard.zid.sa/apps/${appId}`
}
