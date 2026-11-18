import { resolveStoreLines } from '../../src/lib/returns/engine'
import { getCachedStandardMappingSettings } from '../../src/lib/sync/settings'
import { resolveOrderRelatedRecord } from '../../src/lib/orders/related-matching'
import { resolveOdooProductId } from '../../src/lib/returns/odoo'

jest.mock('../../src/lib/sync/settings', () => ({
  getCachedStandardMappingSettings: jest.fn(),
}))
jest.mock('../../src/lib/orders/related-matching', () => ({
  resolveOrderRelatedRecord: jest.fn(),
}))
jest.mock('../../src/lib/returns/odoo', () => ({
  ...jest.requireActual('../../src/lib/returns/odoo'),
  resolveOdooProductId: jest.fn(),
}))

const settings = getCachedStandardMappingSettings as jest.Mock
const match = resolveOrderRelatedRecord as jest.Mock
const legacy = resolveOdooProductId as jest.Mock
const source = [{ storeProductId: 'zid-uuid-1', sku: 'ERPTEST-SKU-7', quantity: 2 }]
const identity = { workspaceId: 'qa-ws', storeId: '3172448' }

beforeEach(() => {
  jest.resetAllMocks()
  settings.mockResolvedValue({ match_zid_field: 'sku', match_odoo_field: 'default_code' })
  match.mockResolvedValue({ configured: true, recordId: 414 })
})

describe('Zid return line uses Products Standard Mapping, not a fixed SKU heuristic', () => {
  it('searches through the same resolver as normal order line creation', async () => {
    const out = await resolveStoreLines({} as any, 'zid', source, identity)
    expect([...out.byProduct]).toEqual([[414, 2]])
    expect(settings).toHaveBeenCalledWith('qa-ws', 'zid', 'products', '3172448')
    expect(match).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      { workspaceId: 'qa-ws', platform: 'zid', storeId: '3172448' },
      'products', { id: 'zid-uuid-1', product_id: 'zid-uuid-1', sku: 'ERPTEST-SKU-7', name: undefined },
      expect.objectContaining({ match_zid_field: 'sku', match_odoo_field: 'default_code' }), expect.any(Function))
    expect(legacy).not.toHaveBeenCalled()
  })

  it('never substitutes SKU matching when the configured barcode field fails', async () => {
    settings.mockResolvedValue({ match_zid_field: 'barcode', match_odoo_field: 'barcode' })
    match.mockResolvedValue({ configured: true, recordId: null })
    await expect(resolveStoreLines({} as any, 'zid', source, identity))
      .rejects.toThrow('return_configured_product_not_found')
    expect(legacy).not.toHaveBeenCalled()
  })

  it('rejects an ambiguous match rather than crediting a potentially wrong product', async () => {
    match.mockRejectedValue(new Error('Ambiguous Odoo related products match'))
    await expect(resolveStoreLines({} as any, 'zid', source, identity))
      .rejects.toThrow('Ambiguous Odoo related products match')
  })

  it('uses legacy lookup only for shops without a configured Product match pair', async () => {
    settings.mockResolvedValue({})
    match.mockResolvedValue({ configured: false, recordId: null })
    legacy.mockResolvedValue(215)
    const out = await resolveStoreLines({} as any, 'zid', source, identity)
    expect([...out.byProduct]).toEqual([[215, 2]])
    expect(legacy).toHaveBeenCalledWith(expect.anything(), 'zid', 'zid-uuid-1', 'ERPTEST-SKU-7')
  })

  it('never skips an unresolved return line silently', async () => {
    settings.mockResolvedValue(null)
    match.mockResolvedValue({ configured: false, recordId: null })
    legacy.mockResolvedValue(null)
    const out = await resolveStoreLines({} as any, 'zid', source, identity)
    expect(out.unresolved).toBe(1)
    expect(out.byProduct.size).toBe(0)
  })
})
