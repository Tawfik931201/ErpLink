import { accessibleWorkspaceId } from '../../src/lib/workspace-access'
import { supabase } from '../mocks/supabase'

describe('persisted active workspace authorization', () => {
  beforeEach(() => supabase.reset())
  it('permits an owner without requiring a membership row', async () => {
    supabase.addMock('workspaces', [{ id: 'ws-a', user_id: 'owner-a' }])
    expect(await accessibleWorkspaceId('owner-a', 'ws-a')).toBe('ws-a')
    expect(supabase.calls.some(c => c.table === 'workspace_members')).toBe(false)
  })
  it('permits a current member and scopes membership to both user and workspace', async () => {
    supabase.addMock('workspaces', [{ id: 'ws-a', user_id: 'owner-a' }])
    supabase.addMock('workspace_members', [{ workspace_id: 'ws-a', user_id: 'member-a' }])
    expect(await accessibleWorkspaceId('member-a', 'ws-a')).toBe('ws-a')
    expect(supabase.calls.find(c => c.table === 'workspace_members')?.filters)
      .toEqual([['workspace_id', 'ws-a'], ['user_id', 'member-a']])
  })
  it('rejects a removed member even with a persisted workspace selection', async () => {
    supabase.addMock('workspaces', [{ id: 'ws-a', user_id: 'owner-a' }])
    supabase.addMock('workspace_members', [{ workspace_id: 'ws-b', user_id: 'removed' }, { workspace_id: 'ws-a', user_id: 'someone-else' }])
    expect(await accessibleWorkspaceId('removed', 'ws-a')).toBeNull()
  })
  it('fails closed on query errors and deleted workspaces', async () => {
    expect(await accessibleWorkspaceId('member', 'deleted')).toBeNull()
    supabase.setMockResponder(() => ({ data: { id: 'ws-a', user_id: 'member' }, error: { message: 'unavailable' } }))
    expect(await accessibleWorkspaceId('member', 'ws-a')).toBeNull()
  })
  it('rejects missing selections without a query', async () => {
    expect(await accessibleWorkspaceId('member', null)).toBeNull()
    expect(supabase.calls).toHaveLength(0)
  })
})
