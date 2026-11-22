import { supabaseAdmin } from '@/lib/sync-runtime'
import type { SyncEngineResult } from '@/lib/sync-types'
import type { SyncRecordSummary } from '@/lib/telegram-notifier'
import { notifySyncResult } from '@/lib/telegram-notifier'

// ─── Helper: send Telegram notification for a sync result record ─────────────
function extractDetailsFromPayload(event: string, data?: Record<string, unknown>): SyncRecordSummary['details'] | undefined {
  if (!data || typeof data !== 'object') return undefined
  const d = data as any
  const ev = (event || '').toLowerCase()

  if (ev.includes('order') || ev.includes('sale') || ev.includes('cart')) {
    const customer = d.customer || {}
    const custName = customer.name || [customer.first_name, customer.last_name].filter(Boolean).join(' ') || d.customer_name || d.shipping?.address?.name
    const custPhone = customer.mobile || customer.phone || d.customer_mobile || d.customer_phone || d.shipping?.address?.phone
    const orderNum = d.order_number || d.code || d.id || d.reference || d.name
    const total = d.order_total || d.total || d.grand_total || d.total_amount
    const curr = d.currency || d.currency_code || 'SAR'
    const payMethod = d.payment?.method || d.payment_method || d.payment_method_name || d.gateway
    const shipMethod = d.shipping?.method || d.shipping_method || d.shipping_method_name
    const itemsCount = Array.isArray(d.products) ? d.products.length : Array.isArray(d.items) ? d.items.length : Array.isArray(d.line_items) ? d.line_items.length : undefined

    return {
      orderNumber: orderNum ? String(orderNum) : null,
      customerName: custName ? String(custName) : null,
      customerPhone: custPhone ? String(custPhone) : null,
      totalAmount: total ? String(total) : null,
      currency: curr ? String(curr) : 'SAR',
      paymentMethod: payMethod ? String(payMethod) : null,
      shippingMethod: shipMethod ? String(shipMethod) : null,
      itemsCount,
    }
  }

  if (ev.includes('product') || ev.includes('item')) {
    const prod = (d.product && typeof d.product === 'object') ? d.product : d
    const prodName = prod.name?.ar || prod.name?.en || prod.name || prod.title || d.name?.ar || d.name?.en || d.name || d.title
    const sku = prod.sku || prod.code || prod.barcode || d.sku || d.code || d.barcode
    const storeProdId = prod.id || d.id || prod.product_id || d.product_id
    return {
      productName: prodName ? String(prodName) : null,
      productSku: sku ? String(sku) : null,
      orderNumber: storeProdId ? String(storeProdId) : null,
    }
  }

  if (ev.includes('category')) {
    const cat = (d.category && typeof d.category === 'object') ? d.category : d
    const catName = cat.name?.ar || cat.name?.en || cat.name || cat.title || d.name?.ar || d.name?.en || d.name || d.title
    return {
      categoryName: catName ? String(catName) : null,
    }
  }

  if (ev.includes('customer') || ev.includes('contact') || ev.includes('partner')) {
    const cust = (d.customer && typeof d.customer === 'object') ? d.customer : d
    const custName = cust.name || [cust.first_name, cust.last_name].filter(Boolean).join(' ') || d.name || [d.first_name, d.last_name].filter(Boolean).join(' ') || d.customer_name || cust.customer_name
    const phone = cust.mobile || cust.phone || cust.telephone || d.mobile || d.phone || d.telephone || d.customer_mobile || d.customer_phone
    return {
      customerName: custName ? String(custName) : null,
      customerPhone: phone ? String(phone) : null,
    }
  }

  return undefined
}

export async function notifySyncForRecord(
  workspaceId: string | null | undefined,
  record: SyncEngineResult['records'][number],
  event: string,
  mappingName: string,
  mappingId: string,
  model: string,
  storeId?: string,
  errorMessage?: string | null,
  payloadData?: Record<string, unknown>,
  eventKey?: string | null
) {
  let wsId = workspaceId
  if (!wsId && storeId) {
    try {
      const { data: tok } = await supabaseAdmin
        .from('merchant_tokens')
        .select('workspace_id')
        .or(`store_id.eq.${storeId},merchant_id.eq.${storeId}`)
        .maybeSingle()
      wsId = tok?.workspace_id
    } catch { /* ignore */ }
  }
  if (!wsId && storeId) {
    try {
      const { data: sallaTok } = await supabaseAdmin
        .from('salla_tokens')
        .select('workspace_id')
        .eq('merchant_id', storeId)
        .maybeSingle()
      wsId = sallaTok?.workspace_id
    } catch { /* ignore */ }
  }
  if (!wsId && storeId) {
    try {
      const { data: shopTok } = await supabaseAdmin
        .from('shopify_tokens')
        .select('workspace_id')
        .eq('shop_domain', storeId)
        .maybeSingle()
      wsId = shopTok?.workspace_id
    } catch { /* ignore */ }
  }

  if (!wsId) return

  const details = extractDetailsFromPayload(event, payloadData)

  const summary: SyncRecordSummary = {
    status: record.status === 'success' ? 'success' : record.status === 'failed' ? 'failed' : 'skipped',
    event,
    mappingName,
    mappingId,
    model,
    odooRecordId: record.odooRecordId,
    errorMessage: errorMessage || record.message,
    workspaceId: wsId,
    storeId,
    receivedAt: new Date().toISOString(),
    details,
  }
  await notifySyncResult({ workspaceId: wsId, record: summary, eventKey: eventKey ?? null }).catch(() => {})
  // Independent best-effort channel; does not change Odoo commits or mapping.
  try {
    let platform = 'zid'
    const evLower = (event || '').toLowerCase()
    if (evLower.startsWith('salla') || evLower.includes('.salla.')) platform = 'salla'
    else if (evLower.startsWith('shopify') || evLower.includes('.shopify.')) platform = 'shopify'
    else if ((mappingName || '').toLowerCase().includes('salla')) platform = 'salla'
    else if ((mappingName || '').toLowerCase().includes('shopify')) platform = 'shopify'

    const { recordAppNotification } = await import('@/lib/app-notifications')
    await recordAppNotification({
      workspaceId: wsId,
      platform,
      event,
      eventKey: 'result:' + (eventKey || [storeId || '', event, record.odooRecordId || '', record.status, mappingId].join(':')),
      status: summary.status === 'processing' ? 'received' : summary.status,
      reference: details?.orderNumber ? String(details.orderNumber) : details?.productSku ? String(details.productSku) : null,
      odooRecordId: record.odooRecordId,
      details,
      payload: payloadData,
      errorMessage: summary.errorMessage,
    })
  } catch {
    console.warn('[Sync Notifications] App notification enqueue unavailable')
  }
}
