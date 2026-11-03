import { reconcileZidOrders } from '../../src/lib/reconciliation'
import { enqueueWebhookEvent } from '../../src/lib/sync-queue'
import { ZidAPI } from '../../src/lib/zid-client'
import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/sync-queue', () => ({ enqueueWebhookEvent: jest.fn(async () => ({ id: 'queued' })) }))
jest.mock('../../src/lib/erp-execution-target', () => ({ resolveExecutionTarget: jest.fn(async (workspaceId: string) => ({ erpConnectionId: `erp-${workspaceId}`, connectionGeneration: 'generation' })) }))
jest.mock('../../src/lib/webhook-gate', () => ({ isWebhookEventEnabled: jest.fn(async () => ({ allowed: true })) }))
jest.mock('../../src/lib/zid/token', () => ({ getAccessToken: jest.fn(async () => ({ authorization: 'fixture', accessToken: 'fixture' })) }))
jest.mock('../../src/lib/zid-client', () => ({ ZidAPI: { orders: { list: jest.fn() } } }))

const list = ZidAPI.orders.list as jest.Mock
const enqueue = enqueueWebhookEvent as jest.Mock
const states = new Map<string, Record<string, any>>()
const merchants = (count: number) => Array.from({ length: count }, (_, i) => ({ merchant_id: `merchant-${i}`, store_id: `store-${i}`, workspace_id: `workspace-${i}` }))
const orders = (count: number, offset = 0) => Array.from({ length: count }, (_, i) => ({ id: offset + i + 1, updated_at: '2026-11-03T10:00:00Z' }))

describe('Zid reconciliation bounded recovery', () => {
  beforeEach(() => {
    supabase.reset(); states.clear(); jest.clearAllMocks()
    list.mockResolvedValue({ data: { orders: [] } })
    enqueue.mockResolvedValue({ id: 'queued' })
    supabase.setMockResponder((table, op) => {
      const call = supabase.calls[supabase.calls.length - 1]
      if (table !== 'sync_reconcile_state') return undefined
      if (op === 'upsert') {
        const row = call.args[0] as Record<string, any>
        states.set(row.scope, { ...states.get(row.scope), ...row })
        return { data: null, error: null }
      }
      const scope = call.filters.find(([key]) => key === 'scope')?.[1] as string
      return { data: states.get(scope) || null, error: null }
    })
  })

  it('rotates beyond four merchants instead of starving later stores', async () => {
    supabase.addMock('merchant_tokens', merchants(6))
    expect((await reconcileZidOrders()).apiCalls).toBe(4)
    list.mockClear()
    await reconcileZidOrders()
    expect(list.mock.calls.slice(0, 2).map(call => call[0].storeId)).toEqual(['store-4', 'store-5'])
    expect([...states.keys()].every(scope => scope.includes('workspace-') && scope.includes('erp-'))).toBe(true)
  })

  it('resumes page two in the fixed window and only then advances that store watermark', async () => {
    supabase.addMock('merchant_tokens', merchants(1))
    list.mockResolvedValueOnce({ data: { orders: orders(50) } }).mockResolvedValueOnce({ data: { orders: orders(25, 50) } })
    await reconcileZidOrders({ now: new Date('2026-11-03T12:00:00Z') })
    const first = [...states.values()][0]
    expect(first.cursor.page).toBe(2)
    expect(first.last_success).toBeUndefined()
    await reconcileZidOrders({ now: new Date('2026-11-03T12:30:00Z') })
    expect(list.mock.calls[1][1]).toMatchObject({ page: 2, date_to: '2026-11-03T11:59:00.000Z', date_from: list.mock.calls[0][1].date_from })
    expect([...states.values()][0]).toMatchObject({ cursor: {}, last_success: '2026-11-03T11:59:00.000Z' })
    expect(enqueue).toHaveBeenCalledTimes(75)
  })

  it('replays a partially dispatched page and preserves the watermark on durable enqueue failure', async () => {
    supabase.addMock('merchant_tokens', merchants(1))
    list.mockResolvedValue({ data: { orders: orders(3) } })
    enqueue.mockResolvedValueOnce({ id: 'ok' }).mockResolvedValueOnce({ error: 'database_down' })
    expect((await reconcileZidOrders()).stopped).toBe('error')
    expect([...states.values()][0].last_success).toBeUndefined()
    expect([...states.values()][0].cursor.page).toBe(1)
    await reconcileZidOrders()
    expect(list.mock.calls[1][1].page).toBe(1)
    expect(enqueue).toHaveBeenCalledTimes(5)
  })

  it('never dispatches beyond the global 100-item cap or advances an unfinished page', async () => {
    supabase.addMock('merchant_tokens', merchants(3))
    list.mockResolvedValue({ data: { orders: orders(50) } })
    const result = await reconcileZidOrders()
    expect(result.enqueued).toBe(100)
    expect(result.apiCalls).toBe(2)
    expect(result.stopped).toBe('rate_ceiling')
    expect([...states.values()].every(state => !state.last_success && state.cursor.page === 2)).toBe(true)
  })
})
