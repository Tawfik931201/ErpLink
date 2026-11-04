import { applyCategoryMappingOverrides } from '../../src/lib/categories/mapping-overrides'
import { supabaseAdmin } from '../../src/lib/sync-runtime'

jest.mock('../../src/lib/sync-runtime', () => ({ supabaseAdmin: { from: jest.fn() } }))

const query = {
  select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
  ilike: jest.fn().mockReturnThis(), in: jest.fn(),
}
const from = supabaseAdmin.from as unknown as jest.Mock

describe('category mapping overrides characterization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    from.mockReturnValue(query)
    query.in.mockResolvedValue({ data: [], error: null })
    jest.spyOn(console, 'info').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  it('skips querying for an empty category name', async () => {
    expect(await applyCategoryMappingOverrides('w', 'salla', {})).toEqual({})
    expect(from).not.toHaveBeenCalled()
  })

  it('scopes by workspace/platform and requests store plus default with trimmed flat name', async () => {
    await applyCategoryMappingOverrides('w', 'salla', { flat_name: ' Shoes ', name: 'ignored' }, 's')
    expect(from).toHaveBeenCalledWith('category_mappings')
    expect(query.select).toHaveBeenCalledWith('*')
    expect(query.eq.mock.calls).toEqual([['workspace_id', 'w'], ['platform', 'salla']])
    expect(query.ilike).toHaveBeenCalledWith('source_category_name', 'Shoes')
    expect(query.in).toHaveBeenCalledWith('store_id', ['s', ''])
  })

  it('uses localized name and names aliases through the existing name resolver', async () => {
    await applyCategoryMappingOverrides('w', 'salla', { name: { ar: 'أحذية', en: 'Shoes' } })
    expect(query.ilike).toHaveBeenLastCalledWith('source_category_name', 'أحذية')
    await applyCategoryMappingOverrides('w', 'zid', { names: { en: 'Shoes' } })
    expect(query.ilike).toHaveBeenLastCalledWith('source_category_name', 'Shoes')
  })

  it('prefers the store row and preserves raw accounting values while coercing category id', async () => {
    query.in.mockResolvedValue({ data: [
      { store_id: '', odoo_category_id: 1 },
      { store_id: 's', odoo_category_id: '22', income_account_id: '12', expense_account_id: -1,
        stock_valuation_account_id: '14', stock_journal_id: '15', stock_input_account_id: 16,
        stock_output_account_id: '17', property_cost_method: 'fifo', property_valuation: 'real_time' },
    ] })
    expect(await applyCategoryMappingOverrides('w', 'zid', { name: 'Shoes' }, 's')).toEqual({
      odoo_category_id: 22,
      inventory_valuation: { property_cost_method: 'fifo', property_valuation: 'real_time' },
      accounting: { income_account_id: '12', stock_valuation_account_id: '14', stock_journal_id: '15',
        stock_input_account_id: 16, stock_output_account_id: '17' },
    })
  })

  it('uses platform default before arbitrary first row and requests only default when store absent', async () => {
    query.in.mockResolvedValue({ data: [{ store_id: 'other', odoo_category_id: 7 }, { store_id: '', odoo_category_id: 3 }] })
    expect(await applyCategoryMappingOverrides('w', 'zid', { title: 'Shoes' }, 'missing')).toEqual({ odoo_category_id: 3 })
    await applyCategoryMappingOverrides('w', 'zid', { name: 'Shoes' })
    expect(query.in).toHaveBeenLastCalledWith('store_id', [''])
    query.in.mockResolvedValue({ data: [{ store_id: 'other', odoo_category_id: 7 }] })
    expect(await applyCategoryMappingOverrides('w', 'zid', { name: 'Shoes' }, 'missing')).toEqual({})
  })

  it('keeps an empty accounting object when a truthy but nonpositive account is configured', async () => {
    query.in.mockResolvedValue({ data: [{ income_account_id: -1, odoo_category_id: 'bad' }] })
    expect(await applyCategoryMappingOverrides('w', 'zid', { name: 'Shoes' })).toEqual({ accounting: {} })
  })

  it('returns empty for no row but surfaces database failures instead of silently dropping overrides', async () => {
    expect(await applyCategoryMappingOverrides('w', 'zid', { name: 'Shoes' })).toEqual({})
    query.in.mockResolvedValue({ data: null, error: { message: 'unavailable' } })
    await expect(applyCategoryMappingOverrides('w', 'zid', { name: 'Shoes' })).rejects.toEqual({ message: 'unavailable' })
    query.in.mockRejectedValue(new Error('offline'))
    await expect(applyCategoryMappingOverrides('w', 'zid', { name: 'Shoes' })).rejects.toThrow('offline')
    expect(console.warn).toHaveBeenCalled()
  })
})
