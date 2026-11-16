import { connectionGeneration } from '../../src/lib/erp-execution-target'
import { enqueueWebhookEvent } from '../../src/lib/sync-queue'
import { dispatchWebhookReceipt, drainWebhookInbox, pruneProcessedInbox } from '../../src/lib/webhook-inbox'
import { supabase } from '../mocks/supabase'

describe('durable dispatch RPC boundary (offline)', () => {
  const originalRpc = supabase.rpc
  beforeEach(() => supabase.reset())
  afterEach(() => { supabase.rpc = originalRpc })

  it('accepts a Zid category without Odoo and dispatches once the workspace has a current connection', async () => {
    const event = {
      workspaceId: 'ws-a', platform: 'zid', storeId: 'store-a', event: 'category.update',
      payload: { id: 'category-a' }, acceptBeforeErp: true,
    }
    supabase.addMock('webhook_inbox', [])
    supabase.addMock('merchant_tokens', [{ workspace_id: event.workspaceId }])
    supabase.setMockResponder((table, op) => {
      if (table === 'webhook_inbox' && op === 'select') {
        return { data: { id: 'receipt-a' }, error: null }
      }
      return undefined
    })

    expect(await enqueueWebhookEvent(event)).toEqual({ deferred: true })
    const save = supabase.calls.findIndex(call => call.table === 'webhook_inbox' && call.op === 'insert')
    const lookup = supabase.calls.findIndex(call => call.table === 'erp_connections')
    expect(save).toBeGreaterThanOrEqual(0)
    expect(lookup).toBeGreaterThan(save)
    expect(supabase.calls[save].args[0]).toMatchObject({
      awaiting_erp: true, erp_connection_id: null, workspace_id: event.workspaceId, store_id: event.storeId,
    })

    supabase.setMockResponder(null)
    supabase.addMock('webhook_inbox', [{
      id: 'receipt-a', status: 'pending', workspace_id: event.workspaceId, platform: 'zid',
      store_id: event.storeId, attempts: 0, awaiting_erp: true,
    }])
    const dbDispatch = jest.fn(async () => ({ data: 'job-a', error: null }))
    supabase.rpc = dbDispatch as unknown as typeof supabase.rpc
    expect(await drainWebhookInbox()).toMatchObject({ enqueued: 0, failed: 0 })
    expect(dbDispatch).not.toHaveBeenCalled()

    const connection = {
      id: 'erp-new', workspace_id: event.workspaceId, erp_type: 'odoo', status: 'connected',
      url: 'https://new.example', db_name: 'new', username: 'user', password: 'cipher',
    }
    supabase.addMock('erp_connections', [connection])
    supabase.addMock('erp_workspace_bindings', [{ ...connection, erp_connection_id: connection.id }])
    expect(await drainWebhookInbox()).toMatchObject({ enqueued: 1, failed: 0 })
    expect(dbDispatch).toHaveBeenCalledWith('dispatch_webhook_receipt', {
      p_receipt_id: 'receipt-a',
      p_queue_row: expect.objectContaining({
        erp_connection_id: connection.id, connection_generation: connectionGeneration(connection),
      }),
    })
  })

  it('uses the same authoritative receipt identity on intake and repeated recovery', async () => {
    const accepted = new Map<string, string>()
    let writes = 0
    supabase.rpc = (async (name: string, args: { p_receipt_id: string }) => {
      expect(name).toBe('dispatch_webhook_receipt')
      if (!accepted.has(args.p_receipt_id)) accepted.set(args.p_receipt_id, `job-${++writes}`)
      return { data: accepted.get(args.p_receipt_id), error: null }
    }) as unknown as typeof supabase.rpc
    const outcomes = await Promise.all(Array.from({ length: 1000 }, () =>
      dispatchWebhookReceipt('receipt-1', { max_retries: 5, next_retry_at: new Date().toISOString() })))
    expect(new Set(outcomes.map(o => o.id))).toEqual(new Set(['job-1']))
    expect(writes).toBe(1)
    // The marker is independent of a deleted successful queue row.
    expect(await dispatchWebhookReceipt('receipt-1', { max_retries: 5, next_retry_at: new Date().toISOString() })).toEqual({ id: 'job-1' })
  })

  it('keeps dispatch failure recoverable without an unlinked direct queue insert', async () => {
    supabase.addMock('webhook_inbox', [{ id: 'receipt-1', status: 'pending', platform: 'zid', store_id: 'store-a', workspace_id: 'ws-a',
      event: 'order.create', dedup_key: 'delivery-1', payload: { id: 1 }, attempts: 0 }])
    supabase.rpc = (async () => ({ data: null, error: { message: 'database unavailable' } })) as unknown as typeof supabase.rpc
    const result = await drainWebhookInbox(10)
    expect(result.failed).toBe(1)
    expect(supabase.calls.some(c => c.table === 'sync_queue' && c.op === 'insert')).toBe(false)
    expect(supabase.calls.find(c => c.table === 'webhook_inbox' && c.op === 'update')?.args[0]).toMatchObject({ attempts: 1 })
  })

  it('reports a lost dispatch response as retryable instead of making a second direct write', async () => {
    supabase.rpc = (async () => { throw new Error('response lost after commit') }) as unknown as typeof supabase.rpc
    expect(await dispatchWebhookReceipt('receipt-1', { max_retries: 5, next_retry_at: new Date().toISOString() }))
      .toEqual({ error: 'receipt_dispatch_transport_failed' })
    expect(supabase.calls).toHaveLength(0)
  })

  it('limits automated pruning to legacy receipts, retaining new permanent identities', async () => {
    await pruneProcessedInbox(7)
    expect(supabase.calls.find(c => c.table === 'webhook_inbox' && c.op === 'delete')?.filters)
      .toContainEqual(['durable_version', 1])
  })
})
