jest.mock('@supabase/supabase-js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- factory must resolve the mock after Jest hoisting
  createClient: () => require('../mocks/supabase').supabase,
}))
jest.mock('../../src/lib/entity-links', () => ({ upsertEntityLink: jest.fn() }))

import { logSync } from '../../src/lib/sync-runtime'
import { supabase } from '../mocks/supabase'

const entry = {
  id: 'log-b', workspace_id: 'workspace-a', field_mapping_id: '',
  event: 'order.created', store_id: 'store-a', zid_entity_id: 'order-1',
  odoo_model: 'sale.order', status: 'failed' as const, payload: {},
}

describe('sync runtime log workspace isolation', () => {
  beforeEach(() => {
    supabase.reset()
    jest.spyOn(console, 'info').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  it('scopes both existing-status read and update to the processing workspace', async () => {
    supabase.addMock('sync_logs', [{ id: 'log-b', workspace_id: 'workspace-b', status: 'success', odoo_record_id: 123 }])
    await logSync(entry)
    const calls = supabase.calls.filter(c => c.table === 'sync_logs')
    expect(calls.map(c => c.op)).toEqual(['select', 'update'])
    for (const call of calls) {
      expect(call.filters).toEqual(expect.arrayContaining([['id', 'log-b'], ['workspace_id', 'workspace-a']]))
    }
    expect(calls[1].args[0]).toMatchObject({ odoo_record_id: null, status: 'failed' })
  })

  it.each(['22P02', '23514'])('keeps workspace scope during %s fallback writes', async code => {
    let updates = 0
    supabase.setMockResponder((_table, op) => op === 'update' && updates++ === 0
      ? { data: null, error: { code, message: 'simulated constraint failure' } }
      : { data: null, error: null })
    await logSync(entry)
    const writes = supabase.calls.filter(c => c.op === 'update')
    expect(writes).toHaveLength(2)
    for (const write of writes) expect(write.filters).toEqual(expect.arrayContaining([['id', 'log-b'], ['workspace_id', 'workspace-a']]))
  })

  it('preserves same-workspace record precedence', async () => {
    supabase.addMock('sync_logs', [{ id: 'log-b', workspace_id: 'workspace-a', status: 'success', odoo_record_id: 123 }])
    await logSync(entry)
    expect(supabase.calls.find(c => c.op === 'update')?.args[0]).toMatchObject({ odoo_record_id: 123, status: 'failed' })
  })
})
