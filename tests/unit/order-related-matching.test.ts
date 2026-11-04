import { saveStandardMappingSettings } from '../../src/app/actions/standard-mapping'
import { withErpTarget } from '../../src/lib/erp-execution-target'
import type { OdooClient } from '../../src/lib/odoo-client'
import { resolveOrderRelatedRecord } from '../../src/lib/orders/related-matching'
import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/auth', () => ({ getActiveUserId: async () => 'user-related' }))
jest.mock('../../src/lib/users', () => ({ getOrCreateDbUser: async () => ({ id: 'user-related', active_workspace_id: 'ws-related' }) }))
jest.mock('../../src/app/actions/odoo', () => ({ getActiveWorkspaceErpConnection: jest.fn() }))

const identity = { workspaceId: 'ws-related', platform: 'zid' as const, storeId: 'store-a' }
const scope = { ...identity, erpConnectionId: 'erp-a', connectionGeneration: 'generation-a', eventId: 'order.created' }
function fixture(field = 'email', ttype = 'char', ids: number[] = [42], readonly = false) {
  const client = {
    execute: jest.fn().mockResolvedValue([{ name: field, ttype, readonly }]),
    search: jest.fn().mockResolvedValue(ids),
  }
  return { client, cast: client as unknown as Pick<OdooClient, 'search' | 'execute'> }
}

