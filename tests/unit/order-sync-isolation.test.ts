import { createOrderInvoice } from '@/lib/odoo/order-invoice'
import type { OdooClient } from '@/lib/odoo-client'
import { applyOrderStatusAction, buildOrderLineItems, getOrderStatusRow } from '@/lib/sync-engine'
import type { FieldMappingRow } from '@/lib/sync-types'
import { ttlCache } from '@/lib/ttl-cache'

import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/sync-runtime', () => ({
  supabaseAdmin: jest.requireActual('../mocks/supabase').supabase,
  logSync: jest.fn(),
}))

const mockSettings = jest.fn()
jest.mock('../../src/lib/mapping-settings', () => ({
  ...jest.requireActual('../../src/lib/mapping-settings'),
  getEffectiveStandardMappingSettings: (...args: unknown[]) => mockSettings(...args),
}))

describe('Order execution isolation', () => {
  beforeEach(() => {
    supabase.reset()
    ttlCache.clear('eng:stdsets:')
    mockSettings.mockReset().mockResolvedValue(null)
  })

  it('keeps explicitly cleared invoice/picking actions authoritative over stale JSON', async () => {
    supabase.addMock('order_status_mappings', [{
      workspace_id: 'ws', platform: 'zid', zid_status: 'delivered', store_id: 'store',
      odoo_state: 'sale', enabled: true, invoice_action: '', picking_action: '',
    }])
    mockSettings.mockResolvedValue({ status_actions: { delivered: {
      state: 'done', invoice_action: 'create_and_post', picking_action: 'create_and_validate',
    } } })
    expect(await getOrderStatusRow('ws', 'delivered', 'zid', 'store')).toEqual({
      odoo_state: 'sale', enabled: true, invoice_action: '', picking_action: '',
    })
    expect(mockSettings).not.toHaveBeenCalled()
  })

  it('does not borrow another store status when only workspace defaults were requested', async () => {
    supabase.addMock('order_status_mappings', [{
      workspace_id: 'ws', platform: 'zid', zid_status: 'delivered', store_id: 'other',
      odoo_state: 'done', enabled: true, invoice_action: 'create_and_post',
    }])
    expect(await getOrderStatusRow('ws', 'delivered', 'zid')).toBeNull()
  })

  it('resolves numeric Zid store ids to the workspace merchant key used by status settings', async () => {
    supabase.addMock('merchant_tokens', [{ workspace_id: 'ws', store_id: '123', merchant_id: 'merchant' }])
    supabase.addMock('order_status_mappings', [{
      workspace_id: 'ws', platform: 'zid', zid_status: 'delivered', store_id: 'merchant',
      odoo_state: 'sale', enabled: false,
    }])
    expect(await getOrderStatusRow('ws', 'delivered', 'zid', '123')).toEqual({
      odoo_state: 'sale', enabled: false, invoice_action: '', picking_action: '',
    })
    const tokenReads = supabase.calls.filter(c => c.table === 'merchant_tokens')
    expect(tokenReads).toHaveLength(1)
    expect(tokenReads[0].filters).toContainEqual(['workspace_id', 'ws'])
  })

  it('does not share product lookup results across clients on the same Odoo database', async () => {
    const clientFor = (productId: number) => ({
      url: 'https://shared.odoo.test', db: 'shared',
      execute: jest.fn(async (model: string) => model === 'ir.model.fields' ? [
        { name: 'product_id', ttype: 'many2one', relation: 'product.product' },
        { name: 'tax_id', ttype: 'many2many' },
      ] : [productId]),
      searchRead: jest.fn(async () => []),
    } as unknown as OdooClient)
    const mapping = { id: 'm', workspace_id: 'ws', mappings: {} } as FieldMappingRow
    const payload = { products: [{ sku: 'SHARED-SKU', name: 'Item', price: 10, quantity: 1 }] }
    const a = clientFor(11)
    const b = clientFor(22)
    const build = (client: OdooClient) => buildOrderLineItems(client, mapping, payload, new Map(), {}, 'zid', {}, 'store', 'order.create')
    expect((await build(a))[0].product_id).toBe(11)
    expect((await build(b))[0].product_id).toBe(22)
    const productCalls = () => (a.execute as jest.Mock).mock.calls.filter(c => c[0] === 'product.product').length
    const count = productCalls()
    await build(a)
    expect(productCalls()).toBe(count)
  })
})

describe('Odoo public order invoice wizard', () => {
  it.each([14, 15, 16, 17])('uses public wizard with active order context on Odoo %i', async () => {
    const execute = jest.fn().mockResolvedValueOnce(81).mockResolvedValueOnce({ type: 'ir.actions.act_window_close' })
    await createOrderInvoice({ execute } as unknown as OdooClient, 42)
    const context = { active_model: 'sale.order', active_id: 42, active_ids: [42] }
    expect(execute.mock.calls).toEqual([
      ['sale.advance.payment.inv', 'create', [{ advance_payment_method: 'delivered' }], { context }],
      ['sale.advance.payment.inv', 'create_invoices', [[81]], { context }],
    ])
  })

  it('propagates wizard failure without retrying private methods or creating another wizard', async () => {
    const execute = jest.fn().mockResolvedValueOnce(81).mockRejectedValueOnce(new Error('No invoiceable lines'))
    await expect(createOrderInvoice({ execute } as unknown as OdooClient, 42)).rejects.toThrow('No invoiceable lines')
    expect(execute).toHaveBeenCalledTimes(2)
  })
})

describe('Odoo order workflow compatibility', () => {
  it.each([14, 15, 16, 17])('locks a confirmed order using the workflow supported by Odoo %i', async (major) => {
    const execute = jest.fn().mockResolvedValue(true)
    const client = {
      searchRead: jest.fn().mockResolvedValue([{ state: 'sale' }]),
      getMajorVersion: jest.fn().mockResolvedValue(major), execute,
    } as unknown as OdooClient
    await applyOrderStatusAction(client, 42, 'done', 'delivered')
    expect(execute).toHaveBeenCalledWith('sale.order', major >= 17 ? 'action_lock' : 'action_done', [[42]])
  })

  it('cancels through the workflow without returning an unattended UI wizard', async () => {
    const execute = jest.fn().mockResolvedValue(true)
    const client = { searchRead: jest.fn().mockResolvedValue([{ state: 'sale' }]), execute } as unknown as OdooClient
    await applyOrderStatusAction(client, 42, 'cancel', 'canceled')
    expect(execute).toHaveBeenCalledWith('sale.order', 'action_cancel', [[42]], { context: { disable_cancel_warning: true } })
  })

  it('does not bypass a cancellation business-rule failure by writing state directly', async () => {
    const write = jest.fn()
    const client = {
      searchRead: jest.fn().mockResolvedValue([{ state: 'sale' }]),
      execute: jest.fn().mockRejectedValue(new Error('Delivered order cannot be cancelled')),
      write,
    } as unknown as OdooClient
    await applyOrderStatusAction(client, 42, 'cancel', 'canceled')
    expect(write).not.toHaveBeenCalled()
  })
})
