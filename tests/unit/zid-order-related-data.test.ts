import { resolveOrderRelatedRecord } from '@/lib/orders/related-matching'
import { acquirePullToken } from '@/lib/store-pull-budget'
import { resolveZidOrderTokenScope } from '@/lib/zid/order-enrichment'
import { readOrderRelatedDetails } from '@/lib/zid/order-related-data'
import { getAccessToken } from '@/lib/zid/token'
import { ZidAPI } from '@/lib/zid-client'

import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/zid/order-enrichment', () => ({
  resolveZidOrderTokenScope: jest.fn(async (storeId: string) => ({ merchant_id: storeId, store_id: storeId, workspace_id: 'ws' })),
  zidOrderCacheScope: (workspace: string, store: string) => JSON.stringify([workspace, store]),
}))
jest.mock('../../src/lib/zid/token', () => ({ getAccessToken: jest.fn(async () => ({ authorization: 'test', accessToken: 'test' })) }))
jest.mock('../../src/lib/store-pull-budget', () => ({ acquirePullToken: jest.fn(async () => true) }))
jest.mock('../../src/lib/zid-client', () => ({ ZidAPI: {
  products: { get: jest.fn(async () => ({ data: { product: { id: 'p1', barcode: 'API-BARCODE' } } })) },
  customers: { get: jest.fn(async () => ({ data: { customer: { id: 'p1', email: 'buyer@example.test' } } })) },
} }))

const identity = { workspaceId: 'ws', platform: 'zid' as const, storeId: 'store' }
describe('read missing match data before preparing an order', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(acquirePullToken as jest.Mock).mockResolvedValue(true)
    ;(resolveZidOrderTokenScope as jest.Mock).mockImplementation(async (storeId: string) => ({ merchant_id: storeId, store_id: storeId, workspace_id: 'ws' }))
    ;(ZidAPI.products.get as jest.Mock).mockResolvedValue({ data: { product: { id: 'p1', barcode: 'API-BARCODE' } } })
  })

  it('does not fetch entity details when the configured match value is already available', async () => {
    const hydrate = jest.fn()
    const client = { execute: jest.fn().mockResolvedValue([{ name: 'barcode', ttype: 'char' }]), search: jest.fn().mockResolvedValue([42]) }
    await resolveOrderRelatedRecord(client, supabase, identity, 'products', { barcode: 'ORDER-BARCODE' }, { match_zid_field: 'barcode', match_odoo_field: 'barcode' }, hydrate)
    expect(hydrate).not.toHaveBeenCalled()
  })

  it('hydrates the selected missing field and keeps its typed value as the matching key', async () => {
    const client = { execute: jest.fn().mockResolvedValue([{ name: 'barcode', ttype: 'char' }]), search: jest.fn().mockResolvedValue([42]) }
    const result = await resolveOrderRelatedRecord(client, supabase, identity, 'products', { id: 'p1' }, { match_zid_field: 'barcode', match_odoo_field: 'barcode' }, () => readOrderRelatedDetails(client, identity, 'products', { id: 'p1' }))
    expect(result.recordId).toBe(42)
    expect(client.search).toHaveBeenCalledWith('product.product', [['barcode', '=', 'API-BARCODE']], 2)
  })

  it('deduplicates repeated reads only inside the same execution and store scope', async () => {
    const client = {}
    await Promise.all([1, 2, 3].map(() => readOrderRelatedDetails(client, identity, 'products', { id: 'p1' })))
    expect(ZidAPI.products.get).toHaveBeenCalledTimes(1)
    await readOrderRelatedDetails(client, { ...identity, storeId: 'other' }, 'products', { id: 'p1' })
    await readOrderRelatedDetails({}, identity, 'products', { id: 'p1' })
    expect(ZidAPI.products.get).toHaveBeenCalledTimes(3)
    expect(resolveZidOrderTokenScope).toHaveBeenCalledWith('store', 'ws')
  })

  it('keeps product and customer IDs in separate cache entries', async () => {
    const client = {}
    expect((await readOrderRelatedDetails(client, identity, 'products', { id: 'p1' })).barcode).toBe('API-BARCODE')
    expect((await readOrderRelatedDetails(client, identity, 'customers', { id: 'p1' })).email).toBe('buyer@example.test')
    expect(ZidAPI.customers.get).toHaveBeenCalledTimes(1)
  })

  it('does not call Zid if the store cannot be verified or the read budget is exhausted', async () => {
    ;(resolveZidOrderTokenScope as jest.Mock).mockResolvedValueOnce(null)
    await expect(readOrderRelatedDetails({}, identity, 'products', { id: 'p1' })).rejects.toThrow('No linked Zid store')
    ;(acquirePullToken as jest.Mock).mockResolvedValue(false)
    await expect(readOrderRelatedDetails({}, identity, 'products', { id: 'p1' })).rejects.toThrow('pull budget exhausted')
    expect(getAccessToken).not.toHaveBeenCalled()
    expect(ZidAPI.products.get).not.toHaveBeenCalled()
  })

  it('rejects a mismatched API entity before using its matching fields', async () => {
    ;(ZidAPI.products.get as jest.Mock).mockResolvedValue({ data: { product: { id: 'different', barcode: 'WRONG' } } })
    await expect(readOrderRelatedDetails({}, identity, 'products', { id: 'p1' })).rejects.toThrow('different related entity')
  })
})
