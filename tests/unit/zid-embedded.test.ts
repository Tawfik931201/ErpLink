import { getZidConfig } from '../../src/lib/zid/config'
import { createEmbeddedTicket, embeddedTokenHash, registerEmbeddedAccess } from '../../src/lib/zid/embedded'
import { getAccessToken } from '../../src/lib/zid/token'
import { supabase } from '../mocks/supabase'

const mockGetUser = jest.fn()
const mockGetUserList = jest.fn()
const mockCreateUser = jest.fn()
const mockCreateTicket = jest.fn()
jest.mock('@clerk/nextjs/server', () => ({ clerkClient: async () => ({
  users: { getUser: mockGetUser, getUserList: mockGetUserList, createUser: mockCreateUser },
  signInTokens: { createSignInToken: mockCreateTicket },
}) }))
jest.mock('../../src/lib/zid/token', () => ({ getAccessToken: jest.fn() }))
jest.mock('../../src/lib/zid/config', () => ({ getZidConfig: jest.fn() }))

const token = '9c70b51e-b86f-41ac-aaed-4519273875ec'
const grant = { merchant_id: 'm1', workspace_id: 'w1', clerk_user_id: 'user_embed', token_hash: embeddedTokenHash(token) }

beforeEach(() => {
  supabase.reset()
  jest.clearAllMocks()
  supabase.addMock('zid_embedded_access', [grant])
  supabase.addMock('merchant_tokens', [{ merchant_id: 'm1', workspace_id: 'w1' }])
  supabase.addMock('workspace_members', [{ workspace_id: 'w1', user_id: 'user_embed' }])
  mockGetUser.mockResolvedValue({ id: 'user_embed', externalId: 'zid-embedded:w1:m1', privateMetadata: { zidEmbedded: true } })
  mockCreateTicket.mockResolvedValue({ token: 'one-use-ticket' })
})

it.each(['', 'not-a-token', 'header.payload.signature', token.replace('-41ac-', '-11ac-')])('rejects malformed credentials before touching the DB (%s)', async value => {
  expect(await createEmbeddedTicket(value)).toBeNull()
  expect(supabase.calls).toHaveLength(0)
  expect(mockCreateTicket).not.toHaveBeenCalled()
})

it('hashes the UUID without persisting a bearer credential', () => {
  expect(embeddedTokenHash(token)).toMatch(/^[a-f0-9]{64}$/)
  expect(embeddedTokenHash(token.toUpperCase())).toBe(embeddedTokenHash(token))
})

it('issues a 60-second Clerk ticket only for the isolated identity', async () => {
  expect(await createEmbeddedTicket(token)).toBe('one-use-ticket')
  expect(mockCreateTicket).toHaveBeenCalledWith({ userId: 'user_embed', expiresInSeconds: 60 })
  expect(supabase.calls.find(c => c.table === 'zid_embedded_access')?.filters).toContainEqual(['token_hash', embeddedTokenHash(token)])
  expect(supabase.calls.find(c => c.table === 'merchant_tokens')?.filters).toEqual([
    ['merchant_id', 'm1'], ['workspace_id', 'w1'],
  ])
})

it.each(['merchant_tokens', 'workspace_members', 'zid_embedded_access'])('refuses disconnected/revoked access: %s', async table => {
  supabase.addMock(table, [])
  expect(await createEmbeddedTicket(token)).toBeNull()
  expect(mockCreateTicket).not.toHaveBeenCalled()
})

it('refuses a store moved to another workspace', async () => {
  supabase.addMock('merchant_tokens', [{ merchant_id: 'm1', workspace_id: 'other-workspace' }])
  expect(await createEmbeddedTicket(token)).toBeNull()
  expect(mockCreateTicket).not.toHaveBeenCalled()
})

it.each([
  { externalId: 'installer-or-admin', privateMetadata: { zidEmbedded: true } },
  { externalId: 'zid-embedded:w1:m1', privateMetadata: {} },
  { externalId: 'zid-embedded:w1:m1', privateMetadata: { zidEmbedded: true }, banned: true },
  { externalId: 'zid-embedded:w1:m1', privateMetadata: { zidEmbedded: true }, locked: true },
])('refuses an inappropriate Clerk identity', async identity => {
  mockGetUser.mockResolvedValue({ id: 'user_embed', ...identity })
  expect(await createEmbeddedTicket(token)).toBeNull()
  expect(mockCreateTicket).not.toHaveBeenCalled()
})

it('fails closed when storage is unavailable', async () => {
  supabase.setMockResponder(table => table === 'zid_embedded_access' ? { data: null, error: { message: 'offline' } } : undefined)
  await expect(createEmbeddedTicket(token)).rejects.toThrow('unavailable')
  expect(mockCreateTicket).not.toHaveBeenCalled()
})

it('never provisions an identity for a store outside the caller workspace', async () => {
  await expect(registerEmbeddedAccess('m1', 'foreign-workspace')).rejects.toThrow('Store not found')
  expect(mockGetUserList).not.toHaveBeenCalled()
  expect(mockCreateUser).not.toHaveBeenCalled()
})

it('does not create an identity before the migration is available', async () => {
  supabase.setMockResponder(table => table === 'zid_embedded_access' ? { data: null, error: { message: 'table missing' } } : undefined)
  await expect(registerEmbeddedAccess('m1', 'w1')).rejects.toThrow('migration')
  expect(mockCreateUser).not.toHaveBeenCalled()
})

it('registers only a UUID with Zid and stores only its digest', async () => {
  supabase.addMock('zid_embedded_access', [])
  mockGetUserList.mockResolvedValue({ data: [{ id: 'user_embed', externalId: 'zid-embedded:w1:m1', privateMetadata: { zidEmbedded: true } }] })
  ;(getAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'mock-manager', authorization: 'Bearer mock-authorization' })
  ;(getZidConfig as jest.Mock).mockReturnValue({ apiUrl: 'https://api.zid.sa/v1' })
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response)
  try {
    await registerEmbeddedAccess('m1', 'w1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.zid.sa/v1/managers/embedded-apps-token')
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer mock-authorization', 'X-Manager-Token': 'mock-manager' })
    const body = JSON.parse(options!.body as string)
    expect(Object.keys(body)).toEqual(['token'])
    expect(embeddedTokenHash(body.token)).not.toBeNull()
    const saved = supabase.calls.find(c => c.table === 'zid_embedded_access' && c.op === 'upsert')!.args[0]
    expect(saved).toEqual({ merchant_id: 'm1', workspace_id: 'w1', clerk_user_id: 'user_embed', token_hash: embeddedTokenHash(body.token) })
    expect(JSON.stringify(saved)).not.toContain(body.token)
    expect(supabase.calls.find(c => c.table === 'workspace_members' && c.op === 'upsert')!.args[0])
      .toMatchObject({ workspace_id: 'w1', user_id: 'user_embed', role: 'member' })
  } finally { fetchMock.mockRestore() }
})
