import { reconcileZidDeletedCategories, isZidCategoryNotFound } from '../../src/lib/category-delete-reconciliation'
import { enqueueWebhookEvent } from '../../src/lib/sync-queue'
import { ZidAPI } from '../../src/lib/zid-client'
import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/sync-queue', () => ({
  enqueueWebhookEvent: jest.fn(async () => ({ id: 'job-1' })),
}))
jest.mock('../../src/lib/erp-execution-target', () => ({
  resolveExecutionTarget: jest.fn(async () => ({
    erpConnectionId: 'erp-1', connectionGeneration: 'generation-1',
  })),
}))
jest.mock('../../src/lib/webhook-gate', () => ({
  isWebhookEventEnabled: jest.fn(async () => ({ allowed: true })),
}))
jest.mock('../../src/lib/zid/token', () => ({
  getAccessToken: jest.fn(async () => ({
    authorization: 'fixture', accessToken: 'fixture',
  })),
}))
jest.mock('../../src/lib/zid-client', () => ({
  ZidAPI: { categories: { get: jest.fn() } },
}))

const get = ZidAPI.categories.get as jest.Mock
const enqueue = enqueueWebhookEvent as jest.Mock
const states = new Map<string, Record<string, unknown>>()

describe('Zid missing category webhook recovery', () => {
  beforeEach(() => {
    supabase.reset()
    states.clear()
    jest.clearAllMocks()
    supabase.addMock('merchant_tokens', [{
      merchant_id: 'merchant-1', store_id: 'store-1', workspace_id: 'ws-1',
    }])
    supabase.addMock('odoo_entity_links', [{
      workspace_id: 'ws-1', store_id: 'store-1', platform: 'zid',
      entity_type: 'categories', store_entity_id: '1787490',
    }])
    supabase.setMockResponder((table, op) => {
      if (table !== 'sync_reconcile_state') return undefined
      const call = supabase.calls[supabase.calls.length - 1]
      if (op === 'upsert') {
        const next = call.args[0] as Record<string, unknown>
        states.set(String(next.scope), { ...states.get(String(next.scope)), ...next })
        return { data: null, error: null }
      }
      const scope = call.filters.find(([field]) => field === 'scope')?.[1]
      return { data: states.get(String(scope)) ?? null, error: null }
    })
  })

  it('requires two explicit 404s at least one minute apart before delete', async () => {
    get.mockRejectedValue({ response: { status: 404 } })
    const first = await reconcileZidDeletedCategories(new Date('2026-11-18T00:00:00Z'))
    expect(first.checked).toBe(1)
    expect(first.enqueued).toBe(0)
    const tooSoon = await reconcileZidDeletedCategories(new Date('2026-11-18T00:00:30Z'))
    expect(tooSoon.enqueued).toBe(0)
    const confirmed = await reconcileZidDeletedCategories(new Date('2026-11-18T00:02:00Z'))
    expect(confirmed.confirmedMissing).toBe(1)
    expect(confirmed.enqueued).toBe(1)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      event: 'category.delete', workspaceId: 'ws-1', storeId: 'store-1',
      payload: { category_id: '1787490' },
    }))
  })

  it('never treats timeouts, 429, 500 or unauthorized access as proof of deletion', async () => {
    for (const status of [401, 429, 500]) {
      expect(isZidCategoryNotFound({ response: { status } })).toBe(false)
    }
    expect(isZidCategoryNotFound(new Error('Request timed out'))).toBe(false)
    get.mockRejectedValue({ response: { status: 500 } })
    const result = await reconcileZidDeletedCategories(new Date('2026-11-18T00:00:00Z'))
    expect(result.errors).toHaveLength(1)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('clears first absence when the category reappears', async () => {
    get.mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({ data: { category: { id: 1787490 } } })
      .mockRejectedValueOnce({ response: { status: 404 } })
    await reconcileZidDeletedCategories(new Date('2026-11-18T00:00:00Z'))
    await reconcileZidDeletedCategories(new Date('2026-11-18T00:01:05Z'))
    const third = await reconcileZidDeletedCategories(new Date('2026-11-18T00:02:30Z'))
    expect(third.enqueued).toBe(0)
  })
})
