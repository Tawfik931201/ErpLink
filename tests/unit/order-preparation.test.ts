import type { OdooClient } from '@/lib/odoo-client'
import { executeOdooOperation } from '@/lib/sync-engine'
import type { FieldMappingRow } from '@/lib/sync-types'
import { ttlCache } from '@/lib/ttl-cache'

import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/sync-runtime', () => ({
  supabaseAdmin: jest.requireActual('../mocks/supabase').supabase, logSync: jest.fn(),
}))
const mockReadRelated = jest.fn()
jest.mock('../../src/lib/zid/order-related-data', () => ({
  readOrderRelatedDetails: (...args: unknown[]) => mockReadRelated(...args),
}))

const orderSchema = {
  client_order_ref: { type: 'char' }, state: { type: 'selection', selection: [['draft', 'Draft']] },
  partner_id: { type: 'many2one', relation: 'res.partner' },
  partner_invoice_id: { type: 'many2one', relation: 'res.partner' },
  partner_shipping_id: { type: 'many2one', relation: 'res.partner' },
  order_line: { type: 'one2many', relation: 'sale.order.line' },
  warehouse_id: { type: 'many2one', relation: 'stock.warehouse' },
  company_id: { type: 'many2one', relation: 'res.company' },
  currency_id: { type: 'many2one', relation: 'res.currency' },
  pricelist_id: { type: 'many2one', relation: 'product.pricelist' },
}
const lineSchema = {
  product_id: { type: 'many2one', relation: 'product.product' },
  name: { type: 'char' }, product_uom_qty: { type: 'float' }, price_unit: { type: 'float' }, discount: { type: 'float' },
  tax_id: { type: 'many2many', relation: 'account.tax' }, analytic_distribution: { type: 'json' },
}
const partnerSchema = { name: { type: 'char' }, ref: { type: 'char' }, email: { type: 'char' }, phone: { type: 'char' }, customer_rank: { type: 'integer' } }
const orderSettings = {
  match_zid_field: 'id', match_odoo_field: 'client_order_ref',
  order: { customer_fallback_policy: 'create_new', product_fallback_policy: 'skip_order',
    enable_vat: true, vat_saudi_tax_id: 5,
    analytic: { enabled: true, rules: [{ condition: 'all', source_value: '', odoo_analytic_account_id: 9, percentage: 100 }] },
  },
}
const mapping = { id: 'order-mapping', name: 'Orders', workspace_id: 'ws', merchant_id: 'store', mappings: {} } as FieldMappingRow
const payload = {
  id: '1001', order_status: 'new', currency_code: 'SAR',
  customer: { id: 77, name: 'Buyer', email: 'buyer@example.test' },
  shipping_address: { country: { code: 'SA' } },
  products: [{ id: 3, sku: 'WRONG-SKU', barcode: 'MATCH-BARCODE', name: 'Item', quantity: 2, price: 100 }],
}

function configureOrders(settings = orderSettings) {
  supabase.addMock('standard_mapping_settings', [
    { workspace_id: 'ws', store_type: 'zid', store_id: 'store', entity_type: 'orders', settings },
    { workspace_id: 'ws', store_type: 'zid', store_id: 'store', entity_type: 'customers', settings: { disabled: true, enabled_actions: [], match_zid_field: 'email', match_odoo_field: 'ref' } },
    { workspace_id: 'ws', store_type: 'zid', store_id: 'store', entity_type: 'products', settings: { disabled: true, enabled_actions: [], match_zid_field: 'barcode', match_odoo_field: 'barcode' } },
  ])
}