describe('read-only order relation matching from customer/product settings', () => {
  beforeEach(() => supabase.reset())

  it.each(['products', 'customers'] as const)('saves %s matching independently of disabled syncing and empty actions', async entity => {
    const settings = { disabled: true, enabled_actions: [], match_zid_field: 'barcode', match_odoo_field: 'barcode' }
    supabase.addMock('standard_mapping_settings', [{ id: 'settings-row' }])
    expect((await saveStandardMappingSettings('zid', entity, settings, 'store-a')).success).toBe(true)
    const write = supabase.calls.find(call => call.op === 'upsert')!
    expect(write.args[0]).toMatchObject({ workspace_id: identity.workspaceId, store_type: 'zid', store_id: 'store-a', entity_type: entity, settings })
  })

  it.each(['products', 'customers'] as const)('honors the configured %s fields even when entity sync is disabled', async entity => {
    const { client, cast } = fixture('x_external')
    const result = await resolveOrderRelatedRecord(cast, supabase, identity, entity,
      { id: 1001, external: { code: '00017' } },
      { disabled: true, enabled_actions: [], match_zid_field: 'external.code', match_odoo_field: 'x_external' })
    expect(result).toEqual({ configured: true, recordId: 42, match: { sourceField: 'external.code', targetField: 'x_external', value: '00017' }, matchValues: { x_external: '00017' } })
    expect(client.search).toHaveBeenCalledWith(entity === 'products' ? 'product.product' : 'res.partner', [['x_external', '=', '00017']], 2)
    expect(supabase.calls).toHaveLength(0)
    expect(client.execute).toHaveBeenCalledWith('ir.model.fields', 'search_read', expect.any(Array), expect.any(Object))
  })

  it('missing configured email never falls back to the source ID', async () => {
    const { cast, client } = fixture()
    await expect(resolveOrderRelatedRecord(cast, supabase, identity, 'customers', { id: 1001 },
      { match_zid_field: 'email', match_odoo_field: 'email' })).rejects.toThrow('value email is missing')
    expect(client.search).not.toHaveBeenCalled()
  })

  it('rejects an incomplete configured pair instead of choosing a default field', async () => {
    await expect(resolveOrderRelatedRecord(fixture().cast, supabase, identity, 'customers', { id: 1001 },
      { match_zid_field: 'email' })).rejects.toThrow('Select both related match fields')
  })

  it('returns unconfigured without searching when no pair exists', async () => {
    const { cast, client } = fixture()
    expect(await resolveOrderRelatedRecord(cast, supabase, identity, 'customers', { id: 1001 }, {})).toEqual({ configured: false, recordId: null })
    expect(client.search).not.toHaveBeenCalled()
    expect(client.execute).not.toHaveBeenCalled()
  })

  it('leaves an explicit miss available to the caller creation/fallback policy with its matching key', async () => {
    const { cast, client } = fixture('barcode', 'char', [])
    expect(await resolveOrderRelatedRecord(cast, supabase, identity, 'products', { barcode: '00123', sku: 'different' },
      { match_zid_field: 'barcode', match_odoo_field: 'barcode' })).toMatchObject({ configured: true, recordId: null, matchValues: { barcode: '00123' } })
    expect(client.search).toHaveBeenCalledTimes(1)
  })

  it('rejects ambiguous matches without selecting the first ID', async () => {
    const { cast } = fixture('email', 'char', [42, 43])
    await expect(resolveOrderRelatedRecord(cast, supabase, identity, 'customers', { email: 'a@example.test' },
      { match_zid_field: 'email', match_odoo_field: 'email' })).rejects.toThrow('Ambiguous')
  })

  it('uses numeric match types but does not write a readonly matching key during creation', async () => {
    const { cast, client } = fixture('x_reference', 'integer', [], true)
    expect(await resolveOrderRelatedRecord(cast, supabase, identity, 'products', { id: '00123' },
      { match_zid_field: 'id', match_odoo_field: 'x_reference' })).toMatchObject({ match: { value: 123 }, matchValues: {} })
    expect(client.search).toHaveBeenCalledWith('product.product', [['x_reference', '=', 123]], 2)
  })

  it('deduplicates field metadata reads across order lines sharing a client', async () => {
    const { cast, client } = fixture('barcode')
    const config = { match_zid_field: 'barcode', match_odoo_field: 'barcode' }
    await Promise.all(['a', 'b'].map(barcode => resolveOrderRelatedRecord(cast, supabase, identity, 'products', { barcode }, config)))
    expect(client.execute).toHaveBeenCalledTimes(1)
    expect(client.search).toHaveBeenCalledTimes(2)
  })

  it('reads only the effective settings of the selected workspace, platform and store', async () => {
    supabase.addMock('standard_mapping_settings', [
      { workspace_id: 'other-workspace', store_type: 'zid', entity_type: 'customers', store_id: 'store-a', settings: { match_zid_field: 'id', match_odoo_field: 'id' } },
      { workspace_id: identity.workspaceId, store_type: 'zid', entity_type: 'customers', store_id: 'store-a', settings: { disabled: true, match_zid_field: 'email', match_odoo_field: 'email' } },
    ])
    const { cast, client } = fixture()
    expect((await resolveOrderRelatedRecord(cast, supabase, identity, 'customers', { id: 1001, email: 'a@example.test' })).recordId).toBe(42)
    expect(client.search).toHaveBeenCalledWith('res.partner', [['email', '=', 'a@example.test']], 2)
    const query = supabase.calls.find(call => call.table === 'standard_mapping_settings')!
    expect(query.filters).toEqual([['workspace_id', identity.workspaceId], ['store_type', 'zid'], ['entity_type', 'customers']])
    expect(supabase.calls.some(call => ['insert', 'upsert', 'update', 'delete'].includes(call.op))).toBe(false)
  })

  it('scopes a saved customer link by connection, generation, workspace, platform, store and source ID', async () => {
    supabase.addMock('odoo_entity_links', [
      { workspace_id: identity.workspaceId, erp_connection_id: 'erp-a', connection_generation: 'old-generation', platform: 'zid', store_id: 'store-a', odoo_model: 'res.partner', store_entity_id: '1001', odoo_record_id: 99 },
      { workspace_id: identity.workspaceId, erp_connection_id: 'erp-a', connection_generation: 'generation-a', platform: 'zid', store_id: 'store-a', odoo_model: 'res.partner', store_entity_id: '1001', odoo_record_id: 42 },
    ])
    const { cast, client } = fixture()
    expect(await withErpTarget(scope, () => resolveOrderRelatedRecord(cast, supabase, identity, 'customers', { id: 1001 },
      { match_zid_field: '__odoo_record_id', match_odoo_field: 'id' }))).toEqual({ configured: true, recordId: 42, matchValues: {} })
    expect(client.search).toHaveBeenCalledWith('res.partner', [['id', '=', 42]], 2)
    expect(client.execute).not.toHaveBeenCalled()
  })
})
