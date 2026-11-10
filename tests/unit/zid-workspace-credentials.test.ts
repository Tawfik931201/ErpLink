import { disconnectZidStore, getActiveWorkspaceZidTokens, updateZidSyncSettings } from '../../src/app/actions/workspaces'
import { supabase } from '../mocks/supabase'

const mockUnregister = jest.fn(async () => ({ removed: 1 }))
const mockSync = jest.fn(async () => ({}))
jest.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, revalidatePath: jest.fn(), revalidateTag: jest.fn() }))
jest.mock('../../src/lib/auth', () => ({ getActiveUserId: async () => 'user-a' }))
jest.mock('../../src/lib/users', () => ({ getOrCreateDbUser: async () => ({ id: 'user-a', active_workspace_id: 'ws-a' }) }))
jest.mock('../../src/lib/salla-client', () => ({ unregisterSallaWebhooks: jest.fn() }))
jest.mock('../../src/lib/shopify-client', () => ({}))
jest.mock('../../src/lib/zid/webhooks', () => ({
  unregisterAllZidWebhooks: (...args: unknown[]) => mockUnregister(...args as []),
  syncWebhooksWithSettings: (...args: unknown[]) => mockSync(...args as []),
}))
beforeEach(() => {
  supabase.reset()
  jest.clearAllMocks()
  supabase.addMock('merchant_tokens', [
    { merchant_id: '42', store_id: '42', workspace_id: 'ws-a', name: 'A', access_token: 'private-access', refresh_token: 'private-refresh', authorization_token: 'private-auth' },
    { merchant_id: '43', store_id: '43', workspace_id: 'ws-b', name: 'B' },
  ])
})
it('keeps credentials out of the server-action response and requests only safe columns', async () => {
  const response = await getActiveWorkspaceZidTokens()
  expect(response.success).toBe(true)
  if (!response.success) throw new Error('Expected store list')
  expect(response.tokens).toHaveLength(1)
  expect(response.tokens[0].merchant_id).toBe('42')
  expect(JSON.stringify(response)).not.toContain('private-')
  const select = supabase.calls.find(call => call.table === 'merchant_tokens' && call.op === 'select')!
  expect(select.filters).toContainEqual(['workspace_id', 'ws-a'])
  for (const secret of ['access_token', 'refresh_token', 'authorization_token', '*']) expect(select.args[0]).not.toContain(secret)
})
it.each(['disconnect', 'settings'])('rejects cross-workspace %s before provider calls or writes', async action => {
  const result = action === 'disconnect' ? await disconnectZidStore('43') : await updateZidSyncSettings('43', {})
  expect(result.success).toBe(false)
  expect(mockUnregister).not.toHaveBeenCalled()
  expect(mockSync).not.toHaveBeenCalled()
  expect(supabase.calls.some(call => ['update', 'delete', 'insert'].includes(call.op))).toBe(false)
})
it('still permits changes to the current workspace store', async () => {
  expect((await updateZidSyncSettings('42', { product_update: { zid2odoo: true, odoo2zid: false } })).success).toBe(true)
  expect(mockSync).toHaveBeenCalledWith('42', expect.any(Object))
})
