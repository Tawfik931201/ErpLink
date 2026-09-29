import { supabase } from '@/lib/supabase'

import { getZidConfig } from './config'
import type {
  AccessTokenResponse,
  RefreshTokenResponse,
  StoredZidTokens,
  ZidTokenStore,
} from './types'
import { ZidOAuthError } from './types'

const DEFAULT_TOKEN_KEY = 'default'
const EXPIRY_SKEW_MS = 60_000

function getAuthorizationFromResponse(response: AccessTokenResponse): string | undefined {
  return response.Authorization ?? response.authorization
}

export function toStoredTokens(response: AccessTokenResponse): StoredZidTokens {
  if (!response.access_token || !response.refresh_token || !response.expires_in) {
    throw new ZidOAuthError({
      code: 'invalid_token',
      message: 'Zid token response is missing required token fields.',
      details: {
        hasAccessToken: Boolean(response.access_token),
        hasRefreshToken: Boolean(response.refresh_token),
        hasExpiresIn: Boolean(response.expires_in),
      },
    })
  }

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Date.now() + response.expires_in * 1000,
    tokenType: response.token_type,
    authorization: getAuthorizationFromResponse(response),
    scope: response.scope,
  }
}

export class SupabaseZidTokenStore implements ZidTokenStore {
  async getTokens(merchantId = DEFAULT_TOKEN_KEY): Promise<StoredZidTokens | null> {
    const { data: merchantToken } = await supabase
      .from('merchant_tokens')
      .select('access_token,refresh_token,expires_in,updated_at,token_type,authorization_token')
      .eq('merchant_id', merchantId)
      .single()

    if (!merchantToken) return null

    // expires_in stores the remaining lifetime (in seconds) at save time, so the
    // absolute expiry must be anchored to updated_at — not to Date.now() — otherwise
    // the token never appears expired and refreshAccessToken() never runs.
    const savedAt = merchantToken.updated_at ? new Date(merchantToken.updated_at).getTime() : 0

    return {
      accessToken: merchantToken.access_token,
      refreshToken: merchantToken.refresh_token,
      expiresAt: merchantToken.expires_in && savedAt ? savedAt + Number(merchantToken.expires_in) * 1000 : 0,
      tokenType: merchantToken.token_type,
      authorization: merchantToken.authorization_token,
      scope: undefined,
    }
  }

  async saveTokens(tokens: StoredZidTokens, merchantId = DEFAULT_TOKEN_KEY): Promise<void> {
    const tokenData = {
      merchant_id: merchantId,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: Math.floor((tokens.expiresAt - Date.now()) / 1000),
      token_type: tokens.tokenType,
      authorization_token: tokens.authorization || '',
      updated_at: new Date().toISOString()
    }
    
    const { data: existingToken } = await supabase
      .from('merchant_tokens')
      .select('merchant_id')
      .eq('merchant_id', merchantId)
      .single()

    if (existingToken) {
      await supabase
        .from('merchant_tokens')
        .update(tokenData)
        .eq('merchant_id', merchantId)
    } else {
      await supabase
        .from('merchant_tokens')
        .insert([tokenData])
    }
  }
}

export class MemoryZidTokenStore implements ZidTokenStore {
  private tokens = new Map<string, StoredZidTokens>()

  async getTokens(key = DEFAULT_TOKEN_KEY): Promise<StoredZidTokens | null> {
    return this.tokens.get(key) ?? null
  }

  async saveTokens(tokens: StoredZidTokens, key = DEFAULT_TOKEN_KEY): Promise<void> {
    this.tokens.set(key, tokens)
  }
}

function createTokenStore(): ZidTokenStore {
  if (process.env.ZID_TOKEN_STORAGE === 'memory') {
    return new MemoryZidTokenStore()
  }

  return new SupabaseZidTokenStore()
}

const tokenStore: ZidTokenStore = createTokenStore()

/** Single-flight للـrefresh: دفعة ويب هوك واحدة = تبادل واحد مع زد. */
const refreshInFlight = new Map<string, Promise<StoredZidTokens>>()

export function isExpired(expiresAt: number): boolean {
  return Date.now() + EXPIRY_SKEW_MS >= expiresAt
}

export async function saveTokens(
  responseOrTokens: AccessTokenResponse | StoredZidTokens,
  key = DEFAULT_TOKEN_KEY
): Promise<StoredZidTokens> {
  const tokens =
    'access_token' in responseOrTokens ? toStoredTokens(responseOrTokens) : responseOrTokens

  try {
    await tokenStore.saveTokens(tokens, key)
  } catch (error) {
    throw new ZidOAuthError({
      code: 'token_storage_failed',
      message: 'Zid tokens were received but could not be saved in server storage.',
      details: error,
    })
  }

  return tokens
}

export async function exchangeAuthorizationCodeForResponse(
  code: string
): Promise<AccessTokenResponse> {
  const config = getZidConfig()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code,
  })

  let response: Response
  try {
    response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    })
  } catch (error) {
    throw new ZidOAuthError({
      code: 'network_error',
      message: 'Network error while exchanging Zid authorization code.',
      details: error,
    })
  }

  const payload = (await response.json().catch(() => ({}))) as AccessTokenResponse

  if (!response.ok) {
    throw new ZidOAuthError({
      code: 'invalid_token',
      message: 'Zid rejected the authorization code or client credentials.',
      status: response.status,
      details: payload,
    })
  }

  return payload
}

export async function refreshAccessToken(key = DEFAULT_TOKEN_KEY): Promise<StoredZidTokens> {
  const running = refreshInFlight.get(key)
  if (running) return running

  const task = (async (): Promise<StoredZidTokens> => {
    const storedTokens = await tokenStore.getTokens(key)

    if (!storedTokens?.refreshToken) {
      throw new ZidOAuthError({
        code: 'invalid_token',
        message: 'No Zid refresh token is available in server storage.',
      })
    }

    const config = getZidConfig()
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: storedTokens.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    })

    let response: Response
    try {
      response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        cache: 'no-store',
      })
    } catch (error) {
      throw new ZidOAuthError({
        code: 'network_error',
        message: 'Network error while refreshing Zid access token.',
        details: error,
      })
    }

    const payload = (await response.json().catch(() => ({}))) as RefreshTokenResponse

    if (!response.ok) {
      throw new ZidOAuthError({
        code: response.status === 401 ? 'unauthorized' : 'expired_token',
        message: 'Zid refresh token is invalid, expired, or unauthorized.',
        status: response.status,
        details: payload,
      })
    }

    return saveTokens(payload, key)
  })()

  refreshInFlight.set(key, task)
  try {
    return await task
  } finally {
    refreshInFlight.delete(key)
  }
}

export async function getAccessToken(key = DEFAULT_TOKEN_KEY): Promise<StoredZidTokens> {
  const tokens = await tokenStore.getTokens(key)

  if (!tokens) {
    throw new ZidOAuthError({
      code: 'invalid_token',
      message: 'Zid tokens were not found in server storage.',
    })
  }

  if (isExpired(tokens.expiresAt)) {
    return refreshAccessToken(key)
  }

  return tokens
}
