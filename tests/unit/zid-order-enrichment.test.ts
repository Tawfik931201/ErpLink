import { readFileSync } from 'fs'
import { join } from 'path'

import { isOrderPaid } from '@/lib/odoo/order-payment'
import { clearOrderDetailCache, getCachedOrderDetails, setCachedOrderDetails } from '@/lib/store-pull-budget'
import { assertZidOrderDetails, canReuseZidOrderDetails, mergeZidOrderDetails, resolveZidOrderTokenScope, zidOrderCacheScope } from '@/lib/zid/order-enrichment'

import { supabase } from '../mocks/supabase'

describe('Zid order enrichment isolation and freshness', () => {
  beforeEach(() => {
    supabase.reset()
    clearOrderDetailCache()
  })

  it('prefers the actual store to a colliding merchant id', async () => {
    supabase.addMock('merchant_tokens', [
      { merchant_id: '10', store_id: '20', workspace_id: 'other' },
      { merchant_id: '30', store_id: '10', workspace_id: 'owner' },
    ])
    await expect(resolveZidOrderTokenScope('10', 'owner')).resolves.toEqual({
      merchant_id: '30', store_id: '10', workspace_id: 'owner',
    })
    expect(supabase.calls).toHaveLength(1)
    expect(supabase.calls[0].args).toEqual(['merchant_id,store_id,workspace_id'])
    expect(supabase.calls[0].filters).toEqual([['store_id', '10']])
  })

  it('fails closed after a store moves workspaces, even if its id matches our merchant', async () => {
    supabase.addMock('merchant_tokens', [
      { merchant_id: '10', store_id: '20', workspace_id: 'old' },
      { merchant_id: '30', store_id: '10', workspace_id: 'new' },
    ])
    await expect(resolveZidOrderTokenScope('10', 'old')).rejects.toThrow('no longer linked')
    expect(supabase.calls).toHaveLength(1)
  })

  it('scopes the legacy merchant-id fallback to the delivery workspace', async () => {
    supabase.addMock('merchant_tokens', [
      { merchant_id: '10', store_id: '20', workspace_id: 'owner' },
    ])
    await expect(resolveZidOrderTokenScope('10', 'other')).resolves.toBeNull()
    expect(supabase.calls[1].filters).toEqual([['merchant_id', '10'], ['workspace_id', 'other']])
    await expect(resolveZidOrderTokenScope('10', 'owner')).resolves.toMatchObject({ store_id: '20' })
  })

  it('does not fall back after a database error or read without a trusted workspace', async () => {
    supabase.setMockResponder(() => ({ data: null, error: new Error('database unavailable') }))
    await expect(resolveZidOrderTokenScope('10', 'owner')).rejects.toThrow('database unavailable')
    expect(supabase.calls).toHaveLength(1)
    await expect(resolveZidOrderTokenScope('10', '')).rejects.toThrow('requires a workspace')
    expect(supabase.calls).toHaveLength(1)
  })

  it('keeps the same order id separate across stores, workspaces and platforms', () => {
    const order = { id: 7, products: [{ id: 'sku-1' }] }
    const key = zidOrderCacheScope('ws-1', 'store-1')
    setCachedOrderDetails('zid', key, '7', order)
    expect(getCachedOrderDetails('zid', key, '7')).toEqual(order)
    expect(getCachedOrderDetails('zid', zidOrderCacheScope('ws-1', 'store-2'), '7')).toBeNull()
    expect(getCachedOrderDetails('zid', zidOrderCacheScope('ws-2', 'store-1'), '7')).toBeNull()
    expect(getCachedOrderDetails('salla', key, '7')).toBeNull()
  })

  it.each(['order.update', 'order.status.update', 'order.payment_status.update', 'order.cancelled', 'order.delivered'])(
    '%s reads current details rather than replaying cached lines/payment/status', event => {
      expect(canReuseZidOrderDetails(event, false)).toBe(false)
    },
  )

  it('reuses signed creation details for retry but always reads legacy deliveries afresh', () => {
    expect(canReuseZidOrderDetails('order.create', false)).toBe(true)
    expect(canReuseZidOrderDetails('order.created', false)).toBe(true)
    expect(canReuseZidOrderDetails('order.create', true)).toBe(false)
  })

  it('rejects successful HTTP responses that lack lines or belong to another order', () => {
    expect(() => assertZidOrderDetails({ id: 7, products: [] }, '7')).toThrow('no line items')
    expect(() => assertZidOrderDetails({ id: 7 }, '7')).toThrow('no line items')
    expect(() => assertZidOrderDetails({ id: 8, products: [{ sku: 'x' }] }, '7')).toThrow('different order')
    expect(() => assertZidOrderDetails({ id: 7, products: [{ sku: 'x' }] }, '7')).not.toThrow()
  })

  it('uses current payment state, totals and lines over an older signed webhook', () => {
    const payload = {
      id: 7, payment_status: 'paid', financial_status: 'paid', payment_status_name: 'paid',
      payment: { status: 'paid', invoice: [{ code: 'total', value: 100 }] },
      order: { payment_status: 'paid', payment: { status: 'paid' } },
      products: [{ sku: 'old', quantity: 1 }], items: [{ sku: 'old-alias' }],
      order_total: 100, event_only_field: 'keep', __returnRemaining: 3,
    }
    const snapshot = {
      id: 7, payment_status: 'pending',
      payment: { status: 'pending', invoice: [{ code: 'total', value: 50 }] },
      products: [{ sku: 'current', quantity: 2 }], order_total: 50,
    }
    const merged = mergeZidOrderDetails(payload, snapshot, false)
    expect(merged.payment_status).toBe('pending')
    expect(isOrderPaid(merged)).toBe(false)
    expect(merged.products).toEqual(snapshot.products)
    expect(merged.items).toBeUndefined()
    expect(merged.order_total).toBe(50)
    expect(merged.payment).toEqual(snapshot.payment)
    expect(merged.event_only_field).toBe('keep')
    expect(merged.__returnRemaining).toBe(3)
    expect(payload.order.payment_status).toBe('paid')
  })

  it('also removes stale nested payment aliases when the API exposes only top-level payment_status', () => {
    const merged = mergeZidOrderDetails({
      payment: { status: 'paid', payment_status: 'paid', method: { code: 'cod' } },
      order: { payment: { status: 'paid' }, payment_status: 'paid' },
    }, { payment_status: 'pending' }, false)
    expect(isOrderPaid(merged)).toBe(false)
    expect(merged.payment).toEqual({ method: { code: 'cod' } })
  })

  it('uses the current paid snapshot when a signed webhook still says pending', () => {
    const merged = mergeZidOrderDetails({ payment_status: 'pending' }, { payment_status: 'paid' }, false)
    expect(isOrderPaid(merged)).toBe(true)
  })

  it('does not retain body-only fields or event flags from a legacy delivery', () => {
    const snapshot = { id: 7, payment_status: 'pending', products: [{ sku: 'current' }] }
    expect(mergeZidOrderDetails({ __returnRemaining: 99, event_only_field: 'untrusted' }, snapshot, true)).toEqual(snapshot)
  })

  it('wires the policies before caching/merging and rereads unsigned full payloads', () => {
    const part = readFileSync(join(__dirname, '../../src/lib/zid/orders.ts'), 'utf8')
    expect(part).toContain('if (!orderId || isLegacyDelivery || !hasOrderItems || !isOrderCreationEvent(normalizedEvent))')
    expect(part).toContain("if (!orderId) throw new Error('Zid order event is missing its order id')")
    expect(part).toContain('resolveZidOrderTokenScope(storeIdStr, resolvedWorkspaceId')
    expect(part).toContain('canReuseZidOrderDetails(normalizedEvent, isLegacyDelivery)')
    expect(part).toContain('...mergeZidOrderDetails(data, orderData, isLegacyDelivery)')
    expect(part).not.toContain('.or(`store_id.eq.')
    expect(part.indexOf('assertZidOrderDetails(orderData, orderIdStr)')).toBeLessThan(part.indexOf("setCachedOrderDetails('zid'"))
  })
})
