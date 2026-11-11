import { connectionGeneration } from '../../src/lib/erp-execution-target'
import { validateOrderLines } from '../../src/lib/platform-validation'
import { getSallaOrder, getSallaOrderItems } from '../../src/lib/salla-client'
import { processWebhookEvent } from '../../src/lib/sync-engine'
import { ttlCache } from '../../src/lib/ttl-cache'
import { isWebhookEventEnabled } from '../../src/lib/webhook-gate'
import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/sync-runtime', () => ({
  supabaseAdmin: jest.requireActual('../mocks/supabase').supabase,
  logSync: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../src/lib/crypto', () => ({ decrypt: jest.fn(() => 'fixture-key') }))
jest.mock('../../src/lib/telegram-notifier', () => ({ notifySyncResult: jest.fn().mockResolvedValue(undefined) }))
jest.mock('../../src/lib/webhook-skip-log', () => ({ logWebhookSkip: jest.fn().mockResolvedValue(undefined) }))
jest.mock('../../src/lib/salla-client', () => ({ getSallaOrder: jest.fn(), getSallaOrderItems: jest.fn() }))
jest.mock('../../src/lib/odoo-client', () => ({ OdooClient: jest.fn(() => mockOdoo) }))

const mockOdoo = {
  getMajorVersion: jest.fn().mockResolvedValue(19),
  search: jest.fn().mockResolvedValue([]),
  searchRead: jest.fn().mockResolvedValue([]),
  execute: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue(501),
  write: jest.fn().mockResolvedValue(true),
}

const store = '4130'
const workspace = 'salla-order-audit'
const erp = {
  id: 'audit-erp', workspace_id: workspace, erp_type: 'odoo',
  url: 'https://odoo.invalid', db_name: 'fixture', username: 'fixture', password: 'fixture',
}

const money = (amount: number) => ({ amount, currency: 'SAR' })
const details = {
  id: 111, reference_id: 222, date: { date: '2026-11-10 14:00:00.000000', timezone: 'Asia/Riyadh' },
  status: { id: 333, slug: 'ready' }, payment_method: 'cod', currency: 'SAR',
  shipping: { address: { country_code: 'SA' } },
  amounts: {
    shipping_cost: money(23),
    cash_on_delivery: money(11.5),
    discounts: [{ code: 'TEST', discount: '5.75', currency: 'SAR' }],
  },
}
const item = { id: 444, sku: 'SALLA-SKU', name: 'Fixture product', quantity: 2 }
const pricedItem = { ...item, amounts: { price_without_tax: money(100), total_discount: money(0), total: money(230) } }
const settings = {
  enabled_actions: ['create'], match_zid_field: 'reference_id', match_odoo_field: 'client_order_ref',
  company_id: 10, link_company: true,
  customer_fallback_policy: 'default_customer', default_customer_id: 11,
  product_fallback_policy: 'default_product', default_product_id: 12,
  add_shipping_as_line: true, shipping_product_id: 13,
  add_cod_as_line: true, cod_product_id: 14, cod_amount: 4.6,
  add_discount_as_line: true, discount_mode: 'fixed', discount_product_id: 15,
  enable_vat: true, vat_country_rules: [{ country_code: 'SA', tax_id: 16 }],
  prices_include_tax: true, tax_rate_percent: 15,
  order_status_custom_field: 'x_salla_order_status', update_custom_status_field: true,
  order: { default_warehouse_id: 17, default_pricelist_id: 18, default_payment_term_id: 19 },
}

function configure(saved: Record<string, unknown> = settings) {
  supabase.addMock('standard_mapping_settings', [
    { workspace_id: workspace, store_type: 'salla', entity_type: 'orders', store_id: '', settings: { disabled: true } },
    { workspace_id: workspace, store_type: 'salla', entity_type: 'orders', store_id: store, settings: saved },
  ])
}

const dispatch = (data: Record<string, unknown>) =>
  processWebhookEvent('order.created', store, { ...data }, 'salla', true, workspace, 'audit-delivery', {
    erpConnectionId: erp.id, connectionGeneration: connectionGeneration(erp),
  })

let orderState: string
let invoiceIds: number[]
let paymentState: string

