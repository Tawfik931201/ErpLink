import { decrypt, encrypt } from '../../src/lib/crypto'
import { withSyncRequestContext } from '../../src/lib/sync/request-context'
import { publicZidStore } from '../../src/lib/zid/credentials'
import { SupabaseZidTokenStore, getAccessToken, refreshAccessToken } from '../../src/lib/zid/token'
import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/zid/config', () => ({ getZidConfig: () => ({
  tokenUrl: 'https://oauth.invalid/token', clientId: 'offline-client', clientSecret: 'offline-secret',
}) }))

const savedKey = process.env.ENCRYPTION_KEY
const originalFetch = global.fetch
let rows: Array<Record<string, any>>
let queryFailure = false
let cursor = 0
const store = new SupabaseZidTokenStore()
function row(merchant: string, workspace = 'workspace-a', raw = false) {
  const encode = raw ? (v: string) => v : encrypt
  return { id: `row-${merchant}`, merchant_id: merchant, store_id: merchant, workspace_id: workspace,
    access_token: encode(`access-${merchant}`), refresh_token: encode(`refresh-${merchant}`),
    authorization_token: encode(`auth-${merchant}`), token_type: 'Bearer',
    expires_in: 3600, updated_at: new Date().toISOString() }
}
beforeEach(() => {
  process.env.ENCRYPTION_KEY = 'offline-zid-storage-key'
  supabase.reset()
  rows = [row('42'), row('43', 'workspace-b')]
  queryFailure = false
  cursor = 0
  supabase.setMockResponder(table => {
    if (table !== 'merchant_tokens') return undefined
    if (queryFailure) return { data: null, error: { message: 'database failure' } }
    const calls = supabase.calls.slice(cursor)
    cursor = supabase.calls.length
    const query = calls.find(call => ['update', 'insert', 'delete'].includes(call.op)) || calls[0]
    const matches = rows.filter(record => query.filters.every(([key, value]) => record[key] === value))
    if (query.op === 'update') for (const record of matches) Object.assign(record, query.args[0])
    return { data: matches[0] ? { ...matches[0] } : null, error: null }
  })
})
afterEach(() => { global.fetch = originalFetch })
afterAll(() => {
  if (savedKey === undefined) delete process.env.ENCRYPTION_KEY
  else process.env.ENCRYPTION_KEY = savedKey
})

it('does not share in-flight Zid credentials across implicit workspace contexts', async () => {
  const a = withSyncRequestContext({ workspaceId: 'workspace-a' }, () => store.getTokens('42'))
  const b = withSyncRequestContext({ workspaceId: 'workspace-b' }, () => store.getTokens('42'))
  const results = await Promise.allSettled([a, b])
  expect(results[0].status).toBe('fulfilled')
  expect(results[1].status).toBe('rejected')
  if (results[0].status === 'fulfilled') expect(results[0].value?.accessToken).toBe('access-42')
  if (results[1].status === 'rejected') expect(String(results[1].reason)).toMatch(/no longer connected/)
  expect(supabase.calls.filter(call => call.op === 'select' && call.table === 'merchant_tokens')).toHaveLength(2)
})

