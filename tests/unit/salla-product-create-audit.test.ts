import { connectionGeneration } from '../../src/lib/erp-execution-target'
import { extractGenericVariants } from '../../src/lib/products/variants'
import { processWebhookEvent } from '../../src/lib/sync-engine'
import { ttlCache } from '../../src/lib/ttl-cache'
import { isWebhookEventEnabled } from '../../src/lib/webhook-gate'
import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/sync-runtime', () => ({
  supabaseAdmin: jest.requireActual('../mocks/supabase').supabase,
  logSync: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../src/lib/crypto', () => ({ decrypt: jest.fn(() => 'mock-key') }))
jest.mock('../../src/lib/telegram-notifier', () => ({ notifySyncResult: jest.fn().mockResolvedValue(undefined) }))
jest.mock('../../src/lib/webhook-skip-log', () => ({ logWebhookSkip: jest.fn().mockResolvedValue(undefined) }))
jest.mock('../../src/lib/salla-client', () => ({ getSallaProduct: jest.fn() }))
jest.mock('../../src/lib/odoo-client', () => ({
  OdooClient: jest.fn(() => mockOdoo),
}))

const mockOdoo = {
  getMajorVersion: jest.fn().mockResolvedValue(19),
  search: jest.fn().mockResolvedValue([]),
  searchRead: jest.fn().mockResolvedValue([]),
  execute: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue(501),
  write: jest.fn().mockResolvedValue(true),
}

const store = '4130'
const workspace = 'salla-product-audit'
const erp = {
  id: 'audit-erp', workspace_id: workspace, erp_type: 'odoo',
  url: 'https://odoo.invalid', db_name: 'fixture', username: 'fixture', password: 'fixture',
}
const payload = {
  id: 1234, sku: 'SALLA-AUDIT', name: 'منتج تجريبي', description: 'وصف تجريبي',
  price: { amount: 100, currency: 'SAR' },
  sale_price: { amount: 80, currency: 'SAR' },
  cost_price: 25, quantity: 7, tax: { amount: 15, currency: 'SAR' },
}
const row = (store_id: string, settings: Record<string, unknown>) => ({
  workspace_id: workspace, store_type: 'salla', entity_type: 'products', store_id, settings,
})
function configure(settings: Record<string, unknown>) {
  supabase.addMock('standard_mapping_settings', [
    row('', { disabled: true }),
    row(store, settings),
  ])
}
const dispatch = (data: Record<string, unknown> = payload) =>
  processWebhookEvent('product.created', store, { ...data }, 'salla', true, workspace, 'audit-delivery', {
    erpConnectionId: erp.id, connectionGeneration: connectionGeneration(erp),
  })

beforeEach(() => {
  mockOdoo.search.mockReset().mockResolvedValue([])
  mockOdoo.searchRead.mockReset().mockResolvedValue([])
  mockOdoo.create.mockReset().mockResolvedValue(501)
  mockOdoo.write.mockReset().mockResolvedValue(true)
  mockOdoo.execute.mockReset().mockResolvedValue([])
  ttlCache.clear('')
  supabase.reset()
  supabase.addMock('salla_tokens', [{ workspace_id: workspace, merchant_id: store }])
  supabase.addMock('erp_connections', [erp])
  supabase.addMock('erp_workspace_bindings', [{ ...erp, erp_connection_id: erp.id }])
})

it('uses the Salla store row, not the disabled platform default, to prepare the Odoo create', async () => {
  configure({
    enabled_actions: ['create'], match_zid_field: 'sku', match_odoo_field: 'default_code',
    product_type: { default_type: 'consu' }, inventory: { track_inventory: true, tracking: 'serial', sync_enabled: true },
    company_id: 42, link_company: true,
    price: { source: 'price', cost_source: 'none', markup_percent: 12.34, rounding: 'ceil', decimal_places: 1 },
    description: { language: 'ar', fallback: 'name' },
    category: { sync_mode: 'skip' }, tax: { sync_mode: 'static_ids', default_tax_ids: [55] },
  })
  expect(await isWebhookEventEnabled(workspace, 'salla', 'product.created', store)).toMatchObject({ allowed: true })
  expect(await dispatch({ ...payload, categories: [{ id: 12, name: 'Ignored category' }] })).toMatchObject({ success: 1 })
  expect(mockOdoo.search.mock.calls.some(([model, domain]) => model === 'product.template' &&
    JSON.stringify(domain).includes('["default_code","=","SALLA-AUDIT"]'))).toBe(true)
  expect(mockOdoo.create).toHaveBeenCalledTimes(1)
  expect(mockOdoo.create).toHaveBeenCalledWith('product.template', expect.objectContaining({
    name: payload.name, default_code: payload.sku, type: 'consu', is_storable: true, tracking: 'serial',
    company_id: 42, list_price: 112.4, taxes_id: [[6, 0, [55]]],
  }))
  expect(mockOdoo.create.mock.calls[0][1]).not.toHaveProperty('standard_price')
  expect(mockOdoo.create.mock.calls[0][1]).not.toHaveProperty('categ_id')
})