beforeEach(() => {
  jest.clearAllMocks()
  orderState = 'draft'
  invoiceIds = []
  paymentState = 'draft'
  mockOdoo.create.mockReset().mockImplementation(async model => model === 'account.payment' ? 701 : 501)
  mockOdoo.searchRead.mockReset().mockImplementation(async model => {
    if (model === 'res.company') return [{ currency_id: [40, 'SAR'] }]
    if (model === 'sale.order') return [{ id: 501, name: 'S00501', state: orderState, invoice_ids: invoiceIds,
      company_id: [10, 'Company'], partner_id: [11, 'Customer'], currency_id: [40, 'SAR'], pricelist_id: [18, 'Saved'], amount_total: 230 }]
    if (model === 'account.move') return [{ id: 601, state: 'draft', move_type: 'out_invoice' }]
    if (model === 'account.journal') return [{ id: 21 }]
    if (model === 'account.payment') return [{ id: 701, state: paymentState, company_id: [10, 'Company'] }]
    return []
  })
  mockOdoo.execute.mockReset().mockImplementation(async (model, method) => {
    if (model === 'ir.model.fields' && method === 'search_read') {
      return [
        { name: 'client_order_ref', ttype: 'char' },
        { name: 'tax_ids', ttype: 'many2many', relation: 'account.tax' },
        { name: 'analytic_distribution', ttype: 'json' },
      ]
    }
    if (model === 'sale.order' && method === 'fields_get') {
      return { x_salla_order_status: { selection: [['ready', 'Ready']] } }
    }
    if (model === 'res.currency' && method === 'search_read') return [{ id: 40, name: 'SAR', active: true }]
    if (model === 'product.pricelist' && method === 'search_read') {
      return [{ id: 18, currency_id: [40, 'SAR'], company_id: [10, 'Company'], active: true }]
    }
    if (model === 'sale.order' && method === 'action_confirm') orderState = 'sale'
    if (model === 'sale.advance.payment.inv' && method === 'create') return 602
    if (model === 'sale.advance.payment.inv' && method === 'create_invoices') invoiceIds = [601]
    if (model === 'account.payment' && method === 'action_post') paymentState = 'in_process'
    return []
  })
  jest.mocked(getSallaOrder).mockReset()
  jest.mocked(getSallaOrderItems).mockReset()
  ttlCache.clear('')
  supabase.reset()
  supabase.addMock('salla_tokens', [{ workspace_id: workspace, merchant_id: store }])
  supabase.addMock('erp_connections', [erp])
  supabase.addMock('erp_workspace_bindings', [{ ...erp, erp_connection_id: erp.id }])
})

function createdValues() {
  expect(mockOdoo.create).toHaveBeenCalledWith('sale.order', expect.any(Object))
  return mockOdoo.create.mock.calls.find(([model]) => model === 'sale.order')![1]
}

it('uses the store-specific Orders settings and builds product, VAT and shipping lines', async () => {
  configure()
  expect(await isWebhookEventEnabled(workspace, 'salla', 'order.created', store)).toMatchObject({ allowed: true })
  expect(await dispatch({ ...details, items: [{ ...item, price: money(115) }] })).toMatchObject({ success: 1 })
  expect(createdValues()).toMatchObject({
    client_order_ref: '222', company_id: 10, partner_id: 11, warehouse_id: 17,
    pricelist_id: 18, payment_term_id: 19, x_salla_order_status: 'ready',
    order_line: expect.arrayContaining([
      [0, 0, expect.objectContaining({ product_id: 12, product_uom_qty: 2, price_unit: 100, tax_ids: [[6, 0, [16]]] })],
      [0, 0, expect.objectContaining({ product_id: 13, price_unit: 20 })],
    ]),
  })
  expect(createdValues()).not.toHaveProperty('state')
  expect(orderState).toBe('draft')
})

it('blocks Salla order creation when the store enables only updates', async () => {
  configure({ ...settings, enabled_actions: ['update'] })
  expect(await isWebhookEventEnabled(workspace, 'salla', 'order.created', store)).toMatchObject({ allowed: false })
  await dispatch({ ...details, items: [{ ...item, price: money(115) }] })
  expect(mockOdoo.create).not.toHaveBeenCalled()
})

it('uses a saved branch warehouse and calls the mapped confirmation action', async () => {
  configure({
    ...settings,
    order: {
      ...settings.order,
      store_warehouse_mappings: { '999': '20' },
      status_actions: { ready: { state: 'sale', enabled: true } },
      analytic: {
        enabled: true,
        rules: [{ condition: 'warehouse', source_value: '999', odoo_analytic_account_id: 30, percentage: 75 }],
      },
    },
  })
  expect(await dispatch({ ...details, branch_id: 999, items: [{ ...item, price: money(115) }] })).toMatchObject({ success: 1 })
  expect(createdValues()).toHaveProperty('warehouse_id', 20)
  expect(createdValues().order_line[0][2]).toHaveProperty('analytic_distribution', { '30': 75 })
  expect(createdValues()).not.toHaveProperty('state')
  expect(mockOdoo.execute).toHaveBeenCalledWith('sale.order', 'action_confirm', [501])
})

