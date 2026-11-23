import { decrypt } from '@/lib/crypto'
import { supabase } from '@/lib/supabase'
import { getSyncRequestContext } from '@/lib/sync/request-context'

import { getZidConfig } from './config'
import { encryptZidCredentials, isEncryptedZidCredential } from './credentials'
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

type TokenSnapshot = { id: string; workspace_id: string; store_id: string; refresh_token: string }
const snapshots = new WeakMap<StoredZidTokens, TokenSnapshot>()

function assertTokenWorkspace(tokens: StoredZidTokens, workspaceId?: string) {
  if (workspaceId && snapshots.get(tokens)?.workspace_id !== workspaceId) {
    throw new Error('Zid store is no longer connected to this workspace')
  }
}

function assertMerchantKey(key: string) {
  if (!key || key === DEFAULT_TOKEN_KEY) throw new Error('An explicit Zid merchant key is required')
}

export class SupabaseZidTokenStore implements ZidTokenStore {
  // Collapse only concurrent identical reads. Do not retain credential rows
  // after a request finishes: uninstall, store moves and token rotation must
  // all take effect on the next operation.
  private readonly tokenReads = new Map<string, Promise<StoredZidTokens | null>>()

  async getTokens(merchantId = DEFAULT_TOKEN_KEY, retry = 0, workspaceId?: string): Promise<StoredZidTokens | null> {
    assertMerchantKey(merchantId)
    const ctx = getSyncRequestContext()
    const effectiveWs = workspaceId ?? ctx?.workspaceId
    const cacheKey = `${merchantId}:${effectiveWs ?? ''}`
    if (ctx && retry === 0 && ctx.zidTokens.has(cacheKey)) {
      const cached = ctx.zidTokens.get(cacheKey)!
      if (effectiveWs) assertTokenWorkspace(cached, effectiveWs)
      if (!isExpired(cached.expiresAt)) return cached
    }
    // A workspace-scoped read must not share a result with another workspace.
    // Including retry avoids self-deadlock if legacy encryption upgrades race.
    const key = JSON.stringify([merchantId, workspaceId ?? null, retry])
    const existing = this.tokenReads.get(key)
    if (existing) return existing
    const task = this.loadTokens(merchantId, retry, workspaceId)
    this.tokenReads.set(key, task)
    try {
      const result = await task
      if (ctx && result && retry === 0) {
        ctx.zidTokens.set(cacheKey, result)
      }
      return result
    } finally {
      if (this.tokenReads.get(key) === task) this.tokenReads.delete(key)
    }
  }

  private async loadTokens(merchantId: string, retry: number, workspaceId?: string): Promise<StoredZidTokens | null> {
    const { data, error } = await supabase.from('merchant_tokens')
      .select('id,merchant_id,store_id,workspace_id,access_token,refresh_token,expires_in,updated_at,token_type,authorization_token')
      .eq('merchant_id', merchantId).maybeSingle()
    if (error) throw new Error('Could not read Zid credentials')
    if (!data) return null
    if (workspaceId && data.workspace_id !== workspaceId) throw new Error('Zid store is no longer connected to this workspace')
    if (!data.id || !data.workspace_id || !data.store_id) throw new Error('Zid credentials require a linked store and workspace')
    let row = data
    const tokens: StoredZidTokens = {
      accessToken: decrypt(row.access_token || ''), refreshToken: decrypt(row.refresh_token || ''),
      authorization: decrypt(row.authorization_token || ''), tokenType: row.token_type,
      expiresAt: Number(row.expires_in) && Date.parse(row.updated_at)
        ? Date.parse(row.updated_at) + Number(row.expires_in) * 1000 : 0,
    }
    if (!tokens.accessToken || !tokens.refreshToken) throw new Error('Zid credentials are incomplete')
    if ([row.access_token, row.refresh_token, row.authorization_token].some(value => value && !isEncryptedZidCredential(value))) {
      const encrypted = encryptZidCredentials({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken,
        authorization_token: tokens.authorization })
      // Do not change updated_at: it anchors expiry, not just display metadata.
      const upgraded = await supabase.from('merchant_tokens').update(encrypted)
        .eq('id', row.id).eq('workspace_id', row.workspace_id).eq('store_id', row.store_id)
        .eq('refresh_token', row.refresh_token).select('id').maybeSingle()
      if (upgraded.error) throw new Error('Could not protect legacy Zid credentials')
      if (!upgraded.data) {
        if (retry === 0) return this.getTokens(merchantId, 1, workspaceId)
        throw new Error('Zid connection changed; retry with current credentials')
      }
      row = { ...row, ...encrypted }
    }
    snapshots.set(tokens, { id: row.id, workspace_id: row.workspace_id, store_id: row.store_id, refresh_token: row.refresh_token })
    return tokens
  }

