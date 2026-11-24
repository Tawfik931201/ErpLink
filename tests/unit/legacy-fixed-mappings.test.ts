import { legacyFixedMappingTablesEnabled } from '@/lib/legacy-fixed-mappings'

describe('legacy fixed mapping Supabase table access', () => {
  const oldValue = process.env.ENABLE_LEGACY_FIXED_MAPPING_TABLES

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
})
