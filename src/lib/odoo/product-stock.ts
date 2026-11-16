import { isInventorySyncErpToStoreEnabled } from '@/lib/inventory-sync-settings'
import { resolveWarehouse } from '@/lib/odoo/order-location'
import type { OdooClient } from '@/lib/odoo-client'
import { finiteProductNumber, shouldSyncProductStock } from '@/lib/products/settings-values'

export async function updateOdooStock(client: OdooClient, productId: number, qty: number, locationId?: number, infiniteValue?: number, workspaceId?: string): Promise<boolean> {
  if (!Number.isFinite(qty) || !Number.isInteger(productId) || productId <= 0) return false
  if (infiniteValue !== undefined && infiniteValue > 0 && qty >= infiniteValue) {
    console.info(`[SyncEngine] Skipping stock update for product #${productId}: qty ${qty} >= infinite value ${infiniteValue}`)
    return true
  }
  // عندما يُفعَّل «مزامنة المخزون (من أودو إلى زد)» في مركز الربط، أودو
  // هو مصدر الحقيقة لكميات المخزون — تُمنع أي كتابة مخزون عكسية زد → أودو.
  if (workspaceId) {
    const suppressed = await isInventorySyncErpToStoreEnabled(workspaceId)
    if (suppressed) {
      console.info(`[SyncEngine] Skipping Zid→Odoo stock write for product #${productId}: Odoo→Zid inventory sync is enabled.`)
      return true
    }
  }
  console.info(`[SyncEngine] Attempting stock update for product #${productId} to quantity=${qty} locationId=${locationId ?? 'auto'}`)
  try {
    let locId: number | null = locationId ?? null
    if (!locId) {
      const locIds = await client.search('stock.location', [['usage', '=', 'internal']], 1)
      if (!locIds || locIds.length === 0) {
        console.warn(`[SyncEngine] No internal location found for stock update of product #${productId}`)
        return false
      }
      locId = locIds[0]
    }

    try {
      const wizardId = await client.create('stock.change.product.qty', {
        product_id: productId,
        new_qty: qty,
        location_id: locId
      })
      await client.execute('stock.change.product.qty', 'change_product_qty', [wizardId])
      console.info(`[SyncEngine] Stock for product #${productId} updated via stock.change.product.qty wizard.`)
      return true
    } catch (wizardErr: any) {
      console.warn(`[SyncEngine] stock.change.product.qty wizard failed for product #${productId}: ${wizardErr.message || wizardErr}. Trying stock.quant fallback...`)
      const quantIds = await client.search('stock.quant', [
        ['product_id', '=', productId],
        ['location_id', '=', locId]
      ], 1)

      try {
        if (quantIds && quantIds.length > 0) {
          await client.write('stock.quant', [quantIds[0]], { inventory_quantity: qty })
          try {
            await client.execute('stock.quant', 'action_apply_inventory', [[quantIds[0]]])
          } catch (execErr: any) {
            if (!String(execErr.message || execErr).includes('cannot marshal None')) {
              throw execErr
            }
            console.info(`[SyncEngine] stock.quant.action_apply_inventory completed on server (non-critical XML-RPC marshalling error ignored).`)
          }
        } else {
          const newQuantId = await client.create('stock.quant', {
            product_id: productId,
            location_id: locId,
            inventory_quantity: qty
          })
          try {
            await client.execute('stock.quant', 'action_apply_inventory', [[newQuantId]])
          } catch (execErr: any) {
            if (!String(execErr.message || execErr).includes('cannot marshal None')) {
              throw execErr
            }
            console.info(`[SyncEngine] stock.quant.action_apply_inventory completed on server (non-critical XML-RPC marshalling error ignored).`)
          }
        }
        console.info(`[SyncEngine] Stock for product #${productId} updated via stock.quant direct modification.`)
        return true
      } catch (quantErr: any) {
        throw quantErr
      }
    }
  } catch (err: any) {
    console.error(`[SyncEngine] Failed to update stock in Odoo for product #${productId}:`, err.message || err)
    return false
  }
}

/** Inventory payloads with locations must never be collapsed into an arbitrary warehouse. */
export async function syncProductStockQuantities(
  client: OdooClient, productId: number, data: Record<string, unknown>,
  settings: Record<string, any>, workspaceId: string, platform: 'zid' | 'salla' | 'shopify' = 'zid',
): Promise<void> {
  if (!shouldSyncProductStock(settings, data, platform)) return
  const adjustments = new Map<number | undefined, number>()
  if (Array.isArray(data.stocks) && data.stocks.length) {
    for (const stock of data.stocks) {
      if (stock.is_infinite === true || (platform === 'salla' && stock.unlimited_quantity === true)) continue
      const qty = finiteProductNumber(stock.available_quantity ?? stock.quantity)
      if (qty === undefined) throw new Error('Product stock location has no valid quantity')
      const sourceId = stock.location?.id ?? stock.location_id ?? stock.location
      const location = sourceId ? await resolveWarehouse(workspaceId, platform, String(sourceId)) : null
      const target = location?.location_id ?? (data.stocks.length === 1 ? settings.inventory?.default_location_id : undefined)
      if (!target) throw new Error(`Map stock location ${String(sourceId || '')} before synchronizing product quantities`)
      adjustments.set(target, (adjustments.get(target) ?? 0) + qty)
    }
  } else {
    const qty = finiteProductNumber(data.quantity ?? data.stock_quantity ?? data.qty ?? data.inventory_quantity)
    if (qty !== undefined) adjustments.set(settings.inventory?.default_location_id, qty)
  }
  if (adjustments.size && ['lot', 'serial'].includes(settings.inventory?.tracking)) {
    throw new Error('Aggregate product quantity cannot adjust lot/serial inventory without lot identities')
  }
  for (const [location, qty] of adjustments) {
    if (!await updateOdooStock(client, productId, qty, location, settings.stock?.infinite_value, workspaceId)) {
      throw new Error(`Stock update failed for product #${productId}`)
    }
  }
}

export async function syncProductTemplateStock(
  client: OdooClient, templateId: number, data: Record<string, unknown>,
  values: Record<string, unknown>, settings: Record<string, any>, workspaceId: string,
  platform: 'zid' | 'salla' | 'shopify' = 'zid',
): Promise<void> {
  if (!shouldSyncProductStock(settings, data, platform) || values.type === 'service' || values.is_storable === false) return
  // A kit's availability is derived from its components, never an independent quant.
  if (settings.bom?.enabled && settings.bom?.type !== 'normal' && (
    ['grouped_product', 'grouped', 'bundle', 'dynamic_bundle'].includes(String(data.product_class)) ||
    ['group_products', 'grouped_products', 'components', 'bundle_products'].some(key => Array.isArray(data[key]))
  )) return
  const qty = finiteProductNumber(data.quantity ?? data.stock_quantity ?? data.qty ?? data.inventory_quantity)
  if (qty === undefined && !(Array.isArray(data.stocks) && data.stocks.length)) return
  const ids = await client.search('product.product', [['product_tmpl_id', '=', templateId]], 2)
  if (ids.length !== 1) throw new Error(`Cannot resolve a single stock product for template #${templateId}`)
  await syncProductStockQuantities(client, ids[0], data, settings, workspaceId, platform)
}
