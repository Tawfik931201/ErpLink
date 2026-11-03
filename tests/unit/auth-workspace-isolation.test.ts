jest.mock('react', () => ({ cache: (fn: unknown) => fn }))
jest.mock('@clerk/nextjs/server', () => ({ auth: jest.fn() }))
jest.mock('next/headers', () => ({ cookies: jest.fn() }))

import { auth } from '@clerk/nextjs/server'

import { getActiveWorkspaceId } from '../../src/lib/auth'
import { supabase } from '../mocks/supabase'

describe('authenticated active workspace boundary', () => {
  beforeEach(() => {
    supabase.reset()
    ;(auth as unknown as jest.Mock).mockResolvedValue({ userId: 'caller' })
    supabase.addMock('users', [{ id: 'caller', active_workspace_id: 'ws-a' }])
    supabase.addMock('workspaces', [{ id: 'ws-a', user_id: 'owner' }])
    supabase.addMock('workspace_members', [])
  })
  it('rejects a stale selection after membership removal', async () => {
    expect(await getActiveWorkspaceId()).toBeNull()
  })
  it('permits current membership', async () => {
    supabase.addMock('workspace_members', [{ user_id: 'caller', workspace_id: 'ws-a' }])
    expect(await getActiveWorkspaceId()).toBe('ws-a')
  })
  it('permits the workspace owner', async () => {
    supabase.addMock('workspaces', [{ id: 'ws-a', user_id: 'caller' }])
    expect(await getActiveWorkspaceId()).toBe('ws-a')
  })
})