it.each([
  ['sale_price', 80], ['cost', 25],
])('uses saved %s instead of the preset price, and uses the price as cost', async (source, wanted) => {
  configure({ inventory: { track_inventory: false }, price: { source, cost_source: 'price', markup_percent: 10 } })
  expect(await dispatch()).toMatchObject({ success: 1 })
  const values = mockOdoo.create.mock.calls[0][1]
  expect(values.list_price).toBeCloseTo(wanted * 1.1)
  expect(values.standard_price).toBe(payload.price.amount)
})

it('leaves the Salla tax amount to Odoo when automatic tax selection has no name', async () => {
  configure({ inventory: { track_inventory: false }, tax: { sync_mode: 'auto_by_name' } })
  expect(await dispatch()).toMatchObject({ success: 1 })
  expect(mockOdoo.create.mock.calls[0][1]).not.toHaveProperty('taxes_id')
  expect(mockOdoo.search.mock.calls.some(([model]) => model === 'account.tax')).toBe(false)
})

it('matches one Odoo sales tax using the tax amount relative to the net price', async () => {
  configure({ company_id: 42, inventory: { track_inventory: false }, tax: { sync_mode: 'auto_by_name' } })
  mockOdoo.search.mockImplementation(async model => model === 'account.tax' ? [55] : [])
  expect(await dispatch({ ...payload, tax: { amount: 30, currency: 'SAR' }, pre_tax_price: { amount: 200, currency: 'SAR' } })).toMatchObject({ success: 1 })
  expect(mockOdoo.search).toHaveBeenCalledWith('account.tax', [
    ['type_tax_use', '=', 'sale'], ['company_id', '=', 42], ['amount_type', '=', 'percent'], ['amount', '=', 15],
  ], 2)
  expect(mockOdoo.create.mock.calls[0][1]).toHaveProperty('taxes_id', [[6, 0, [55]]])
})

it('reports ambiguous automatic sales taxes before creating a product', async () => {
  configure({ inventory: { track_inventory: false }, tax: { sync_mode: 'auto_by_name' } })
  mockOdoo.search.mockImplementation(async model => model === 'account.tax' ? [55, 56] : [])
  expect(await dispatch({ ...payload, tax_rate: 15 })).toMatchObject({
    failed: 1, records: [{ message: expect.stringContaining('one matching Odoo tax') }],
  })
  expect(mockOdoo.create).not.toHaveBeenCalled()
})

it('preserves a populated plain-text description and uses the configured fallback for an empty one', async () => {
  configure({ inventory: { track_inventory: false }, description: { language: 'ar', fallback: 'name' } })
  expect(await dispatch()).toMatchObject({ success: 1 })
  expect(mockOdoo.create.mock.calls[0][1]).toHaveProperty('description_sale', payload.description)
  expect(await dispatch({ ...payload, description: '' })).toMatchObject({ success: 1 })
  expect(mockOdoo.create.mock.calls[1][1]).toHaveProperty('description_sale', payload.name)
})

it('reports a rejected tracking setting and does not retry without it', async () => {
  configure({ inventory: { track_inventory: true, tracking: 'serial', sync_enabled: true } })
  mockOdoo.create.mockRejectedValueOnce(new Error("Wrong value for product.template.tracking: 'serial'"))
  expect(await dispatch()).toMatchObject({ success: 0, failed: 1, records: [{ message: expect.stringContaining('tracking') }] })
  expect(mockOdoo.create).toHaveBeenCalledTimes(1)
  expect(mockOdoo.create.mock.calls[0][1]).toHaveProperty('tracking', 'serial')
})

