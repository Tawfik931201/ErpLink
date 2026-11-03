import { replayDeadItem, replayAllDeadItems, retryFrozenItems, restoreQueueArchive } from '../../src/app/actions/queue-dashboard'
import { validateExecutionTarget } from '../../src/lib/erp-execution-target'
import { supabase } from '../mocks/supabase'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('../../src/lib/auth', () => ({ getActiveWorkspaceId: jest.fn().mockResolvedValue('ws-a') }))
jest.mock('../../src/lib/sync-queue', () => ({ extractEntityId: jest.fn(), FROZEN_SENTINEL: '9999-12-31' }))
jest.mock('../../src/lib/erp-execution-target', () => ({ validateExecutionTarget: jest.fn() }))

describe('manual queue recovery keeps original destination (offline)', () => {
  const validate = validateExecutionTarget as jest.Mock
  const dead = { id: 'dead-a', original_id: 'original-job', workspace_id: 'ws-a', store_id: 'store-a',
    platform: 'zid', event: 'order.create', payload: { id: 1 }, erp_connection_id: 'erp-a',
    connection_generation: 'generation-a', execution_key: 'entity-key', receipt_id: 'receipt-a' }
  beforeEach(() => { supabase.reset(); validate.mockReset().mockResolvedValue({}) })

  it('restores the original receipt/job/ERP identity without rebinding to a new connection', async () => {
    supabase.addMock('sync_queue_dead', [dead])
    expect(await replayDeadItem('dead-a')).toMatchObject({ success: true })
    expect(validate).toHaveBeenCalledWith('ws-a', 'zid', 'store-a', { erpConnectionId: 'erp-a', connectionGeneration: 'generation-a' })
    expect(supabase.calls.find(c => c.table === 'sync_queue' && c.op === 'insert')?.args[0])
      .toMatchObject({ id: 'original-job', receipt_id: 'receipt-a', erp_connection_id: 'erp-a', connection_generation: 'generation-a', execution_key: 'entity-key' })
  })
  it('does not recover another workspace dead letter', async () => {
    supabase.addMock('sync_queue_dead', [{ ...dead, workspace_id: 'ws-b' }])
    expect(await replayDeadItem('dead-a')).toMatchObject({ success: false })
    expect(validate).not.toHaveBeenCalled()
  })
  it('refuses unpinned historic dead letters instead of sending them to the current default', async () => {
    supabase.addMock('sync_queue_dead', [{ ...dead, erp_connection_id: null }])
    expect(await replayAllDeadItems()).toMatchObject({ success: false, replayed: 0 })
    expect(supabase.calls.some(c => c.table === 'sync_queue' && c.op === 'insert')).toBe(false)
  })
  it('refuses changed or disabled original connections', async () => {
    supabase.addMock('sync_queue_dead', [dead]); validate.mockRejectedValue(new Error('rotation'))
    expect(await replayDeadItem('dead-a')).toMatchObject({ success: false })
    expect(supabase.calls.some(c => c.table === 'sync_queue' && c.op === 'insert')).toBe(false)
  })
  it('bulk retry excludes unknown outcomes and active leases', async () => {
    await retryFrozenItems()
    expect(supabase.calls.find(c => c.table === 'sync_queue' && c.op === 'update')?.filters)
      .toContainEqual(['outcome_unknown', false])
  })
  it('rejects an old archive with no original pinned snapshot', async () => {
    supabase.addMock('queue_archives', [{ id: 'archive-a', workspace_id: 'ws-a', platform: 'zid', store_id: 'store-a' }])
    expect(await restoreQueueArchive('archive-a')).toMatchObject({ success: false })
    expect(supabase.calls.some(c => c.table === 'sync_queue' && c.op === 'insert')).toBe(false)
  })
})
