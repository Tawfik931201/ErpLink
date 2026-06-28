import { getZidConfig } from './config'
import { getAccessToken } from './token'
import type { ZidRequestOptions } from './types'
import { ZidOAuthError } from './types'

function buildUrl(path: string, query?: ZidRequestOptions['query']): string {
  const baseUrl = getZidConfig().apiUrl
  const url = new URL(path.replace(/^\//, ''), `${baseUrl}/`)

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value))
    }
  })

  return url.toString()
}

function buildBody(body: ZidRequestOptions['body']): BodyInit | undefined {
  if (!body) {
    return undefined
  }

  if (
    typeof body === 'string' ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer
  ) {
    return body
  }

  return JSON.stringify(body)
}

export async function zidRequest<TResponse = unknown>(
  path: string,
  options: ZidRequestOptions = {}
): Promise<TResponse> {
  const { tokenKey, query, headers, body, ...init } = options
  const tokens = await getAccessToken(tokenKey)

  if (!tokens.authorization) {
    throw new ZidOAuthError({
      code: 'invalid_token',
      message: 'Zid Authorization token is missing from stored OAuth data.',
    })
  }

  let authHeader = tokens.authorization
  if (!authHeader.startsWith('Bearer ')) {
    authHeader = `Bearer ${authHeader}`
  }

  const requestHeaders = new Headers(headers)
  requestHeaders.set('Accept', 'application/json')
  requestHeaders.set('Authorization', authHeader)
  requestHeaders.set('X-Manager-Token', tokens.accessToken)

  if (body && !requestHeaders.has('Content-Type') && !(body instanceof FormData)) {
    requestHeaders.set('Content-Type', 'application/json')
  }

  console.info('[Zid API] Request started', { path, method: init.method ?? 'GET' })

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), {
      ...init,
      headers: requestHeaders,
      body: buildBody(body),
      cache: init.cache ?? 'no-store',
    })
  } catch (error) {
    throw new ZidOAuthError({
      code: 'network_error',
      message: 'Network error while calling Zid API.',
      details: error,
    })
  }

  if (response.status === 401) {
    throw new ZidOAuthError({
      code: 'unauthorized',
      message: 'Zid API request is unauthorized. The stored token may be invalid.',
      status: response.status,
      details: await response.json().catch(() => undefined),
    })
  }

  if (!response.ok) {
    throw new ZidOAuthError({
      code: 'zid_api_error',
      message: `Zid API request failed with status ${response.status}.`,
      status: response.status,
      details: await response.json().catch(() => undefined),
    })
  }

  if (response.status === 204) {
    return undefined as TResponse
  }

  return response.json() as Promise<TResponse>
}
