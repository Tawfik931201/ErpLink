import type { OdooClient } from '../../src/lib/odoo-client'
import { applyProductPriceSettings, shouldSyncProductStock } from '../../src/lib/products/settings-values'
import { readAllProductRows, solveVariantPriceExtras, syncVariantPrices } from '../../src/lib/products/variant-prices'
import {
  applyFixedSettingsToValues, buildOdooValues, buildVariantProductValues, executeOdooOperation,
  findExistingOdooRecord, syncProductBom, syncProductStockQuantities, syncProductTemplateStock,
} from '../../src/lib/sync-engine'
import type { FieldMappingRow } from '../../src/lib/sync-types'
import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/sync-runtime', () => ({
  supabaseAdmin: jest.requireActual('../mocks/supabase').supabase,
  logSync: jest.fn(),
}))

const mapping: FieldMappingRow = {
  id: 'fixture', workspace_id: 'ws-products', erp_connection_id: 'erp-products', merchant_id: 'merchant-products',
  store_id: 'merchant-products', action: 'product.created', odoo_model: 'product.template', name: 'Products', mappings: {},
}
const makeClient = (major = 19) => ({
  getMajorVersion: jest.fn().mockResolvedValue(major),
  search: jest.fn().mockResolvedValue([]),
  searchRead: jest.fn().mockResolvedValue([]),
  execute: jest.fn().mockImplementation(async model => model === 'mrp.bom'
    ? { product_tmpl_id: { type: 'many2one' }, bom_line_ids: { type: 'one2many' }, type: { type: 'selection', selection: [['normal', 'Normal'], ['phantom', 'Kit']] } }
    : model === 'mrp.bom.line' ? { product_id: { type: 'many2one' }, product_qty: { type: 'float' } } : []),
  create: jest.fn().mockResolvedValue(500),
  write: jest.fn().mockResolvedValue(true),
})
type FixtureClient = ReturnType<typeof makeClient>
const asClient = (client: FixtureClient) => client as unknown as OdooClient

