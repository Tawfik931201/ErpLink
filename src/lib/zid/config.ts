import { ZidOAuthError } from './types'

export interface ZidConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  authUrl: string
  tokenUrl: string
  apiUrl: string
}

const REQUIRED_ENV = [
  'ZID_CLIENT_ID',
  'ZID_CLIENT_SECRET',
  'ZID_REDIRECT_URI',
  'ZID_AUTH_URL',
  'ZID_TOKEN_URL',
  'ZID_API_URL',
] as const

function readRequiredEnv(
  name: (typeof REQUIRED_ENV)[number],
  options: { trimTrailingSlash?: boolean } = {}
): string {
  const value = process.env[name]

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
