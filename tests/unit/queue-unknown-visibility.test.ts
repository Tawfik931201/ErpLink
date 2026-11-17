import { readFileSync } from 'fs'
import { join } from 'path'

describe('Queue unknown ERP outcome visibility', () => {
  const dashboard = readFileSync(join(process.cwd(), 'src/app/actions/queue-dashboard.ts'), 'utf8')
  const client = readFileSync(join(process.cwd(), 'src/app/(app)/app/queue/queue-client.tsx'), 'utf8')
  const recovery = readFileSync(join(process.cwd(), 'supabase/migrations/20261117174500_queue_lease_recovery.sql'), 'utf8')

  it('counts uncertain ERP outcomes for the active workspace without exposing another workspace', () => {
    expect(dashboard).toContain("q.eq('workspace_id', workspaceId).eq('outcome_unknown', true)")
    expect(dashboard).toContain('        uncertain,')
  })

  it('keeps uncertain jobs visible but not included in Retry Frozen', () => {
    expect(client).toContain('overview?.uncertain ?? 0')
    expect(client).toContain('const frozenCount = Math.max(0, (overview?.frozen ?? 0) - (overview?.uncertain ?? 0))')
    expect(client).toContain('Retry Frozen cannot replay them')
    expect(dashboard).toContain(".eq('outcome_unknown', false)")
  })

  it('continues to fence later jobs until remote effects are reconciled safely', () => {
    expect(recovery).toContain('other.outcome_unknown')
    expect(recovery).toContain('other.execution_key = q.execution_key')
    expect(recovery).toContain('ERP_OUTCOME_UNKNOWN: active worker lease expired; reconciliation required')
  })
})