function fixture(options: { customerFound?: boolean; missingModel?: string; failCreate?: boolean; duplicateOrder?: boolean; foreignTax?: boolean } = {}) {
  const calls: string[] = []
  const client = {
    url: 'https://odoo.test', db: 'test',
    getMajorVersion: jest.fn().mockResolvedValue(17),
    execute: jest.fn(async (model: string, method: string, args: unknown[], kwargs?: Record<string, any>) => {
      if (method === 'default_get') return { company_id: 7 }
      if (method === 'search_read' && model === 'res.currency') {
        expect(kwargs?.context).toMatchObject({ allowed_company_ids: [7], company_id: 7 })
        const domain = args[0] as unknown[][]
        const requestedId = domain.find(term => term[0] === 'id')?.[2]
        const requestedName = domain.find(term => term[0] === 'name')?.[2]
        return requestedId === 4 || requestedName === 'SAR' ? [{ id: 4, name: 'SAR', active: true }] : []
      }
      if (method === 'search_read' && model === 'product.pricelist') {
        expect(kwargs?.context).toMatchObject({ allowed_company_ids: [7], company_id: 7 })
        const domain = args[0] as unknown[][]
        expect(domain).toEqual(expect.arrayContaining([['currency_id', '=', 4], ['company_id', '=', 7], ['company_id', '=', false]]))
        return [{ id: 20, currency_id: [4, 'SAR'], company_id: [7, 'Existing company'], active: true }]
      }
      if (method === 'fields_get') {
        if (model === 'account.tax') return { company_id: { type: 'many2one', relation: 'res.company' } }
        return model === 'sale.order' ? orderSchema : model === 'sale.order.line' ? lineSchema : partnerSchema
      }
      if (model === 'ir.model.fields') {
        const targetModel = (args[0] as string[][]).find(c => c[0] === 'model')?.[2]
        const schema = targetModel === 'sale.order.line' ? lineSchema : targetModel === 'res.partner' ? partnerSchema : { barcode: { type: 'char' }, client_order_ref: { type: 'char' } }
        return Object.entries(schema).map(([name, f]) => ({ name, ttype: f.type, relation: 'relation' in f ? f.relation : '', readonly: false }))
      }
      return []
    }),
    search: jest.fn(async (model: string, domain: unknown[][]) => {
      if (model === 'sale.order') return options.duplicateOrder ? [50] : []
      if (model === 'res.partner') return options.customerFound === false ? [] : [11]
      if (model === 'product.product') return domain[0][0] === 'barcode' ? [22] : []
      return []
    }),
    searchRead: jest.fn(async (model: string, domain: unknown[][]) => {
      // Post-status financial integrity checks must read back a persisted SO
      // line. This fixture models the configured 15% VAT tax #5, not an empty
      // Odoo result (which would correctly fail the new strict verification).
      if (model === 'sale.order.line' && domain.some(term => term[0] === 'order_id')) {
        return [{ id: 81, tax_id: [5], tax_ids: [5] }]
      }
      if (model === 'sale.order') return [{ id: 50, partner_id: [11, 'Existing buyer'], company_id: [7, 'Existing company'], currency_id: [4, 'SAR'], pricelist_id: [20, 'SAR pricelist'], state: 'draft', amount_total: 200 }]
      if (model === options.missingModel) return []
      if (model === 'res.company' && domain.some(term => term[0] === 'id' && term[1] === '=' && term[2] === 7)) {
        return [{ id: 7, currency_id: [4, 'SAR'] }]
      }
      const ids = domain.find(c => c[0] === 'id' && c[1] === 'in')?.[2]
      return Array.isArray(ids) ? ids.map(id => ({ id, company_id: options.foreignTax && model === 'account.tax' ? [8, 'Foreign company'] : false })) : []
    }),
    create: jest.fn(async (model: string) => {
      calls.push(`create:${model}`)
      if (options.failCreate && model === 'sale.order') throw new Error("Invalid field 'warehouse_id'")
      return model === 'res.partner' ? 11 : 50
    }),
    write: jest.fn(async () => true),
  }
  return { client, calls }
}
const run = (client: ReturnType<typeof fixture>['client'], data = payload) => executeOdooOperation({
  client: client as unknown as OdooClient, mapping, event: 'order.create', storeId: 'store', zidEntityId: '1001', zidData: data,
  odooModel: 'sale.order', odooOperation: 'create', odooValues: { client_order_ref: '1001' }, presetKey: null, platformHint: 'zid',
})

