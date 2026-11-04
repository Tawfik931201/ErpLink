import { archiveCategory, categoryCompanyClient, categoryMatchValue, prepareCategoryValues, type CategoryField } from '../../src/lib/categories/odoo-values'
import { withErpTarget } from '../../src/lib/erp-execution-target'
import type { OdooClient } from '../../src/lib/odoo-client'
import { getSallaCategory } from '../../src/lib/salla-client'
import { buildOdooValues, executeOdooOperation, findExistingOdooRecord, resolveSingleRelationId } from '../../src/lib/sync-engine'
import type { FieldMappingRow } from '../../src/lib/sync-types'
import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/sync-runtime', () => ({ supabaseAdmin: jest.requireActual('../mocks/supabase').supabase, logSync: jest.fn() }))
jest.mock('../../src/lib/salla-client', () => ({ getSallaCategory: jest.fn() }))

const fields: Record<string, CategoryField> = {
  name: { type: 'char' }, parent_id: { type: 'many2one' }, x_external: { type: 'char' },
  property_cost_method: { type: 'selection', selection: [['standard', 'Standard'], ['average', 'Average'], ['fifo', 'FIFO']] },
  property_valuation: { type: 'selection', selection: [['manual_periodic', 'Manual'], ['real_time', 'Automatic']] },
}
const mapping: FieldMappingRow = { id: 'cat', name: 'Categories', workspace_id: 'ws', erp_connection_id: 'erp', merchant_id: 'store', store_id: 'store', action: 'category.create', odoo_model: 'product.category', mappings: {} }
function fixture(version = 17) {
  const actualFields = { ...fields, property_valuation: { ...fields.property_valuation, selection: [[version >= 19 ? 'periodic' : 'manual_periodic', 'Periodic'], ['real_time', 'Automatic']] } }
  return {
    getMajorVersion: jest.fn().mockResolvedValue(version),
    execute: jest.fn().mockImplementation(async (model, method) => method === 'fields_get' ? actualFields : Object.entries(actualFields).map(([name, f]) => ({ name, ttype: f.type, relation: '' }))),
    search: jest.fn().mockResolvedValue([]), searchRead: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(501), write: jest.fn().mockResolvedValue(true), unlink: jest.fn().mockResolvedValue(true),
  }
}
const cast = (client: ReturnType<typeof fixture>) => client as unknown as OdooClient
const run = (client: ReturnType<typeof fixture>, settings: Record<string, any>, operation: 'create' | 'update' | 'delete' = 'create', platform: 'zid' | 'salla' = 'zid') => executeOdooOperation({
  client: cast(client), mapping: { ...mapping, mappings: { __settings: settings } as any }, event: `category.${operation}`, storeId: 'store', zidEntityId: '0012', zidData: { id: '0012', name: 'Shoes' },
  odooModel: 'product.category', odooOperation: operation, odooValues: { name: 'Shoes' }, presetKey: null, platformHint: platform,
})

