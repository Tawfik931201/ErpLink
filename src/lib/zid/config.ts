import { ZidOAuthError } from './types'

export interface ZidConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  authUrl: string
  tokenUrl: string
  apiUrl: string
}

type RequiredZidEnv =
  | 'ZID_CLIENT_ID'
  | 'ZID_CLIENT_SECRET'
  | 'ZID_REDIRECT_URI'
  | 'ZID_AUTH_URL'
  | 'ZID_TOKEN_URL'
  | 'ZID_API_URL'

/** أسماء بديلة مقبولة للتوافق مع المسار القديم /api/auth/zid/* */
const ENV_FALLBACKS: Partial<Record<RequiredZidEnv, string[]>> = {
  ZID_CLIENT_ID: ['NEXT_PUBLIC_ZID_CLIENT_ID'],
  ZID_REDIRECT_URI: ['ZID_OAUTH_REDIRECT_URI'],
}

function readRequiredEnv(
  name: RequiredZidEnv,
  options: { trimTrailingSlash?: boolean } = {}
): string {
  const fallbacks = ENV_FALLBACKS[name] ?? []
  const value = process.env[name] ?? fallbacks.map((k) => process.env[k]).find(Boolean)

  if (!value) {
    throw new ZidOAuthError({
      code: 'missing_config',
      message: `Missing required environment variable: ${name}`,
    })
  }

  return options.trimTrailingSlash ? value.replace(/\/$/, '') : value
}

export function getZidConfig(): ZidConfig {
  return {
    clientId: readRequiredEnv('ZID_CLIENT_ID'),
    clientSecret: readRequiredEnv('ZID_CLIENT_SECRET'),
    redirectUri: readRequiredEnv('ZID_REDIRECT_URI'),
    authUrl: readRequiredEnv('ZID_AUTH_URL'),
    tokenUrl: readRequiredEnv('ZID_TOKEN_URL'),
    apiUrl: readRequiredEnv('ZID_API_URL', { trimTrailingSlash: true }),
  }
}
