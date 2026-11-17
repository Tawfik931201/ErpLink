import { resolveEntityLinkId, upsertEntityLink } from '@/lib/entity-links'
import { getErpExecutionScope } from '@/lib/erp-execution-target'
import { fetchFieldMeta } from '@/lib/odoo/field-meta'
import { type SyncProductBom } from '@/lib/odoo/product-bom'
import { findExistingOdooRecord, persistPlatformIdOnRecord, safeCreateOdooRecord, safeWriteOdooRecord } from '@/lib/odoo/records'
import type { OdooClient } from '@/lib/odoo-client'
import { platformIdField, platformLegacyIdField } from '@/lib/platform-fields'
import { assertProductWriteAllowed, finiteProductNumber } from '@/lib/products/settings-values'
import { readAllProductRows, syncVariantPrices } from '@/lib/products/variant-prices'
import { pickStaleZidVariants } from '@/lib/products/variant-reconciliation'
import type { GenericVariant } from '@/lib/products/variants'
import { resolveZidMatchValue, toNameString } from '@/lib/sync-helpers'
import { logSync, supabaseAdmin } from '@/lib/sync-runtime'
import type { FieldMappingRow, SyncEngineResult } from '@/lib/sync-types'

import { syncProductStockQuantities } from './product-stock'
import { buildVariantProductValues } from './product-variant-values'

async function ensureSingleAttributeLine(
  client: OdooClient,
  templateId: number,
  attributeId: number,
  desiredValueIds: number[],
  strict = false,
): Promise<number> {
  // Re-read immediately before mutation. Parent and child webhooks can arrive
  // nearly together; using an earlier snapshot lets both workers see "no line"
  // and create duplicates for the same attribute.
  const lines = await client.searchRead<any>('product.template.attribute.line', [
    ['product_tmpl_id', '=', templateId],
    ['attribute_id', '=', attributeId],
  ], ['id', 'value_ids'], 100)

  if (lines.length === 0) {
    try {
      return await client.create('product.template.attribute.line', {
        product_tmpl_id: templateId,
        attribute_id: attributeId,
        value_ids: [[6, 0, desiredValueIds]],
      })
    } catch (err) {
      // A concurrent worker may have created the line between the read and the
      // create. Re-read once and continue through the merge path.
      const raced = await client.searchRead<any>('product.template.attribute.line', [
        ['product_tmpl_id', '=', templateId],
        ['attribute_id', '=', attributeId],
      ], ['id', 'value_ids'], 100)
      if (raced.length === 0) throw err
      lines.push(...raced)
    }
  }

  const keeper = lines[0]
  const mergedValueIds = Array.from(new Set([
    ...(keeper.value_ids || []).map(Number),
    ...desiredValueIds.map(Number),
    ...lines.slice(1).flatMap((line: any) => (line.value_ids || []).map(Number)),
  ])).filter(id => Number.isInteger(id) && id > 0)

  const written = await client.write('product.template.attribute.line', [keeper.id], {
    value_ids: [[6, 0, mergedValueIds]],
  })
  if (!written && strict) throw new Error(`Odoo rejected attribute line #${keeper.id}`)

  // Defensive cleanup for old/raced duplicate rows. Do this only after the
  // keeper contains the full union, so removing duplicates cannot lose values.
  const duplicateIds = lines.slice(1).map((line: any) => Number(line.id)).filter((id: number) => Number.isInteger(id) && id > 0)
  if (duplicateIds.length > 0) {
    try {
      await client.unlink('product.template.attribute.line', duplicateIds)
      console.warn(
        `[SyncEngine] Removed duplicate attribute line(s) #${duplicateIds.join(', #')} for template #${templateId}, attribute #${attributeId}.`
      )
    } catch (err: any) {
      if (strict) throw err
      console.warn(
        `[SyncEngine] Could not remove duplicate attribute lines for template #${templateId}: ${err?.message ?? err}`
      )
    }
  }

  return Number(keeper.id)
}

