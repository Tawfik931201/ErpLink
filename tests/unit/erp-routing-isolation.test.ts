import { processSingleMapping, storeEntityIdFromPayload } from '../../src/lib/sync-engine'
import type { FieldMappingRow } from '../../src/lib/sync-types'
import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/sync-runtime', () => ({
  supabaseAdmin: jest.requireActual('../mocks/supabase').supabase,
  logSync: jest.fn(),
}))
jest.mock('../../src/lib/crypto', () => ({ decrypt: jest.fn(() => { throw new Error('Credentials must not be read') }) }))

const mapping: FieldMappingRow = {
  id: 'mapping-a', workspace_id: 'workspace-a', erp_connection_id: 'connection-b',
  merchant_id: 'store-a', store_id: null, action: 'custom.create',
  odoo_model: 'x.fixture', mappings: {}, name: 'Fixture',
}

describe('ERP routing ownership boundary', () => {
  beforeEach(() => {
    supabase.reset()
    supabase.addMock('merchant_tokens', [{ workspace_id: 'workspace-a', merchant_id: 'store-a' }])
    supabase.addMock('erp_workspace_bindings', [{ workspace_id: 'workspace-a', erp_connection_id: 'connection-a', erp_type: 'odoo', url: 'https://a.example', db_name: '' }])
  })

  it('rejects another workspace connection before reading credentials', async () => {
    supabase.addMock('erp_connections', [
      { id: 'connection-b', workspace_id: 'workspace-b', erp_type: 'erpnext' },
    ])
    const result = await processSingleMapping(mapping, 'custom.create', 'store-a', { id: 1 })
    expect(result.status).toBe('failed')
    const reads = supabase.calls.filter(c => c.table === 'erp_connections')
    expect(reads).toHaveLength(1)
    expect(reads[0].filters).toContainEqual(['workspace_id', 'workspace-a'])
  })

  it('does not reroute a deleted explicit connection to another connection', async () => {
    supabase.addMock('erp_connections', [{ id: 'connection-a', workspace_id: 'workspace-a', url: 'https://a.example', username: 'a', password: 'cipher-a', erp_type: 'odoo' }])
    const result = await processSingleMapping(mapping, 'custom.create', 'store-a', { id: 2 })
    expect(result.status).toBe('failed')
    expect(supabase.calls.filter(c => c.table === 'erp_connections')).toHaveLength(1)
  })

  it('retains workspace fallback only when no connection was configured', async () => {
    supabase.addMock('erp_connections', [{ id: 'connection-a', workspace_id: 'workspace-a', url: 'https://a.example', username: 'a', password: 'cipher-a', erp_type: 'odoo' }])
    const result = await processSingleMapping({ ...mapping, erp_connection_id: null }, 'custom.create', 'store-a', { id: 3 })
    expect(result.status).toBe('skipped') // Empty field mapping, after successful routing.
    expect(supabase.calls.filter(c => c.table === 'erp_connections')[0].filters)
      .toContainEqual(['workspace_id', 'workspace-a'])
  })

  it('executes a Zid product delete carrying product_id, not id', async () => {
    supabase.addMock('erp_connections', [{ id: 'connection-a', workspace_id: 'workspace-a', url: 'https://a.example', username: 'a', password: 'cipher-a', erp_type: 'odoo' }])
    const result = await processSingleMapping({ ...mapping, erp_connection_id: null, odoo_model: 'product.template' }, 'product.deleted', 'store-a', { product_id: 42, sku: 'SKU-42' })
    // Before the fix this failed with 'ERP execution context is incomplete'
    // (storeEntityId '') — the id is now taken from product_id.
    expect(result.message).not.toContain('execution context is incomplete')
  })
})

describe('store entity identity', () => {
  it('takes the id from product_id on a Zid product delete payload', () => {
    expect(storeEntityIdFromPayload({ product_id: 42, sku: 'SKU-42' })).toBe('42')
  })

  it('prefers the plain id when present and keeps the other chains', () => {
    expect(storeEntityIdFromPayload({ id: 7, product_id: 42 })).toBe('7')
    expect(storeEntityIdFromPayload({ category_uuid: 'uuid-1' })).toBe('uuid-1')
    expect(storeEntityIdFromPayload({ customer_id: 'c-1' })).toBe('c-1')
    expect(storeEntityIdFromPayload({ order_id: 'o-1' })).toBe('o-1')
    expect(storeEntityIdFromPayload({ sku: 'SKU-42' })).toBe('')
  })
})
