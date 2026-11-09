import type { OdooClient } from '@/lib/odoo-client'
import { buildOrderLineItems } from '@/lib/sync-engine'
import type { FieldMappingRow } from '@/lib/sync-types'
import { ttlCache } from '@/lib/ttl-cache'

import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/sync-runtime', () => ({
  supabaseAdmin: jest.requireActual('../mocks/supabase').supabase,
  logSync: jest.fn(),
}))

const mapping: FieldMappingRow = {
  id: 'map-order', workspace_id: 'ws-1', erp_connection_id: 'conn-1', merchant_id: '10',
  store_id: '20', name: 'Orders', action: 'order.create', odoo_model: 'sale.order', mappings: {},
}

function mockClient(analyticFields: string[] = [], headerAnalyticField = false) {
  return {
    execute: jest.fn(async (model: string, method: string, args: unknown[]) => {
      if (model === 'ir.model.fields' && method === 'search_read') {
        const domain = args[0] as string[][]
        if (domain.some(condition => condition[0] === 'model' && condition[2] === 'product.product')) {
          return [
            { name: 'x_reference', ttype: 'char' }, { name: 'x_number', ttype: 'integer' },
            { name: 'barcode', ttype: 'char' },
          ]
        }
        if (domain.some(condition => condition[0] === 'model' && condition[2] === 'sale.order')) {
          return headerAnalyticField ? [{ name: 'analytic_account_id', ttype: 'many2one', relation: 'account.analytic.account' }] : []
        }
        return [
          { name: 'product_id', ttype: 'many2one', relation: 'product.product' },
          { name: 'tax_id', ttype: 'many2many', relation: 'account.tax' },
          { name: 'price_unit', ttype: 'float' }, { name: 'product_uom_qty', ttype: 'float' },
          ...analyticFields.map(name => ({ name, ttype: name === 'analytic_distribution' ? 'json' : 'many2one' })),
        ]
      }
      if (model === 'product.product' && method === 'search') return [42]
      return []
    }),
    search: jest.fn(async () => [] as number[]),
    create: jest.fn(async () => 123),
    getMajorVersion: jest.fn(async () => 17),
  }
}

function settings(extra: Record<string, unknown> = {}) {
  supabase.addMock('standard_mapping_settings', [{
    workspace_id: 'ws-1', store_type: 'zid', store_id: '20', entity_type: 'products',
    settings: { disabled: true, enabled_actions: [], match_zid_field: 'barcode', match_odoo_field: 'x_reference', ...extra },
  }])
}

async function lines(client: ReturnType<typeof mockClient>, products: unknown[], orderSettings: Record<string, unknown> = {}, row = mapping, payload: Record<string, unknown> = {}) {
  return buildOrderLineItems(client as unknown as OdooClient, row,
    { id: 1, products, ...payload }, new Map(), {}, 'zid', orderSettings, '20', 'order.create', 'create')
}

