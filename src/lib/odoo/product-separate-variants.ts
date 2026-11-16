import { type SyncProductBom } from '@/lib/odoo/product-bom'
import { findExistingOdooRecord, persistPlatformIdOnRecord, safeCreateOdooRecord, safeWriteOdooRecord } from '@/lib/odoo/records'
import type { OdooClient } from '@/lib/odoo-client'
import { assertProductWriteAllowed } from '@/lib/products/settings-values'
import type { GenericVariant } from '@/lib/products/variants'
import { toNameString } from '@/lib/sync-helpers'
import { logSync } from '@/lib/sync-runtime'
import type { FieldMappingRow, SyncEngineResult } from '@/lib/sync-types'

import { syncProductTemplateStock } from './product-stock'
import { buildVariantProductValues } from './product-variant-values'

export async function syncAsSeparateProducts(
  syncProductBom: SyncProductBom,
  client: OdooClient,
  mapping: FieldMappingRow,
  event: string,
  storeId: string,
  zidEntityId: string,
  zidData: Record<string, unknown>,
  odooValues: Record<string, unknown>,
  variants: GenericVariant[],
  platform: 'zid' | 'salla' | 'shopify',
  triggerType?: 'automatic' | 'manual',
  existingLogId?: string,
  matchStrategy?: string,
  _defaultLocationId?: number,
  _infiniteValue?: number,
  fixedMatch?: { odoo_field: string; zid_field: string },
  _priceSettings?: { markup_percent: number; rounding: string; decimal_places: number },
  mergedSettings?: Record<string, any>
): Promise<SyncEngineResult['records'][number]> {
  console.info(`[SyncEngine] 📦 مزامنة ${variants.length} متغيرات كمنتجات منفصلة في أودو.`)

  const mainProductName = toNameString(zidData.name || odooValues.name)
  const results: number[] = []

  // Also create/update the main product template itself (not just the variants)
  const mainDuplicateId = await findExistingOdooRecord(client, 'product.template', zidData, odooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, platform)
  let mainRecordId: number | null = null
  assertProductWriteAllowed(mergedSettings || {}, mainDuplicateId !== null)
  if (mainDuplicateId !== null) {
    console.info(`[SyncEngine] 🔄 المنتج الرئيسي موجود بالفعل (ID: #${mainDuplicateId}). جاري تحديث البيانات...`)
    await safeWriteOdooRecord(client, 'product.template', mainDuplicateId, odooValues, odooValues, platform)
    mainRecordId = mainDuplicateId
  } else {
    console.info(`[SyncEngine] ➕ جاري إنشاء المنتج الرئيسي "${mainProductName}" في أودو...`)
    mainRecordId = await safeCreateOdooRecord(client, 'product.template', odooValues, odooValues, undefined, platform)
    if (zidData.id) {
      await persistPlatformIdOnRecord(client, 'product.template', mainRecordId, platform, String(zidData.id))
    }
  }
  results.push(mainRecordId)

  if (mergedSettings && mainRecordId) {
    await syncProductBom(client, mainRecordId, zidData, mergedSettings, platform, mapping.workspace_id, storeId)
  }

  for (const variant of variants) {
    const attributeValues = Object.values(variant.attributes)
    // Include the variant's attributes in the product name (e.g., "T-Shirt - Red - Large")
    const variantName = attributeValues.length > 0
      ? `${mainProductName} - ${attributeValues.join(' - ')}`
      : mainProductName

    const variantOdooValues = await buildVariantProductValues(
      client, odooValues, zidData, variant, mergedSettings || {}, platform, fixedMatch,
    )

    // Check if this specific variant already exists in Odoo
    const variantMockData = {
      ...zidData,
      ...variant.source,
      id: variant.id,
      name: variantOdooValues.name,
      sku: variant.sku,
      barcode: variant.barcode
    }
    const duplicateId = await findExistingOdooRecord(client, 'product.template', variantMockData, variantOdooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, platform)

    let recordId: number
    assertProductWriteAllowed(mergedSettings || {}, duplicateId !== null)
    if (duplicateId !== null && results.includes(duplicateId)) throw new Error('Separate variants must not match the parent or another variant template')
    if (duplicateId !== null) {
      await safeWriteOdooRecord(client, 'product.template', duplicateId, variantOdooValues, variantOdooValues, platform)
      recordId = duplicateId
    } else {
      console.info(`[SyncEngine] ➕ جاري إنشاء متغير كمنتج منفصل "${variantName}" في أودو...`)
      recordId = await safeCreateOdooRecord(client, 'product.template', variantOdooValues, variantOdooValues,
        `variant:${String(variant.id || variant.sku || JSON.stringify(variant.attributes))}`, platform)
      if (variant.id) {
        await persistPlatformIdOnRecord(client, 'product.template', recordId, platform, String(variant.id))
      }
    }

    await syncProductTemplateStock(client, recordId, { ...variant.source, quantity: variant.quantity }, variantOdooValues, mergedSettings || {}, mapping.workspace_id, platform)

    if (variant.id) {
      await logSync({
        workspace_id: mapping.workspace_id,
        field_mapping_id: mapping.id,
        event,
        store_id: storeId,
        zid_entity_id: String(variant.id),
        odoo_model: 'product.template',
        odoo_record_id: recordId,
        status: 'success',
        error_message: null,
        payload: { ...zidData, variant: variantMockData },
        platform,
        trigger_type: triggerType
      })
    }

    results.push(recordId)
  }

  const msg = `Successfully synced ${results.length} variants as standalone product.template records: [${results.join(', ')}]`
  await logSync({
    id: existingLogId,
    workspace_id: mapping.workspace_id,
    field_mapping_id: mapping.id,
    event,
    store_id: storeId,
    zid_entity_id: zidEntityId,
    odoo_model: 'product.template',
    odoo_record_id: results[0] || null,
    status: 'success',
    error_message: null,
    payload: zidData,
    platform,
        trigger_type: triggerType
  })

  return {
    mappingId: mapping.id,
    mappingName: mapping.name,
    model: 'product.template',
    status: 'success',
    odooRecordId: results[0],
    message: msg
  }
}

