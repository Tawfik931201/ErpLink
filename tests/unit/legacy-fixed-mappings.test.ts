import { withErpTarget } from '../../src/lib/erp-execution-target'
import { legacyFixedMappingTablesEnabled } from '../../src/lib/legacy-fixed-mappings'
import { processFixedMappingFallback } from '../../src/lib/sync/mappings'
import { supabase } from '../mocks/supabase'

describe('legacy fixed mapping Supabase table access', () => {
  const oldValue = process.env.ENABLE_LEGACY_FIXED_MAPPING_TABLES

  beforeEach(() => {
    supabase.reset()
  })

  afterEach(() => {
    if (oldValue === undefined) delete process.env.ENABLE_LEGACY_FIXED_MAPPING_TABLES
    else process.env.ENABLE_LEGACY_FIXED_MAPPING_TABLES = oldValue
  })

  it('does not query absent legacy tables by default', () => {
    delete process.env.ENABLE_LEGACY_FIXED_MAPPING_TABLES
    expect(legacyFixedMappingTablesEnabled()).toBe(false)
  })

  it('requires an explicit opt-in for installations with legacy tables', () => {
    process.env.ENABLE_LEGACY_FIXED_MAPPING_TABLES = 'false'
    expect(legacyFixedMappingTablesEnabled()).toBe(false)
    process.env.ENABLE_LEGACY_FIXED_MAPPING_TABLES = 'true'
    expect(legacyFixedMappingTablesEnabled()).toBe(true)
  })

  it('proves processFixedMappingFallback executes 0 queries to fixed_mappings when disabled', async () => {
    delete process.env.ENABLE_LEGACY_FIXED_MAPPING_TABLES
    const target = {
      workspaceId: 'ws-test',
      platform: 'zid' as const,
      storeId: 'store-1',
      erpConnectionId: 'conn-1',
      connectionGeneration: 'gen-1',
      eventId: 'evt-1',
    }
    await withErpTarget(target, async () => {
      await processFixedMappingFallback('zid_category', 'category.create', 'store-1', { id: 10, name: 'Books' }, 'zid', null, 'ws-test').catch(() => null)
    })
    const fixedMappingCalls = supabase.calls.filter(c => c.table === 'fixed_mappings' || c.table === 'fixed_mapping_settings' || c.table === 'fixed_mapping_rules')
    expect(fixedMappingCalls.length).toBe(0)
  })

  it('queries fixed_mappings when ENABLE_LEGACY_FIXED_MAPPING_TABLES=true', async () => {
    process.env.ENABLE_LEGACY_FIXED_MAPPING_TABLES = 'true'
    supabase.addMock('fixed_mappings', [{ field_rows: [] }])
    const target = {
      workspaceId: 'ws-test',
      platform: 'zid' as const,
      storeId: 'store-1',
      erpConnectionId: 'conn-1',
      connectionGeneration: 'gen-1',
      eventId: 'evt-1',
    }
    await withErpTarget(target, async () => {
      await processFixedMappingFallback('zid_category', 'category.create', 'store-1', { id: 10, name: 'Books' }, 'zid', null, 'ws-test').catch(() => null)
    })
    const fixedMappingCalls = supabase.calls.filter(c => c.table === 'fixed_mappings')
    expect(fixedMappingCalls.length).toBeGreaterThan(0)
  })
})
