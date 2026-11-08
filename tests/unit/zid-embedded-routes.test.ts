import { NextRequest } from 'next/server'

import { POST as register } from '../../src/app/api/zid/embedded/register/route'
import { POST as session } from '../../src/app/api/zid/embedded/session/route'
import { supabase } from '../mocks/supabase'

const mockAuth = jest.fn()
const mockRegister = jest.fn()
const mockTicket = jest.fn()
jest.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }))
jest.mock('../../src/lib/auth', () => ({ getActiveWorkspaceId: async () => 'workspace-a' }))
jest.mock('../../src/lib/zid/embedded', () => ({
  registerEmbeddedAccess: (...args: unknown[]) => mockRegister(...args),
  createEmbeddedTicket: (...args: unknown[]) => mockTicket(...args),
}))
jest.mock('../../src/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true }), rateLimitKeyFromHeaders: () => 'offline-ip',
}))

const savedAppUrl = process.env.NEXT_PUBLIC_APP_URL
beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example'
  supabase.reset()
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'owner-a' })
  mockRegister.mockResolvedValue(undefined)
  mockTicket.mockResolvedValue('single-use-ticket')
  supabase.addMock('workspaces', [{ id: 'workspace-a', user_id: 'owner-a' }])
})
afterAll(() => {
  if (savedAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = savedAppUrl
})
function request(body: unknown, origin = 'https://app.example') {
  // The internal host deliberately differs: production runs behind a proxy.
  return new NextRequest('http://localhost:3000/api/zid/embedded', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

it('rejects cross-origin registration before authentication or writes', async () => {
  expect((await register(request({ merchantId: 'm1' }, 'https://attacker.example'))).status).toBe(403)
  expect(mockAuth).not.toHaveBeenCalled()
  expect(mockRegister).not.toHaveBeenCalled()
})
it('requires a Clerk session for registration', async () => {
  mockAuth.mockResolvedValue({ userId: null })
  expect((await register(request({ merchantId: 'm1' }))).status).toBe(401)
  expect(mockRegister).not.toHaveBeenCalled()
})
it('does not allow a member to provision broader access', async () => {
  mockAuth.mockResolvedValue({ userId: 'member-a' })
  expect((await register(request({ merchantId: 'm1' }))).status).toBe(403)
  expect(mockRegister).not.toHaveBeenCalled()
})
it('rejects a malformed store selector', async () => {
  expect((await register(request({ merchantId: 1 }))).status).toBe(400)
  expect(mockRegister).not.toHaveBeenCalled()
})
it('uses only the active owned workspace, never a body-supplied workspace', async () => {
  const response = await register(request({ merchantId: 'm1', workspaceId: 'foreign' }))
  expect(response.status).toBe(200)
  expect(mockRegister).toHaveBeenCalledWith('m1', 'workspace-a')
  expect(await response.json()).toEqual({ success: true })
})
it('rejects cross-origin session exchange', async () => {
  expect((await session(request({ token: 'uuid' }, 'https://attacker.example'))).status).toBe(403)
  expect(mockTicket).not.toHaveBeenCalled()
})
it('does not cache a short-lived ticket', async () => {
  const response = await session(request({ token: 'uuid' }))
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(await response.json()).toEqual({ ticket: 'single-use-ticket' })
})
it('does not fall back to normal login when a grant is invalid', async () => {
  mockTicket.mockResolvedValue(null)
  expect((await session(request({ token: 'revoked' }))).status).toBe(401)
})
it('returns a recoverable error without leaking provider details', async () => {
  mockTicket.mockRejectedValue(new Error('sensitive provider internals'))
  const response = await session(request({ token: 'uuid' }))
  expect(response.status).toBe(503)
  expect(JSON.stringify(await response.json())).not.toContain('sensitive')
})
