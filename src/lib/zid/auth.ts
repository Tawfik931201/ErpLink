import { getZidConfig } from './config'

export function buildAuthorizationUrl(state?: string): string {
  const config = getZidConfig()
  const url = new URL(config.authUrl)

  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')

  if (state) {
    url.searchParams.set('state', state)
  }

  console.info('[Zid OAuth] Authorization URL created')

  return url.toString()
}
