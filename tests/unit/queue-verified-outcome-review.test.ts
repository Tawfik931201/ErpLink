import fs from 'fs'
import path from 'path'

// Schema-level invariants; live integration must exercise the RPC inside
// a transaction against a test database before an uncertain job is released.
describe('audited unknown order outcome reconciliation SQL', () => {
  const migration = fs.readFileSync(path.join(process.cwd(),
    'supabase/migrations/20261118001500_verified_order_outcome_reconciliation.sql'), 'utf8')

  it('requires an unknown, unleased Zid order and serializes concurrent reviews', () => {
    expect(migration).toContain('FOR UPDATE')
    expect(migration).toContain('job.outcome_unknown IS DISTINCT FROM true')
    expect(migration).toContain('job.lease_token IS NOT NULL')
    expect(migration).toContain("job.platform <> 'zid'")
    expect(migration).toContain("job.event NOT IN ('order.updated', 'order.status.update')")
  })

  it('fences to exact workspace/store/order/ERP generation', () => {
    for (const fragment of [
      'link.workspace_id = job.workspace_id', 'link.platform = job.platform',
      'link.store_id = job.store_id', "link.store_entity_id = job.payload->>'id'",
      'link.erp_connection_id = job.erp_connection_id',
      'link.connection_generation = job.connection_generation',
    ]) expect(migration).toContain(fragment)
  })

  it('requires mapped financial, line, workflow and state evidence before marking applied', () => {
    for (const fragment of [
      'mapped_order_comparison', 'expected_total', 'actual_total',
      'expected_state', 'actual_state', 'lines_verified',
      'workflow_verified', "confirmed_applied",
    ]) expect(migration).toContain(fragment)
  })

  it('persists a unique audit and does not grant replay to untrusted browser roles', () => {
    expect(migration).toContain('queue_id uuid NOT NULL UNIQUE')
    expect(migration).toContain('source_payload_md5')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.resolve_verified_unknown_order_job')
    expect(migration).toContain('TO service_role')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.resolve_verified_unknown_order_job')
  })

  it('never unblocks an unknown outcome without a verified decision', () => {
    expect(migration).toContain("p_decision = 'confirmed_applied'")
    expect(migration).toContain("p_decision = 'confirmed_no_remote_effect'")
    expect(migration).toContain('no_remote_effect_verified')
    expect(migration).toContain('outcome_unknown = false')
  })
})
