export interface AccessTokenResponse {
  [key: string]: unknown
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  Authorization?: string
  authorization?: string
  scope?: string
}

export type RefreshTokenResponse = AccessTokenResponse

export interface StoredZidTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  tokenType: string
  authorization?: string
  scope?: string
}

export interface ZidTokenStore {
  getTokens(key?: string): Promise<StoredZidTokens | null>
  saveTokens(tokens: StoredZidTokens, key?: string): Promise<void>
}

export interface ZidError {
  code: string
  message: string
  status?: number
  details?: unknown
}

export class ZidOAuthError extends Error {
  code: string
  status?: number
  details?: unknown

  constructor(error: ZidError) {
    super(error.message)
    this.name = 'ZidOAuthError'
    this.code = error.code
    this.status = error.status
    this.details = error.details
  }
}

export interface ZidRequestOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | Record<string, unknown> | unknown[]
  tokenKey?: string
  query?: Record<string, string | number | boolean | undefined | null>
}
