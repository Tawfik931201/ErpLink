import { resolveEntityLinkId, upsertEntityLink } from '../../src/lib/entity-links'
import { assertSaleOrderLinkOwnership } from '../../src/lib/orders/matching'
import { findOriginalSaleOrder } from '../../src/lib/returns/odoo'
import { getCachedStandardMappingSettings } from '../../src/lib/sync/settings'

jest.mock('../../src/lib/sync/settings', () => ({
  getCachedStandardMappingSettings: jest.fn(),
}))
jest.mock('../../src/lib/entity-links', () => ({
  resolveEntityLinkId: jest.fn().mockResolvedValue(null),
  upsertEntityLink: jest.fn().mockResolvedValue(true),
}))
jest.mock('../../src/lib/orders/matching', () => ({
  assertSaleOrderLinkOwnership: jest.fn().mockResolvedValue(undefined),
}))

const params = {
  workspaceId: 'ws', platform: 'zid' as const,
  storeId: '3172448', orderId: '502218013',
  payload: { id: 502218013, code: 'QA-ORDER-7' },
}
const configured = getCachedStandardMappingSettings as jest.Mock
const linked = resolveEntityLinkId as jest.Mock
const ownership = assertSaleOrderLinkOwnership as jest.Mock
const upsert = upsertEntityLink as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  configured.mockResolvedValue({ match_zid_field: 'id', match_odoo_field: 'client_order_ref' })
  linked.mockResolvedValue(null)
  upsert.mockResolvedValue(true)
})

function fakeClient(records: unknown[] = []) {
  return {
    getMajorVersion: jest.fn().mockResolvedValue(19),
    searchRead: jest.fn().mockImplementation(async (model: string, domain: unknown) => {
      if (model !== 'sale.order') return []
      const arr = JSON.stringify(domain)
      if (arr.includes('client_order_ref') || arr.includes('x_qa_order_ref')) return records
      if (arr.includes('"id"') && records.length === 1) return [{
        id: 67, name: 'S00067', state: 'draft',
        partner_id: [15, 'QA'], pricelist_id: [1, 'List'],
        company_id: [1, 'Company'], warehouse_id: [1, 'WH'],
        invoice_ids: [], order_line: [],
      }]
      return []
    }),
  } as any
}

describe('returns use Orders Standard Mapping matching fields', () => {
  it('searches the exact configured id → client_order_ref field', async () => {
    const client = fakeClient([{ id: 67, amount_total: 210 }])
    const result = await findOriginalSaleOrder(client, params)
    expect(result?.id).toBe(67)
    expect(client.searchRead.mock.calls[0][1]).toEqual([
      ['client_order_ref', '=', '502218013'], ['state', '!=', 'cancel'],
    ])
    expect(ownership).toHaveBeenCalledWith(expect.anything(), 67, {
      workspaceId: 'ws', platform: 'zid', storeId: '3172448', storeEntityId: '502218013',
    })
    expect(upsert).toHaveBeenCalledWith(expect.anything(), 67)
  })

  it('switches to a custom saved order match field without guessing the old ID', async () => {
    configured.mockResolvedValue({ match_zid_field: 'code', match_odoo_field: 'x_qa_order_ref' })
    const client = fakeClient([{ id: 67, amount_total: 210 }])
    await findOriginalSaleOrder(client, params)
    expect(client.searchRead.mock.calls[0][1]).toEqual([
      ['x_qa_order_ref', '=', 'QA-ORDER-7'], ['state', '!=', 'cancel'],
    ])
  })

  it('fails closed on missing custom match values instead of falling back to order id', async () => {
    configured.mockResolvedValue({ match_zid_field: 'customer.reference', match_odoo_field: 'x_external_ref' })
    const client = fakeClient([])
    await expect(findOriginalSaleOrder(client, params))
      .rejects.toThrow('return_order_match_source_missing')
    expect(client.searchRead).not.toHaveBeenCalled()
  })

  it('blocks missing saved match when the same Zid order already owns a durable original SO', async () => {
    configured.mockResolvedValue({ match_zid_field: 'code', match_odoo_field: 'client_order_ref' })
    linked.mockResolvedValue(57)
    const client = fakeClient([])
    await expect(findOriginalSaleOrder(client, params))
      .rejects.toThrow('return_order_match_missing_but_linked:57')
    expect(client.searchRead.mock.calls[0][1]).toEqual([
      ['client_order_ref', '=', 'QA-ORDER-7'], ['state', '!=', 'cancel'],
    ])
    expect(linked).toHaveBeenCalledWith(expect.objectContaining({
      storeEntityId: params.orderId, odooModel: 'sale.order',
    }))
    expect(upsert).not.toHaveBeenCalled()
  })

  it('allows true missing-original fallback only when both saved match and durable original are absent', async () => {
    configured.mockResolvedValue({ match_zid_field: 'code', match_odoo_field: 'client_order_ref' })
    linked.mockResolvedValue(null)
    const client = fakeClient([])
    await expect(findOriginalSaleOrder(client, params)).resolves.toBeNull()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('rejects ambiguous saved match and does not write a return', async () => {
    const client = fakeClient([{ id: 67, amount_total: 210 }, { id: 68, amount_total: 210 }])
    await expect(findOriginalSaleOrder(client, params))
      .rejects.toThrow('return_order_match_ambiguous')
    expect(ownership).not.toHaveBeenCalled()
  })

  it('rejects a configured match that conflicts with the durable order link', async () => {
    linked.mockResolvedValue(88)
    const client = fakeClient([{ id: 67, amount_total: 210 }])
    await expect(findOriginalSaleOrder(client, params))
      .rejects.toThrow('return_order_match_conflicts_with_durable_link')
  })

  it('never matches a negative return SO as the original', async () => {
    const client = fakeClient([{ id: 67, amount_total: -210 }])
    await expect(findOriginalSaleOrder(client, params))
      .rejects.toThrow('return_order_match_invalid')
  })
})
