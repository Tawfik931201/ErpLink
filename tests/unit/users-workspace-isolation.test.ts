jest.mock('react', () => ({ cache: (fn: unknown) => fn }))
jest.mock('@clerk/nextjs/server', () => ({ currentUser: jest.fn() }))

import { getOrCreateDbUser } from '../../src/lib/users'
import { ensureDefaultWorkspace } from '../../src/lib/workspace-defaults'
import { supabase } from '../mocks/supabase'

describe('user action workspace boundary', () => {
  beforeEach(() => {
    supabase.reset()
    supabase.addMock('users', [{ id: 'removed', active_workspace_id: 'ws-a' }])
    supabase.addMock('workspaces', [{ id: 'ws-a', user_id: 'owner-a' }])
    supabase.addMock('workspace_members', [])
    supabase.addMock('audit_logs', [{ actor_id: 'removed', action: 'workspace.delete' }])
  })
  it('does not expose a removed member workspace through the shared action user resolver', async () => {
    const user = await getOrCreateDbUser('removed')
    expect(user.active_workspace_id).toBeNull()
  })
  it('does not revive a removed membership from the default-workspace fast path', async () => {
    expect(await ensureDefaultWorkspace('removed')).toBeNull()
  })
  it('retains the active workspace for its owner', async () => {
    supabase.addMock('users', [{ id: 'owner-a', active_workspace_id: 'ws-a' }])
    expect((await getOrCreateDbUser('owner-a')).active_workspace_id).toBe('ws-a')
  })
})