it('preserves the saved pricelist with multi-currency enabled', async () => {
  configure({ ...settings, order: { ...settings.order, multi_currency_enabled: true } })
  expect(await dispatch({ ...details, items: [{ ...item, price: money(115) }] })).toMatchObject({ success: 1 })
  expect(createdValues()).toMatchObject({ pricelist_id: 18, currency_id: 40 })
})

it('converts Salla prices, fees and discounts into the saved pricelist currency', async () => {
  configure({ ...settings, order: { ...settings.order, multi_currency_enabled: true } })
  const execute = mockOdoo.execute.getMockImplementation()!
  mockOdoo.execute.mockImplementation(async (model, method, args, options) => {
    if (model === 'product.pricelist' && method === 'search_read') {
      return [{ id: 18, currency_id: [42, 'AED'], company_id: false, active: true }]
    }
    if (model === 'res.currency' && method === 'search_read' && args[0][0][0] === 'id') {
      return [{ id: 42, name: 'AED', active: true }]
    }
    if (model === 'res.currency.rate') return [{ rate: args[0][0][2] === 42 ? 2 : 1 }]
    return execute(model, method, args, options)
  })
  expect(await dispatch({ ...details, items: [pricedItem] })).toMatchObject({ success: 1 })
  const values = createdValues()
  expect(values).toMatchObject({ pricelist_id: 18, currency_id: 42 })
  expect(values.order_line.map((command: [number, number, { price_unit: number }]) => command[2].price_unit))
    .toEqual([200, 40, -11.5, 20])
})

it('posts the fully settled Salla payment in the saved journal', async () => {
  configure({
    ...settings,
    payment_sync_enabled: true,
    payment_journal_mappings: [{ zid_payment_method: 'credit_card', odoo_journal_id: 21 }],
  })
  expect(await dispatch({
    ...details, payment_method: 'credit_card',
    payment_actions: { refund_action: { paid_amount: money(230) } },
    amounts: { ...details.amounts, total: money(230) },
    items: [{ ...item, price: money(115) }],
  })).toMatchObject({ success: 1 })
  expect(mockOdoo.create).toHaveBeenCalledWith('account.payment', expect.objectContaining({
    amount: 230, journal_id: 21, currency_id: 40, partner_id: 11, memo: 'Salla Order #S00501',
  }))
  expect(mockOdoo.execute).toHaveBeenCalledWith('account.payment', 'action_post', [[701]])
})

it('waits for the full Salla payment before creating an Odoo payment', async () => {
  configure({
    ...settings,
    payment_sync_enabled: true,
    payment_journal_mappings: [{ zid_payment_method: 'credit_card', odoo_journal_id: 21 }],
  })
  expect(await dispatch({
    ...details, payment_method: 'credit_card',
    payment_actions: { refund_action: { paid_amount: money(30) } },
    amounts: { ...details.amounts, total: money(230) },
    items: [pricedItem],
  })).toMatchObject({ success: 1 })
  expect(mockOdoo.create.mock.calls.map(([model]) => model)).toEqual(['sale.order'])
})

it('reads Salla net unit prices, order discounts and the actual COD fee', async () => {
  configure()
  expect(await dispatch({ ...details, items: [pricedItem] })).toMatchObject({ success: 1 })
  const lines = createdValues().order_line.map((command: [number, number, Record<string, unknown>]) => command[2])
  expect(lines).toEqual([
    expect.objectContaining({ product_id: 12, price_unit: 100 }),
    expect.objectContaining({ product_id: 13, price_unit: 20 }),
    expect.objectContaining({ product_id: 15, price_unit: -5.75 }),
    expect.objectContaining({ product_id: 14, price_unit: 10 }),
  ])
})

it('applies the configured percentage discount without duplicating the item discount', async () => {
  configure({ ...settings, discount_mode: 'percent' })
  expect(await dispatch({
    ...details,
    amounts: { ...details.amounts, discounts: [{ discount: '20' }] },
    items: [{ ...pricedItem, amounts: { ...pricedItem.amounts, total_discount: money(10) } }],
  })).toMatchObject({ success: 1 })
  expect(createdValues().order_line[0][2]).toMatchObject({ price_unit: 100, discount: 10 })
  expect(createdValues().order_line).toHaveLength(3)
})

