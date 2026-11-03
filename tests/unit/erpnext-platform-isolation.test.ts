import { type ErpNextClient, executeErpNextOperation } from '../../src/lib/erpnext-engine'
import type { FieldMappingRow } from '../../src/lib/sync-types'

jest.mock('../../src/lib/sync-runtime', () => ({ logSync: jest.fn() }))

const mapping: FieldMappingRow = {
  id: 'map', workspace_id: 'ws', erp_connection_id: 'erp', merchant_id: 'store',
  store_id: null, action: 'customer.create', odoo_model: 'Customer', mappings: {}, name: 'Fixture',
}

describe('ERPNext platform identity selection', () => {
  afterEach(() => jest.restoreAllMocks())

  it.each([
    ['salla', ['x_zid_id', 'x_salla_id'], 'x_salla_id'],
    ['salla', ['zid_id', 'salla_id'], 'salla_id'],
    ['zid', ['x_zid_id', 'x_salla_id'], 'x_zid_id'],
  ] as const)('uses only %s identity fields (%s)', async (platform, fields, expected) => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ data: { fields: fields.map(fieldname => ({ fieldname, fieldtype: 'Data' })) } }),
    } as Response)
    const search = jest.fn().mockResolvedValue(['intended-record'])
    const create = jest.fn()
    const client = { search, create } as unknown as ErpNextClient
    await executeErpNextOperation({
      client, mapping, event: 'customer.create', storeId: 'store', zidEntityId: '7',
      zidData: { id: 7 }, docType: 'Customer', operation: 'create', values: {},
      platform,
    })
    expect(search).toHaveBeenCalledWith('Customer', [[expected, '=', '7']])
    expect(create).not.toHaveBeenCalled()
  })
})