describe('order-line products use the configured Product match fields', () => {
  beforeEach(() => {
    supabase.reset()
    ttlCache.clear('')
    jest.spyOn(console, 'info').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  it('uses read-only matching even when product synchronization is disabled', async () => {
    settings()
    const client = mockClient()
    client.search.mockResolvedValue([95])
    const result = await lines(client, [{ id: 10, sku: 'WRONG-SKU', barcode: 'BAR-1', price: 25, quantity: 2 }])
    expect(result[0]).toMatchObject({ product_id: 95, price_unit: 25, product_uom_qty: 2 })
    expect(client.search).toHaveBeenCalledWith('product.product', [['x_reference', '=', 'BAR-1']], 2)
    expect(client.execute.mock.calls.some(call => call[0] === 'product.product')).toBe(false)
    expect(client.create).not.toHaveBeenCalled()
    expect(supabase.calls.find(call => call.table === 'standard_mapping_settings')?.filters).toEqual(
      expect.arrayContaining([['workspace_id', 'ws-1'], ['store_type', 'zid'], ['entity_type', 'products']]),
    )
  })

  it('does not fall back to a matching SKU when the explicit source key is missing', async () => {
    settings()
    const client = mockClient()
    await expect(lines(client, [{ id: 10, sku: 'FOUND-BY-SKU', price: 25 }])).rejects.toThrow('match value barcode is missing')
    expect(client.search).not.toHaveBeenCalled()
    expect(client.create).not.toHaveBeenCalled()
  })

  it('rejects ambiguity before creating any replacement product', async () => {
    settings()
    const client = mockClient()
    client.search.mockResolvedValue([95, 96])
    await expect(lines(client, [{ sku: 'x', barcode: 'DUPLICATE', price: 25 }])).rejects.toThrow('Ambiguous')
    expect(client.create).not.toHaveBeenCalled()
  })

  it('writes the configured source value, not the line id, when Orders permits creating a product', async () => {
    settings({ company_id: 7, category_id: 6, tax: { default_tax_ids: [5] } })
    const client = mockClient()
    const result = await lines(client, [{ id: 999, sku: 'SKU', barcode: 'BAR-1', price: 25 }], { product_fallback_policy: 'create_new' })
    expect(result[0].product_id).toBe(123)
    expect(client.create).toHaveBeenCalledTimes(1)
    expect(client.create).toHaveBeenCalledWith('product.product', expect.objectContaining({
      x_reference: 'BAR-1', default_code: 'SKU', barcode: 'BAR-1', company_id: 7, categ_id: 6, taxes_id: [[6, 0, [5]]],
    }))
  })

  it('creates a missing voucher as a service product when Orders creates new products', async () => {
    settings({ company_id: 7, category_id: 6, tax: { default_tax_ids: [5] } })
    const client = mockClient()
    const result = await lines(client, [{ id: 700, sku: 'VOUCHER-SKU', barcode: 'BAR-V', price: 99, product_class: 'voucher' }], { product_fallback_policy: 'create_new' })
    expect(result[0].product_id).toBe(123)
    expect(client.create).toHaveBeenCalledTimes(1)
    expect(client.create).toHaveBeenCalledWith('product.product', expect.objectContaining({
      name: expect.anything(), default_code: 'VOUCHER-SKU', barcode: 'BAR-V',
      type: 'service', company_id: 7, categ_id: 6, taxes_id: [[6, 0, [5]]],
    }))
    // A voucher carries no bundle notes and no stock should be implied.
    const created = (client.create.mock.calls as unknown[][])[0][1] as Record<string, unknown>
    expect(created).not.toHaveProperty('description')
    expect(created).not.toHaveProperty('group_products')
  })

  it('keeps numeric match values numeric when creating a missing product', async () => {
    settings({ match_zid_field: 'product_id', match_odoo_field: 'x_number' })
    const client = mockClient()
    await lines(client, [{ id: 999, product_id: '501', sku: 'SKU', price: 25 }])
    expect(client.create).toHaveBeenCalledWith('product.product', expect.objectContaining({ x_number: 501 }))
  })

  it('does not retry a failed create with stripped matching/company/tax fields', async () => {
    settings({ company_id: 7 })
    const client = mockClient()
    client.create.mockRejectedValue(new Error('response timed out'))
    await expect(lines(client, [{ barcode: 'BAR-1', price: 25 }], { default_product_id: 77 })).rejects.toThrow('timed out')
    expect(client.create).toHaveBeenCalledTimes(1)
  })

  it('keeps the Orders default-product and skip-order policies', async () => {
    settings()
    const client = mockClient()
    const result = await lines(client, [{ barcode: 'BAR-1', price: 25 }], { product_fallback_policy: 'default_product', default_product_id: 77 })
    expect(result[0].product_id).toBe(77)
    await expect(lines(client, [{ barcode: 'BAR-1', price: 25 }], { product_fallback_policy: 'skip_order' }))
      .rejects.toMatchObject({ isOrderSkipped: true })
    expect(client.create).not.toHaveBeenCalled()
  })

  it('preserves an explicit static custom-line product id', async () => {
    settings()
    const client = mockClient()
    const row = { ...mapping, mappings: { 'sale.order.line': [{ id: 'f1', erpField: 'product_id', staticValue: 88 }] } }
    const result = await lines(client, [{ sku: 'SKU', price: 25 }], {}, row)
    expect(result[0].product_id).toBe(88)
    expect(client.search).not.toHaveBeenCalled()
    expect(client.create).not.toHaveBeenCalled()
  })

  it('rejects ambiguous legacy SKU matches instead of taking the first product', async () => {
    const client = mockClient()
    client.execute.mockImplementation(async (model, method) => {
      if (model === 'product.product' && method === 'search') return [11, 12]
      return [{ name: 'product_id', ttype: 'many2one', relation: 'product.product' }] as never
    })
    await expect(lines(client, [{ sku: 'DUPLICATE', price: 25 }])).rejects.toThrow('Ambiguous order product match')
    expect(client.create).not.toHaveBeenCalled()
  })

  it('deduplicates repeated legacy lookups within the same order', async () => {
    const client = mockClient()
    const result = await lines(client, [{ sku: 'SKU', price: 25 }, { sku: 'SKU', price: 30 }])
    expect(result).toHaveLength(2)
    expect(client.execute.mock.calls.filter(call => call[0] === 'product.product')).toHaveLength(1)
  })

  it('does not invent an unnamed product for an incomplete empty line', async () => {
    const client = mockClient()
    await expect(lines(client, [{ price: 25, quantity: 1 }])).rejects.toThrow('incomplete product line')
    expect(client.create).not.toHaveBeenCalled()
  })

  it.each([{ products: [] }, { products: [null] }, { products: ['invalid'] }])('refuses incomplete product lines: %j', async ({ products }) => {
    const client = mockClient()
    await expect(lines(client, products)).rejects.toThrow(/no product line items|invalid product line item/)
    expect(client.create).not.toHaveBeenCalled()
  })

  it.each([
    { settings: { add_shipping_as_line: true, shipping_product_sku: 'MISSING' }, payload: { shipping_cost: 20 }, error: 'Shipping fee' },
    { settings: { add_discount_as_line: true, discount_mode: 'fixed' }, payload: { order_discount: 10 }, error: 'Discount line' },
    { settings: { add_cod_as_line: true, cod_amount: 10 }, payload: { payment_method: { code: 'zid_cod', title: 'Cash on delivery' } }, error: 'COD fee' },
  ])('refuses to silently drop an enabled financial line: $error', async ({ settings: orderSettings, payload, error }) => {
    const client = mockClient()
    const execute = client.execute.getMockImplementation()!
    client.execute.mockImplementation(async (model, method, args) =>
      model === 'product.product' && method === 'search' ? [] : execute(model, method, args))
    const row = { ...mapping, mappings: { 'sale.order.line': [{ id: 'static', erpField: 'product_id', staticValue: 88 }] } }
    await expect(lines(client, [{ price: 100 }], orderSettings, row, payload)).rejects.toThrow(error)
  })

  it('does not require a shipping product for an actual zero shipping fee', async () => {
    const client = mockClient()
    const result = await lines(client, [{ sku: 'SKU', price: 100 }], { add_shipping_as_line: true }, mapping, { shipping_cost: 0 })
    expect(result).toHaveLength(1)
  })

  const analytic = { enabled: true, rules: [{ condition: 'all', source_value: '', source_label: '', odoo_analytic_account_id: 5, percentage: 100 }] }

  it('refuses to lose a matched analytic rule when no supported Odoo field is confirmed', async () => {
    const client = mockClient()
    await expect(lines(client, [{ sku: 'SKU', price: 25 }], { analytic })).rejects.toThrow('no supported Odoo analytic field')
  })

  it('applies matched analytics when Odoo confirms the distribution field', async () => {
    const client = mockClient(['analytic_distribution'])
    const result = await lines(client, [{ sku: 'SKU', price: 25 }], { analytic })
    expect(result[0].analytic_distribution).toEqual({ '5': 100 })
  })

  it.each([14, 15])('writes the Odoo %i legacy analytic account on the header and preserves explicit parent mapping', async major => {
    const client = mockClient([], true)
    client.getMajorVersion.mockResolvedValue(major)
    const parent: Record<string, unknown> = {}
    const result = await buildOrderLineItems(client as unknown as OdooClient, mapping,
      { id: 1, products: [{ sku: 'SKU', price: 25 }] }, new Map(), parent, 'zid', { analytic }, '20', 'order.create', 'create')
    expect(parent.analytic_account_id).toBe(5)
    expect(result[0].analytic_account_id).toBeUndefined()
    expect(result[0].analytic_distribution).toBeUndefined()
    parent.analytic_account_id = 9
    await buildOrderLineItems(client as unknown as OdooClient, mapping,
      { id: 1, products: [{ sku: 'SKU', price: 25 }] }, new Map(), parent, 'zid', { analytic }, '20', 'order.create', 'create')
    expect(parent.analytic_account_id).toBe(9)
  })

  it('does not silently lose analytics after a field metadata read failure', async () => {
    const client = mockClient()
    const execute = client.execute.getMockImplementation()!
    client.execute.mockImplementation(async (model, method, args) => {
      if (model === 'ir.model.fields') throw new Error('metadata read failed')
      return execute(model, method, args)
    })
    const row = { ...mapping, mappings: { 'sale.order.line': [{ id: 'static', erpField: 'product_id', staticValue: 88 }] } }
    await expect(lines(client, [{ price: 25 }], { analytic }, row)).rejects.toThrow('no supported Odoo analytic field')
  })

  it('recognizes the documented nested Zid COD code even with a different display label', async () => {
    const client = mockClient()
    const result = await lines(client, [{ sku: 'SKU', price: 100 }], { add_cod_as_line: true, cod_amount: 10, cod_product_id: 99 }, mapping,
      { payment: { method: { code: 'zid_cod', name: 'Local cash label' } } })
    expect(result.find(line => line.product_id === 99)?.price_unit).toBe(10)
  })

  it('preserves Salla behavior when analytic fields are unavailable', async () => {
    const client = mockClient()
    const result = await buildOrderLineItems(client as unknown as OdooClient, mapping,
      { id: 1, products: [{ sku: 'SKU', price: 25 }] }, new Map(), {}, 'salla', { analytic }, '20', 'order.create', 'create')
    expect(result).toHaveLength(1)
    expect(result[0].analytic_distribution).toBeUndefined()
  })
})
