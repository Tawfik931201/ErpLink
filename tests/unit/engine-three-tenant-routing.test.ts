jest.mock('../../src/lib/sync-runtime', () => ({ supabaseAdmin: jest.requireActual('../mocks/supabase').supabase, logSync: jest.fn() }))
jest.mock('../../src/lib/crypto', () => ({ decrypt: (value: string) => `decrypted:${value}` }))
jest.mock('../../src/lib/odoo-client', () => ({ OdooClient: jest.fn().mockImplementation((config: unknown) => ({ config, fieldsGet: async () => ({}), search: async () => [], searchRead: async () => [] })) }))
jest.mock('../../src/lib/erpnext-engine', () => ({
  ErpNextClient: jest.fn().mockImplementation((config: unknown) => ({ config })),
  fetchErpNextFieldMeta: async () => new Map(), buildErpNextValues: async () => ({}),
  executeErpNextOperation: jest.fn(async () => ({ status: 'skipped', message: 'mock ERP boundary' })),
}))

import { connectionGeneration, withErpTarget } from '../../src/lib/erp-execution-target'
import { ErpNextClient } from '../../src/lib/erpnext-engine'
import { OdooClient } from '../../src/lib/odoo-client'
import { processSingleMapping } from '../../src/lib/sync-engine'
import type { FieldMappingRow } from '../../src/lib/sync-types'
import { supabase } from '../mocks/supabase'

const connections = ['a', 'b', 'c'].map((id, i) => ({ id: `erp-${id}`, workspace_id: `ws-${id}`, url: `https://${id}.example`, username: `user-${id}`, password: `cipher-${id}`, db_name: `db-${id}`, erp_type: i === 2 ? 'erpnext' : 'odoo', status: 'connected' }))
describe('three tenant real engine credential routing', () => {
  beforeEach(() => {
    supabase.reset()
    jest.clearAllMocks()
    supabase.addMock('erp_connections', connections)
    supabase.addMock('erp_workspace_bindings', connections.map(connection => ({ workspace_id: connection.workspace_id, erp_connection_id: connection.id, erp_type: connection.erp_type, url: connection.url, db_name: connection.db_name })))
    supabase.addMock('merchant_tokens', [{ workspace_id: 'ws-a', merchant_id: 'a' }, { workspace_id: 'ws-c', merchant_id: 'c' }])
    supabase.addMock('salla_tokens', [{ workspace_id: 'ws-b', merchant_id: 'b' }])
    jest.spyOn(console, 'info').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())
  it('uses A/B Odoo credentials and C ERPNext credentials during concurrent mapping execution', async () => {
    const results = await Promise.all(connections.map(async (connection, i) => {
      const id = ['a', 'b', 'c'][i]
      const platform = i === 1 ? 'salla' as const : 'zid' as const
      const mapping: FieldMappingRow = { id: `mapping-${id}`, name: id, workspace_id: `ws-${id}`, erp_connection_id: connection.id, merchant_id: id, store_id: id, action: 'custom.delete', odoo_model: 'x.fixture', odoo_operation: 'delete', mappings: {} }
      return processSingleMapping(mapping, 'custom.delete', id, { id: 'same-id' }, 'automatic', undefined, platform)
    }))
    expect(results.every(r => r.status !== 'failed')).toBe(true)
    expect((OdooClient as unknown as jest.Mock).mock.calls.map(call => call[0]).sort((a, b) => a.url.localeCompare(b.url))).toEqual([
      { url: 'https://a.example', db: 'db-a', username: 'user-a', apiKey: 'decrypted:cipher-a' },
      { url: 'https://b.example', db: 'db-b', username: 'user-b', apiKey: 'decrypted:cipher-b' },
    ])
    expect(ErpNextClient).toHaveBeenCalledWith({ url: 'https://c.example', username: 'user-c', apiKey: 'decrypted:cipher-c' })
  })
  it('rejects changed queued mapping connection before constructing any provider client', async () => {
    const mapping: FieldMappingRow = { id: 'mapping-a', name: 'a', workspace_id: 'ws-a', erp_connection_id: 'erp-b', merchant_id: 'a', store_id: 'a', action: 'custom.delete', odoo_model: 'x.fixture', mappings: {} }
    const result = await withErpTarget({ workspaceId: 'ws-a', platform: 'zid', storeId: 'a', erpConnectionId: 'erp-a', connectionGeneration: connectionGeneration(connections[0]), eventId: 'event-a' }, () => processSingleMapping(mapping, 'custom.delete', 'a', { id: 1 }, 'automatic', undefined, 'zid'))
    expect(result.status).toBe('failed')
    expect(OdooClient).not.toHaveBeenCalled()
    expect(ErpNextClient).not.toHaveBeenCalled()
  })
})