  async saveTokens(tokens: StoredZidTokens, merchantId = DEFAULT_TOKEN_KEY, previous?: StoredZidTokens): Promise<void> {
    assertMerchantKey(merchantId)
    const current = previous || await this.getTokens(merchantId)
    const snapshot = current && snapshots.get(current)
    if (!snapshot) throw new Error('Zid connection is missing; authorize the store again')
    const tokenData = encryptZidCredentials({
      access_token: tokens.accessToken, refresh_token: tokens.refreshToken,
      authorization_token: tokens.authorization || current?.authorization || '',
      expires_in: Math.max(0, Math.floor((tokens.expiresAt - Date.now()) / 1000)),
      token_type: tokens.tokenType, updated_at: new Date().toISOString(),
    })
    // Update the exact credential generation read before the provider call.
    // Never INSERT here: uninstall/move/reinstall must invalidate stale renewal.
    const { data, error } = await supabase.from('merchant_tokens').update(tokenData)
      .eq('merchant_id', merchantId).eq('id', snapshot.id)
      .eq('workspace_id', snapshot.workspace_id).eq('store_id', snapshot.store_id)
      .eq('refresh_token', snapshot.refresh_token).select('id').maybeSingle()
    if (error || !data) throw new Error('Zid connection changed or credentials could not be saved')
    snapshots.set(tokens, {
      id: snapshot.id,
      workspace_id: snapshot.workspace_id,
      store_id: snapshot.store_id,
      refresh_token: tokenData.refresh_token,
    })
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
    if (process.env.NODE_ENV === 'production') throw new Error('Zid tokens require durable server storage in production')
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
  key = DEFAULT_TOKEN_KEY,
  previous?: StoredZidTokens
): Promise<StoredZidTokens> {
  const tokens =
    'access_token' in responseOrTokens ? toStoredTokens(responseOrTokens) : responseOrTokens

  try {
    if (tokenStore instanceof SupabaseZidTokenStore) await tokenStore.saveTokens(tokens, key, previous)
    else await tokenStore.saveTokens(tokens, key)
  } catch {
    throw new ZidOAuthError({
      code: 'token_storage_failed',
      message: 'Zid tokens were received but could not be saved in server storage.',
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
  } catch {
    throw new ZidOAuthError({
      code: 'network_error',
      message: 'Network error while exchanging Zid authorization code.',
    })
  }

  const payload = (await response.json().catch(() => ({}))) as AccessTokenResponse

  if (!response.ok) {
    throw new ZidOAuthError({
      code: 'invalid_token',
      message: 'Zid rejected the authorization code or client credentials.',
      status: response.status,
    })
  }

  return payload
}

export async function refreshAccessToken(key = DEFAULT_TOKEN_KEY, workspaceId?: string): Promise<StoredZidTokens> {
  const flightKey = JSON.stringify([key, workspaceId || null])
  const running = refreshInFlight.get(flightKey)
  if (running) return running

  const task = (async (): Promise<StoredZidTokens> => {
    const storedTokens = tokenStore instanceof SupabaseZidTokenStore
      ? await tokenStore.getTokens(key, 0, workspaceId) : await tokenStore.getTokens(key)
    if (storedTokens) assertTokenWorkspace(storedTokens, workspaceId)

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
    } catch {
      throw new ZidOAuthError({
        code: 'network_error',
        message: 'Network error while refreshing Zid access token.',
      })
    }

    const payload = (await response.json().catch(() => ({}))) as RefreshTokenResponse

    if (!response.ok) {
      throw new ZidOAuthError({
        code: response.status === 401 ? 'unauthorized' : 'expired_token',
        message: 'Zid refresh token is invalid, expired, or unauthorized.',
        status: response.status,
      })
    }

    const refreshed = await saveTokens({
      ...payload,
      refresh_token: payload.refresh_token || storedTokens.refreshToken,
      Authorization: payload.Authorization || payload.authorization || storedTokens.authorization,
    }, key, storedTokens)

    const ctx = getSyncRequestContext()
    if (ctx) {
      const effectiveWs = workspaceId ?? ctx.workspaceId
      ctx.zidTokens.set(`${key}:${effectiveWs ?? ''}`, refreshed)
    }

    return refreshed
  })()

  refreshInFlight.set(flightKey, task)
  try {
    return await task
  } finally {
    refreshInFlight.delete(flightKey)
  }
}

export async function getAccessToken(key = DEFAULT_TOKEN_KEY, workspaceId?: string): Promise<StoredZidTokens> {
  const ctx = getSyncRequestContext()
  const effectiveWorkspaceId = workspaceId ?? ctx?.workspaceId
  const cacheKey = `${key}:${effectiveWorkspaceId ?? ''}`

  if (ctx && ctx.zidTokens.has(cacheKey)) {
    const cached = ctx.zidTokens.get(cacheKey)!
    assertTokenWorkspace(cached, effectiveWorkspaceId)
    if (!isExpired(cached.expiresAt)) {
      return cached
    }
  }

  const tokens = tokenStore instanceof SupabaseZidTokenStore
    ? await tokenStore.getTokens(key, 0, effectiveWorkspaceId) : await tokenStore.getTokens(key)

  if (!tokens) {
    throw new ZidOAuthError({
      code: 'invalid_token',
      message: 'Zid tokens were not found in server storage.',
    })
  }

  assertTokenWorkspace(tokens, effectiveWorkspaceId)

  if (isExpired(tokens.expiresAt)) {
    const refreshed = await refreshAccessToken(key, effectiveWorkspaceId)
    if (ctx) {
      ctx.zidTokens.set(cacheKey, refreshed)
    }
    return refreshed
  }

  if (ctx) {
    ctx.zidTokens.set(cacheKey, tokens)
  }

  return tokens
}