describe('complete order preparation from the linked Standard Mapping tabs', () => {
  beforeEach(() => {
    supabase.reset(); ttlCache.clear('eng:stdsets:')
    mockReadRelated.mockReset().mockRejectedValue(new Error('Related details unavailable'))
    configureOrders()
  })

  it('uses both disabled tabs matching fields and sends VAT and analytic settings together', async () => {
    const { client } = fixture()
    expect((await run(client)).status).toBe('success')
    expect(client.search).toHaveBeenCalledWith('res.partner', [['ref', '=', 'buyer@example.test']], 2)
    expect(client.search).toHaveBeenCalledWith('product.product', [['barcode', '=', 'MATCH-BARCODE']], 2)
    const written = (client.create.mock.calls as unknown as Array<[string, Record<string, unknown>]>).find(([model]) => model === 'sale.order')![1]
    expect(written).toMatchObject({ partner_id: 11, order_line: [[0, 0, { product_id: 22, product_uom_qty: 2, price_unit: 100, tax_id: [[6, 0, [5]]], analytic_distribution: { '9': 100 } }]] })
    expect(written).toMatchObject({ company_id: 7, currency_id: 4, pricelist_id: 20 })
    expect(client.create).toHaveBeenCalledTimes(1)
  })

  it('does not create even the pending customer when an analytic reference is inaccessible', async () => {
    const { client } = fixture({ customerFound: false, missingModel: 'account.analytic.account' })
    await expect(run(client)).rejects.toThrow('missing or inaccessible account.analytic.account')
    expect(client.create).not.toHaveBeenCalled()
  })

  it('rejects a tax belonging to another Odoo company before creating a customer or order', async () => {
    const { client } = fixture({ customerFound: false, foreignTax: true })
    await expect(run(client)).rejects.toThrow('account.tax belongs to another Odoo company')
    expect(client.create).not.toHaveBeenCalled()
  })

  it('creates a customer with the selected matching key only after all order references validate', async () => {
    const { client, calls } = fixture({ customerFound: false })
    await run(client)
    expect(calls).toEqual(['create:res.partner', 'create:sale.order'])
    expect(client.create).toHaveBeenCalledWith('res.partner', expect.objectContaining({ ref: 'buyer@example.test' }))
    const customerCreateIndex = client.create.mock.invocationCallOrder[0]
    const referenceReads = client.searchRead.mock.calls.flatMap(([, domain], i) =>
      domain.some(condition => condition[0] === 'id' && condition[1] === 'in') ? [client.searchRead.mock.invocationCallOrder[i]] : [])
    expect(referenceReads.length).toBeGreaterThan(0)
    expect(referenceReads.every(index => index < customerCreateIndex)).toBe(true)
  })

  it('never retries a rejected SO after silently removing the configured fields', async () => {
    const { client } = fixture({ failCreate: true })
    await expect(run(client)).rejects.toThrow("Invalid field 'warehouse_id'")
    expect(client.create).toHaveBeenCalledTimes(1)
  })

  it('keeps an existing order customer and does not create an unused customer on duplicate delivery', async () => {
    const { client } = fixture({ customerFound: false, duplicateOrder: true })
    await run(client)
    expect(client.create).not.toHaveBeenCalled()
    expect(client.search.mock.calls.filter(([model]) => model === 'res.partner')).toHaveLength(0)
    expect(client.write).toHaveBeenCalled()
  })

  it('does not fall back to customer id when the configured email is missing', async () => {
    const { client } = fixture()
    await expect(run(client, { ...payload, customer: { ...payload.customer, email: '' } })).rejects.toThrow('email is missing')
    expect(client.create).not.toHaveBeenCalled()
  })

  it('fetches a missing product match key without replacing actual order prices or quantities with catalog values', async () => {
    mockReadRelated.mockResolvedValue({ id: 3, barcode: 'MATCH-BARCODE', price: 999, quantity: 999 })
    const { client } = fixture()
    await run(client, { ...payload, products: [{ ...payload.products[0], barcode: '' }] })
    expect(client.create).toHaveBeenCalledWith('sale.order', expect.objectContaining({
      order_line: [[0, 0, expect.objectContaining({ product_id: 22, price_unit: 100, product_uom_qty: 2 })]],
    }))
  })

  it('uses the selected default customer after an explicit match misses', async () => {
    configureOrders({ ...orderSettings, order: { ...orderSettings.order, customer_fallback_policy: 'default_customer', default_customer_id: 99 } } as typeof orderSettings)
    const { client } = fixture({ customerFound: false })
    await run(client)
    expect(client.create).toHaveBeenCalledTimes(1)
    expect(client.create).toHaveBeenCalledWith('sale.order', expect.objectContaining({ partner_id: 99 }))
  })

  it('honors skip_order instead of choosing a different customer search key', async () => {
    configureOrders({ ...orderSettings, order: { ...orderSettings.order, customer_fallback_policy: 'skip_order' } })
    const { client } = fixture({ customerFound: false })
    expect((await run(client)).status).toBe('skipped')
    expect(client.create).not.toHaveBeenCalled()
    expect(client.search.mock.calls.filter(([model]) => model === 'res.partner')).toHaveLength(1)
  })

  it('rejects an invalid default-customer configuration rather than creating a new customer', async () => {
    configureOrders({ ...orderSettings, order: { ...orderSettings.order, customer_fallback_policy: 'default_customer' } })
    const { client } = fixture({ customerFound: false })
    await expect(run(client)).rejects.toThrow('default order customer is missing')
    expect(client.create).not.toHaveBeenCalled()
  })
})
