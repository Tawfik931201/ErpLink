import { decrypt } from '../../src/lib/crypto'
import { beginZidAuthorization, consumeZidState, finishZidConnection, pendingHash,
  readPendingZidConnection, savePendingZidConnection } from '../../src/lib/zid/oauth-pending'
import { supabase } from '../mocks/supabase'

const savedKey = process.env.ENCRYPTION_KEY
beforeEach(() => {
  process.env.ENCRYPTION_KEY = 'offline-onboarding-test-key'
  supabase.reset()
})
afterEach(() => jest.restoreAllMocks())
afterAll(() => {
  if (savedKey === undefined) delete process.env.ENCRYPTION_KEY
  else process.env.ENCRYPTION_KEY = savedKey
})
it('stores only a hash of the authorization state', async () => {
  const state = await beginZidAuthorization()
  expect(state).toMatch(/^[a-f0-9]{64}$/)
  const insert = supabase.calls.find(call => call.op === 'insert')!
  expect(insert.args[0]).toEqual(expect.objectContaining({ token_hash: pendingHash(state), kind: 'authorization' }))
  expect(JSON.stringify(supabase.calls)).not.toContain(state)
})
it('fails before authorization without a stable encryption key', async () => {
  delete process.env.ENCRYPTION_KEY
  await expect(beginZidAuthorization()).rejects.toThrow('ENCRYPTION_KEY')
  expect(supabase.calls).toHaveLength(0)
})
it('requires a row returned by atomic state deletion', async () => {
  expect(await consumeZidState('a'.repeat(64))).toBe(false)
  supabase.setMockResponder(() => ({ data: { token_hash: 'hash' }, error: null }))
  expect(await consumeZidState('a'.repeat(64))).toBe(true)
  expect(supabase.calls.find(call => call.op === 'delete')?.filters).toContainEqual(['kind', 'authorization'])
})
it('retains encrypted credentials and only a hash of the browser handle', async () => {
  const payload = { store_id: '42', name: 'Merchant store', access_token: 'sensitive-access', refresh_token: 'sensitive-refresh' }
  const handle = await savePendingZidConnection(payload)
  const row = supabase.calls.find(call => call.op === 'insert')!.args[0] as Record<string, string>
  expect(row.token_hash).toBe(pendingHash(handle))
  expect(row.encrypted_payload).not.toContain('sensitive-access')
  expect(JSON.parse(decrypt(row.encrypted_payload))).toEqual(payload)
  expect(JSON.stringify(row)).not.toContain(handle)
})
it('does not query for malformed handles and rejects expired connections', async () => {
  expect(await readPendingZidConnection('bad')).toBeNull()
  expect(supabase.calls).toHaveLength(0)
  supabase.addMock('zid_oauth_pending', [{ token_hash: pendingHash('a'.repeat(64)), kind: 'connection', expires_at: '2000-01-01' }])
  expect(await readPendingZidConnection('a'.repeat(64))).toBeNull()
})
it('passes encrypted credentials to the atomic binding RPC with remaining token lifetime', async () => {
  const handle = await savePendingZidConnection({ store_id: '42', access_token: 'access', refresh_token: 'refresh', expires_at_ms: Date.now() + 120_000 })
  const row = supabase.calls.find(call => call.op === 'insert')!.args[0] as Record<string, unknown>
  supabase.addMock('zid_oauth_pending', [row])
  const rpc = jest.spyOn(supabase, 'rpc').mockResolvedValue({ data: '42', error: null } as never)
  expect(await finishZidConnection(handle, 'user-a', 'workspace-a')).toBe('42')
  expect(rpc).toHaveBeenCalledWith('complete_zid_oauth_connection', expect.objectContaining({
    p_hash: pendingHash(handle), p_user_id: 'user-a', p_workspace_id: 'workspace-a',
    p_token_data: expect.objectContaining({ access_token: expect.not.stringMatching(/^access$/), expires_in: expect.any(Number) }),
  }))
  const args = (rpc.mock.calls as unknown as Array<[string, { p_token_data: { access_token: string; refresh_token: string } }]>)[0][1]
  expect(decrypt(args.p_token_data.access_token)).toBe('access')
  expect(decrypt(args.p_token_data.refresh_token)).toBe('refresh')
  expect(supabase.calls.some(call => call.table === 'merchant_tokens')).toBe(false)
})