describe('category settings execution', () => {
  beforeEach(() => { supabase.reset(); jest.spyOn(console, 'info').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => jest.restoreAllMocks())

  const cases = (['zid', 'salla'] as const).flatMap(platform => [14, 15, 16, 17, 18, 19, 20].flatMap(version =>
    ['', 'standard', 'average', 'fifo'].flatMap(cost => ['', version >= 19 ? 'periodic' : 'manual_periodic', 'real_time'].map(valuation => [platform, version, cost, valuation] as const))))
  it.each(cases)('%s Odoo %i cost=%s valuation=%s preserves selected settings and match identity', async (platform, version, cost, valuation) => {
    const client = fixture(version)
    const result = await run(client, { costing_method: cost, inventory_valuation: valuation, category: { odoo_match_field: 'x_external', zid_match_field: 'id' } }, 'create', platform)
    expect(result.status).toBe('success')
    expect(client.create).toHaveBeenCalledWith('product.category', { name: 'Shoes', x_external: '0012', ...(cost ? { property_cost_method: cost } : {}), ...(valuation ? { property_valuation: valuation } : {}) })
  })

  it.each(['create', 'update', 'delete'] as const)('disabled %s has no ERP writes', async operation => {
    const client = fixture()
    expect((await run(client, { enabled_actions: [] }, operation)).status).toBe('skipped')
    expect(client.create).not.toHaveBeenCalled(); expect(client.write).not.toHaveBeenCalled(); expect(client.unlink).not.toHaveBeenCalled()
  })

  it('uses the dispatched store for matching instead of a borrowed mapping store', async () => {
    const client = fixture()
    const stores: unknown[][] = []
    const originalFrom = supabase.from
    jest.spyOn(supabase, 'from').mockImplementation((table: string) => {
      const builder = originalFrom(table)
      if (table === 'category_mappings') {
        const originalIn = builder.in as (...args: unknown[]) => unknown
        builder.in = (...args: unknown[]) => { stores.push(args); return originalIn(...args) }
      }
      return builder
    })
    await executeOdooOperation({ client: cast(client), mapping: { ...mapping, merchant_id: 'other' }, event: 'category.create', storeId: 'store', zidEntityId: '12', zidData: { id: '12', name: 'Shoes' }, odooModel: 'product.category', odooOperation: 'create', odooValues: { name: 'Shoes' }, presetKey: null, platformHint: 'salla' })
    expect(stores).toContainEqual(['store_id', ['store', '']])
  })

  it('does not search by name when a custom match was selected', async () => {
    const client = fixture()
    client.search.mockImplementation(async (_model, domain) => domain[0][0] === 'name' ? [77] : [])
    expect(await findExistingOdooRecord(cast(client), 'product.category', { id: '0012', name: 'Shared' }, {}, mapping, undefined, { odoo_field: 'x_external', zid_field: 'id' }, 'ws', 'salla')).toBeNull()
    expect(client.search.mock.calls.every(call => call[1][0][0] === 'x_external')).toBe(true)
  })

  it('rejects ambiguous matches instead of updating an arbitrary category', async () => {
    const client = fixture(); client.search.mockResolvedValue([1, 2])
    await expect(run(client, { category: { odoo_match_field: 'name', zid_match_field: 'name' } })).rejects.toThrow('Ambiguous')
    expect(client.write).not.toHaveBeenCalled()
  })

  it('never writes the database primary key', async () => {
    const client = fixture()
    await run(client, { category: { odoo_match_field: 'id', zid_match_field: 'id' } })
    expect(client.create.mock.calls[0][1]).not.toHaveProperty('id')
  })

  it('keeps an existing category identity when its name changes', async () => {
    const client = fixture(); client.search.mockImplementation(async (_model, domain) => domain[0][0] === 'x_external' ? [77] : [])
    await run(client, { category: { odoo_match_field: 'x_external', zid_match_field: 'id' } }, 'update')
    expect(client.write).toHaveBeenCalledWith('product.category', [77], { name: 'Shoes', x_external: '0012' })
  })

  it('persists the category identity under the workspace, store, platform and ERP generation', async () => {
    const client = fixture()
    await withErpTarget({ workspaceId: 'ws', platform: 'salla', storeId: 'store', erpConnectionId: 'erp', connectionGeneration: 'generation', eventId: 'category-test' }, () => run(client, {}, 'create', 'salla'))
    const writes = supabase.calls.filter(call => call.table === 'odoo_entity_links' && call.op === 'upsert')
    expect(writes).toHaveLength(1)
    expect(writes[0].args[0]).toMatchObject({ workspace_id: 'ws', platform: 'salla', store_id: 'store', erp_connection_id: 'erp', connection_generation: 'generation', store_entity_id: '0012', odoo_record_id: 501 })
  })

  it('resolves a rename from the durable store link even when matching by name', async () => {
    const client = fixture(); client.searchRead.mockResolvedValue([{ id: 77 }] as never)
    supabase.addMock('odoo_entity_links', [{ workspace_id: 'ws', platform: 'salla', store_id: 'store', erp_connection_id: 'erp', connection_generation: 'generation', store_entity_id: '0012', odoo_model: 'product.category', odoo_record_id: 77 }])
    const id = await withErpTarget({ workspaceId: 'ws', platform: 'salla', storeId: 'store', erpConnectionId: 'erp', connectionGeneration: 'generation', eventId: 'rename-test' }, () => findExistingOdooRecord(cast(client), 'product.category', { id: '0012', name: 'Renamed' }, {}, mapping, undefined, { odoo_field: 'name', zid_field: 'name' }, 'ws', 'salla'))
    expect(id).toBe(77)
    expect(client.searchRead).toHaveBeenCalledWith('product.category', [['id', '=', 77]], ['id'], 1)
    expect(client.search).not.toHaveBeenCalled()
  })

  it.each(['nothing', 'archive', 'delete', 'delete_or_archive'])('honors deletion strategy %s', async strategy => {
    const client = fixture(); client.search.mockResolvedValue([77]); client.searchRead.mockResolvedValue([{ name: 'Shoes' }] as never)
    client.unlink.mockRejectedValue(new Error('Products linked'))
    const promise = run(client, { on_delete: strategy }, 'delete')
    if (strategy === 'delete') await expect(promise).rejects.toThrow('Products linked')
    else await promise
    expect(client.unlink).toHaveBeenCalledTimes(strategy === 'delete' || strategy === 'delete_or_archive' ? 1 : 0)
    expect(client.write).toHaveBeenCalledTimes(strategy === 'archive' || strategy === 'delete_or_archive' ? 1 : 0)
  })

  it('does not discard unsupported settings or retry a category write after an ERP rejection', async () => {
    expect(() => prepareCategoryValues({ property_valuation: 'obsolete' }, fields)).toThrow('Unsupported')
    expect(() => prepareCategoryValues({ imaginary: true }, fields)).toThrow('missing')
    const client = fixture(); client.create.mockRejectedValue(new Error('Invalid field custom'))
    await expect(run(client, {})).rejects.toThrow('Invalid field custom')
    expect(client.create).toHaveBeenCalledTimes(1)
  })

  it.each([19, 20])('converts a saved manual valuation on Odoo %i using actual selection metadata', async version => {
    const client = fixture(version)
    await run(client, { inventory_valuation: 'manual_periodic' })
    expect(client.create).toHaveBeenCalledWith('product.category', expect.objectContaining({ property_valuation: 'periodic' }))
  })

  it('uses the actual stock account and journal field names', () => {
    const fields = { property_stock_journal: { type: 'many2one' }, property_stock_account_input_categ_id: { type: 'many2one' }, property_stock_account_output_categ_id: { type: 'many2one' } }
    expect(prepareCategoryValues({ property_stock_journal_id: 3, property_stock_input_account_id: 4, property_stock_output_account_id: 5 }, fields)).toEqual({ property_stock_journal: 3, property_stock_account_input_categ_id: 4, property_stock_account_output_categ_id: 5 })
  })

  it('creates a missing Salla parent with its configured match field and valuation', async () => {
    const client = fixture(20)
    supabase.addMock('salla_tokens', [{ workspace_id: 'parent-ws', merchant_id: 'parent-store' }])
    supabase.addMock('standard_mapping_settings', [{ workspace_id: 'parent-ws', store_type: 'salla', entity_type: 'categories', store_id: 'parent-store', settings: { match_odoo_field: 'x_external', match_zid_field: 'id', costing_method: 'fifo', inventory_valuation: 'periodic' } }])
    ;(getSallaCategory as jest.Mock).mockResolvedValue({ id: 12, name: 'Parent', parent_id: null })
    expect(await resolveSingleRelationId(cast(client), 'product.category', 12, 'salla', undefined, undefined, 'parent-ws', 'parent-store')).toBe(501)
    expect(getSallaCategory).toHaveBeenCalledWith('parent-store', '12')
    expect(client.create).toHaveBeenCalledWith('product.category', { name: 'Parent', x_external: '12', property_cost_method: 'fifo', property_valuation: 'periodic' })
  })

  it('detects cyclic store parents before writing any category', async () => {
    const client = fixture()
    supabase.addMock('salla_tokens', [{ workspace_id: 'cycle-ws', merchant_id: 'cycle-store' }])
    ;(getSallaCategory as jest.Mock).mockResolvedValue({ id: 12, name: 'Cycle', parent_id: 12 })
    await expect(resolveSingleRelationId(cast(client), 'product.category', 12, 'salla', undefined, undefined, 'cycle-ws', 'cycle-store')).rejects.toThrow('Cyclic')
    expect(client.create).not.toHaveBeenCalled()
  })

  it('clears a root category parent explicitly', async () => {
    const client = fixture()
    expect(await buildOdooValues(cast(client), [{ id: 'parent', erpField: 'parent_id', zidField: 'parent_id' }], { parent_id: null }, new Map(), 'salla')).toEqual({ parent_id: false })
  })

  it('retains text identity and rejects unsupported or invalid numeric matching', () => {
    expect(categoryMatchValue('0012', { type: 'char' })).toBe('0012')
    expect(categoryMatchValue('12', { type: 'integer' })).toBe(12)
    expect(() => categoryMatchValue('uuid', { type: 'integer' })).toThrow()
    expect(() => categoryMatchValue('12', { type: 'many2one' })).toThrow()
  })

  it('keeps company contexts separate during concurrent operations', async () => {
    const base = { execute: jest.fn().mockResolvedValue(true) } as unknown as OdooClient
    const first = categoryCompanyClient(base, 1); const second = categoryCompanyClient(base, 2)
    await Promise.all([first.execute('product.category', 'write', []), second.execute('product.category', 'write', [])])
    expect(base.execute).toHaveBeenNthCalledWith(1, 'product.category', 'write', [], { context: { allowed_company_ids: [1], force_company: 1 } })
    expect(base.execute).toHaveBeenNthCalledWith(2, 'product.category', 'write', [], { context: { allowed_company_ids: [2], force_company: 2 } })
    expect(categoryCompanyClient(base, null)).toBe(base)
  })

  it('uses native archive when the connected category model supports it', async () => {
    const client = fixture(); client.execute.mockResolvedValue({ ...fields, active: { type: 'boolean' } })
    await archiveCategory(cast(client), 7)
    expect(client.write).toHaveBeenCalledWith('product.category', [7], { active: false })
    expect(client.unlink).not.toHaveBeenCalled()
  })

  it('refuses to resolve a category using an unrelated store token', async () => {
    const client = fixture()
    supabase.addMock('salla_tokens', [{ workspace_id: 'ws', merchant_id: 'other' }])
    await expect(resolveSingleRelationId(cast(client), 'product.category', 12, 'salla', undefined, undefined, 'ws', 'store')).rejects.toThrow('not connected')
    expect(client.create).not.toHaveBeenCalled()
  })
})
