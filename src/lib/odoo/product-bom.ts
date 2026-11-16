import { findExistingOdooRecord } from '@/lib/odoo/records'
import type { OdooClient } from '@/lib/odoo-client'
import { assertBomCapability } from '@/lib/products/bom-capability'
import { isDynamicBundle } from '@/lib/products/bundle'
import { finiteProductNumber } from '@/lib/products/settings-values'
import { supabaseAdmin } from '@/lib/sync-runtime'
import type { SyncEngineResult } from '@/lib/sync-types'

export type SyncMissingProduct = (
  data: Record<string, unknown>,
  workspaceId: string,
  storeId: string,
  platform: 'zid' | 'salla' | 'shopify',
) => Promise<SyncEngineResult['records'][number] | null>

export function bindOdooProductBom(syncMissingProduct: SyncMissingProduct) {
  return syncOdooProductBom.bind(null, syncMissingProduct)
}

export type SyncProductBom = ReturnType<typeof bindOdooProductBom>

// ─── BoM / Kit sync (Odoo only — uses OdooClient XML-RPC) ───────────────
async function syncOdooProductBom(
  syncMissingProduct: SyncMissingProduct,
  client: OdooClient,
  templateId: number,
  zidData: Record<string, unknown>,
  mergedSettings: Record<string, any>,
  platform: 'zid' | 'salla' | 'shopify',
  workspaceId: string,
  dispatchStoreId = ''
): Promise<void> {
  const bomEnabled = !!mergedSettings.bom?.enabled
  if (!bomEnabled) return

  const bomType = mergedSettings.bom?.type || 'phantom'
  // Dynamic bundles are service products with zero-price component lines on
  // the order — there is no BoM to build and nothing to assert.
  if (isDynamicBundle(zidData)) return

  const isGrouped =
    zidData.product_class === 'grouped_product' ||
    zidData.product_class === 'dynamic_bundle' ||
    zidData.product_class === 'grouped' ||
    zidData.product_class === 'bundle' ||
    Array.isArray(zidData.group_products) ||
    Array.isArray(zidData.grouped_products) ||
    Array.isArray(zidData.components) ||
    Array.isArray(zidData.bundle_products)
  if (!isGrouped) return

  await assertBomCapability(client, bomType)

  console.info(`[SyncEngine] 🛠️ Product is classified as a grouped/bundle product. Syncing BoM in Odoo for template #${templateId}...`)

  const groupedProducts = Array.isArray(zidData.group_products)
    ? zidData.group_products
    : (Array.isArray(zidData.grouped_products)
      ? zidData.grouped_products
      : (Array.isArray(zidData.components)
        ? zidData.components
        : (Array.isArray(zidData.bundle_products) ? zidData.bundle_products : [])))

  if (groupedProducts.length === 0) {
    throw new Error('Grouped product components are missing; existing BoM preserved')
  }

  try {
    const resolvedComponents: { product_id: number; product_qty: number }[] = []

    // Deliberately current-only: this lookup has never had a legacy fallback,
    // unlike the relation/persist paths. Do not "fix" this to
    // pickExistingIdField without a migration note for legacy Odoo instances.
    const storeIdStr = String(dispatchStoreId || zidData.store_id || '')
    let zidCreds: any = null
    if (platform === 'zid') {
      try {
        let tokenRow: any = null
        // Store-keyed first (exact under multi-store), then newest workspace row.
        if (storeIdStr) {
          const { data } = await supabaseAdmin
            .from('merchant_tokens')
            .select('*')
            .eq('workspace_id', workspaceId)
            .or(`store_id.eq.${storeIdStr},merchant_id.eq.${storeIdStr}`)
            .maybeSingle()
          tokenRow = data
        }
        if (!tokenRow && workspaceId && !storeIdStr) {
          const { data } = await supabaseAdmin
            .from('merchant_tokens')
            .select('*')
            .eq('workspace_id', workspaceId)
            .order('updated_at', { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle()
          tokenRow = data
        }

        if (tokenRow) {
          const { getAccessToken } = await import('@/lib/zid/token')
          const storedTokens = await getAccessToken(tokenRow.merchant_id)
          zidCreds = {
            authorization: storedTokens.authorization || '',
            managerToken: storedTokens.accessToken,
            storeId: tokenRow.store_id || tokenRow.merchant_id,
          }
        }
      } catch (err) {
        console.warn(`[SyncEngine] Failed to resolve Zid credentials inside syncProductBom:`, err)
      }
    }

    for (const comp of groupedProducts) {
      const compId = comp.item_id || comp.item?.id || comp.id || comp.product_id
      const compSku = comp.item?.sku || comp.sku || comp.sku_code || comp.default_code
      const compBarcode = comp.item?.barcode || comp.barcode

      if (!compId && !compSku && !compBarcode) throw new Error('BoM component has no identity')
      if (String(compId) === String(zidData.id)) throw new Error('A grouped product cannot contain itself')

      // Search matching product.product in Odoo using findExistingOdooRecord
      // (which safely checks sync_logs, entity_links, SKU, barcode, and verifies custom fields via fieldMeta)
      let matchedId: number | null = null
      try {
        matchedId = await findExistingOdooRecord(
          client,
          'product.product',
          { id: compId, sku: compSku, barcode: compBarcode },
          { default_code: compSku, barcode: compBarcode },
          { merchant_id: storeIdStr },
          undefined,
          mergedSettings.match_zid_field && mergedSettings.match_odoo_field ? { zid_field: mergedSettings.match_zid_field, odoo_field: mergedSettings.match_odoo_field } : undefined,
          workspaceId,
          platform
        )
      } catch {
        // Fallback to standard search if findExistingOdooRecord fails
      }

      if (!matchedId && compSku) {
        const ids = await client.search('product.product', [['default_code', '=', String(compSku)]], 1)
        if (ids.length > 0) matchedId = ids[0]
      }
      if (!matchedId && compBarcode) {
        const ids = await client.search('product.product', [['barcode', '=', String(compBarcode)]], 1)
        if (ids.length > 0) matchedId = ids[0]
      }

      // If not matched, try to pull it from Zid and sync it
      if (!matchedId && compId && platform === 'zid' && zidCreds && workspaceId) {
        try {
          console.info(`[SyncEngine] Component product ID ${compId} not found in Odoo. Attempting to fetch and sync it first...`)
          const { ZidAPI } = await import('@/lib/zid-client')
          const response = await ZidAPI.products.get(zidCreds, String(compId))
          const productData = response.data?.product || response.data
          if (productData && (productData.id || productData.name)) {
            if (['grouped_product', 'grouped', 'bundle', 'dynamic_bundle'].includes(productData.product_class)) throw new Error('Sync nested grouped components first to avoid recursive BoM imports')
            const syncRes = await syncMissingProduct({ ...productData }, workspaceId, storeIdStr, platform)

            if (syncRes && syncRes.status === 'success') {
              const newOdooId = syncRes.odooRecordId
              if (newOdooId) {
                const ids = syncRes.model === 'product.product' ? [Number(newOdooId)] : await client.search('product.product', [['product_tmpl_id', '=', Number(newOdooId)]], 2)
                if (ids.length === 1) matchedId = ids[0]
              }
            }
          }
        } catch (compErr: any) {
          console.warn(`[SyncEngine] Failed to auto-sync missing component product ID ${compId}:`, compErr?.message ?? compErr)
        }
      }

      if (matchedId) {
        const qty = finiteProductNumber(comp.item_quantity ?? comp.quantity ?? comp.qty ?? 1)
        if (qty === undefined || qty <= 0) throw new Error('BoM component quantity must be positive')
        resolvedComponents.push({ product_id: matchedId, product_qty: qty })
      } else {
        throw new Error(`Unresolved BoM component ${compId || compSku || compBarcode}; existing BoM preserved`)
      }
    }

    if (resolvedComponents.length === 0) {
      console.info(`[SyncEngine] No component products could be matched in Odoo. Skipping BoM creation/update.`)
      return
    }

    // Check if BoM already exists
    const existingBomIds = await client.search('mrp.bom', [['product_tmpl_id', '=', templateId], ['product_id', '=', false]], 1)

    const lines = resolvedComponents.map(comp => [0, 0, { product_id: comp.product_id, product_qty: comp.product_qty }])
    let bomId: number
    if (existingBomIds.length) {
      bomId = existingBomIds[0]
      await client.write('mrp.bom', [bomId], { type: bomType, product_qty: 1, bom_line_ids: [[5, 0, 0], ...lines] })
    } else {
      bomId = await client.create('mrp.bom', { product_tmpl_id: templateId, type: bomType, product_qty: 1, bom_line_ids: lines })
    }
    console.info(`[SyncEngine] ✅ BoM for template #${templateId} successfully updated with ${resolvedComponents.length} components.`)
  } catch (err: any) {
    throw err
  }
}