describe('product Standard Mapping execution', () => {
  beforeEach(() => supabase.reset())

  it.each(['price', 'sale_price', 'cost'])('selects %s before applying markup and rounding, and respects the cost source', source => {
    const values: Record<string, unknown> = { list_price: 999, standard_price: 888 }
    applyProductPriceSettings(values, { price: { source, cost_source: 'price', markup_percent: 10, rounding: 'ceil', decimal_places: 2 } }, { price: 100, sale_price: 80, cost: 25 })
    expect(values.list_price).toBe({ price: 110, sale_price: 88, cost: 27.5 }[source])
    expect(values.standard_price).toBe(100)
  })

  it("leaves Odoo cost untouched when cost_source is 'none'", () => {
    const values: Record<string, unknown> = { list_price: 999, standard_price: 777 }
    applyProductPriceSettings(values, { price: { source: 'price', cost_source: 'none', markup_percent: 0 } }, { price: 100, cost: 42 })
    expect(values.list_price).toBe(100)
    expect(values.standard_price).toBe(777)
  })

  it("cost_source 'none' also blocks the field-mapping path from writing standard_price", async () => {
    const client = makeClient()
    const rows = [{ id: 'cost', erpField: 'standard_price', zidField: 'cost' }]
    const meta = new Map([['standard_price', { name: 'standard_price', ttype: 'float', relation: '' }]])
    const data = { cost: 42 }
    // 'none' must win over a custom (or preset) mapping to standard_price.
    expect(await buildOdooValues(asClient(client), rows, data, meta, 'zid', 'ws-products', 'merchant-products', { price: { cost_source: 'none' } })).toEqual({})
    // Control: a real cost_source still writes the cost.
    expect(await buildOdooValues(asClient(client), rows, data, meta, 'zid', 'ws-products', 'merchant-products', { price: { cost_source: 'cost' } })).toEqual({ standard_price: 42 })
  })

  it("cost_source 'none' strips a standard_price some earlier step already placed in values", async () => {
    const values = await applyFixedSettingsToValues({ list_price: 100, standard_price: 777 }, { price: { source: 'price', cost_source: 'none', markup_percent: 0 } }, { price: 100, cost: 42 }, 19, undefined, 'zid', 'product.template')
    expect(values.list_price).toBe(100)
    expect(values).not.toHaveProperty('standard_price')
  })

  it("variants carry no cost when cost_source is 'none', even though the store sends one", async () => {
    const client = makeClient()
    const values = await buildVariantProductValues(asClient(client), { name: 'Parent', list_price: 330, standard_price: 777 },
      { id: 'parent', name: { ar: 'عربي', en: 'Parent' }, price: 300 },
      { id: 'child', sku: '0012', price: 50, cost: 42, attributes: { Size: 'M' }, source: { id: 'child', sku: '0012', price: 50, cost: 42 } },
      { price: { source: 'price', cost_source: 'none', markup_percent: 0 } }, 'zid')
    expect(values).not.toHaveProperty('standard_price')
    expect(values.list_price).toBe(50)
  })

  it.each(['voucher', 'downloadable'])('substitutes Zid digital class %s as a non-stocked service product', async productClass => {
    const digital19 = await applyFixedSettingsToValues({}, {}, { product_class: productClass }, 19, undefined, 'zid', 'product.template')
    expect(digital19.type).toBe('service')
    expect(digital19.is_storable).toBe(false)
    const digital17 = await applyFixedSettingsToValues({}, {}, { product_class: productClass }, 17, undefined, 'zid', 'product.template')
    expect(digital17.type).toBe('service')
    expect(digital17).not.toHaveProperty('is_storable')
    expect(shouldSyncProductStock(
      { product_type: { default_type: 'consu' }, inventory: { track_inventory: true, sync_enabled: false } },
      { product_class: productClass, quantity: 10 },
      'zid',
    )).toBe(false)
  })

  it('keeps the Standard Mapping product type for an ordinary Zid product', async () => {
    const plain = await applyFixedSettingsToValues({}, {}, { product_class: 'standalone' }, 19, undefined, 'zid', 'product.template')
    expect(plain.type).toBe('consu')
    expect(plain.is_storable).toBe(false)
  })

  it('substitutes a dynamic bundle as a service product', async () => {
    const bundle = await applyFixedSettingsToValues({}, {}, { product_class: 'dynamic_bundle' }, 19, undefined, 'zid', 'product.template')
    expect(bundle.type).toBe('service')
    expect(bundle.is_storable).toBe(false)
  })

  it('keeps zero prices/costs and uses regular price when sale price is absent', () => {
    const settings = { price: { source: 'sale_price', cost_source: 'cost', markup_percent: 10, rounding: '' } }
    const values = { list_price: 50, standard_price: 20 }
    applyProductPriceSettings(values, settings, { price: 80, sale_price: 0, cost: 0 })
    expect(values).toEqual({ list_price: 0, standard_price: 0 })
    applyProductPriceSettings(values, settings, { price: 80, sale_price: null })
    expect(values.list_price).toBeCloseTo(88)
  })

  it.each([14, 15, 16, 17, 18, 19, 20])('honors explicit inventory off on Odoo %i even with a mapped legacy type', async version => {
    const values = await applyFixedSettingsToValues({ type: 'product', is_storable: true }, { inventory: { track_inventory: false } }, {}, version, undefined, 'zid', 'product.template')
    expect(values.type).toBe('consu')
    expect(values.is_storable).toBe(version >= 18 ? false : undefined)
    expect(values.tracking).toBe(version >= 20 ? false : 'none')
    expect(values.detailed_type).toBe(version >= 15 && version <= 17 ? 'consu' : undefined)
  })

  it('product images are never synced, even with a legacy all-images setting', async () => {
    const originalFetch = global.fetch
    const fetchMock = jest.fn()
    global.fetch = fetchMock
    try {
      const values = await applyFixedSettingsToValues({ image_1920: 'old', image_variant_1920: 'old' }, { image: { sync_mode: 'all' } }, {}, 19, undefined, 'zid', 'product.template')
      expect(values).not.toHaveProperty('image_1920')
      expect(values).not.toHaveProperty('image_variant_1920')
      const client = makeClient()
      expect(await buildOdooValues(asClient(client), [{ id: 'image', erpField: 'image_1920', zidField: 'image' }], { image: 'https://must-not-fetch.test/image.png' }, new Map(), 'zid', undefined, '', { image: { sync_mode: 'all' } })).toEqual({})
      expect(fetchMock).not.toHaveBeenCalled()
      expect(client.create).not.toHaveBeenCalled()
    } finally {
      global.fetch = originalFetch
    }
  })

  it('separate variants get their own identity, configured name/price/cost, and zero values', async () => {
    const client = makeClient()
    const values = await buildVariantProductValues(asClient(client), { name: 'English name', x_external: 'parent', x_zid_id: 'parent', barcode: 'PARENT', list_price: 330, standard_price: 20 },
      { id: 'parent', name: { ar: 'عربي', en: 'English name' }, price: 300 },
      { id: 'child', sku: '0012', price: 50, quantity: 0, attributes: { Size: 'M' }, weight: 0, source: { id: 'child', sku: '0012', price: 50, sale_price: 0, cost: 0 } },
      { price: { source: 'sale_price', cost_source: 'price', markup_percent: 10 }, image: { sync_mode: 'skip' } }, 'zid', { odoo_field: 'x_external', zid_field: 'id' })
    expect(values).toMatchObject({ name: 'English name - M', x_external: 'child', default_code: '0012', list_price: 0, standard_price: 50, weight: 0 })
    expect(values).not.toHaveProperty('x_zid_id')
    expect(values).not.toHaveProperty('barcode')
  })

  it('resolves a mapped template to its actual stock variant instead of using a coincidentally equal ID', async () => {
    supabase.addMock('product_mappings', [{ workspace_id: 'ws-products', platform: 'zid', store_id: 'merchant-products', source_product_id: 'source', odoo_product_id: 123 }])
    const client = makeClient()
    client.search.mockImplementation(async (model, domain) => model === 'product.product' && domain.some((term: any[]) => term[0] === 'product_tmpl_id' && term[2] === 123) ? [987] : [])
    expect(await findExistingOdooRecord(asClient(client), 'product.product', { id: 'source' }, {}, mapping, undefined, undefined, 'ws-products', 'zid')).toBe(987)
    expect(client.search).not.toHaveBeenCalledWith('product.product', [['id', '=', 123]], 1)
  })

  it('does not fall back to a shared product name when an explicit matching field was selected', async () => {
    const client = makeClient()
    client.execute.mockResolvedValue([{ name: 'x_external', ttype: 'char' }, { name: 'name', ttype: 'char' }, { name: 'default_code', ttype: 'char' }])
    client.search.mockImplementation(async (_model, domain) => domain[0][0] === 'name' ? [123] : [])
    const id = await findExistingOdooRecord(asClient(client), 'product.template', { id: 'new-id', name: 'Shared name', sku: 'new-sku' }, {}, mapping, undefined, { odoo_field: 'x_external', zid_field: 'id' }, 'ws-products', 'zid')
    expect(id).toBeNull()
    expect(client.search.mock.calls.every(call => call[1][0][0] === 'x_external')).toBe(true)
  })

  it('preserves leading zeros when injecting a configured match field', async () => {
    const client = makeClient()
    const settings = { product: { odoo_match_field: 'default_code', zid_match_field: 'sku' } }
    await executeOdooOperation({ client: asClient(client), mapping: { ...mapping, mappings: { __settings: settings } as any }, event: 'product.create', storeId: 'merchant-products', zidEntityId: 'id', zidData: { id: 'id', sku: '0012', name: 'Name' }, odooModel: 'product.template', odooOperation: 'create', odooValues: { name: 'Name' }, presetKey: null, platformHint: 'zid' })
    expect(client.create).toHaveBeenCalledWith('product.template', expect.objectContaining({ default_code: '0012' }))
  })

  it.each([false, true])('updates the owning template, never the matched variant ID (collision=%s)', async collision => {
    const client = makeClient()
    // In production template39 owns variant57. Another template57 may exist;
    // even then its ID is unrelated to variant57 and must never be written.
    client.execute.mockResolvedValue([{ name: 'default_code', ttype: 'char' }])
    client.search.mockImplementation(async (model, domain) => {
      if (domain.some((term: any[]) => term[0] === 'default_code' && term[2] === 'QA-SKU')) {
        return model === 'product.product' ? [57] : model === 'product.template' ? [39] : []
      }
      if (model === 'product.template' && domain.some((term: any[]) => term[0] === 'id' && term[2] === 57)) return collision ? [57] : []
      return []
    })
    client.write.mockImplementation(async (model, ids) => {
      if (model === 'product.template' && ids.includes(57) && !collision) throw new Error('Missing template57')
      return true
    })
    const settings = { inventory: { sync_enabled: true }, product: { odoo_match_field: 'default_code', zid_match_field: 'sku' } }
    const result = await executeOdooOperation({ client: asClient(client), mapping: { ...mapping, mappings: { __settings: settings } as any }, event: 'product.publish', storeId: 'merchant-products', zidEntityId: 'source', zidData: { id: 'source', sku: 'QA-SKU' }, odooModel: 'product.template', odooOperation: 'update', odooValues: { name: 'Updated QA', default_code: 'QA-SKU' }, presetKey: null, platformHint: 'zid' })
    expect(result).toMatchObject({ status: 'success', model: 'product.template', odooRecordId: 39 })
    expect(client.write).toHaveBeenCalledWith('product.template', [39], expect.objectContaining({ name: 'Updated QA' }))
    expect(client.write.mock.calls.some(([model, ids]) => model === 'product.template' && ids.includes(57))).toBe(false)
    expect(client.search.mock.calls.some(([model]) => model === 'product.product')).toBe(false)
  })

  it('disabled product synchronization performs no Odoo writes', async () => {
    const client = makeClient()
    const values = await buildOdooValues(asClient(client), [{ id: 'category', erpField: 'categ_id', zidField: 'category' }], { category: 'Must not create' }, new Map(), 'zid', 'ws-products', 'merchant-products', { disabled: true })
    expect(values).toEqual({})
    expect(client.search).not.toHaveBeenCalled()
    const result = await executeOdooOperation({ client: asClient(client), mapping: { ...mapping, mappings: { __settings: { disabled: true } } as any }, event: 'product.create', storeId: 'merchant-products', zidEntityId: 'id', zidData: { id: 'id', name: 'Name' }, odooModel: 'product.template', odooOperation: 'create', odooValues: { name: 'Name' }, presetKey: null, platformHint: 'zid' })
    expect(result.status).toBe('skipped')
    expect(client.create).not.toHaveBeenCalled()
    expect(client.write).not.toHaveBeenCalled()
  })

  it('rejects a missing Manufacturing module before creating even a partial grouped product', async () => {
    const client = makeClient()
    client.execute.mockRejectedValue(new Error("Object mrp.bom doesn't exist"))
    const settings = { bom: { enabled: true, type: 'normal' } }
    await expect(executeOdooOperation({ client: asClient(client), mapping: { ...mapping, mappings: { __settings: settings } as any }, event: 'product.create', storeId: 'merchant-products', zidEntityId: 'bundle', zidData: { id: 'bundle', product_class: 'grouped_product', group_products: [{ item_id: 'component', item_quantity: 2 }] }, odooModel: 'product.template', odooOperation: 'create', odooValues: { name: 'Bundle' }, presetKey: null, platformHint: 'zid' })).rejects.toThrow('Manufacturing module')
    expect(client.create).not.toHaveBeenCalled()
    expect(client.write).not.toHaveBeenCalled()
  })

  it('archives a deleted Salla product when on_delete is set and delete is absent from enabled_actions', async () => {
    const client = makeClient()
    client.execute.mockResolvedValue({ default_code: { type: 'char' } })
    client.search.mockImplementation(async model => model === 'product.template' ? [42] : [])
    const settings = {
      enabled_actions: ['create', 'update'],
      on_delete: 'archive',
      match_zid_field: 'sku',
      match_odoo_field: 'default_code',
    }
    supabase.setMockResponder(table => table === 'standard_mapping_settings'
      ? { data: [{ store_id: 'salla-product-archive', settings }], error: null }
      : undefined)
    const result = await executeOdooOperation({
      client: asClient(client),
      mapping,
      event: 'product.deleted',
      storeId: 'salla-product-archive',
      zidEntityId: '42',
      zidData: { id: 42, sku: 'SALLA-SKU' },
      odooModel: 'product.template',
      odooOperation: 'delete',
      odooValues: {},
      presetKey: 'salla_product_delete',
      platformHint: 'salla',
    })
    expect(result.status).toBe('success')
    expect(client.write).toHaveBeenCalledWith('product.template', [42], { active: false })
  })

  it('fails an unavailable customer matching field before a partner write, without silently changing the setting', async () => {
    const client = makeClient()
    client.execute.mockResolvedValue({ phone: { type: 'char' } })
    const settings = { customer: { odoo_match_field: 'mobile', zid_match_field: 'telephone' } }
    await expect(executeOdooOperation({ client: asClient(client), mapping: { ...mapping, mappings: { __settings: settings } as any }, event: 'customer.create', storeId: 'merchant-products', zidEntityId: 'customer', zidData: { id: 'customer', telephone: '500000000' }, odooModel: 'res.partner', odooOperation: 'create', odooValues: { name: 'Customer' }, presetKey: null, platformHint: 'zid' })).rejects.toThrow('Customer match field "mobile" is unavailable')
    expect(client.create).not.toHaveBeenCalled()
    expect(client.write).not.toHaveBeenCalled()
  })

  it.each(['product.template', 'product.product'] as const)('runs no gallery synchronization during a real standalone %s execution, even with a legacy all-images setting', async model => {
    const client = makeClient()
    const originalFetch = global.fetch
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from('image') })
    global.fetch = fetchMock
    try {
      const settings = { image: { sync_mode: 'all' }, inventory: { sync_enabled: true } }
      const result = await executeOdooOperation({ client: asClient(client), mapping: { ...mapping, mappings: { __settings: settings } as any }, event: 'product.create', storeId: 'merchant-products', zidEntityId: 'gallery', zidData: { id: 'gallery', images: [{ url: 'https://images.test/main.png', is_main: true }, { url: 'https://images.test/second.png' }] }, odooModel: model, odooOperation: 'create', odooValues: { name: 'Gallery' }, presetKey: null, platformHint: 'zid' })
      expect(result.status).toBe('success')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(client.write.mock.calls.some((call: any[]) => call[2] && Object.keys(call[2]).some(key => key.includes('image')))).toBe(false)
      expect(client.execute).not.toHaveBeenCalledWith('product.image', expect.anything(), expect.anything())
    } finally {
      global.fetch = originalFetch
    }
  })

  it('an unrecognized image shape never fails the product sync (no Unrecognized product image URL)', async () => {
    const client = makeClient()
    const settings = { image: { sync_mode: 'all' } }
    const originalFetch = global.fetch
    const fetchMock = jest.fn()
    global.fetch = fetchMock
    try {
      const result = await executeOdooOperation({ client: asClient(client), mapping: { ...mapping, mappings: { __settings: settings } as any }, event: 'product.create', storeId: 'merchant-products', zidEntityId: 'gallery', zidData: { id: 'gallery', images: [{ unknown: 'image' }] }, odooModel: 'product.template', odooOperation: 'create', odooValues: { name: 'Gallery' }, presetKey: null, platformHint: 'zid' })
      expect(result.status).toBe('success')
      expect(client.create).toHaveBeenCalledWith('product.template', expect.objectContaining({ name: 'Gallery' }))
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      global.fetch = originalFetch
    }
  })

  it('variant images are never fetched or written, even with a legacy all-images setting', async () => {
    const client = makeClient()
    const originalFetch = global.fetch
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from('primary') })
    global.fetch = fetchMock
    try {
      const values = await buildVariantProductValues(asClient(client), { name: 'Parent' }, { id: 'parent' }, {
        id: 'child', sku: 'CHILD', price: 100, image: 'https://images.test/first.png', attributes: { Size: '20' }, source: {
          id: 'child', images: [{ origin: 'https://images.test/first.png' }, { origin: 'https://images.test/main.png', is_main: true }],
        },
      }, { image: { sync_mode: 'all' } }, 'zid')
      expect(values).not.toHaveProperty('image_1920')
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      global.fetch = originalFetch
    }
  })

  it('simple product stock uses the generated variant ID and reports failures', async () => {
    const client = makeClient()
    client.search.mockImplementation(async (model) => model === 'product.product' ? [987] : [10])
    await syncProductTemplateStock(asClient(client), 123, { quantity: 0 }, { type: 'consu', is_storable: true }, { inventory: { track_inventory: true } }, 'ws-products')
    expect(client.create).toHaveBeenCalledWith('stock.change.product.qty', { product_id: 987, new_qty: 0, location_id: 10 })
    client.search.mockResolvedValue([])
    await expect(syncProductTemplateStock(asClient(client), 123, { quantity: 1 }, {}, {}, 'ws-products')).rejects.toThrow('single stock product')
  })

  it('suppresses ERP-owned, infinite, service and kit stock; lot totals cannot adjust unidentified lots', async () => {
    expect(shouldSyncProductStock({ inventory: { sync_enabled: true } }, { quantity: 1 })).toBe(false)
    expect(shouldSyncProductStock({}, { is_infinite: true })).toBe(false)
    const client = makeClient()
    await syncProductTemplateStock(asClient(client), 123, { quantity: 2, product_class: 'grouped_product' }, {}, { bom: { enabled: true, type: 'phantom' } }, 'ws-products')
    expect(client.create).not.toHaveBeenCalled()
    client.search.mockResolvedValue([987])
    await expect(syncProductTemplateStock(asClient(client), 123, { quantity: 2 }, {}, { inventory: { tracking: 'lot' } }, 'ws-products')).rejects.toThrow('lot identities')
  })

  it('applies each Zid warehouse balance to its mapped location and validates all locations before writing', async () => {
    supabase.addMock('warehouse_mappings', [
      { workspace_id: 'ws-products', platform: 'zid', source_location_id: 'source-a', odoo_location_id: 10 },
      { workspace_id: 'ws-products', platform: 'zid', source_location_id: 'source-b', odoo_location_id: 20 },
    ])
    const client = makeClient()
    const stocks = [{ location: 'source-a', available_quantity: 0 }, { location: 'source-b', available_quantity: 8 }]
    await syncProductStockQuantities(asClient(client), 987, { quantity: 999, stocks }, {}, 'ws-products')
    expect(client.create).toHaveBeenCalledWith('stock.change.product.qty', { product_id: 987, new_qty: 0, location_id: 10 })
    expect(client.create).toHaveBeenCalledWith('stock.change.product.qty', { product_id: 987, new_qty: 8, location_id: 20 })
    client.create.mockClear()
    await expect(syncProductStockQuantities(asClient(client), 987, { stocks: [...stocks, { location: 'unmapped', available_quantity: 5 }] }, {}, 'ws-products')).rejects.toThrow('Map stock location')
    expect(client.create).not.toHaveBeenCalled()
  })

  it('UOM auto-create is cancelled: map-existing still looks up existing UoM/category records without creating missing ones, even with a legacy auto_create value', async () => {
    const client = makeClient()
    const rows = [{ id: 'category', erpField: 'categ_id', zidField: 'category' }, { id: 'uom', erpField: 'uom_id', zidField: 'unit' }]
    const meta = new Map([
      ['categ_id', { name: 'categ_id', ttype: 'many2one', relation: 'product.category' }],
      ['uom_id', { name: 'uom_id', ttype: 'many2one', relation: 'uom.uom' }],
    ])
    await buildOdooValues(asClient(client), rows, { category: { id: 'new-category', name: 'Missing' }, unit: 'Box' }, meta, 'zid', 'ws-products', 'merchant-products', { category: { sync_mode: 'map_existing' }, uom: { auto_create: true } })
    expect(client.search).toHaveBeenCalledWith('product.category', [['name', '=', 'Missing']])
    expect(client.search).toHaveBeenCalledWith('uom.uom', [['name', '=', 'Box']])
    expect(client.create).not.toHaveBeenCalled()
  })

  it('keeps Zid child detection on product.created and retries a missing parent', async () => {
    const client = makeClient()
    await expect(executeOdooOperation({ client: asClient(client), mapping, event: 'product.created', storeId: 'merchant-products', zidEntityId: 'child', zidData: { id: 'child', parent_id: 'parent', name: 'Child' }, odooModel: 'product.template', odooOperation: 'create', odooValues: { name: 'Child' }, presetKey: null, platformHint: 'zid' })).rejects.toThrow('Parent product template')
    expect(client.create).not.toHaveBeenCalled()
  })

  it.each([14, 17, 18, 19, 20])('executes a full Zid variant snapshot with configured sources and custom matching on Odoo %i', async major => {
    const client = makeClient(major)
    client.search.mockImplementation(async (model, domain) => {
      if (model === 'product.template') return [123]
      if (model === 'product.attribute') return [10]
      if (model === 'product.attribute.value') return domain[0][2] === 'S' ? [20] : [21]
      if (model === 'product.template.attribute.line') return [50]
      return []
    })
    client.execute.mockResolvedValue([{ name: 'default_code', ttype: 'char' }])
    client.searchRead.mockImplementation(async model => {
      if (model === 'product.template') return [{ id: 123, list_price: 100 }]
      if (model === 'product.template.attribute.line') return [{ id: 50, attribute_id: [10, 'Size'], value_ids: [20, 21] }]
      if (model === 'product.product') return [
        { id: 987, default_code: 'OLD-S', product_template_attribute_value_ids: [11], lst_price: 100, x_child: 'child-s' },
        { id: 988, default_code: 'OLD-M', product_template_attribute_value_ids: [12], lst_price: 100, x_child: 'child-m' },
      ]
      if (model === 'product.template.attribute.value') return [
        { id: 11, attribute_id: [10, 'Size'], product_attribute_value_id: [20, 'S'], price_extra: 0, attribute_line_id: [50, 'Size'] },
        { id: 12, attribute_id: [10, 'Size'], product_attribute_value_id: [21, 'M'], price_extra: 0, attribute_line_id: [50, 'Size'] },
      ]
      return []
    })
    const settings = { inventory: { track_inventory: false }, image: { sync_mode: 'skip' }, price: { source: 'price', cost_source: 'price', markup_percent: 10, rounding: '' }, variantOdooMatchField: 'x_child', variantZidMatchField: 'id' }
    const result = await executeOdooOperation({ client: asClient(client), mapping: { ...mapping, mappings: { __settings: settings } as any }, event: 'product.updated', storeId: 'merchant-products', zidEntityId: 'parent', zidData: { id: 'parent', sku: 'ROOT', name: 'Product', price: 100, variants: [
      { id: 'child-s', sku: 'NEW-S', price: 100, sale_price: 50, attributes: [{ name: 'Size', value: 'S' }] },
      { id: 'child-m', sku: 'NEW-M', price: 125, sale_price: 75, attributes: [{ name: 'Size', value: 'M' }] },
    ] }, odooModel: 'product.template', odooOperation: 'update', odooValues: { name: 'Product', default_code: 'ROOT', list_price: 100 }, presetKey: null, platformHint: 'zid' })
    expect(result.status).toBe('success')
    expect(client.searchRead).toHaveBeenCalledWith('product.product', [['product_tmpl_id', '=', 123]], expect.arrayContaining(['x_child']), 250, 0)
    expect(client.write).toHaveBeenCalledWith('product.product', [988], expect.objectContaining({ default_code: 'NEW-M', x_child: 'child-m', standard_price: 125 }))
    const productWrites = client.write.mock.calls.filter(call => call[0] === 'product.product')
    if (major < 20) expect(productWrites.every(call => !('lst_price' in call[2]) && !('list_price' in call[2]))).toBe(true)
    else expect(client.write).toHaveBeenCalledWith('product.product', [988], { lst_price: 137.5 })
  })

  it('replaces a complete BoM with one transactional ORM call, retaining zero-risk old lines on resolution failure', async () => {
    const client = makeClient()
    client.search.mockImplementation(async (model, domain) => model === 'mrp.bom' ? [90] : model === 'product.product' && domain.some((term: any[]) => term[0] === 'default_code') ? [987] : [])
    const settings = { bom: { enabled: true, type: 'phantom' } }
    await syncProductBom(asClient(client), 123, { id: 'bundle', product_class: 'grouped_product', group_products: [{ item_id: 'component', sku: 'SKU', item_quantity: 2 }] }, settings, 'zid', 'ws-products', 'merchant-products')
    expect(client.write).toHaveBeenCalledWith('mrp.bom', [90], { type: 'phantom', product_qty: 1, bom_line_ids: [[5, 0, 0], [0, 0, { product_id: 987, product_qty: 2 }]] })
    expect(client.execute).not.toHaveBeenCalledWith('mrp.bom.line', 'unlink', expect.anything())
    client.write.mockClear()
    client.search.mockResolvedValue([])
    await expect(syncProductBom(asClient(client), 123, { product_class: 'grouped_product', group_products: [{ item_id: 'missing' }] }, settings, 'zid', 'ws-products', 'merchant-products')).rejects.toThrow('Unresolved BoM component')
    expect(client.write).not.toHaveBeenCalled()
  })

  it('does not misrepresent customer-selected dynamic bundles as fixed kits', async () => {
    // Dynamic bundles are service products with zero-price component lines on
    // the order — syncProductBom must simply no-op (no BoM, no throw).
    const client = makeClient()
    await expect(syncProductBom(asClient(client), 123, { product_class: 'dynamic_bundle' }, { bom: { enabled: true } }, 'zid', 'ws-products')).resolves.toBeUndefined()
    expect(client.create).not.toHaveBeenCalled()
    expect(client.write).not.toHaveBeenCalled()
  })
})

