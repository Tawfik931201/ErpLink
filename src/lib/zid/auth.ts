import { getZidConfig } from './config'

export function buildAuthorizationUrl(state?: string): string {
  const config = getZidConfig()
  const url = new URL(config.authUrl)

  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')

  // Only attach scope if explicitly configured in environment.
  // By default, Zid uses the scopes configured in the Zid Partner Dashboard for this app.
  // Passing invented/invalid scopes causes Zid to reject authorization with EC4.
  if (process.env.ZID_OAUTH_SCOPE) {
    url.searchParams.set('scope', process.env.ZID_OAUTH_SCOPE)
  }

  if (state) {
    url.searchParams.set('state', state)
  }

  return url.toString()
}
