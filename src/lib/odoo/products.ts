import { type SyncProductBom } from '@/lib/odoo/product-bom'
import { applyFixedSettingsToValues, applyRulesToValues } from '@/lib/odoo/value-settings'
import { findSallaProductTax } from '@/lib/products/salla-tax'
import { assertSallaVariantCombinations, extractGenericVariants } from '@/lib/products/variants'
import { resolvePath, toNameString } from '@/lib/sync-helpers'
import { supabaseAdmin } from '@/lib/sync-runtime'

import type { ExecuteOdooParams, OdooConfiguredMatch, OdooSyncRecord, OdooValuesPreparation } from './operation-types'
import { syncAsVariants, syncChildVariantAsVariant } from './product-native-variants'
import { syncAsSeparateProducts, syncChildAsSeparateProduct } from './product-separate-variants'
import type { ResolveOdooRelation } from './relations'

export async function prepareOdooProduct({
  client, mapping, event, zidData, odooValues, mergedSettings, odooModel, odooOperation, storeId, zidEntityId, presetKey, triggerType, existingLogId,
  execPlatform, defaultLocationId, infiniteValue, pSettings, fixedMatch, matchStrategy,
  resolveSingleRelationId, syncProductBom,
}: OdooValuesPreparation & {
  execPlatform: NonNullable<ExecuteOdooParams['platformHint']>
  defaultLocationId?: number
  infiniteValue?: number
  pSettings?: { markup_percent: number; rounding: string; decimal_places: number }
  fixedMatch?: OdooConfiguredMatch
  matchStrategy?: string
  resolveSingleRelationId: ResolveOdooRelation
  syncProductBom: SyncProductBom
}): Promise<{ values: Record<string, unknown> } | { record: OdooSyncRecord }> {
  // Zid and Salla share past-tense event names. Keep the dispatched platform.
  const platform = execPlatform
  const variantSyncMode = (mergedSettings)?.variant?.sync_mode || (mapping as any).variant_sync_mode || 'AS_VARIANTS'
  const companyName = (mergedSettings)?.company_id ? `المعرف ${(mergedSettings).company_id}` : 'الافتراضية'
  console.info(`[SyncEngine] ⚙️ إعدادات تسجيل المنتج في أودو: [الشركة: ${companyName}] | [طريقة المزامنة للمتغيرات: ${variantSyncMode}]`)
  console.info(`[SyncEngine] ⏳ محاولة التسجيل في أودو للموديل: ${odooModel} (العملية: ${odooOperation})...`)

  // Apply fixed mapping settings to values (type, sale_ok, price, warehouse, etc.)
  const majorVersion = await client.getMajorVersion().catch(() => 17)
  let effectiveOdooValues = await applyFixedSettingsToValues(odooValues, mergedSettings, zidData, majorVersion, mapping.workspace_id, platform, odooModel)
  delete effectiveOdooValues.id
  if (platform === 'salla' && mergedSettings.tax && ['auto_by_name', undefined].includes(mergedSettings.tax.sync_mode) &&
      effectiveOdooValues.taxes_id === undefined) {
    const rawTaxName = zidData.tax_name ?? resolvePath(zidData, 'tax.name')
    const taxName = typeof rawTaxName === 'string' ? rawTaxName.trim() : ''
    let mappedId: number | undefined
    if (mapping.workspace_id && taxName) {
      const { data: taxMapping, error } = await supabaseAdmin.from('tax_mappings').select('odoo_tax_id')
        .eq('workspace_id', mapping.workspace_id).eq('platform', 'salla').eq('source_tax_name', taxName).maybeSingle()
      if (error) throw new Error('Could not load the Salla tax mapping')
      mappedId = taxMapping?.odoo_tax_id
    }
    const taxId = await findSallaProductTax(client, zidData, effectiveOdooValues.company_id, mappedId)
    if (taxId !== undefined) effectiveOdooValues.taxes_id = [[6, 0, [taxId]]]
  }

  // ── Auto-resolve category when not mapped by field presets ──
  // The standard preset may not include categ_id → categories in its field_rows.
  // When category.sync_mode is 'auto' or 'map_existing', resolve from zidData and inject.
  if (effectiveOdooValues.categ_id === undefined) {
    const _catCfg = (mergedSettings)?.category
    const _catSyncMode = _catCfg?.sync_mode || 'auto'
    if (_catSyncMode !== 'skip') {
      const _catRawValue = zidData.categories ?? (zidData as any).category
      if (_catRawValue !== undefined && _catRawValue !== null) {
        const _catSingle = Array.isArray(_catRawValue) ? _catRawValue[0] : _catRawValue
        try {
          if (_catSyncMode === 'map_existing') {
            // Only link to existing categories — do not create new ones
            const _catName = toNameString(_catSingle)
            if (_catName && !_catName.startsWith('{')) {
              const _found = await client.search('product.category', [['name', '=', _catName]], 1)
              if (_found && _found.length > 0) {
                effectiveOdooValues.categ_id = _found[0]
                console.info(`[SyncEngine] Category sync (map_existing): linked existing "${_catName}" → product.category #${_found[0]}`)
              }
            }
          } else {
            // 'auto' — resolve and create in Odoo if not found
            const _resolved = await resolveSingleRelationId(client, 'product.category', _catSingle, platform, undefined, undefined, mapping.workspace_id, storeId)
            if (_resolved) {
              effectiveOdooValues.categ_id = _resolved
            }
          }
        } catch (_catErr: any) {
          console.warn(`[SyncEngine] Failed to resolve category for product:`, _catErr?.message ?? _catErr)
        }
      }
    }
  }

  // Apply conditional rules and currency conversion
  effectiveOdooValues = await applyRulesToValues(
    effectiveOdooValues,
    mapping.workspace_id,
    presetKey,
    zidData,
    client
  )

  console.info(`[SyncEngine] Variant sync mode: "${variantSyncMode}"`)

  const isChild = platform === 'zid' && (!!zidData.parent_id || !!zidData.parent)
  if (isChild && variantSyncMode === 'AS_VARIANTS') {
    return { record: await syncChildVariantAsVariant(
      client,
      mapping,
      event,
      storeId,
      zidEntityId,
      zidData,
      effectiveOdooValues,
      platform,
      triggerType,
      existingLogId,
      defaultLocationId,
      infiniteValue,
      pSettings,
      fixedMatch,
      mergedSettings
    ) }
  }

  if (isChild && variantSyncMode === 'AS_SEPARATE_PRODUCTS') {
    // In AS_SEPARATE_PRODUCTS mode, each variant is a separate product.template.
    // When a child product webhook comes in, we need to sync it individually
    // by finding/creating its corresponding product.template.
    console.info(`[SyncEngine] Processing Zid child product (ID: ${zidEntityId}) in AS_SEPARATE_PRODUCTS mode — syncing as standalone product.template.`)
    return { record: await syncChildAsSeparateProduct(
      syncProductBom,
      client,
      mapping,
      event,
      storeId,
      zidEntityId,
      zidData,
      effectiveOdooValues,
      platform,
      triggerType,
      existingLogId,
      matchStrategy,
      defaultLocationId,
      infiniteValue,
      fixedMatch,
      pSettings,
      mergedSettings
    ) }
  }

  const variants = extractGenericVariants(zidData, platform)
  if (variants.length > 0) {
    if (platform === 'salla' && variantSyncMode === 'AS_VARIANTS') assertSallaVariantCombinations(variants)

    if (variantSyncMode === 'AS_SEPARATE_PRODUCTS') {
      return { record: await syncAsSeparateProducts(
        syncProductBom,
        client,
        mapping,
        event,
        storeId,
        zidEntityId,
        zidData,
        effectiveOdooValues,
        variants,
        platform,
        triggerType,
        existingLogId,
        matchStrategy,
        defaultLocationId,
        infiniteValue,
        fixedMatch,
        pSettings,
        mergedSettings
      ) }
    } else {
      return { record: await syncAsVariants(
        syncProductBom,
        client,
        mapping,
        event,
        storeId,
        zidEntityId,
        zidData,
        effectiveOdooValues,
        variants,
        platform,
        triggerType,
        existingLogId,
        matchStrategy,
        defaultLocationId,
        infiniteValue,
        fixedMatch,
        pSettings,
        mergedSettings
      ) }
    }
  }
  return { values: effectiveOdooValues }
}