describe('Odoo variant price representation', () => {
  it('paginates past Odoo default limits without losing the last variant', async () => {
    const client = makeClient()
    const rows = Array.from({ length: 251 }, (_, i) => ({ id: i + 1 }))
    client.searchRead.mockImplementation(async (_model, _domain, _fields, limit, offset) => rows.slice(offset, offset + limit))
    expect(await readAllProductRows(asClient(client), 'product.product', [], ['id'])).toEqual(rows)
    expect(client.searchRead).toHaveBeenCalledTimes(2)
    expect(client.searchRead).toHaveBeenLastCalledWith('product.product', [], ['id'], 250, 250)
  })

  it('solves additive combination prices, including free variants, without changing the shared base', () => {
    const rows = [
      { id: 1, valueIds: [11, 21], price: 0 }, { id: 2, valueIds: [11, 22], price: 5 },
      { id: 3, valueIds: [12, 21], price: 10 }, { id: 4, valueIds: [12, 22], price: 15 },
    ]
    const extras = solveVariantPriceExtras(100, rows, { 11: 1, 12: 2, 21: 3, 22: 4 })
    for (const row of rows) expect(100 + row.valueIds.reduce((sum, id) => sum + extras[id], 0)).toBeCloseTo(row.price)
    expect(() => solveVariantPriceExtras(100, [...rows.slice(0, 3), { ...rows[3], price: 99 }], {})).toThrow('AS_SEPARATE_PRODUCTS')
  })

  it.each([14, 15, 16, 17, 18, 19])('writes PTAV extras atomically on Odoo %i, never lst_price', async version => {
    const client = makeClient(version)
    client.searchRead.mockImplementation(async model => model === 'product.template' ? [{ id: 123, list_price: 100 }]
      : model === 'product.product' ? [{ id: 987, product_template_attribute_value_ids: [11], lst_price: 100 }]
      : [{ id: 11, price_extra: 0, attribute_line_id: [50, 'Size'] }])
    await syncVariantPrices(asClient(client), 123, new Map([[987, 125]]))
    expect(client.write).toHaveBeenCalledWith('product.template', [123], { attribute_line_ids: [[1, 50, { product_template_value_ids: [[1, 11, { price_extra: 25 }]] }]] })
    expect(client.write).toHaveBeenCalledTimes(1)
  })

  it('does not throw on inconsistent combination prices; it reports represented=false so the product sync can continue', async () => {
    const client = makeClient(19)
    client.searchRead.mockImplementation(async model => {
      if (model === 'product.template') return [{ id: 123, list_price: 100 }]
      if (model === 'product.product') return [
        { id: 1, product_template_attribute_value_ids: [11, 21], lst_price: 0 },
        { id: 2, product_template_attribute_value_ids: [11, 22], lst_price: 5 },
        { id: 3, product_template_attribute_value_ids: [12, 21], lst_price: 10 },
        { id: 4, product_template_attribute_value_ids: [12, 22], lst_price: 99 },
      ]
      return [
        { id: 11, price_extra: 0, attribute_line_id: [50, 'Size'] },
        { id: 12, price_extra: 0, attribute_line_id: [50, 'Size'] },
        { id: 21, price_extra: 0, attribute_line_id: [51, 'Color'] },
        { id: 22, price_extra: 0, attribute_line_id: [51, 'Color'] },
      ]
    })
    const result = await syncVariantPrices(asClient(client), 123, new Map([[1, 0], [2, 5], [3, 10], [4, 99]]))
    expect(result.represented).toBe(false)
    expect(result.reason).toContain('AS_SEPARATE_PRODUCTS')
    expect(client.write).not.toHaveBeenCalled()
  })

  it('uses the independent variant price on Odoo 20', async () => {
    const client = makeClient(20)
    await syncVariantPrices(asClient(client), 123, new Map([[987, 0]]))
    expect(client.write).toHaveBeenCalledWith('product.product', [987], { lst_price: 0 })
    expect(client.searchRead).not.toHaveBeenCalled()
  })
})
