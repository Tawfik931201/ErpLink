import { buildHumanNotification } from '@/lib/app-notifications'

describe('human-friendly notification formatting', () => {
  it('formats new order arrival concisely without technical jargon', () => {
    const formatted = buildHumanNotification({
      workspaceId: 'ws-1',
      platform: 'zid',
      event: 'order.create',
      eventKey: 'arrival:1',
      status: 'received',
      payload: {
        id: 502395016,
        order_number: '502395016',
        customer: { name: 'عبد الله محمد' },
        order_total: '250',
        currency: 'SAR',
      },
    })
    expect(formatted.title).toBe('🛒 طلب جديد #502395016')
    expect(formatted.body).toContain('وصل طلب جديد من زد')
    expect(formatted.body).toContain('العميل: عبد الله محمد')
    expect(formatted.body).toContain('المبلغ: 250 ر.س')
    expect(formatted.body).not.toContain('order.create')
  })

  it('formats successful order registration in Odoo with clear business details', () => {
    const formatted = buildHumanNotification({
      workspaceId: 'ws-1',
      platform: 'zid',
      event: 'order.create',
      eventKey: 'result:1',
      status: 'success',
      odooRecordId: 112,
      details: {
        orderNumber: '502395016',
        customerName: 'عبد الله محمد',
        totalAmount: '250',
        currency: 'SAR',
      },
    })
    expect(formatted.title).toBe('✅ تم تسجيل الطلب #502395016 في أودو')
    expect(formatted.body).toContain('رقم أودو: #112')
    expect(formatted.body).toContain('رقم زد: #502395016')
    expect(formatted.body).toContain('العميل: عبد الله محمد')
    expect(formatted.body).toContain('الإجمالي: 250 ر.س')
    expect(formatted.body).not.toContain('order.create')
  })

  it('formats failed order sync clearly with reason and order number', () => {
    const formatted = buildHumanNotification({
      workspaceId: 'ws-1',
      platform: 'salla',
      event: 'order.created',
      eventKey: 'result:2',
      status: 'failed',
      details: {
        orderNumber: '998877',
      },
      errorMessage: 'العميل غير موجود في أودو',
    })
    expect(formatted.title).toBe('⚠️ تعذر تسجيل الطلب #998877 في أودو')
    expect(formatted.body).toContain('الطلب: #998877')
    expect(formatted.body).toContain('العميل غير موجود في أودو')
  })

  it('formats new product addition with Odoo ID, store ID, and SKU', () => {
    const formatted = buildHumanNotification({
      workspaceId: 'ws-1',
      platform: 'zid',
      event: 'product.create',
      eventKey: 'result:3',
      status: 'success',
      odooRecordId: 178,
      details: {
        productName: 'عطر المسك الأبيض',
        productSku: 'SKU-001',
        orderNumber: '50104',
      },
    })
    expect(formatted.title).toBe('🏷️ تم إضافة منتج جديد في أودو')
    expect(formatted.body).toContain('عطر المسك الأبيض')
    expect(formatted.body).toContain('رقم أودو: #178')
    expect(formatted.body).toContain('رقم زد: #50104')
    expect(formatted.body).toContain('كود (SKU): SKU-001')
    expect(formatted.body).not.toContain('product.create')
  })

  it('formats product update in Odoo correctly', () => {
    const formatted = buildHumanNotification({
      workspaceId: 'ws-1',
      platform: 'shopify',
      event: 'products/update',
      eventKey: 'result:4',
      status: 'success',
      odooRecordId: 53,
      details: {
        productName: 'حقيبة جلدية',
        productSku: 'BAG-100',
        orderNumber: '15518337',
      },
    })
    expect(formatted.title).toBe('🏷️ تم تحديث المنتج في أودو')
    expect(formatted.body).toContain('حقيبة جلدية')
    expect(formatted.body).toContain('رقم أودو: #53')
    expect(formatted.body).toContain('رقم شوبيفاي: #15518337')
    expect(formatted.body).toContain('كود (SKU): BAG-100')
    expect(formatted.body).not.toContain('products/update')
  })
})