it('decrypts two independent stores without mixing credentials or expiry', async () => {
  const a = await store.getTokens('42')
  const b = await store.getTokens('43')
  expect(a?.accessToken).toBe('access-42')
  expect(b?.accessToken).toBe('access-43')
  expect(a?.expiresAt).toBe(Date.parse(rows[0].updated_at) + 3600_000)
  expect(supabase.calls.filter(call => call.op === 'select').map(call => call.filters))
    .toEqual([[['merchant_id', '42']], [['merchant_id', '43']]])
})
it('automatically encrypts legacy plaintext without extending its expiry', async () => {
  rows = [row('42', 'workspace-a', true)]
  const updatedAt = rows[0].updated_at
  expect((await store.getTokens('42'))?.accessToken).toBe('access-42')
  for (const key of ['access_token', 'refresh_token', 'authorization_token']) expect(rows[0][key]).toMatch(/^v2:[0-9a-f]{24}:[0-9a-f]{32}:/)
  expect(rows[0].updated_at).toBe(updatedAt)
})
it('encrypts all renewed credentials and only updates the exact source store', async () => {
  const previous = await store.getTokens('42')
  await store.saveTokens({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: Date.now() + 120_000, tokenType: 'Bearer' }, '42', previous!)
  expect(decrypt(rows[0].access_token)).toBe('new-access')
  expect(decrypt(rows[0].refresh_token)).toBe('new-refresh')
  expect(decrypt(rows[0].authorization_token)).toBe('auth-42')
  expect(decrypt(rows[1].access_token)).toBe('access-43')
  const write = supabase.calls.find(call => call.op === 'update')!
  expect(write.filters).toEqual(expect.arrayContaining([['id', 'row-42'], ['store_id', '42'], ['workspace_id', 'workspace-a']]))
})
it.each(['deleted', 'moved', 'reauthorized'])('does not overwrite or resurrect a connection that was %s during renewal', async change => {
  const previous = await store.getTokens('42')
  if (change === 'deleted') rows.shift()
  if (change === 'moved') rows[0].workspace_id = 'workspace-b'
  if (change === 'reauthorized') rows[0].refresh_token = encrypt('newer-refresh')
  await expect(store.saveTokens({ ...previous!, accessToken: 'stale-access' }, '42', previous!)).rejects.toThrow('connection changed')
  expect(supabase.calls.some(call => call.op === 'insert')).toBe(false)
  expect(rows.some(record => decrypt(record.access_token) === 'stale-access')).toBe(false)
})
it('rejects default keys and orphan rows rather than guessing a store', async () => {
  await expect(store.getTokens()).rejects.toThrow('explicit')
  rows[0].workspace_id = null
  await expect(store.getTokens('42')).rejects.toThrow('linked store and workspace')
})
it('surfaces read/write failures instead of claiming success', async () => {
  const previous = await store.getTokens('42')
  queryFailure = true
  await expect(store.getTokens('42')).rejects.toThrow('Could not read')
  await expect(store.saveTokens(previous!, '42', previous!)).rejects.toThrow('could not be saved')
})
it('does not send undecryptable ciphertext to the provider', async () => {
  rows[0].access_token = '0'.repeat(32) + ':' + '0'.repeat(32)
  global.fetch = jest.fn()
  await expect(getAccessToken('42')).rejects.toThrow('Failed to decrypt')
  expect(global.fetch).not.toHaveBeenCalled()
})
it('rejects credentials moved to another workspace before decryption, migration or provider calls', async () => {
  rows = [row('42', 'workspace-b', true)]
  global.fetch = jest.fn()
  await expect(getAccessToken('42', 'workspace-a')).rejects.toThrow('no longer connected')
  await expect(refreshAccessToken('42', 'workspace-a')).rejects.toThrow('no longer connected')
  expect(global.fetch).not.toHaveBeenCalled()
  expect(supabase.calls.some(call => call.op === 'update')).toBe(false)
})
it('preserves the authorization credential when renewal omits it and shares one in-flight refresh', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
    access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600, token_type: 'Bearer',
  }) })
  const [a, b] = await Promise.all([refreshAccessToken('42'), refreshAccessToken('42')])
  expect(global.fetch).toHaveBeenCalledTimes(1)
  expect(a.authorization).toBe('auth-42')
  expect(b.accessToken).toBe('rotated-access')
  expect(decrypt(rows[0].authorization_token)).toBe('auth-42')
})
it('returns only display fields even when a stale cache contains credentials', () => {
  const safe = publicZidStore({ ...rows[0], unexpected_secret: 'future-secret' })
  expect(safe.merchant_id).toBe('42')
  for (const key of ['access_token', 'refresh_token', 'authorization_token', 'unexpected_secret']) expect(safe).not.toHaveProperty(key)
})