export async function syncChildAsSeparateProduct(
  syncProductBom: SyncProductBom,
  client: OdooClient,
  mapping: FieldMappingRow,
  event: string,
  storeId: string,
  zidEntityId: string,
  zidData: Record<string, unknown>,
  odooValues: Record<string, unknown>,
  platform: 'zid' | 'salla' | 'shopify',
  triggerType?: 'automatic' | 'manual',
  existingLogId?: string,
  matchStrategy?: string,
  _defaultLocationId?: number,
  _infiniteValue?: number,
  fixedMatch?: { odoo_field: string; zid_field: string },
  _priceSettings?: { markup_percent: number; rounding: string; decimal_places: number },
  mergedSettings?: Record<string, any>
): Promise<SyncEngineResult['records'][number]> {
  console.info(`[SyncEngine] 📦 مزامنة منتج فرعي (child) كمنتج منفصل في أودو: ${zidEntityId}`)

  const finalName = toNameString(odooValues.name || zidData.name)
  const childOdooValues = { ...odooValues }

  // Check if this specific child product already exists in Odoo
  const childMockData = {
    ...zidData,
    id: zidData.id,
    sku: zidData.sku,
    barcode: zidData.barcode
  }

  const duplicateId = await findExistingOdooRecord(
    client, 'product.template', childMockData, childOdooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, platform
  )

  let recordId: number
  assertProductWriteAllowed(mergedSettings || {}, duplicateId !== null)
  if (duplicateId !== null) {
    console.info(`[SyncEngine] 🔄 المنتج الفرعي موجود بالفعل (ID: #${duplicateId}). جاري تحديث البيانات...`)
    await safeWriteOdooRecord(client, 'product.template', duplicateId, childOdooValues, childOdooValues)
    recordId = duplicateId
  } else {
    console.info(`[SyncEngine] ➕ جاري إنشاء المنتج الفرعي "${finalName}" في أودو...`)
    recordId = await safeCreateOdooRecord(client, 'product.template', childOdooValues, childOdooValues)
    if (zidData.id) {
      await persistPlatformIdOnRecord(client, 'product.template', recordId, platform, String(zidData.id))
    }
  }

  await syncProductTemplateStock(client, recordId, zidData, childOdooValues, mergedSettings || {}, mapping.workspace_id, platform)

  if (mergedSettings && recordId) {
    await syncProductBom(client, recordId, zidData, mergedSettings, platform, mapping.workspace_id, storeId)
  }

  const msg = `Successfully synced child product as standalone product.template #${recordId}`
  await logSync({
    id: existingLogId,
    workspace_id: mapping.workspace_id,
    field_mapping_id: mapping.id,
    event,
    store_id: storeId,
    zid_entity_id: zidEntityId,
    odoo_model: 'product.template',
    odoo_record_id: recordId,
    status: 'success',
    error_message: null,
    payload: zidData,
    platform,
        trigger_type: triggerType
  })

  return {
    mappingId: mapping.id,
    mappingName: mapping.name,
    model: 'product.template',
    status: 'success',
    odooRecordId: recordId,
    message: msg
  }
}
