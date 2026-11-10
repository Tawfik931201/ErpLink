import { NextRequest } from 'next/server'

import { GET as legacyConnect } from '../../src/app/api/auth/zid/authorize/route'
import { GET as legacyCallback } from '../../src/app/api/auth/zid/callback/route'
import { GET as callback } from '../../src/app/api/zid/callback/route'
import { GET as connect } from '../../src/app/api/zid/connect/route'
import { POST as link } from '../../src/app/api/zid/link/route'

const mockAuth = jest.fn()
const mockBegin = jest.fn()
const mockConsume = jest.fn()
const mockSave = jest.fn()
const mockFinish = jest.fn()
const mockExchange = jest.fn()
const mockRegister = jest.fn()
jest.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }))
jest.mock('next/cache', () => ({ revalidateTag: jest.fn(), revalidatePath: jest.fn() }))
jest.mock('../../src/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true }), rateLimitKeyFromHeaders: () => 'offline-ip',
}))
jest.mock('../../src/lib/zid/config', () => ({ getZidConfig: () => ({ apiUrl: 'https://zid.invalid/v1' }) }))
jest.mock('../../src/lib/zid/auth', () => ({ buildAuthorizationUrl: (state?: string) => `https://oauth.zid.invalid/authorize?state=${state || ''}` }))
jest.mock('../../src/lib/zid/token', () => ({
  exchangeAuthorizationCodeForResponse: (...args: unknown[]) => mockExchange(...args),
  toStoredTokens: (response: unknown) => response,
}))
jest.mock('../../src/lib/zid/oauth-pending', () => ({
  ZID_PENDING_COOKIE: 'zid_pending_connection', ZID_CONNECT_PATH: '/connect/zid', PENDING_TTL_SECONDS: 3600,
  oauthCookieOptions: (maxAge: number) => ({ httpOnly: true, sameSite: 'lax', path: '/', maxAge }),
  beginZidAuthorization: () => mockBegin(), consumeZidState: (...args: unknown[]) => mockConsume(...args),
  savePendingZidConnection: (...args: unknown[]) => mockSave(...args),
  finishZidConnection: (...args: unknown[]) => mockFinish(...args),
}))
jest.mock('../../src/lib/zid/webhooks', () => ({
  ZID_CORE_EVENTS: ['order_create'], registerZidWebhook: (...args: unknown[]) => mockRegister(...args),
}))

