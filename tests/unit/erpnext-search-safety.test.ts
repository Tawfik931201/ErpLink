import { ErpNextClient } from '../../src/lib/erpnext/client'
import { executeErpNextOperation } from '../../src/lib/erpnext/records'
import type { FieldMappingRow } from '../../src/lib/sync-types'

jest.mock('../../src/lib/sync-runtime', () => ({ logSync: jest.fn() }))

const client = () => new ErpNextClient({ url: 'https://erpnext.invalid', username: 'fixture', apiKey: 'fixture' })
const mapping: FieldMappingRow = {
  id: 'map', workspace_id: 'ws', erp_connection_id: 'erp', merchant_id: 'store',
  store_id: null, action: 'product.create', odoo_model: 'Item', mappings: {}, name: 'Fixture',
  odoo_match_field: 'item_code', zid_match_field: 'sku',
}

afterEach(() => jest.restoreAllMocks())

it('encodes DocType and document name as independent URL segments', async () => {
  const fetcher = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce(Response.json({ data: [{ name: 'A/B' }] }))
    .mockResolvedValueOnce(Response.json({ data: { name: 'A/B' } }))
  const erp = client()
  await expect(erp.search('Item Group', [['name', '=', 'A/B']])).resolves.toEqual(['A/B'])
  await expect(erp.update('Item Group', 'A/B', {})).resolves.toBe(true)
  expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe('/api/resource/Item%20Group')
  expect(new URL(String(fetcher.mock.calls[1][0])).pathname).toBe('/api/resource/Item%20Group/A%2FB')
})

it.each([{}, { data: {} }, { data: [{}] }, { data: [{ name: '' }] }])(
  'rejects malformed search responses instead of assuming no match',
  async body => {
    jest.spyOn(global, 'fetch').mockResolvedValue(Response.json(body))
    await expect(client().search('Item', [])).rejects.toThrow('invalid record list')
  }
)

it('accepts an explicit empty result list', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(Response.json({ data: [] }))
  await expect(client().search('Item', [])).resolves.toEqual([])
})

it('rejects a create response without a remote record identifier', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(Response.json({ data: {} }))
  await expect(client().create('Item', {})).rejects.toThrow('no record identifier')
})

it.each(['create', 'update', 'delete'] as const)(
  'does not mutate ERPNext when the preferred duplicate lookup fails (%s)',
  async operation => {
    jest.spyOn(global, 'fetch').mockResolvedValue(Response.json({ data: { fields: [] } }))
    const search = jest.fn().mockRejectedValue(new Error('Lookup unavailable'))
    const create = jest.fn()
    const update = jest.fn()
    const remove = jest.fn()
    const erp = { search, create, update, delete: remove } as unknown as ErpNextClient
    await expect(executeErpNextOperation({
      client: erp, mapping, event: 'product.create', storeId: 'store', zidEntityId: '7',
      zidData: { id: 7, sku: 'SKU' }, docType: 'Item', operation, values: { item_code: 'SKU' },
    })).rejects.toThrow('Lookup unavailable')
    expect(search).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  }
)
