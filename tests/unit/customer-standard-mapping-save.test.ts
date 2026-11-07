import { saveStandardMappingSettings } from '../../src/app/actions/standard-mapping'
import { supabase } from '../mocks/supabase'

const mockExecute = jest.fn()
let mockErpType = 'odoo'
jest.mock('../../src/lib/auth', () => ({ getActiveUserId: async () => 'user-test' }))
jest.mock('../../src/lib/users', () => ({ getOrCreateDbUser: async () => ({ active_workspace_id: 'workspace-test' }) }))
jest.mock('../../src/lib/crypto', () => ({ decrypt: () => 'test-placeholder' }))
jest.mock('../../src/app/actions/odoo', () => ({ getActiveWorkspaceErpConnection: async () => ({ success: true, connection: { erp_type: mockErpType, url: 'https://example.invalid', username: 'test', password: 'test', db_name: 'test' } }) }))
jest.mock('../../src/lib/odoo-client', () => ({ OdooClient: jest.fn().mockImplementation(() => ({ execute: (...args: unknown[]) => mockExecute(...args) })) }))

describe('saving customer Standard Mapping', () => {
  beforeEach(() => {
    supabase.reset()
    mockErpType = 'odoo'
    mockExecute.mockReset().mockResolvedValue({ phone: { type: 'char' } })
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  it('returns a visible error and never persists an unsupported Odoo match field', async () => {
    const result = await saveStandardMappingSettings('zid', 'customers', { match_zid_field: 'mobile', match_odoo_field: 'mobile' }, 'store-test')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/unavailable/)
    expect(supabase.calls.some(call => call.op === 'upsert')).toBe(false)
  })

  it('blocks saving when capability verification fails', async () => {
    mockExecute.mockRejectedValue(new Error('Odoo unavailable'))
    const result = await saveStandardMappingSettings('zid', 'customers', { match_zid_field: 'telephone', match_odoo_field: 'phone' })
    expect(result.success).toBe(false)
    expect(supabase.calls.some(call => call.op === 'upsert')).toBe(false)
  })

  it('persists a supported explicit choice in the selected store without rewriting it', async () => {
    const settings = { match_zid_field: 'telephone', match_odoo_field: 'phone', customer_type: 'person' }
    const result = await saveStandardMappingSettings('zid', 'customers', settings, 'store-test')
    expect(result.success).toBe(true)
    const save = supabase.calls.find(call => call.table === 'standard_mapping_settings' && call.op === 'upsert')
    expect(save?.args[0]).toMatchObject({ workspace_id: 'workspace-test', store_id: 'store-test', settings })
    expect(mockExecute).toHaveBeenCalledWith('res.partner', 'fields_get', [], { attributes: ['type', 'readonly'] })
  })

  it('rejects enabling BoM when the selected database lacks Manufacturing', async () => {
    mockExecute.mockRejectedValue(new Error('Unknown model mrp.bom'))
    const result = await saveStandardMappingSettings('zid', 'products', { bom: { enabled: true, type: 'phantom' } })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Manufacturing/)
    expect(supabase.calls.some(call => call.op === 'upsert')).toBe(false)
  })

  it('preserves ERPNext settings without sending Odoo capability probes', async () => {
    mockErpType = 'erpnext'
    expect((await saveStandardMappingSettings('zid', 'customers', { match_zid_field: 'mobile', match_odoo_field: 'mobile' })).success).toBe(true)
    expect((await saveStandardMappingSettings('zid', 'products', { bom: { enabled: true } })).success).toBe(true)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('allows disabling customer and product sync even with invalid settings or Odoo unavailable', async () => {
    mockExecute.mockRejectedValue(new Error('Odoo unavailable'))
    expect((await saveStandardMappingSettings('zid', 'customers', { disabled: true, match_zid_field: 'mobile', match_odoo_field: 'mobile' })).success).toBe(true)
    expect((await saveStandardMappingSettings('zid', 'products', { disabled: true, bom: { enabled: true } })).success).toBe(true)
    expect(mockExecute).not.toHaveBeenCalled()
    expect(supabase.calls.filter(call => call.op === 'upsert')).toHaveLength(2)
  })
})
