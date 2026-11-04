import fs from 'fs'
import path from 'path'

const mockAuth = jest.fn()

jest.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

jest.mock('../../src/lib/users', () => ({
  getOrCreateDbUser: jest.fn(async (userId: string) => ({
    id: userId,
    active_workspace_id: 'ws-1',
  })),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  unstable_cache: (fn: unknown) => fn,
}))

import { getOrderStatusMappings, saveOrderStatusMappings } from '@/app/actions/order-status-mappings'
import { ttlCache } from '@/lib/ttl-cache'

import { supabase } from '../mocks/supabase'

type StatusMappings = Record<string, { state: string; enabled: boolean; invoice_action?: string; picking_action?: string }>

function readStripped(relativePath: string): string {
  const raw = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('Order Status Mapping Table — Stock Picking & Invoice Actions', () => {
  beforeEach(() => {
    supabase.reset()
    mockAuth.mockReset()
    mockAuth.mockResolvedValue({ userId: 'user-1' })
  })

  it('saves picking_action and invoice_action in order_status_mappings', async () => {
    const res = await saveOrderStatusMappings(
      'zid',
      {
        indelivery: {
          state: 'sale',
          enabled: true,
          picking_action: 'create',
          invoice_action: 'create',
        },
        delivered: {
          state: 'done',
          enabled: true,
          picking_action: 'create_and_validate',
          invoice_action: 'create_and_post',
        },
        canceled: {
          state: 'cancel',
          enabled: true,
          picking_action: 'cancel',
          invoice_action: 'cancel',
        },
      },
      'store-1'
    )

    expect(res.success).toBe(true)

    // Inspect the upsert call recorded in mock
    const upsertCall = supabase.calls.find(
      c => c.table === 'order_status_mappings' && c.op === 'upsert'
    )
    expect(upsertCall).toBeDefined()
    const rows = upsertCall?.args?.[0] as Array<Record<string, unknown>>
    expect(rows).toBeDefined()
    expect(rows.length).toBe(3)

    const deliveredRow = rows.find(r => r.zid_status === 'delivered')
    expect(deliveredRow).toBeDefined()
    expect(deliveredRow?.odoo_state).toBe('done')
    expect(deliveredRow?.picking_action).toBe('create_and_validate')
    expect(deliveredRow?.invoice_action).toBe('create_and_post')

    const canceledRow = rows.find(r => r.zid_status === 'canceled')
    expect(canceledRow).toBeDefined()
    expect(canceledRow?.odoo_state).toBe('cancel')
    expect(canceledRow?.picking_action).toBe('cancel')
    expect(canceledRow?.invoice_action).toBe('cancel')
  })

  it('fetches order status mappings with picking_action and invoice_action', async () => {
    const res = await getOrderStatusMappings('zid', 'store-1')
    expect(res.success).toBe(true)
    expect(typeof res.mappings).toBe('object')
  })

  it('preserves inherited order settings when first saving store-specific statuses and invalidates engine reads', async () => {
    supabase.addMock('standard_mapping_settings', [{
      workspace_id: 'ws-1', store_type: 'zid', entity_type: 'orders', store_id: '',
      settings: { match_odoo_field: 'client_order_ref', order: { company_id: 7, currency_id: 2 } },
    }])
    ttlCache.set('eng:stdsets:ws-1:zid:store-1:orders', { stale: true }, 30_000)
    const res = await saveOrderStatusMappings('zid', { delivered: 'sale' }, 'store-1')
    expect(res.success).toBe(true)
    const jsonWrite = supabase.calls.find(c => c.table === 'standard_mapping_settings' && c.op === 'upsert')!
    expect(jsonWrite.args[0]).toMatchObject({
      workspace_id: 'ws-1', store_id: 'store-1',
      settings: { match_odoo_field: 'client_order_ref', order: { company_id: 7, currency_id: 2, status_actions: { delivered: 'sale' } } },
    })
    expect(await ttlCache.get('eng:stdsets:ws-1:zid:store-1:orders', 30_000, async () => 'fresh')).toBe('fresh')
  })

  it('does not resurrect cleared invoice and picking actions from stale JSON', async () => {
    supabase.addMock('order_status_mappings', [{
      workspace_id: 'ws-1', platform: 'zid', store_id: 'store-1', zid_status: 'delivered',
      odoo_state: 'sale', enabled: true, invoice_action: null, picking_action: null,
    }])
    supabase.addMock('standard_mapping_settings', [{
      workspace_id: 'ws-1', store_type: 'zid', entity_type: 'orders', store_id: 'store-1',
      settings: { order: { status_actions: { delivered: { state: 'sale', invoice_action: 'create_and_post', picking_action: 'create_and_validate' } } } },
    }])
    const res = await getOrderStatusMappings('zid', 'store-1')
    expect((res.mappings as StatusMappings).delivered).toEqual({ state: 'sale', enabled: true, invoice_action: '', picking_action: '' })
  })

  it('selects store JSON over defaults regardless of database row order', async () => {
    for (const reverse of [false, true]) {
      const rows = [
        { store_id: '', settings: { order: { status_actions: { delivered: { state: 'done', invoice_action: 'create_and_post' } } } } },
        { store_id: 'store-1', settings: { order: { status_actions: { delivered: { state: 'sale', invoice_action: '' } } } } },
      ].map(row => ({ ...row, workspace_id: 'ws-1', store_type: 'zid', entity_type: 'orders' }))
      supabase.addMock('standard_mapping_settings', reverse ? rows.reverse() : rows)
      const res = await getOrderStatusMappings('zid', 'store-1')
      const mappings = res.mappings as StatusMappings
      expect(mappings.delivered.state).toBe('sale')
      expect(mappings.delivered.invoice_action).toBe('')
    }
  })

  it('stops before writing when the current status mapping read fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    supabase.setMockResponder((table, op) => table === 'order_status_mappings' && op === 'select'
      ? { data: null, error: { message: 'Read failed' } } : undefined)
    expect((await saveOrderStatusMappings('zid', { delivered: 'sale' }, 'store-1')).success).toBe(false)
    expect(supabase.calls.some(c => c.op === 'upsert' || c.op === 'delete')).toBe(false)
    errorSpy.mockRestore()
  })

  it('keeps JSON invoice actions available when legacy table columns are absent', async () => {
    let statusReads = 0
    supabase.setMockResponder((table, op) => {
      if (table !== 'order_status_mappings' || op !== 'select') return undefined
      statusReads++
      return statusReads === 1
        ? { data: null, error: { code: '42703', message: 'invoice_action column missing' } }
        : { data: [{ zid_status: 'delivered', odoo_state: 'sale', enabled: true, store_id: 'store-1' }], error: null }
    })
    supabase.addMock('standard_mapping_settings', [{
      workspace_id: 'ws-1', store_type: 'zid', entity_type: 'orders', store_id: 'store-1',
      settings: { order: { status_actions: { delivered: { state: 'sale', invoice_action: 'create_and_post', picking_action: 'validate' } } } },
    }])
    const result = await getOrderStatusMappings('zid', 'store-1')
    expect((result.mappings as StatusMappings).delivered).toEqual({
      state: 'sale', enabled: true, invoice_action: 'create_and_post', picking_action: 'validate',
    })
  })

  it('proves the 3 obsolete options were removed from order settings UI', () => {
    const tabSource = readStripped(
      'src/app/(app)/app/mapping-center/standard-components/order-settings-tab.tsx'
    )

    // "تأكيد الطلب تلقائياً في أودو"
    expect(tabSource).not.toContain('تأكيد الطلب تلقائياً في أودو')
    expect(tabSource).not.toContain('Auto Confirm Order')

    // "إنشاء الفاتورة تلقائياً"
    expect(tabSource).not.toContain('إنشاء الفاتورة تلقائياً')
    expect(tabSource).not.toContain('Auto Create Invoice')

    // "تفعيل التنفيذ والشحن الجزئي"
    expect(tabSource).not.toContain('تفعيل التنفيذ والشحن الجزئي')
    expect(tabSource).not.toContain('Enable Partial Fulfillment')
  })

  it('proves the Order Status Mapping table includes stock picking and invoice columns', () => {
    const tabSource = readStripped(
      'src/app/(app)/app/mapping-center/standard-components/order-settings-tab.tsx'
    )

    // Table headers
    expect(tabSource).toContain('إذن المخزن (الشحن والتسليم)')
    expect(tabSource).toContain('Stock Picking')
    expect(tabSource).toContain('الفاتورة')
    expect(tabSource).toContain('Invoice')

    // Picking action options
    expect(tabSource).toContain('create_and_validate')
    expect(tabSource).toContain('إنشاء وتصديق إذن الصرف')
    expect(tabSource).toContain('تصديق إذن الصرف فقط')
    expect(tabSource).toContain('إلغاء إذن الصرف')

    // Invoice action options
    expect(tabSource).toContain('create_and_post')
    expect(tabSource).toContain('إنشاء وتأكيد الفاتورة')
    expect(tabSource).toContain('تأكيد/ترحيل الفاتورة فقط')
    expect(tabSource).toContain('إلغاء الفاتورة')
  })
})