const options = [{ id: 10, name: 'Color', values: [{ id: 11, name: 'Red' }] }]
const skus = [{ id: 12, sku: 'RED', price: { amount: 120 }, sale_price: { amount: 90 }, cost_price: { amount: 0 },
  related_options: [10], related_option_values: [11] }]

it('does not create a fake variant from an option definition', () => {
  expect(extractGenericVariants({ id: payload.id, options }, 'salla')).toEqual([])
})

it('creates the real SKU with its attributes and own prices in separate-product mode', async () => {
  configure({
    match_zid_field: 'sku', match_odoo_field: 'default_code', inventory: { track_inventory: false },
    price: { source: 'sale_price', cost_source: 'cost', markup_percent: 10, rounding: 'nearest', decimal_places: 2 },
    variant: { sync_mode: 'AS_SEPARATE_PRODUCTS' },
  })
  mockOdoo.create.mockResolvedValueOnce(501).mockResolvedValueOnce(502)
  expect(await dispatch({ ...payload, options, skus })).toMatchObject({ success: 1 })
  expect(mockOdoo.create).toHaveBeenCalledTimes(2)
  expect(mockOdoo.create).toHaveBeenNthCalledWith(1, 'product.template', expect.objectContaining({
    default_code: payload.sku, list_price: 88, standard_price: 25,
  }))
  expect(mockOdoo.create).toHaveBeenNthCalledWith(2, 'product.template', expect.objectContaining({
    name: `${payload.name} - Red`, default_code: 'RED', list_price: 99, standard_price: 0,
  }))
})

it('uses the matching Odoo variant and its attribute price extra in variant mode', async () => {
  configure({
    inventory: { track_inventory: false }, price: { source: 'price', cost_source: 'cost' },
    variant: { sync_mode: 'AS_VARIANTS' },
  })
  mockOdoo.search.mockImplementation(async model => ({
    'product.attribute': [10], 'product.attribute.value': [11], 'product.template.attribute.line': [20],
  })[model as string] || [])
  mockOdoo.searchRead.mockImplementation(async model => ({
    'product.template': [{ id: 501, list_price: 100 }],
    'product.template.attribute.line': [{ id: 20, attribute_id: [10, 'Color'], value_ids: [11] }],
    'product.template.attribute.value': [{
      id: 21, attribute_id: [10, 'Color'], product_attribute_value_id: [11, 'Red'], price_extra: 0, attribute_line_id: [20, 'Color'],
    }],
    'product.product': [{ id: 601, product_template_attribute_value_ids: [21], lst_price: 100 }],
  })[model as string] || [])
  expect(await dispatch({ ...payload, options, skus })).toMatchObject({ success: 1 })
  expect(mockOdoo.write).toHaveBeenCalledWith('product.product', [601], expect.objectContaining({ default_code: 'RED', standard_price: 0 }))
  expect(mockOdoo.write).toHaveBeenCalledWith('product.template', [501], {
    attribute_line_ids: [[1, 20, { product_template_value_ids: [[1, 21, { price_extra: 20 }]] }]],
  })
})

it('rejects incomplete Salla SKU combinations before creating an Odoo template', async () => {
  configure({ variant: { sync_mode: 'AS_VARIANTS' }, inventory: { track_inventory: false } })
  expect(await dispatch({ ...payload, options, skus: [{ ...skus[0], related_option_values: [99] }] })).toMatchObject({
    failed: 1, records: [{ message: expect.stringContaining('Missing Salla option values') }],
  })
  expect(mockOdoo.create).not.toHaveBeenCalled()
})

it('does not create a finite quantity for unlimited Salla stock', async () => {
  configure({ inventory: { track_inventory: true, sync_enabled: false } })
  expect(await dispatch({ ...payload, unlimited_quantity: true, quantity: 0 })).toMatchObject({ success: 1 })
  expect(mockOdoo.create).toHaveBeenCalledTimes(1)
  expect(mockOdoo.search.mock.calls.some(([model]) => model === 'product.product')).toBe(false)
})

it('blocks product creation when only updates are enabled', async () => {
  configure({ enabled_actions: ['update'] })
  expect(await isWebhookEventEnabled(workspace, 'salla', 'product.created', store)).toMatchObject({ allowed: false })
  expect(await dispatch()).toMatchObject({ success: 0, failed: 0 })
  expect(mockOdoo.create).not.toHaveBeenCalled()
})
