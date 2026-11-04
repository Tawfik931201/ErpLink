import { withErpTarget } from '../../src/lib/erp-execution-target'
import type { OdooClient } from '../../src/lib/odoo-client'
import { findExistingOdooRecord } from '../../src/lib/sync-engine'
import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/sync-runtime', () => ({ supabaseAdmin: jest.requireActual('../mocks/supabase').supabase, logSync: jest.fn() }))

const scope = { workspaceId: 'ws-order', platform: 'zid' as const, storeId: 'store-a', erpConnectionId: 'erp-1', connectionGeneration: 'generation-1', eventId: 'order.updated' }
const owner = {
  workspace_id: scope.workspaceId, erp_connection_id: scope.erpConnectionId, connection_generation: scope.connectionGeneration,
  odoo_model: 'sale.order', odoo_record_id: 42, platform: 'zid', store_id: 'store-a', store_entity_id: '1001',
}
function fixture(ids = [42]) {
  return {
    search: jest.fn().mockResolvedValue(ids),
    searchRead: jest.fn().mockResolvedValue([{ id: 42, amount_total: 100 }]),
    execute: jest.fn().mockResolvedValue([{ name: 'client_order_ref', ttype: 'char' }]),
  }
}
const match = (client: ReturnType<typeof fixture>) => withErpTarget(scope, () => findExistingOdooRecord(
  client as unknown as OdooClient, 'sale.order', { id: '1001' }, {}, { merchant_id: 'store-a' }, undefined,
  { odoo_field: 'client_order_ref', zid_field: 'id' }, scope.workspaceId, 'zid',
))

describe('sale order matching isolation', () => {
  beforeEach(() => {
    supabase.reset()
    jest.spyOn(console, 'info').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  it('rejects an ambiguous configured reference instead of taking the first order', async () => {
    const client = fixture([42, 43])
    await expect(match(client)).rejects.toThrow('Ambiguous Odoo sale order match')
    expect(client.search).toHaveBeenCalledTimes(1)
    expect(client.search).toHaveBeenCalledWith('sale.order', [['client_order_ref', '=', '1001'], ['amount_total', '>=', 0]], 2)
  })

  it.each([
    { store_id: 'store-b' },
    { platform: 'salla' },
    { store_entity_id: '1002' },
  ])('rejects a uniquely matched order owned by another store identity: %j', async other => {
    supabase.addMock('odoo_entity_links', [{ ...owner, ...other }])
    const client = fixture()
    await expect(match(client)).rejects.toThrow('linked to another store order')
    expect(client.search).toHaveBeenCalledTimes(1)
  })

  it('allows an unlinked candidate and scopes its ownership lookup to the current ERP generation', async () => {
    supabase.addMock('odoo_entity_links', [
      { ...owner, workspace_id: 'other-workspace', store_id: 'foreign' },
      { ...owner, erp_connection_id: 'other-erp', store_id: 'foreign' },
      { ...owner, connection_generation: 'old-generation', store_id: 'foreign' },
    ])
    expect(await match(fixture())).toBe(42)
    const reverseLookup = supabase.calls.find(call => call.table === 'odoo_entity_links' && call.filters.some(([key]) => key === 'odoo_record_id'))!
    expect(reverseLookup.filters).toEqual([
      ['workspace_id', scope.workspaceId], ['erp_connection_id', scope.erpConnectionId],
      ['connection_generation', scope.connectionGeneration], ['odoo_model', 'sale.order'], ['odoo_record_id', 42],
    ])
  })

  it('allows the same scoped store entity to reuse its saved order', async () => {
    supabase.addMock('odoo_entity_links', [owner])
    expect(await match(fixture())).toBe(42)
  })

  it('rejects a corrupted saved link that also points to another store entity', async () => {
    supabase.addMock('odoo_entity_links', [owner, { ...owner, store_entity_id: '1002' }])
    const client = fixture()
    await expect(match(client)).rejects.toThrow('linked to another store order')
    expect(client.search).not.toHaveBeenCalled()
  })

  it('does not swallow a conflicting order returned by the scoped sync history', async () => {
    supabase.addMock('sync_logs', [{ ...owner, zid_entity_id: '1001', status: 'success' }])
    supabase.addMock('odoo_entity_links', [{ ...owner, store_id: 'store-b' }])
    const client = fixture()
    await expect(match(client)).rejects.toThrow('linked to another store order')
    expect(client.search).not.toHaveBeenCalled()
  })

  it('stops when ownership cannot be verified rather than trying another match', async () => {
    supabase.setMockResponder((table, op) => table === 'odoo_entity_links' && op === 'select'
      ? { data: null, error: { message: 'Database unavailable' } } : undefined)
    await expect(match(fixture())).rejects.toThrow('Cannot verify ownership')
  })
})
