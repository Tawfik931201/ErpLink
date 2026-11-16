import { isOrderCreationEvent } from '@/lib/zid/order-helpers'

import { enrichSallaCategory } from './categories'
import { enrichSallaCustomer } from './customers'
import { hasPricedSallaItems } from './order-amounts'
import { enrichSallaOrder } from './orders'
import { enrichSallaProduct } from './products'

export async function prepareSallaWebhookData(
  data: Record<string, unknown>,
  storeIdStr: string,
  normalizedEvent: string,
  isLegacyDelivery: boolean,
): Promise<Record<string, unknown>> {
  const isSallaShipment = normalizedEvent.startsWith('order.shipment.')
  let sallaShipmentOrderId = isSallaShipment
    ? (data as any)?.order?.id ?? (data as any)?.order_id
    : undefined
  const sallaShipmentId = isSallaShipment ? (data as any)?.id : undefined
  if (isSallaShipment && sallaShipmentOrderId == null && sallaShipmentId != null &&
      ((data as any)?.shipping_number != null || (data as any)?.reference_id != null)) {
    const { getSallaShipmentOrderId } = await import('@/lib/salla-client')
    sallaShipmentOrderId = await getSallaShipmentOrderId(storeIdStr, String(sallaShipmentId))
  }
  const keys = data && typeof data === 'object' ? Object.keys(data) : []

  // ⚠️ Some Salla events nest the order one level down instead of being the
  // order. `order.status.updated` is `{id, status, note, order: {...order}}`
  // where `data.id` is the STATUS-CHANGE record id, not the order id — see
  // docs.salla.dev/doc-433804. Reading `data.id` there fetched the wrong
  // order (or 404), and because the merge put `data` last its wrong `id` won,
  // so `findExistingOdooRecord` missed and a DUPLICATE sale.order was created
  // while the status change — the entire point of the event — never landed.
  // The nested object is the authoritative order, so it drives both the id
  // lookup and the merge.
  const nestedOrder = (data as any)?.order
  const orderSource =
    nestedOrder && typeof nestedOrder === 'object' && !Array.isArray(nestedOrder)
      ? (nestedOrder as any)
      : (data as any)

  const entityId = orderSource?.id
  const hasEntity = entityId !== undefined && entityId !== null
  // `order.shipment.*` payloads are {id, reference_id, shipping_number} where
  // `id` is the SHIPMENT id (e.g. 1427738113), never the order id, and
  // `reference_id` is not the order id either. Fetching the order with it
  // asked Salla for a non-existent order. Nothing to enrich here: the id is
  // normalised to the order id further down.
  const isShipmentEvent = normalizedEvent.includes('shipment')
  const shipmentHasOrder = (data as any)?.order && typeof (data as any).order === 'object'
  const shipmentEntityId = isShipmentEvent && !shipmentHasOrder
    ? sallaShipmentOrderId
    : undefined
  // Payload size alone is the wrong test for orders. An `order.updated` payload
  // can carry a dozen fields and still omit `items`, and it would pass the
  // `keys.length <= 4` check below — so Odoo gets written with no line items and
  // the sync looks like it succeeded. Completeness of an order is decided by
  // `items`, so that is what gates the fetch; the size heuristic stays for the
  // other entities, where a small payload genuinely means "identifier only".
  const isOrderCreate = isOrderCreationEvent(normalizedEvent)
  const missingOrderItems = hasEntity && normalizedEvent.startsWith('order.') &&
    (orderSource?.items === undefined || (isOrderCreate && !hasPricedSallaItems(orderSource.items)))
  // A category payload can be fat (>4 keys) and still omit `parent_id`. Size
  // alone then passes it through with no parent, which looks exactly like
  // "synced fine but Parent Category is empty". Fetch the full category when
  // the parent key is absent so the mapping always has a value to resolve.
  const missingParentId =
    hasEntity && normalizedEvent.startsWith('category.') && (data as any)?.parent_id === undefined
  const isThin = hasEntity && (isOrderCreate ? !orderSource.amounts : keys.length <= 4)
  // legacy delivery: تُعاد القراءة من API سالا **دائماً** حتى لو كان payload
  // كثيفاً — للمتصل غير المصادق صحة الحدث ليست مضمونة، فالجسم محفز فقط
  // و API هي مصدر القيم (نفس قاعدة ثقة مسار أودو → المتجر).
  const legacyNeedsFetch = isLegacyDelivery && hasEntity
  if (legacyNeedsFetch || missingOrderItems || missingParentId || isThin || shipmentEntityId != null) {
    try {
      if (normalizedEvent.startsWith('order.')) {
        const orderFetchId = isShipmentEvent && !shipmentHasOrder ? shipmentEntityId : entityId
        data = await enrichSallaOrder(data, storeIdStr, orderSource, orderFetchId, isOrderCreate, isLegacyDelivery)
      } else if (normalizedEvent.startsWith('customer.')) {
        data = await enrichSallaCustomer(data, storeIdStr, entityId, isLegacyDelivery)
      } else if (normalizedEvent.startsWith('category.')) {
        data = await enrichSallaCategory(data, storeIdStr, entityId, isLegacyDelivery)
      } else if (normalizedEvent.startsWith('product.') && legacyNeedsFetch) {
        // For authenticated deliveries product.* payloads are already full —
        // no fetch needed. Legacy ones are re-read from Salla before anything
        // reaches Odoo.
        data = await enrichSallaProduct(data, storeIdStr, entityId)
      }
    } catch (err) {
      if (isOrderCreate) throw err
      // Enrichment is best-effort — fall back to the raw payload.
    }
  }

  // `order.shipment.*` describes a SHIPMENT, not an order: `data.id` is the
  // shipment id and `reference_id` is not the order id. Point the event at the
  // order it belongs to so the mapping matches (or creates) the right
  // sale.order instead of writing against an unrelated id.
  if (normalizedEvent.includes('shipment')) {
    const shipmentOrder = (data as any)?.order
    const hasShipmentOrder =
      shipmentOrder && typeof shipmentOrder === 'object' && !Array.isArray(shipmentOrder)
    const targetOrderId = (hasShipmentOrder ? (shipmentOrder as any).id : undefined) ?? sallaShipmentOrderId
    if (targetOrderId !== undefined && targetOrderId !== null && String(targetOrderId) !== '') {
      data = {
        ...(hasShipmentOrder ? (shipmentOrder as Record<string, unknown>) : data),
        id: targetOrderId,
        __shipment_id: (data as any)?.__shipment_id ?? sallaShipmentId,
      }
    } else {
      throw new Error('Salla shipment has no verified order ID')
    }
  }
  return data
}
