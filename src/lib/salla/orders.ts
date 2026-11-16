import { hasPricedSallaItems } from './order-amounts'

export async function enrichSallaOrder(
  data: Record<string, unknown>,
  storeIdStr: string,
  orderSource: Record<string, unknown>,
  orderFetchId: unknown,
  isOrderCreate: boolean,
  isLegacyDelivery: boolean,
): Promise<Record<string, unknown>> {
  const { getSallaOrder, getSallaOrderItems } = await import('@/lib/salla-client')
  if (orderFetchId === undefined || orderFetchId === null) {
    // Shipment event with neither a nested order nor an order_id: there
    // is nothing valid to fetch, and `entityId` is a shipment id.
  } else {
    const full = await getSallaOrder(storeIdStr, String(orderFetchId))
    if (isOrderCreate && (!full || String(full.id) !== String(orderFetchId))) {
      throw new Error('Could not verify Salla order details')
    }
    if (full) {
      data = isLegacyDelivery
        ? (isOrderCreate ? { ...full } : { ...orderSource, ...full })
        : { ...full, ...orderSource }
      const sourceItems = isLegacyDelivery ? full.items : data.items
      if (isOrderCreate && !hasPricedSallaItems(sourceItems)) {
        data.items = hasPricedSallaItems(full.items) ? full.items : await getSallaOrderItems(storeIdStr, String(orderFetchId))
        if (!hasPricedSallaItems(data.items)) throw new Error('Salla order items could not be retrieved with valid prices')
      }
    }
  }
  return data
}
