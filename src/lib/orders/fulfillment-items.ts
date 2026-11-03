/** Existing fulfillment parsing, including first-nonempty-array short circuit. */
export function extractFulfilledItems(zidData: Record<string, unknown>): Array<{ sku: string; qty: number }> {
  // Try multiple common payload structures for fulfillment items
  const candidates = ['fulfilled_items', 'items', 'line_items', 'order_items', 'fulfillments']
  for (const key of candidates) {
    const raw = (zidData as any)[key]
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((item: any) => {
        const sku = String(item.sku || item.default_code || item.product_id || item.id || '')
        const qty = parseFloat(String(item.quantity || item.qty || item.fulfilled_qty || 0)) || 0
        return { sku, qty }
      }).filter((i: { sku: string; qty: number }) => i.sku && i.qty > 0)
    }
  }
  // Try nested fulfillment structure (Shopify-style)
  const fulfillments = (zidData as any)?.fulfillments
  if (Array.isArray(fulfillments)) {
    const items: Array<{ sku: string; qty: number }> = []
    for (const f of fulfillments) {
      const fItems = f.line_items || f.items || []
      for (const fi of fItems) {
        const sku = String(fi.sku || fi.product_id || fi.id || '')
        const qty = parseFloat(String(fi.quantity || fi.qty || 0)) || 0
        if (sku && qty > 0) items.push({ sku, qty })
      }
    }
    return items
  }
  return []
}