const savedAppUrl = process.env.NEXT_PUBLIC_APP_URL
const originalFetch = global.fetch
const state = 'a'.repeat(64)
beforeEach(() => {
  jest.clearAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example'
  mockAuth.mockResolvedValue({ userId: null })
  mockBegin.mockResolvedValue(state)
  mockConsume.mockResolvedValue(true)
  mockSave.mockResolvedValue('b'.repeat(64))
  mockFinish.mockResolvedValue('42')
  mockRegister.mockResolvedValue({ success: true })
  mockExchange.mockResolvedValue({ accessToken: 'SECRET_ACCESS', refreshToken: 'SECRET_REFRESH',
    authorization: 'SECRET_AUTH', expiresAt: Date.now() + 3600_000, tokenType: 'Bearer' })
  global.fetch = jest.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () =>
    url.endsWith('/store') ? { store: { id: 42, name: 'Store A' } } : { user: { id: 7, email: 'merchant@example.test' } },
  }))
})
afterAll(() => {
  global.fetch = originalFetch
  if (savedAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = savedAppUrl
})
function callbackRequest(query = `code=PRIVATE_CODE&state=${state}`, cookie = state) {
  return new NextRequest(`https://app.example/api/zid/callback?${query}`, {
    headers: { Cookie: `zid_oauth_state=${cookie}` },
  })
}
function linkRequest(origin = 'https://app.example') {
  return new NextRequest('https://app.example/api/zid/link', {
    method: 'POST', headers: { Origin: origin, Cookie: `zid_pending_connection=${'b'.repeat(64)}` },
    body: new URLSearchParams({ workspace_id: '00000000-0000-4000-8000-000000000001' }),
  })
}

it('starts OAuth for a logged-out merchant without invoking Clerk', async () => {
  const response = await connect(new NextRequest('https://app.example/api/zid/connect'))
  expect(response.headers.get('location')).toBe(`https://oauth.zid.invalid/authorize?state=${state}`)
  expect(response.cookies.get('zid_oauth_state')?.value).toBe(state)
  expect(response.headers.get('set-cookie')).toContain('HttpOnly')
  expect(mockAuth).not.toHaveBeenCalled()
})
it('both old entry URLs use the OAuth-first handlers in place', () => {
  expect(legacyConnect).toBe(connect)
  expect(legacyCallback).toBe(callback)
})
it('exchanges before login and retains credentials server-side without binding or exposing them', async () => {
  const response = await callback(callbackRequest())
  expect(mockExchange).toHaveBeenCalledWith('PRIVATE_CODE')
  expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ store_id: '42', merchant_id: '42', access_token: 'SECRET_ACCESS' }))
  expect(mockAuth).not.toHaveBeenCalled()
  expect(mockFinish).not.toHaveBeenCalled()
  expect(mockRegister).not.toHaveBeenCalled()
  expect(response.headers.get('location')).toBe('https://app.example/connect/zid')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  const output = JSON.stringify([...response.headers]) + await response.text()
  for (const secret of ['PRIVATE_CODE', 'SECRET_ACCESS', 'SECRET_REFRESH', 'SECRET_AUTH']) expect(output).not.toContain(secret)
  expect(response.cookies.get('zid_oauth_state')?.value).toBe('')
})
it('rejects mismatched state before any provider call', async () => {
  await callback(callbackRequest(undefined, 'wrong'))
  expect(mockExchange).not.toHaveBeenCalled()
  expect(global.fetch).not.toHaveBeenCalled()
})
it('rejects consumed or expired state before spending a code', async () => {
  mockConsume.mockResolvedValue(false)
  const response = await callback(callbackRequest())
  expect(response.headers.get('location')).toContain('invalid_state')
  expect(mockExchange).not.toHaveBeenCalled()
})
it('denial consumes state without exchanging or forwarding the code', async () => {
  const response = await callback(callbackRequest(`error=denied&state=${state}`))
  expect(mockExchange).not.toHaveBeenCalled()
  expect(response.headers.get('location')).toContain('zid_denied')
})
it('does not trust a store query hint when the authoritative identity request fails', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false })
  await callback(callbackRequest(`code=PRIVATE_CODE&state=${state}&store_id=999`))
  expect(mockSave).not.toHaveBeenCalled()
})
it('does not expose provider failure details', async () => {
  mockExchange.mockRejectedValue(new Error('SECRET_REFRESH'))
  const response = await callback(callbackRequest())
  expect(response.headers.get('location')).toContain('zid_connection_failed')
  expect(await response.text()).not.toContain('SECRET_REFRESH')
})
it('requires same-origin authenticated confirmation before binding', async () => {
  expect((await link(linkRequest('https://evil.example'))).status).toBe(403)
  expect(mockAuth).not.toHaveBeenCalled()
  expect((await link(linkRequest())).status).toBe(401)
  expect(mockFinish).not.toHaveBeenCalled()
})
it('confirms the store with the authenticated user and chosen workspace, then starts Odoo setup', async () => {
  mockAuth.mockResolvedValue({ userId: 'owner-a' })
  const response = await link(linkRequest())
  expect(mockFinish).toHaveBeenCalledWith('b'.repeat(64), 'owner-a', '00000000-0000-4000-8000-000000000001')
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toContain('/app/connect-odoo')
  expect(response.cookies.get('zid_pending_connection')?.value).toBe('')
})
it('retains the pending cookie on a failed save, without registering webhooks', async () => {
  mockAuth.mockResolvedValue({ userId: 'owner-a' })
  mockFinish.mockRejectedValue(new Error('store belongs to another workspace'))
  const response = await link(linkRequest())
  expect(response.headers.get('location')).toContain('connection_not_saved')
  expect(response.cookies.get('zid_pending_connection')).toBeUndefined()
  expect(mockRegister).not.toHaveBeenCalled()
})
it('reports webhook setup failure as an already-connected store rather than retrying a consumed grant', async () => {
  mockAuth.mockResolvedValue({ userId: 'owner-a' })
  mockRegister.mockRejectedValue(new Error('provider unavailable'))
  const response = await link(linkRequest())
  expect(response.headers.get('location')).toContain('success=zid_connected')
  expect(response.headers.get('location')).toContain('webhook_registration_failed')
})