export async function syncAsVariants(
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
  console.info(`[SyncEngine] 📦 مزامنة ${variants.length} متغيرات تحت منتج رئيسي واحد في أودو.`)

  // Step 1: Create or update the main product.template
  const duplicateId = await findExistingOdooRecord(client, 'product.template', zidData, odooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, platform)

  let templateId: number
  assertProductWriteAllowed(mergedSettings || {}, duplicateId !== null)
  if (duplicateId !== null) {
    console.info(`[SyncEngine] 🔄 المنتج الرئيسي موجود بالفعل (ID: #${duplicateId}). جاري تحديث البيانات...`)
    await safeWriteOdooRecord(client, 'product.template', duplicateId, odooValues, odooValues, platform)
    templateId = duplicateId
  } else {
    console.info(`[SyncEngine] ➕ جاري إنشاء المنتج الرئيسي في أودو...`)
    templateId = await safeCreateOdooRecord(client, 'product.template', odooValues, odooValues, undefined, platform)
    if (zidData.id) {
      await persistPlatformIdOnRecord(client, 'product.template', templateId, platform, String(zidData.id))
    if (mapping.workspace_id && zidData.id) {
      await upsertEntityLink({
        workspaceId: mapping.workspace_id,
        platform,
        storeId,
        odooModel: 'product.template',
        storeEntityId: String(zidData.id),
      }, templateId).catch(() => {})
    }
    }
  }

  if (mergedSettings) {
    await syncProductBom(client, templateId, zidData, mergedSettings, platform, mapping.workspace_id, storeId)
  }

  // Step 2: Attributes Sync
  const attributeValuesMap: Record<string, Set<string>> = {}
  for (const variant of variants) {
    for (const [attrName, attrVal] of Object.entries(variant.attributes)) {
      if (!attributeValuesMap[attrName]) {
        attributeValuesMap[attrName] = new Set()
      }
      attributeValuesMap[attrName].add(attrVal)
    }
  }

  const attributeIdMap: Record<string, number> = {}
  const valueIdMap: Record<string, Record<string, number>> = {} // attrName -> valueName -> valueId

  for (const [attrName, attrValues] of Object.entries(attributeValuesMap)) {
    let attrId: number
    const attrIds = await client.search('product.attribute', [['name', '=', attrName]], 1)
    if (attrIds.length > 0) {
      attrId = attrIds[0]
    } else {
      attrId = await client.create('product.attribute', { name: attrName, create_variant: 'always' })
      console.info(`[SyncEngine] ➕ تم إنشاء خاصية منتج جديدة "${attrName}" (ID: #${attrId})`)
    }
    attributeIdMap[attrName] = attrId
    valueIdMap[attrName] = {}

    for (const attrVal of attrValues) {
      let valId: number
      const valIds = await client.search('product.attribute.value', [
        ['name', '=', attrVal],
        ['attribute_id', '=', attrId]
      ], 1)
      if (valIds.length > 0) {
        valId = valIds[0]
      } else {
        valId = await client.create('product.attribute.value', {
          name: attrVal,
          attribute_id: attrId
        })
      }
      valueIdMap[attrName][attrVal] = valId
    }
  }

  // Step 3: Attribute Lines configuration
  for (const [attrName, attrId] of Object.entries(attributeIdMap)) {
    const desiredValueIds = Object.values(valueIdMap[attrName])
    const lineId = await ensureSingleAttributeLine(
      client,
      templateId,
      attrId,
      desiredValueIds,
      platform === 'salla',
    )
    console.info(
      `[SyncEngine] Ensured single product.template.attribute.line #${lineId} for attribute "${attrName}" with values: [${desiredValueIds.join(', ')}]`
    )
  }

  // Step 4: Force Odoo to generate product.product variants by writing
  // attribute_line_ids back to the template via One2many replace.
  // This triggers Odoo's internal _create_variant_ids hook.
  const allLineIds = await client.search('product.template.attribute.line', [
    ['product_tmpl_id', '=', templateId]
  ], 1000)
  if (allLineIds.length > 0) {
    try {
      const written = await client.write('product.template', [templateId], {
        attribute_line_ids: [[6, 0, allLineIds]]
      })
      if (!written && platform === 'salla') throw new Error(`Odoo rejected variant generation for product #${templateId}`)
      console.info(`[SyncEngine] Wrote attribute_line_ids [[6,0,[${allLineIds.join(',')}]]] to template #${templateId} to trigger variant generation.`)
    } catch (err: any) {
      if (platform === 'salla') throw err
      console.warn(`[SyncEngine] Failed to trigger variant generation via write (non-critical): ${err?.message ?? err}`)
    }
  }

  // Step 5: Fetch auto-generated product.product variants linked to the template
  console.info(`[SyncEngine] Fetching generated product.product records for template #${templateId}...`)
  const settings = (mapping.mappings as any)?.__settings || {}
  const varOdooField = (mapping as any).variant_odoo_match_field || settings.variantOdooMatchField || ''
  const varZidField = (mapping as any).variant_zid_match_field || settings.variantZidMatchField || ''

  const generatedVariants = await readAllProductRows(client, 'product.product', [
    ['product_tmpl_id', '=', templateId]
  ], ['id', 'product_template_attribute_value_ids', 'default_code', 'barcode', ...(varOdooField ? [varOdooField] : [])])

  const ptavs = await readAllProductRows(client, 'product.template.attribute.value', [
    ['product_tmpl_id', '=', templateId]
  ], ['id', 'attribute_id', 'product_attribute_value_id', 'name', 'price_extra'])

  const ptavMap: Record<string, { attribute: string; value: string; price_extra: number }> = {}
  for (const ptav of ptavs) {
    const attrName = Array.isArray(ptav.attribute_id) ? ptav.attribute_id[1] : ''
    let valName = Array.isArray(ptav.product_attribute_value_id) ? ptav.product_attribute_value_id[1] : ptav.name
    if (valName && attrName) {
      const prefix = attrName.toLowerCase() + ': '
      if (valName.toLowerCase().startsWith(prefix)) {
        valName = valName.substring(prefix.length)
      }
    }
    ptavMap[ptav.id] = { attribute: attrName, value: valName, price_extra: ptav.price_extra ?? 0 }
  }

  // Fetch current template base list_price (shared by all variants in Odoo)
  const templateRecords = await client.searchRead<any>('product.template', [
    ['id', '=', templateId]
  ], ['list_price'])
  const templateBasePrice: number = templateRecords.length > 0 ? (Number(templateRecords[0].list_price) || 0) : 0
  console.info(`[SyncEngine] Template #${templateId} base list_price = ${templateBasePrice}`)

  for (const odooVar of generatedVariants) {
    const odooVarAttrs: Record<string, string> = {}
    const ptavIds = odooVar.product_template_attribute_value_ids || []
    for (const ptavId of ptavIds) {
      const resolved = ptavMap[ptavId]
      if (resolved) {
        odooVarAttrs[resolved.attribute] = resolved.value
      }
    }
    odooVar.resolvedAttributes = odooVarAttrs
  }
  console.info(`[SyncEngine] Resolved generated variants:`, JSON.stringify(generatedVariants.map(ov => ({ id: ov.id, attributes: ov.resolvedAttributes })), null, 2))

  const attributesMatch = (attrs1: Record<string, string>, attrs2: Record<string, string>): boolean => {
    const keys1 = Object.keys(attrs1)
    const keys2 = Object.keys(attrs2)
    if (!keys1.length || keys1.length !== keys2.length) return false
    return keys1.every(k => {
      const v1 = String(attrs1[k] ?? '').trim().toLowerCase()
      const keyMatch = keys2.find(k2 => k2.trim().toLowerCase() === k.trim().toLowerCase())
      if (!keyMatch) return false
      return v1 === String(attrs2[keyMatch] ?? '').trim().toLowerCase()
    })
  }


  // Step 6: Variant Update (Update matching product.product records)
  let updatedCount = 0
  const variantPrices = new Map<number, number>()
  const variantRecords = new Map<string, number>()
  const usedVariantIds = new Set<number>()
  for (const variant of variants) {
    const variantValues = await buildVariantProductValues(client, odooValues, zidData, variant, mergedSettings || {}, platform)
    const detailValues: Record<string, any> = {}
    for (const field of ['default_code', 'barcode', 'standard_price', 'weight']) {
      if (variantValues[field] !== undefined) detailValues[field] = variantValues[field]
    }
    // Description is a shared template field; it was applied once above.
    // Variant images are never synced (2026-11-09).
    if (varOdooField && varOdooField !== 'id' && varZidField) {
      const value = resolveZidMatchValue({ ...variant.source, id: variant.id, sku: variant.sku, barcode: variant.barcode }, varZidField)
      if (value !== undefined && value !== null && value !== '') detailValues[varOdooField] = String(value)
    }
    let matchingOdooVar = null

    if (varOdooField && varZidField) {
      let matchValue: any = null
      if (varZidField === 'sku') matchValue = variant.sku
      else if (varZidField === 'id') matchValue = variant.id
      else if (varZidField === 'barcode') matchValue = variant.barcode
      else if (varZidField === 'product_id' || varZidField === 'parent_id') {
        matchValue = variant.product_id || zidData.id || zidData.product_id || null
      }

      if (matchValue !== null && matchValue !== undefined && matchValue !== '') {
        matchingOdooVar = generatedVariants.find((ov: any) => {
          const ovVal = ov[varOdooField]
          return String(ovVal).trim().toLowerCase() === String(matchValue).trim().toLowerCase()
        })
        if (matchingOdooVar) {
          console.info(`[SyncEngine] Matched variant by custom field (${varOdooField} = ${matchValue}) → product.product #${matchingOdooVar.id}`)
        }
      }
    }

    if (!matchingOdooVar) {
      if (variant.sku) {
        matchingOdooVar = generatedVariants.find((ov: any) =>
          String(ov.default_code).trim().toLowerCase() === String(variant.sku).trim().toLowerCase()
        )
      }
      if (!matchingOdooVar && variant.barcode) {
        matchingOdooVar = generatedVariants.find((ov: any) =>
          String(ov.barcode).trim().toLowerCase() === String(variant.barcode).trim().toLowerCase()
        )
      }
    }

    if (!matchingOdooVar) {
      matchingOdooVar = generatedVariants.find((ov: any) =>
        attributesMatch(variant.attributes, ov.resolvedAttributes)
      )
    }

    if (matchingOdooVar) {
      if (usedVariantIds.has(matchingOdooVar.id)) throw new Error('Multiple source variants matched the same Odoo variant; verify variant matching fields')
      usedVariantIds.add(matchingOdooVar.id)
      if (variant.id) variantRecords.set(String(variant.id), matchingOdooVar.id)
      console.info(`[SyncEngine] Matched webhook variant (SKU: ${variant.sku}) to Odoo product.product #${matchingOdooVar.id}`)

      const written = await client.write('product.product', [matchingOdooVar.id], detailValues)
      if (!written && platform === 'salla') throw new Error(`Odoo rejected Salla variant #${matchingOdooVar.id}`)
      if (finiteProductNumber(variantValues.list_price) !== undefined) variantPrices.set(matchingOdooVar.id, Number(variantValues.list_price))
      await syncProductStockQuantities(client, matchingOdooVar.id, { ...variant.source, quantity: variant.quantity }, mergedSettings || {}, mapping.workspace_id, platform)
      updatedCount++
    } else {
      console.warn(`[SyncEngine] No matching Odoo variant found for attributes:`, JSON.stringify(variant.attributes))
      try {
        // Collect matching product.template.attribute.value (PTAV) IDs for dynamic variant generation
        const matchedPtavIds: number[] = []
        for (const [attrName, attrVal] of Object.entries(variant.attributes)) {
          const normAttrName = attrName.trim().toLowerCase()
          const normAttrVal = String(attrVal ?? '').trim().toLowerCase()
          const foundPtav = Object.entries(ptavMap).find(([, meta]) => {
            return meta.attribute.trim().toLowerCase() === normAttrName &&
                   meta.value.trim().toLowerCase() === normAttrVal
          })
          if (foundPtav) {
            matchedPtavIds.push(Number(foundPtav[0]))
          }
        }

        if (matchedPtavIds.length !== Object.keys(variant.attributes).length || !matchedPtavIds.length) {
          throw new Error(`Cannot create a variant without a complete attribute combination: ${variant.id}`)
        }
        const createVariantPayload = {
          ...detailValues,
          product_tmpl_id: templateId,
          product_template_attribute_value_ids: [[6, 0, matchedPtavIds]],
        }
        assertProductWriteAllowed(mergedSettings || {}, false)
        const createdVarId = await client.create('product.product', createVariantPayload)
        if (variant.id) variantRecords.set(String(variant.id), createdVarId)
        if (finiteProductNumber(variantValues.list_price) !== undefined) variantPrices.set(createdVarId, Number(variantValues.list_price))
        await syncProductStockQuantities(client, createdVarId, { ...variant.source, quantity: variant.quantity }, mergedSettings || {}, mapping.workspace_id, platform)
        updatedCount++
      } catch (createErr: any) {
        throw createErr
      }
    }
  }

  const priceSync = await syncVariantPrices(client, templateId, variantPrices, false, platform === 'salla')
  if (!priceSync.represented) {
    if (platform === 'salla') throw new Error(priceSync.reason || 'Odoo cannot represent the Salla variant prices')
    await logSync({ workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: 'product.template', odoo_record_id: templateId, status: 'skipped', error_message: 'Variant prices cannot be represented as attribute extras (prices kept as-is)', payload: { ...zidData, reason: priceSync.reason }, trigger_type: triggerType, platform })
  }
  for (const [sourceId, recordId] of variantRecords) {
    await logSync({ workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: sourceId, odoo_model: 'product.product', odoo_record_id: recordId, status: 'success', payload: zidData, trigger_type: triggerType, platform })
  }

  // Zid reports a removed option value as a parent product.update with a
  // shorter variants[] list — there is no product.delete for the child. Without
  // reconciliation the Odoo product.product stayed active while the sync log
  // said "success". Archive only variants this store previously wrote (prior
  // success sync_logs) that are absent from the current full list. Guards:
  // - update of an existing template only (a first create has no stale state);
  // - non-empty incoming list (empty means unknown, never "remove everything");
  // - every incoming variant carries an id (otherwise the list is not reliable).
  const odooVariantIds = generatedVariants.map(v => Number(v.id)).filter(id => Number.isInteger(id) && id > 0)
  const canReconcile = duplicateId !== null
    && variants.length > 0
    && variants.every(v => Boolean(v.id))
    && odooVariantIds.length > 0
    && Boolean(mapping.workspace_id)
  if (canReconcile) {
    try {
      const { data: priorLogs } = await supabaseAdmin
        .from('sync_logs')
        .select('zid_entity_id, odoo_record_id')
        .eq('workspace_id', mapping.workspace_id)
        .eq('platform', platform)
        .eq('store_id', storeId)
        .eq('odoo_model', 'product.product')
        .eq('status', 'success')
        .in('odoo_record_id', odooVariantIds)
      const priorLinks = (Array.isArray(priorLogs) ? priorLogs : []).map(row => ({
        zidEntityId: String((row as any).zid_entity_id ?? ''),
        odooRecordId: Number((row as any).odoo_record_id),
      }))
      const staleIds = pickStaleZidVariants({
        odooVariantIds,
        usedOdooVariantIds: usedVariantIds,
        priorLinks,
        currentZidVariantIds: variantRecords.keys(),
      })
      if (staleIds.length > 0) {
        await client.write('product.product', staleIds, { active: false })
        console.info(`[SyncEngine] Archived ${staleIds.length} Zid variant(s) removed from the parent product: #${staleIds.join(', #')}`)
      }
    } catch (err: any) {
      // Reconciliation is a cleanup pass, not the primary sync. A failure here
      // must not turn an otherwise successful product update into a retry.
      console.warn(`[SyncEngine] Variant removal reconciliation failed for template #${templateId}:`, err?.message ?? err)
    }
  }

  const successMsg = `Successfully synced product.template #${templateId} and updated ${updatedCount}/${variants.length} variant records.`
  console.info(`[SyncEngine] ✅ ${successMsg}`)

  await logSync({
    id: existingLogId,
    workspace_id: mapping.workspace_id,
    field_mapping_id: mapping.id,
    event,
    store_id: storeId,
    zid_entity_id: zidEntityId,
    odoo_model: 'product.template',
    odoo_record_id: templateId,
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
    odooRecordId: templateId,
    message: successMsg
  }
}

export async function syncChildVariantAsVariant(
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
  _defaultLocationId?: number,
  _infiniteValue?: number,
  _priceSettings?: { markup_percent: number; rounding: string; decimal_places: number },
  fixedMatch?: { odoo_field: string; zid_field: string },
  mergedSettings: Record<string, any> = {}
): Promise<SyncEngineResult['records'][number]> {
  const parentZidId = zidData.parent_id || (zidData.parent as any)?.id
  console.info(`[SyncEngine] Intercepted Zid child variant webhook (ID: ${zidEntityId}, Parent ID: ${parentZidId}).`)

  if (!parentZidId) {
    throw new Error(`Could not resolve parent product ID for child variant ${zidEntityId}`)
  }

  let parentIds: number[] = []
  // A product.template may not have any store-ID custom columns. On Odoo
  // 14–20, searching a missing column raises an XML-RPC fault (and emits a
  // large runtime traceback) even when the later durable-link lookup succeeds.
  // Probe field metadata first, and fall through to scoped entity links/logs
  // when the columns are absent or metadata cannot be read.
  const parentMatchFields = fixedMatch?.odoo_field && fixedMatch.zid_field === 'id'
    ? [fixedMatch.odoo_field]
    : [platformIdField(platform), platformLegacyIdField(platform)]
  try {
    const parentFieldMeta = await fetchFieldMeta(
      client,
      'product.template',
      parentMatchFields.filter(field => field !== 'id'),
    )
    for (const field of parentMatchFields) {
      if (field === 'id') {
        if (!Number.isSafeInteger(Number(parentZidId)) || Number(parentZidId) <= 0) continue
      } else if (!parentFieldMeta.has(field)) {
        continue
      }
      try {
        parentIds = await client.search('product.template', [[field, '=', field === 'id' ? Number(parentZidId) : String(parentZidId)]], 1)
        if (parentIds.length > 0) break
      } catch (err) {
        console.warn(`[SyncEngine] Parent match via product.template.${field} failed; trying scoped links:`, err)
      }
    }
  } catch (err) {
    console.warn('[SyncEngine] Parent product field metadata unavailable; trying scoped links:', err)
  }
  // Fallback 1: Resolve parent template via odoo_entity_links
  if (parentIds.length === 0 && mapping.workspace_id) {
    const linkedParentId = await resolveEntityLinkId({
      workspaceId: mapping.workspace_id,
      platform,
      storeId,
      odooModel: 'product.template',
      storeEntityId: String(parentZidId),
    })
    if (linkedParentId) {
      const confirmed = await client.search('product.template', [['id', '=', linkedParentId]], 1).catch(() => [])
      if (confirmed && confirmed.length > 0) {
        parentIds = [linkedParentId]
        console.info(`[SyncEngine] Resolved parent template ID #${linkedParentId} via odoo_entity_links for Zid parent ${parentZidId}`)
      }
    }
  }

  // Fallback 2: Resolve parent template via sync_logs
  if (parentIds.length === 0 && mapping.workspace_id) {
    try {
      const { data: logRows } = await supabaseAdmin
        .from('sync_logs')
        .select('odoo_record_id')
        .eq('workspace_id', mapping.workspace_id)
        .eq('store_id', storeId)
        .eq('platform', platform)
        .eq('erp_connection_id', getErpExecutionScope()?.erpConnectionId || mapping.erp_connection_id)
        .eq('connection_generation', getErpExecutionScope()?.connectionGeneration || '')
        .eq('zid_entity_id', String(parentZidId))
        .eq('odoo_model', 'product.template')
        .eq('status', 'success')
        .not('odoo_record_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)

      if (logRows && logRows.length > 0 && logRows[0].odoo_record_id) {
        const loggedId = Number(logRows[0].odoo_record_id)
        const confirmed = await client.search('product.template', [['id', '=', loggedId]], 1).catch(() => [])
        if (confirmed && confirmed.length > 0) {
          parentIds = [loggedId]
          console.info(`[SyncEngine] Resolved parent template ID #${loggedId} via sync_logs for Zid parent ${parentZidId}`)
        }
      }
    } catch { /* best-effort */ }
  }

  // Fallback 3: Check custom Odoo fields on product.template (e.g. x_zid_id_product)
  if (parentIds.length === 0) {
    try {
      const meta = await fetchFieldMeta(client, 'product.template', ['x_zid_id_product', 'x_zid_id', 'zid_id'])
      for (const fName of ['x_zid_id_product', 'x_zid_id', 'zid_id']) {
        if (meta.has(fName)) {
          const found = await client.search('product.template', [[fName, '=', String(parentZidId)]], 1).catch(() => [])
          if (found && found.length > 0) {
            parentIds = found
            console.info(`[SyncEngine] Resolved parent template ID #${found[0]} via ${fName} for Zid parent ${parentZidId}`)
            break
          }
        }
      }
    } catch { /* best-effort */ }
  }

  // Fallback 4: Check parent SKU if present on child data
  if (parentIds.length === 0) {
    const pSku = (zidData.parent as any)?.sku || (zidData.parent as any)?.code || (zidData as any).parent_sku
    if (pSku) {
      try {
        const found = await client.search('product.template', [['default_code', '=', String(pSku)]], 1).catch(() => [])
        if (found && found.length > 0) {
          parentIds = found
          console.info(`[SyncEngine] Resolved parent template ID #${found[0]} via parent SKU (${pSku}) for Zid parent ${parentZidId}`)
        }
      } catch { /* best-effort */ }
    }
  }
  if (parentIds.length === 0) {
    throw new Error(`Parent product template (Zid ID: ${parentZidId}) not found in Odoo yet; retry after the parent is synced.`)
  }

  const templateId = parentIds[0]
  console.info(`[SyncEngine] Found parent product template ID: #${templateId} in Odoo.`)

  const rawAttrs = zidData.attributes || zidData.features || zidData.option_values || []
  const attributes: Record<string, string> = {}
  if (Array.isArray(rawAttrs)) {
    rawAttrs.forEach((attr: any) => {
      const attrName = toNameString(attr.name || attr.label || attr.option_name || attr.option_label || attr.slug)
      const attrVal = toNameString(attr.value || attr.value_name || attr.option_value || attr.option_value_name || attr.val || attr.text)
      if (attrName && attrVal) {
        attributes[attrName] = attrVal
      }
    })
  }

  const attributeIdMap: Record<string, number> = {}
  const valueIdMap: Record<string, number> = {}

  for (const [attrName, attrVal] of Object.entries(attributes)) {
    let attrId: number
    const attrIds = await client.search('product.attribute', [['name', '=', attrName]], 1)
    if (attrIds.length > 0) {
      attrId = attrIds[0]
    } else {
      attrId = await client.create('product.attribute', { name: attrName, create_variant: 'always' })
    }
    attributeIdMap[attrName] = attrId

    let valId: number
    const valIds = await client.search('product.attribute.value', [
      ['name', '=', attrVal],
      ['attribute_id', '=', attrId]
    ], 1)
    if (valIds.length > 0) {
      valId = valIds[0]
    } else {
      valId = await client.create('product.attribute.value', {
        name: attrVal,
        attribute_id: attrId
      })
    }
    valueIdMap[attrName] = valId
  }

  for (const [attrName, attrId] of Object.entries(attributeIdMap)) {
    const desiredValId = valueIdMap[attrName]
    await ensureSingleAttributeLine(client, templateId, attrId, [desiredValId])
  }

  const allLineIds = await client.search('product.template.attribute.line', [
    ['product_tmpl_id', '=', templateId]
  ], 1000)
  if (allLineIds.length > 0) {
    try {
      await client.write('product.template', [templateId], {
        attribute_line_ids: [[6, 0, allLineIds]]
      })
      console.info(`[SyncEngine] Wrote attribute_line_ids [[6,0,[${allLineIds.join(',')}]]] to template #${templateId} to trigger variant generation.`)
    } catch (err: any) {
      console.warn(`[SyncEngine] Failed to trigger variant generation via write (non-critical): ${err?.message ?? err}`)
    }
  }

  const settings = (mapping.mappings as any)?.__settings || {}
  const varOdooField = (mapping as any).variant_odoo_match_field || settings.variantOdooMatchField || ''
  const varZidField = (mapping as any).variant_zid_match_field || settings.variantZidMatchField || ''

  const generatedVariants = await readAllProductRows(client, 'product.product', [
    ['product_tmpl_id', '=', templateId]
  ], ['id', 'product_template_attribute_value_ids', 'default_code', 'barcode', ...(varOdooField ? [varOdooField] : [])])

  const ptavs = await readAllProductRows(client, 'product.template.attribute.value', [
    ['product_tmpl_id', '=', templateId]
  ], ['id', 'attribute_id', 'product_attribute_value_id', 'name', 'price_extra'])

  const ptavMap: Record<string, { attribute: string; value: string; price_extra: number }> = {}
  for (const ptav of ptavs) {
    const attrName = Array.isArray(ptav.attribute_id) ? ptav.attribute_id[1] : ''
    let valName = Array.isArray(ptav.product_attribute_value_id) ? ptav.product_attribute_value_id[1] : ptav.name
    if (valName && attrName) {
      const prefix = attrName.toLowerCase() + ': '
      if (valName.toLowerCase().startsWith(prefix)) {
        valName = valName.substring(prefix.length)
      }
    }
    ptavMap[ptav.id] = { attribute: attrName, value: valName, price_extra: ptav.price_extra ?? 0 }
  }

  // Fetch current template base list_price
  const templateBaseRecs = await client.searchRead<any>('product.template', [
    ['id', '=', templateId]
  ], ['list_price'])
  const childTemplateBasePrice: number = templateBaseRecs.length > 0 ? (Number(templateBaseRecs[0].list_price) || 0) : 0
  console.info(`[SyncEngine] Child variant: template #${templateId} base list_price = ${childTemplateBasePrice}`)

  for (const odooVar of generatedVariants) {
    const odooVarAttrs: Record<string, string> = {}
    const ptavIds = odooVar.product_template_attribute_value_ids || []
    for (const ptavId of ptavIds) {
      const resolved = ptavMap[ptavId]
      if (resolved) {
        odooVarAttrs[resolved.attribute] = resolved.value
      }
    }
    odooVar.resolvedAttributes = odooVarAttrs
  }

  const attributesMatch = (attrs1: Record<string, string>, attrs2: Record<string, string>): boolean => {
    const keys1 = Object.keys(attrs1)
    const keys2 = Object.keys(attrs2)
    if (!keys1.length || keys1.length !== keys2.length) return false
    return keys1.every(k => {
      const v1 = attrs1[k]
      const keyMatch = keys2.find(k2 => k2.toLowerCase() === k.toLowerCase())
      if (!keyMatch) return false
      return v1.toLowerCase() === attrs2[keyMatch].toLowerCase()
    })
  }


  let matchingOdooVar = null

  if (varOdooField && varZidField) {
    let matchValue: any = null
    if (varZidField === 'sku') matchValue = zidData.sku
    else if (varZidField === 'id') matchValue = zidData.id
    else if (varZidField === 'barcode') matchValue = zidData.barcode
    else if (varZidField === 'product_id' || varZidField === 'parent_id') matchValue = parentZidId

    if (matchValue !== null && matchValue !== undefined && matchValue !== '') {
      matchingOdooVar = generatedVariants.find((ov: any) => {
        const ovVal = ov[varOdooField]
        return String(ovVal).trim().toLowerCase() === String(matchValue).trim().toLowerCase()
      })
    }
  }

  if (!matchingOdooVar) {
    if (zidData.sku) {
      matchingOdooVar = generatedVariants.find((ov: any) =>
        String(ov.default_code).trim().toLowerCase() === String(zidData.sku).trim().toLowerCase()
      )
    }
    if (!matchingOdooVar && zidData.barcode) {
      matchingOdooVar = generatedVariants.find((ov: any) =>
        String(ov.barcode).trim().toLowerCase() === String(zidData.barcode).trim().toLowerCase()
      )
    }
  }

  if (!matchingOdooVar) {
    matchingOdooVar = generatedVariants.find((ov: any) =>
      attributesMatch(attributes, ov.resolvedAttributes)
    )
  }

  if (matchingOdooVar) {
    console.info(`[SyncEngine] Matched child variant to Odoo product.product #${matchingOdooVar.id}`)
    const updatePayload: Record<string, any> = {}
    for (const field of ['default_code', 'barcode', 'standard_price', 'weight']) {
      if (odooValues[field] !== undefined) updatePayload[field] = odooValues[field]
    }
    if (varOdooField && varOdooField !== 'id' && varZidField) {
      const value = resolveZidMatchValue(zidData, varZidField)
      if (value !== undefined && value !== null && value !== '') updatePayload[varOdooField] = String(value)
    }
    assertProductWriteAllowed(mergedSettings, true)
    await client.write('product.product', [matchingOdooVar.id], updatePayload)
    const price = finiteProductNumber(odooValues.list_price)
    if (price !== undefined) {
      const priceSync = await syncVariantPrices(client, templateId, new Map([[matchingOdooVar.id, price]]), true)
      if (!priceSync.represented) {
        await logSync({ workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: 'product.product', odoo_record_id: matchingOdooVar.id, status: 'skipped', error_message: 'Variant price cannot be represented as attribute extras (price kept as-is)', payload: { ...zidData, reason: priceSync.reason }, trigger_type: triggerType, platform })
      }
    }
    await syncProductStockQuantities(client, matchingOdooVar.id, zidData, mergedSettings, mapping.workspace_id, platform)

    const successMsg = `Successfully updated child variant product.product #${matchingOdooVar.id} under parent template #${templateId}.`
    console.info(`[SyncEngine] ✅ ${successMsg}`)

    await logSync({
      id: existingLogId,
      workspace_id: mapping.workspace_id,
      field_mapping_id: mapping.id,
      event,
      store_id: storeId,
      zid_entity_id: zidEntityId,
      odoo_model: 'product.product',
      odoo_record_id: matchingOdooVar.id,
      status: 'success',
      payload: zidData,
      platform,
        trigger_type: triggerType
    })

    return {
      mappingId: mapping.id,
      mappingName: mapping.name,
      model: 'product.product',
      status: 'success',
      odooRecordId: matchingOdooVar.id,
      message: successMsg
    }
  } else {
    const matchedPtavIds = Object.entries(attributes).map(([name, value]) => {
      const found = Object.entries(ptavMap).find(([, meta]) => meta.attribute.trim().toLowerCase() === name.trim().toLowerCase() && meta.value.trim().toLowerCase() === value.trim().toLowerCase())
      if (!found) throw new Error(`Unresolved attribute ${name} for child ${zidEntityId}`)
      return Number(found[0])
    })
    if (!matchedPtavIds.length) throw new Error(`Child ${zidEntityId} has no attribute combination`)
    const createVariantPayload: Record<string, any> = {
      product_tmpl_id: templateId,
      product_template_attribute_value_ids: [[6, 0, matchedPtavIds]],
    }
    for (const field of ['default_code', 'barcode', 'standard_price', 'weight']) {
      if (odooValues[field] !== undefined) createVariantPayload[field] = odooValues[field]
    }
    if (varOdooField && varOdooField !== 'id' && varZidField) {
      const value = resolveZidMatchValue(zidData, varZidField)
      if (value !== undefined && value !== null && value !== '') createVariantPayload[varOdooField] = String(value)
    }
    assertProductWriteAllowed(mergedSettings, false)
    const createdVarId = await client.create('product.product', createVariantPayload)
    const price = finiteProductNumber(odooValues.list_price)
    if (price !== undefined) {
      const priceSync = await syncVariantPrices(client, templateId, new Map([[createdVarId, price]]), true)
      if (!priceSync.represented) {
        await logSync({ workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: 'product.product', odoo_record_id: createdVarId, status: 'skipped', error_message: 'Variant price cannot be represented as attribute extras (price kept as-is)', payload: { ...zidData, reason: priceSync.reason }, trigger_type: triggerType, platform })
      }
    }
    await syncProductStockQuantities(client, createdVarId, zidData, mergedSettings, mapping.workspace_id, platform)

    if (createdVarId !== null) {
      const successMsg = `Created missing child variant product.product #${createdVarId} under parent template #${templateId}.`
      console.info(`[SyncEngine] ✅ ${successMsg}`)
      await logSync({
        id: existingLogId,
        workspace_id: mapping.workspace_id,
        field_mapping_id: mapping.id,
        event,
        store_id: storeId,
        zid_entity_id: zidEntityId,
        odoo_model: 'product.product',
        odoo_record_id: createdVarId,
        status: 'success',
        payload: zidData,
        platform,
        trigger_type: triggerType
      })
      return {
        mappingId: mapping.id,
        mappingName: mapping.name,
        model: 'product.product',
        status: 'success',
        odooRecordId: createdVarId,
        message: successMsg
      }
    }

    const errorMsg = `Could not match or create Odoo variant for ${zidEntityId}: ${JSON.stringify(attributes)}`
    console.warn(`[SyncEngine] ${errorMsg}`)
    await logSync({
      id: existingLogId,
      workspace_id: mapping.workspace_id,
      field_mapping_id: mapping.id,
      event,
      store_id: storeId,
      zid_entity_id: zidEntityId,
      odoo_model: 'product.product',
      status: 'skipped',
      error_message: errorMsg,
      payload: zidData,
      platform,
        trigger_type: triggerType
    })
    return {
      mappingId: mapping.id,
      mappingName: mapping.name,
      model: 'product.product',
      status: 'skipped',
      message: errorMsg
    }
  }
}
