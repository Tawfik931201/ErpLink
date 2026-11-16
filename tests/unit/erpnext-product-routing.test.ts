import { connectionGeneration } from '../../src/lib/erp-execution-target'
import { OdooClient } from '../../src/lib/odoo-client'
import { processWebhookEvent } from '../../src/lib/sync-engine'
import { ZidAPI } from '../../src/lib/zid-client'
import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/sync-runtime', () => ({
  supabaseAdmin: jest.requireActual('../mocks/supabase').supabase,
  logSync: jest.fn(),
}))
jest.mock('../../src/lib/crypto', () => ({ decrypt: () => 'fixture-secret' }))
jest.mock('../../src/lib/odoo-client', () => ({ OdooClient: jest.fn() }))
jest.mock('../../src/lib/telegram-notifier', () => ({ notifySyncResult: jest.fn().mockResolvedValue(undefined) }))
jest.mock('../../src/lib/zid/token', () => ({ getAccessToken: jest.fn().mockResolvedValue({ accessToken: 'fixture-token' }) }))
jest.mock('../../src/lib/zid-client', () => ({ ZidAPI: { products: { get: jest.fn() } } }))

const workspace = 'erpnext-products'
const store = 'fixture-zid'
const connection = {
  id: 'erpnext-fixture', workspace_id: workspace, erp_type: 'erpnext',
  url: 'https://erpnext.invalid', db_name: '', username: 'fixture-user', password: 'encrypted-fixture',
}
const target = { erpConnectionId: connection.id, connectionGeneration: connectionGeneration(connection) }
const sku = 'SKU 123'
const sourceId = 'zid-123'

beforeEach(() => {
  jest.clearAllMocks()
  supabase.reset()
  supabase.addMock('merchant_tokens', [{ workspace_id: workspace, merchant_id: store, store_id: store }])
  supabase.addMock('erp_connections', [connection])
  supabase.addMock('erp_workspace_bindings', [{ ...connection, erp_connection_id: connection.id }])
  supabase.addMock('field_mappings', ['create', 'update'].map(operation => ({
    id: `erpnext-item-${operation}`, name: `ERPNext Item ${operation}`, workspace_id: workspace,
    store_id: store, merchant_id: store, erp_connection_id: connection.id,
    action: `product.${operation}`, odoo_model: 'Item', odoo_match_field: 'item_code', zid_match_field: 'sku',
    mappings: { Item: [
      { id: 'item-name', erpField: 'item_name', zidField: 'name.en' },
      { id: 'item-code', erpField: 'item_code', zidField: 'sku' },
    ] },
  })))
  supabase.setMockResponder((table, op) => table === 'erp_effects' && op === 'select'
    ? { data: { id: 'reservation' }, error: null }
    : undefined)
})

afterEach(() => jest.restoreAllMocks())

it('enriches a Zid product and creates then updates the same ERPNext Item over REST', async () => {
  const get = jest.mocked(ZidAPI.products.get)
  const snapshot = (name: string) => ({ data: {
    product: { id: sourceId, sku, name: { ar: name, en: name } },
  } }) as unknown as Awaited<ReturnType<typeof get>>
  get.mockResolvedValueOnce(snapshot('Initial name')).mockResolvedValueOnce(snapshot('Updated name'))

  const writes: { method: string; path: string; body: Record<string, unknown> }[] = []
  const filters: unknown[] = []
  const fetch = jest.spyOn(global, 'fetch').mockImplementation(async (input, options) => {
    const url = new URL(String(input))
    expect(url.origin).toBe(connection.url)
    expect(new Headers(options?.headers).get('authorization')).toBe('token fixture-user:fixture-secret')
    if (url.pathname === '/api/resource/DocType/Item') {
      return Response.json({ data: { fields: [
        { fieldname: 'item_name', fieldtype: 'Data' }, { fieldname: 'item_code', fieldtype: 'Data' },
      ] } })
    }
    if (options?.method === 'GET' && url.pathname === '/api/resource/Item') {
      filters.push(JSON.parse(url.searchParams.get('filters')!))
      return Response.json({ data: writes.length ? [{ name: sku }] : [] })
    }
    if (options?.method === 'POST' || options?.method === 'PUT') {
      writes.push({ method: options.method, path: url.pathname, body: JSON.parse(String(options.body)) })
      return Response.json({ data: { name: sku } })
    }
    throw new Error(`Unexpected fixture request ${options?.method} ${url.pathname}`)
  })

  await expect(processWebhookEvent('product.create', store, { id: sourceId }, 'zid', true, workspace, 'create-item', target))
    .resolves.toMatchObject({ processed: 1, success: 1, failed: 0 })
  await expect(processWebhookEvent('product.update', store, { id: sourceId }, 'zid', true, workspace, 'update-item', target))
    .resolves.toMatchObject({ processed: 1, success: 1, failed: 0 })

  expect(get).toHaveBeenCalledTimes(2)
  expect(OdooClient).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalled()
  expect(filters).toContainEqual([['item_code', '=', sku]])
  expect(writes).toEqual([
    { method: 'POST', path: '/api/resource/Item', body: {
      item_name: 'Initial name', item_code: sku, item_group: 'All Item Groups', stock_uom: 'Nos',
    } },
    { method: 'PUT', path: '/api/resource/Item/SKU%20123', body: { item_name: 'Updated name', item_code: sku } },
  ])
  expect(supabase.calls.filter(call => call.table === 'erp_effects' && call.op === 'insert')).toHaveLength(1)
})
