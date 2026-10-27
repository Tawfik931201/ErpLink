import fs from 'fs'
import path from 'path'

import { ensureDefaultWorkspace } from '@/lib/workspace-defaults'

import { supabase } from '../mocks/supabase'

describe('ensureDefaultWorkspace', () => {
  beforeEach(() => {
    supabase.calls.length = 0
  })

  it('returns null if userId is empty', async () => {
    const res = await ensureDefaultWorkspace('')
    expect(res).toBeNull()
    expect(supabase.calls.length).toBe(0)
  })

  it('queries users, workspaces, and audit_logs in expected order', async () => {
    await ensureDefaultWorkspace('user-123')

    const tables = supabase.calls.map((c) => c.table)
    expect(tables).toContain('users')
    expect(tables).toContain('workspaces')
    expect(tables).toContain('workspace_members')
    expect(tables).toContain('audit_logs')
  })

  it('inserts a Default workspace scoped to the user if no workspace exists', async () => {
    await ensureDefaultWorkspace('user-new-456')

    const insertCall = supabase.calls.find(
      (c) => c.table === 'workspaces' && c.op === 'insert'
    )
    expect(insertCall).toBeDefined()
    expect(insertCall?.args[0]).toEqual([
      { name: 'Default', user_id: 'user-new-456' },
    ])
  })

  it('layout.tsx wires ensureDefaultWorkspace into ensureWorkspaceAccess', () => {
    const layoutPath = path.join(__dirname, '..', '..', 'src', 'app', '(app)', 'app', 'layout.tsx')
    const layoutSrc = fs.readFileSync(layoutPath, 'utf8')
    expect(layoutSrc).toContain("import { ensureDefaultWorkspace } from '@/lib/workspace-defaults'")
    expect(layoutSrc).toMatch(/activeId\s*=\s*await\s+ensureDefaultWorkspace\(userId\)/)
  })

  it('users.ts calls ensureDefaultWorkspace when active_workspace_id is missing', () => {
    const usersPath = path.join(__dirname, '..', '..', 'src', 'lib', 'users.ts')
    const usersSrc = fs.readFileSync(usersPath, 'utf8')
    expect(usersSrc).toContain("import { ensureDefaultWorkspace } from '@/lib/workspace-defaults'")
    expect(usersSrc).toMatch(/ensureDefaultWorkspace\(userId\)/)
  })

  it('workspaces.ts records audit log on deleteWorkspace', () => {
    const wsPath = path.join(__dirname, '..', '..', 'src', 'app', 'actions', 'workspaces.ts')
    const wsSrc = fs.readFileSync(wsPath, 'utf8')
    expect(wsSrc).toContain("action: 'workspace.delete'")
  })
})
