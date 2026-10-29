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

import { supabase } from '../mocks/supabase'

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