it.each([{}, { items: [item] }])('hydrates a thin event through the separate order items endpoint', async (partial) => {
  configure()
  jest.mocked(getSallaOrder).mockResolvedValue(details)
  jest.mocked(getSallaOrderItems).mockResolvedValue([pricedItem])
  expect(await dispatch({ id: details.id, reference_id: details.reference_id, ...partial })).toMatchObject({ success: 1 })
  expect(getSallaOrder).toHaveBeenCalledWith(store, String(details.id))
  expect(getSallaOrderItems).toHaveBeenCalledWith(store, String(details.id))
  expect(createdValues().order_line[0][2]).toMatchObject({ price_unit: 100, product_uom_qty: 2 })
})

it('keeps the explicit zero COD fee and the price of a free item', async () => {
  configure()
  expect(await dispatch({
    ...details,
    amounts: { ...details.amounts, cash_on_delivery: money(0), discounts: [] },
    items: [{ ...pricedItem, amounts: { price_without_tax: money(0) } }],
  })).toMatchObject({ success: 1 })
  expect(createdValues().order_line).toEqual([
    [0, 0, expect.objectContaining({ product_id: 12, price_unit: 0 })],
    [0, 0, expect.objectContaining({ product_id: 13, price_unit: 20 })],
  ])
})

it('fails a thin delivery when Salla returns no priced items', async () => {
  configure()
  jest.mocked(getSallaOrder).mockResolvedValue(details)
  jest.mocked(getSallaOrderItems).mockResolvedValue([item])
  await expect(dispatch({ id: details.id })).rejects.toThrow('Salla order items could not be retrieved with valid prices')
  expect(mockOdoo.create).not.toHaveBeenCalled()
})

it('reports an Odoo rejection without dropping the selected pricelist', async () => {
  configure()
  mockOdoo.create.mockRejectedValueOnce(new Error('Incompatible companies on records (pricelist_id: 18)'))
  expect(await dispatch({ ...details, items: [pricedItem] })).toMatchObject({ failed: 1, records: [
    expect.objectContaining({ message: expect.stringContaining('Incompatible companies') }),
  ] })
  expect(mockOdoo.create).toHaveBeenCalledTimes(1)
  expect(mockOdoo.create.mock.calls[0][1]).toHaveProperty('pricelist_id', 18)
})

it('confirms and creates a draft invoice when the saved automation is enabled', async () => {
  configure({ ...settings, order: { ...settings.order, auto_confirm: true, auto_invoice: true } })
  expect(await dispatch({ ...details, items: [{ ...item, price: money(115) }] })).toMatchObject({ success: 1 })
  expect(createdValues()).not.toHaveProperty('state')
  expect(mockOdoo.execute).toHaveBeenCalledWith('sale.order', 'action_confirm', [501])
  expect(mockOdoo.execute).toHaveBeenCalledWith('sale.advance.payment.inv', 'create_invoices', [[602]], expect.any(Object))
  expect(invoiceIds).toEqual([601])
})

it('reports failed confirmation and resumes on the already linked order on retry', async () => {
  configure({ ...settings, order: { ...settings.order, auto_confirm: true } })
  const execute = mockOdoo.execute.getMockImplementation()!
  mockOdoo.execute.mockImplementation(async (model, method, ...args) => {
    if (model === 'sale.order' && method === 'action_confirm') throw new Error('Confirmation rejected')
    return execute(model, method, ...args)
  })
  expect(await dispatch({ ...details, items: [pricedItem] })).toMatchObject({ failed: 1, records: [
    expect.objectContaining({ message: expect.stringContaining('confirmation did not complete') }),
  ] })
  supabase.addMock('odoo_entity_links', [{
    workspace_id: workspace, platform: 'salla', store_id: store, erp_connection_id: erp.id,
    connection_generation: connectionGeneration(erp), store_entity_id: String(details.id),
    odoo_model: 'sale.order', odoo_record_id: 501,
  }])
  mockOdoo.execute.mockImplementation(execute)
  expect(await dispatch({ ...details, items: [pricedItem] })).toMatchObject({ success: 1 })
  expect(orderState).toBe('sale')
  expect(mockOdoo.create).toHaveBeenCalledTimes(1)
})

it('admits Salla money objects at the webhook guard and rejects invalid nested prices', () => {
  expect(validateOrderLines([pricedItem, { ...item, price: money(0) }], 'salla').ok).toBe(true)
  expect(validateOrderLines([{ ...item, amounts: { price_without_tax: money(-1) } }], 'salla').ok).toBe(false)
})
