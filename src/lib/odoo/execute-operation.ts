import { applyCategoryMappingOverrides } from '@/lib/categories/mapping-overrides'
import { archiveCategory, categoryCompanyClient } from '@/lib/categories/odoo-values'
import { validateCustomerMatchSettings } from '@/lib/customers/matching-settings'
import { upsertEntityLink } from '@/lib/entity-links'
import { getErpExecutionScope } from '@/lib/erp-execution-target'
import { legacyFixedMappingTablesEnabled } from '@/lib/legacy-fixed-mappings'
import { buildOrderLineItems, prepareSaleOrderForUpdate } from '@/lib/odoo/order-lines'
import { ensureSaleOrderTaxes, maybeApplyOrderStatusAction, processFullDelivery, processPartialDelivery } from '@/lib/odoo/order-workflow'
import { type SyncProductBom } from '@/lib/odoo/product-bom'
import { findExistingOdooRecord, persistPlatformIdOnRecord, safeCreateOdooRecord, safeWriteOdooRecord } from '@/lib/odoo/records'
import { createPreparedOrderCustomer } from '@/lib/orders/customer-create'
import { extractFulfilledItems } from '@/lib/orders/fulfillment-items'
import { validateOrderPayload } from '@/lib/orders/preflight'
import { allPlatformIdFieldNames, platformIdFieldNames } from '@/lib/platform-fields'
import { assertBomCapability, needsProductBom } from '@/lib/products/bom-capability'
import { isDynamicBundle } from '@/lib/products/bundle'
import { assertProductWriteAllowed } from '@/lib/products/settings-values'
import { extractSallaRefundedLines, isReturnSignal, isZidReturnStatus, type StoreReturnLine } from '@/lib/returns/detect'
import { processReturnEvent } from '@/lib/returns/engine'
import { normalizeReturnSettings } from '@/lib/returns/settings'
import { getPlatformFromEvent } from '@/lib/sync/events'
import { getCachedStandardMappingSettings } from '@/lib/sync/settings'
import { resolveZidMatchValue } from '@/lib/sync-helpers'
import { logSync, supabaseAdmin } from '@/lib/sync-runtime'
import type { FieldMappingItem, OdooFieldMeta } from '@/lib/sync-types'

import { prepareOdooCategory } from './categories'
import { prepareOdooCustomer } from './customers'
import type { ExecuteOdooParams, OdooSyncRecord } from './operation-types'
import { prepareOdooOrder, type PendingOrderCustomer } from './order-values'
import { syncProductTemplateStock } from './product-stock'
import { prepareOdooProduct } from './products'
import type { ResolveOdooRelation } from './relations'

export async function executeOdooOperation(
  params: ExecuteOdooParams,
  { syncProductBom, resolveSingleRelationId }: {
    syncProductBom: SyncProductBom
    resolveSingleRelationId: ResolveOdooRelation
  },
): Promise<OdooSyncRecord> {
  const {
    client: suppliedClient,
    mapping: suppliedMapping,
    event,
    storeId,
    zidEntityId,
    zidData,
    odooModel,
    odooOperation,
    odooValues,
    presetKey,
    triggerType,
    existingLogId,
    platformHint,
  } = params

  let client = suppliedClient
  const mapping = odooModel === 'product.template' || odooModel === 'product.product' || odooModel === 'product.category' || odooModel === 'sale.order'
    ? { ...suppliedMapping, merchant_id: storeId || suppliedMapping.merchant_id } : suppliedMapping
  const persistCategoryIdentity = async (recordId: number) => {
    const scope = getErpExecutionScope()
    if (odooModel !== 'product.category' || !scope || !zidEntityId) return
    const saved = await upsertEntityLink({ workspaceId: mapping.workspace_id!, platform: platformHint ?? getPlatformFromEvent(event), storeId: storeId || mapping.merchant_id || '', odooModel, storeEntityId: zidEntityId }, recordId)
    if (!saved) throw new Error('Category was written to Odoo but its durable identity could not be saved')
  }

  // ─── Merge settings for the Odoo model (product.template, res.partner, sale.order, product.category) ──
  let mergedSettings: Record<string, any> = {}
  let effectiveOdooValues = odooValues
  let pendingOrderCustomer: PendingOrderCustomer | null = null
  const inlineSettings: Record<string, any> = (mapping.mappings as any)?.['__settings'] ?? {}
  let ms = inlineSettings
  if (presetKey && mapping.workspace_id && legacyFixedMappingTablesEnabled()) {
    const { data: dbRow } = await supabaseAdmin
      .from('fixed_mapping_settings')
      .select('settings')
      .eq('workspace_id', mapping.workspace_id)
      .eq('preset_key', presetKey)
      .maybeSingle()
    if (dbRow?.settings) {
      ms = { ...(dbRow.settings as Record<string, any>), ...inlineSettings }
    }
  }
  mergedSettings = ms

  // ── Merge standard_mapping_settings (per-store per-entity overrides) ──────────
  const ev = event.toLowerCase()
  const resolvedStoreType: string = presetKey
    ? presetKey.split('_')[0]
    : platformHint ?? (
        ev.startsWith('shopify:') || ev.includes('shopify') ? 'shopify'
        : ev.includes('salla') ? 'salla'
        : 'zid'
      )
  if (mapping.workspace_id) {
    const storeType = resolvedStoreType
    const entityType = odooModel === 'product.category' ? 'categories'
      : odooModel === 'product.template' ? 'products'
      : odooModel === 'res.partner' ? 'customers'
      : odooModel === 'sale.order' ? 'orders'
      : null
    if (entityType) {
      // Prefer the store this operation was dispatched for over the mapping's
      // own merchant: a preset mapping built without merchant_id (or a
      // multi-store workspace) must not fall back to store #1's settings.
      const stdSettings = await getCachedStandardMappingSettings(mapping.workspace_id, storeType, entityType, storeId || mapping.merchant_id || '')
      if (stdSettings) {
        const override: Record<string, any> = { ...stdSettings }
        if (stdSettings.costing_method !== undefined || stdSettings.inventory_valuation !== undefined) {
          override.inventory_valuation = {
            ...((mergedSettings)?.inventory_valuation || {}),
            ...(stdSettings.costing_method ? { property_cost_method: stdSettings.costing_method } : {}),
            ...(stdSettings.inventory_valuation ? { property_valuation: stdSettings.inventory_valuation } : {}),
          }
          if (entityType === 'categories') {
            if (stdSettings.costing_method === '') delete override.inventory_valuation.property_cost_method
            if (stdSettings.inventory_valuation === '') delete override.inventory_valuation.property_valuation
          }
        }
        if (stdSettings.match_zid_field || stdSettings.match_odoo_field) {
          const matchKey = entityType === 'categories' ? 'category'
            : entityType === 'products' ? 'product'
            : entityType === 'customers' ? 'customer'
            : 'order'
          override[matchKey] = {
            ...((mergedSettings)?.[matchKey] || {}),
            ...(stdSettings[matchKey] && typeof stdSettings[matchKey] === 'object' && !Array.isArray(stdSettings[matchKey]) ? stdSettings[matchKey] : {}),
            ...(stdSettings.match_zid_field ? { zid_match_field: stdSettings.match_zid_field } : {}),
            ...(stdSettings.match_odoo_field ? { odoo_match_field: stdSettings.match_odoo_field } : {}),
          }
        }
        if (stdSettings.on_delete) {
          override.delete = {
            ...((mergedSettings)?.delete || {}),
            strategy: stdSettings.on_delete === 'delete_or_archive' ? 'try_delete_archive'
              : stdSettings.on_delete === 'nothing' ? 'skip'
              : stdSettings.on_delete,
          }
        }
        if (Object.keys(override).length > 0) {
          ms = { ...ms, ...override }
          mergedSettings = ms
          if (entityType !== 'products') {
            console.info(`[SyncEngine] Merged standard_mapping_settings for ${storeType}/${entityType}:`, override)
          }
        }
      }
    }
  }

  // Resolve platform once for reuse across order/cancel/deliver operations
  const execPlatform: 'zid' | 'salla' | 'shopify' = platformHint ?? getPlatformFromEvent(event)
  const isSallaOrderCreate = odooModel === 'sale.order' && execPlatform === 'salla' && odooOperation === 'create'
  const finishSallaOrderCreate = async (recordId: number) => {
    const scope = getErpExecutionScope()
    if (scope) {
      const saved = await upsertEntityLink({
        workspaceId: mapping.workspace_id, platform: 'salla', storeId: scope.storeId,
        odooModel: 'sale.order', storeEntityId: zidEntityId,
      }, recordId)
      if (!saved) throw new Error('Salla order was written but its durable identity could not be saved')
    }
    await ensureSaleOrderTaxes(client, recordId, zidData, mapping.workspace_id, 'salla', storeId, true)
    await maybeApplyOrderStatusAction(client, recordId, zidData, mapping.workspace_id, 'salla', storeId, mergedSettings.order ?? {})
  }
  if ((odooModel === 'product.template' || odooModel === 'product.product' || odooModel === 'product.category') &&
      (mergedSettings.disabled || (Array.isArray(mergedSettings.enabled_actions) && !mergedSettings.enabled_actions.includes(odooOperation) &&
        !(execPlatform === 'salla' && odooOperation === 'delete' && mergedSettings.on_delete && mergedSettings.on_delete !== 'nothing')))) {
    const message = `Product ${odooOperation} is disabled in Standard Mapping settings`
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: message, payload: zidData, trigger_type: triggerType, platform: execPlatform })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message }
  }

  if (odooModel === 'product.category') {
    if (mergedSettings.on_delete) mergedSettings.delete = { ...(mergedSettings.delete || {}), strategy: mergedSettings.on_delete === 'nothing' ? 'skip' : mergedSettings.on_delete === 'delete_or_archive' ? 'try_delete_archive' : mergedSettings.on_delete }
    mergedSettings.category = { ...(mergedSettings.category || {}), ...(mergedSettings.match_odoo_field ? { odoo_match_field: mergedSettings.match_odoo_field } : {}), ...(mergedSettings.match_zid_field ? { zid_match_field: mergedSettings.match_zid_field } : {}) }
    mergedSettings.inventory_valuation = { ...(typeof mergedSettings.inventory_valuation === 'object' ? mergedSettings.inventory_valuation : typeof mergedSettings.inventory_valuation === 'string' && mergedSettings.inventory_valuation ? { property_valuation: mergedSettings.inventory_valuation } : {}), ...(mergedSettings.costing_method ? { property_cost_method: mergedSettings.costing_method } : {}) }
    client = categoryCompanyClient(client, mergedSettings.company_id)
    const override = mapping.workspace_id ? await applyCategoryMappingOverrides(mapping.workspace_id, execPlatform, zidData, storeId || mapping.merchant_id || '') : {}
    mergedSettings = { ...mergedSettings, ...override, inventory_valuation: { ...(typeof mergedSettings.inventory_valuation === 'object' ? mergedSettings.inventory_valuation : {}), ...(override.inventory_valuation || {}) }, accounting: { ...(mergedSettings.accounting || {}), ...(override.accounting || {}) } }
  }

  if ((odooModel === 'product.template' || odooModel === 'product.product') &&
      (odooOperation === 'create' || odooOperation === 'update') && needsProductBom(mergedSettings, zidData)) {
    // Dynamic bundles have no fixed BoM (the customer picks the components), so
    // they are recorded as a service product instead — never a BoM assertion.
    if (!isDynamicBundle(zidData)) {
      await assertBomCapability(client, mergedSettings.bom?.type || 'phantom')
    }
  }

  // Product photos are never synced (2026-11-09): no gallery capability
  // assertion, so a weird image shape can never fail the whole product sync.

  // Zid's reverse_in_progress is a transient return workflow state, not a
  // completed return. Never let it fall through to the generic sale.order
  // update path: delivered orders can already be locked in Odoo 17+, and a
  // normal update may then attempt to rewrite taxes/lines and fail before the
  // completed reversal event arrives.
  if (odooModel === 'sale.order' && odooOperation === 'update' && execPlatform === 'zid') {
    const transientReturnStatus =
      (zidData as any)?.order_status ??
      (zidData as any)?.display_status ??
      (zidData as any)?.status
    if (isZidReturnStatus(transientReturnStatus, true) && !isZidReturnStatus(transientReturnStatus)) {
      const message = 'Zid return is still in progress; waiting for the completed reversal event'
      await logSync({
        id: existingLogId,
        workspace_id: mapping.workspace_id,
        field_mapping_id: mapping.id,
        event,
        store_id: storeId,
        zid_entity_id: zidEntityId,
        odoo_model: 'sale.order',
        status: 'skipped',
        error_message: message,
        payload: zidData,
        trigger_type: triggerType,
        platform: execPlatform,
      })
      return {
        mappingId: mapping.id,
        mappingName: mapping.name,
        model: 'sale.order',
        status: 'skipped',
        message,
      }
    }
  }

  // ── Returns: intercept an order update that is really a return ───────────
  // A return is NOT a new Odoo operation: `enabled_actions` in
  // standard_mapping_settings has no `return` member, so adding one would make
  // webhook-gate drop the event silently. It is detected here, after the
  // settings merge, and replaces the normal order write.
  if (
    odooModel === 'sale.order' &&
    odooOperation === 'update' &&
    (execPlatform === 'zid' || execPlatform === 'salla') &&
    isReturnSignal(execPlatform, event, zidData)
  ) {
    const configuredReturnSettings =
      (mergedSettings as any)?.order?.returns || (mergedSettings as any)?.returns
    const returnSettings = normalizeReturnSettings(configuredReturnSettings)
    // Explicit "nothing" in saved Standard Mapping means NO return effect.
    // Falling through to regular order status_actions can try to cancel an
    // already invoiced/locked sale.order, retry forever and violate the saved
    // return setting. Preserve legacy fall-through ONLY when no return mode
    // was explicitly configured (older workspaces without returns setup).
    const explicitReturnMode = (configuredReturnSettings as any)?.mode
    if (typeof explicitReturnMode === 'string' &&
        explicitReturnMode.trim() && returnSettings.mode === 'nothing') {
      const message = 'returns_disabled_by_standard_mapping'
      await logSync({
        id: existingLogId,
        workspace_id: mapping.workspace_id,
        field_mapping_id: mapping.id,
        event,
        store_id: storeId,
        zid_entity_id: zidEntityId,
        odoo_model: 'sale.order',
        status: 'skipped',
        error_message: message,
        payload: zidData,
        trigger_type: triggerType,
        platform: execPlatform,
      })
      return {
        mappingId: mapping.id,
        mappingName: mapping.name,
        model: 'sale.order',
        status: 'skipped',
        message,
      }
    }
    if (returnSettings.mode !== 'nothing') {
      const nestedOrder = (zidData.order && typeof zidData.order === 'object')
        ? (zidData.order as Record<string, unknown>)
        : null
      const returnOrderId = String(
        zidEntityId ||
        nestedOrder?.id ||
        zidData.order_id ||
        zidData.id ||
        nestedOrder?.order_id ||
        ''
      )

      // Zid's webhook enrichment already includes completed reversal receipts
      // with received/not-received quantities. Never block a queue lease with
      // a second network call to view-for-return (which loses that distinction).
      // The return engine validates those receipts before any Odoo write.

      const outcome = await processReturnEvent({
        client,
        platform: execPlatform,
        event,
        workspaceId: mapping.workspace_id,
        storeId: storeId || mapping.merchant_id || '',
        orderId: returnOrderId,
        payload: zidData,
        settings: returnSettings,
        refundedLines: execPlatform === 'salla' ? extractSallaRefundedLines(zidData) : undefined,
        autoConfirm: Boolean((mergedSettings as any)?.order?.auto_confirm),
        orderStdSettings: mergedSettings,
      })

      if (outcome.handled) {
        console.info(`[Returns] ${execPlatform} order ${returnOrderId}: ${outcome.message}`)
        await logSync({
          id: existingLogId,
          workspace_id: mapping.workspace_id,
          field_mapping_id: mapping.id,
          event,
          store_id: storeId,
          zid_entity_id: returnOrderId,
          odoo_model: 'sale.order',
          odoo_record_id: outcome.odooRecordId ?? null,
          suppressEntityLink: true,
          status: outcome.status,
          error_message: outcome.status !== 'success' ? outcome.message : null,
          payload: zidData,
          trigger_type: triggerType,
          platform: execPlatform,
        })
        // Returning nothing_to_return, missing-original or unknown quantities
        // must NEVER flow through a normal order update and become a
        // misleading success against the original sale.order.
        return {
          mappingId: mapping.id,
          mappingName: mapping.name,
          model: 'sale.order',
          status: outcome.status,
          odooRecordId: outcome.odooRecordId,
          message: outcome.message,
        }
      }
    }
  }

  const matchStrategy = (mergedSettings)?.matching?.strategy
  let fixedMatch = (mergedSettings)?.matching?.odoo_field && (mergedSettings)?.matching?.zid_field
    ? { odoo_field: (mergedSettings).matching.odoo_field, zid_field: (mergedSettings).matching.zid_field }
    : undefined

  // ── Entity-specific matching: override fixedMatch with settings ──
  const entityMatchModels = ['product.category', 'product.template', 'res.partner', 'sale.order']
  if (entityMatchModels.includes(odooModel)) {
    const cfgKey = odooModel === 'product.category' ? 'category'
      : odooModel === 'product.template' ? 'product'
      : odooModel === 'res.partner' ? 'customer'
      : 'order'
    const entityCfg = (mergedSettings)?.[cfgKey]
    if (entityCfg?.odoo_match_field && entityCfg?.zid_match_field) {
      fixedMatch = { odoo_field: entityCfg.odoo_match_field, zid_field: entityCfg.zid_match_field }
    }
  }

  if (odooModel === 'res.partner' && fixedMatch && (odooOperation === 'create' || odooOperation === 'update')) {
    const fields = await client.execute<Record<string, { type?: string; readonly?: boolean }>>('res.partner', 'fields_get', [[fixedMatch.odoo_field]], { attributes: ['type', 'readonly'] })
    validateCustomerMatchSettings({ match_zid_field: fixedMatch.zid_field, match_odoo_field: fixedMatch.odoo_field }, fields)
    const sourceMatch = resolveZidMatchValue(zidData, fixedMatch.zid_field)
    if (sourceMatch === undefined || sourceMatch === null || sourceMatch === '') {
      throw new Error(`Configured customer match value "${fixedMatch.zid_field}" is missing from the source data`)
    }
  }

  // Inject configured match field values for create/update operations
  if (fixedMatch?.odoo_field && fixedMatch.odoo_field !== 'id' && fixedMatch?.zid_field && (odooOperation === 'create' || odooOperation === 'update')) {
    const matchVal = resolveZidMatchValue(zidData, fixedMatch.zid_field)
    if (matchVal !== undefined && matchVal !== null && matchVal !== '') {
      const odooField = fixedMatch.odoo_field
      // Inject into effectiveOdooValues and odooValues
      effectiveOdooValues = {
        ...effectiveOdooValues,
        [odooField]: String(matchVal)
      }
      odooValues[odooField] = effectiveOdooValues[odooField]

      // Remove default match fields if they are not the configured odoo_field
      const defaultFields = allPlatformIdFieldNames()
      defaultFields.forEach(f => {
        if (f !== odooField) {
          delete effectiveOdooValues[f]
          delete odooValues[f]
        }
      })
      console.info(`[SyncEngine] Generic Injected Match Field: ${odooField} = ${JSON.stringify(effectiveOdooValues[odooField])}`)
    }
  }
  const existingSaleOrderId = odooModel === 'sale.order'
    ? await findExistingOdooRecord(client, odooModel, zidData, odooValues, { ...mapping, merchant_id: storeId || mapping.merchant_id }, matchStrategy, fixedMatch, mapping.workspace_id, execPlatform)
    : null

  const defaultLocationId = (mergedSettings)?.inventory?.default_location_id ?? undefined
  const skipDuplicateCheck = (mergedSettings)?.matching?.action === 'create_duplicate'
  const infiniteValue = (mergedSettings)?.stock?.infinite_value
  const pSettings = (mergedSettings)?.price
    ? { markup_percent: (mergedSettings).price.markup_percent || 0, rounding: (mergedSettings).price.rounding || 'nearest', decimal_places: (mergedSettings).price.decimal_places ?? 2 }
    : undefined

  const preparation = { ...params, client, mapping, mergedSettings }

  if (odooModel === 'product.template' && (odooOperation === 'create' || odooOperation === 'update')) {
    const product = await prepareOdooProduct({
      ...preparation, execPlatform, defaultLocationId, infiniteValue, pSettings, fixedMatch, matchStrategy,
      resolveSingleRelationId, syncProductBom,
    })
    if ('record' in product) return product.record
    effectiveOdooValues = product.values
  }

  // ── Category-specific settings (product.category) ──────────────────────────
  if (odooModel === 'product.category' && (odooOperation === 'create' || odooOperation === 'update')) {
    effectiveOdooValues = await prepareOdooCategory({ ...preparation, fixedMatch })
  }

  // ── Customer-specific settings (res.partner) ─────────────────────────────
  if (odooModel === 'res.partner' && (odooOperation === 'create' || odooOperation === 'update')) {
    effectiveOdooValues = await prepareOdooCustomer(preparation)
  }

  // ── Order-specific settings (sale.order) ──────────────────────────────────
  if (odooModel === 'sale.order' && (odooOperation === 'create' || odooOperation === 'update')) {
    const order = await prepareOdooOrder({ ...preparation, execPlatform, isSallaOrderCreate, existingSaleOrderId })
    if ('record' in order) return order.record
    effectiveOdooValues = order.values
    pendingOrderCustomer = order.pendingOrderCustomer
  }

  if (odooModel === 'sale.order') {
    delete (effectiveOdooValues as any).location_id
    delete (odooValues as any).location_id
  }

  const prepareOrderWrite = async (create: boolean) => {
    if (odooModel !== 'sale.order' || execPlatform !== 'zid') return
    const explicitFields = ((mapping.mappings as any)?.['sale.order'] || []).map((field: FieldMappingItem) => field.erpField).filter(Boolean)
    await validateOrderPayload(client, effectiveOdooValues, {
      create, pendingCustomer: pendingOrderCustomer?.values, explicitFields,
    })
    if (pendingOrderCustomer) {
      const partnerId = await createPreparedOrderCustomer(client, pendingOrderCustomer)
      effectiveOdooValues.partner_id = partnerId
      if (!effectiveOdooValues.partner_invoice_id) effectiveOdooValues.partner_invoice_id = partnerId
      if (!effectiveOdooValues.partner_shipping_id) effectiveOdooValues.partner_shipping_id = partnerId
      pendingOrderCustomer = null
    }
  }
  const createPreparedRecord = async () => {
    await prepareOrderWrite(true)
    return (odooModel === 'sale.order' && execPlatform === 'zid') || isSallaOrderCreate
      ? client.create(odooModel, effectiveOdooValues)
      : safeCreateOdooRecord(client, odooModel, effectiveOdooValues, odooValues, undefined, execPlatform)
  }
  const writePreparedRecord = async (recordId: number) => {
    await prepareOrderWrite(false)
    return (odooModel === 'sale.order' && execPlatform === 'zid') || isSallaOrderCreate
      ? client.write(odooModel, [recordId], effectiveOdooValues)
      : safeWriteOdooRecord(client, odooModel, recordId, effectiveOdooValues, odooValues, execPlatform)
  }

  // ── Cancel operation (sale.order only) ────────────────────────────────────────
  if (odooOperation === 'cancel') {
    const existingId = (odooModel === 'sale.order' ? existingSaleOrderId : await findExistingOdooRecord(client, odooModel, zidData, odooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, execPlatform))
    if (existingId === null) {
      const msg = `No matching ${odooModel} record found in Odoo for cancel`
      console.warn(`[SyncEngine] ${msg}`)
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: msg, payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: msg }
    }
    try {
      await client.execute(odooModel, 'action_cancel', [[existingId]], {
        context: { disable_cancel_warning: true },
      })
      console.info(`[SyncEngine] ✅ Cancelled ${odooModel} #${existingId} in Odoo (zid_id="${zidEntityId}")`)
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType, platform: execPlatform })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: existingId }
    } catch (err: any) {
      const errMsg = err?.message ?? String(err)
      console.error(`[SyncEngine] ❌ Failed to cancel ${odooModel} #${existingId}:`, errMsg)
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'failed', error_message: errMsg, payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'failed', message: errMsg }
    }
  }

  // ── Deliver operation (sale.order only) ────────────────────────────────────
  if (odooOperation === 'deliver') {
    if (execPlatform === 'salla' && mergedSettings.order?.partial_fulfillment) {
      const message = 'Review partial Salla delivery in Odoo. Shipment quantities could not be verified for automatic validation.'
      await logSync({
        id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id,
        event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel,
        status: 'skipped', error_message: message, payload: zidData, trigger_type: triggerType, platform: execPlatform,
      })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message }
    }

    const existingId = (odooModel === 'sale.order' ? existingSaleOrderId : await findExistingOdooRecord(client, odooModel, zidData, odooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, execPlatform))
    if (existingId === null) {
      const msg = `No matching ${odooModel} record found in Odoo for deliver`
      console.warn(`[SyncEngine] ${msg}`)
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: msg, payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: msg }
    }
    try {
      // Confirm the order if it's still in draft/quotation state
      const recs = await client.searchRead<any>(odooModel, [['id', '=', existingId]], ['state'])
      if (recs.length > 0) {
        const state = recs[0].state
        if (state === 'draft' || state === 'sent') {
          await client.execute(odooModel, 'action_confirm', [existingId])
          console.info(`[SyncEngine] Confirmed ${odooModel} #${existingId} before delivery`)
        }
      }
      // Check if partial fulfillment is enabled
      const partialFulfillment = (mergedSettings)?.order?.partial_fulfillment
      if (partialFulfillment) {
        // Partial fulfillment: deliver only the fulfilled items from the payload
        const fulfilledItems = extractFulfilledItems(zidData)
        if (fulfilledItems.length > 0) {
          await processPartialDelivery(client, odooModel, existingId, fulfilledItems, execPlatform)
        } else {
          // Fallback to full delivery if no fulfillment items found
          await processFullDelivery(client, odooModel, existingId)
        }
      } else {
        // Full delivery: validate open stock picking(s)
        await processFullDelivery(client, odooModel, existingId)
      }
      console.info(`[SyncEngine] ✅ Delivered ${odooModel} #${existingId} in Odoo (zid_id="${zidEntityId}")`)
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType, platform: execPlatform })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: existingId }
    } catch (err: any) {
      const errMsg = err?.message ?? String(err)
      console.error(`[SyncEngine] ❌ Failed to deliver ${odooModel} #${existingId}:`, errMsg)
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'failed', error_message: errMsg, payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'failed', message: errMsg }
    }
  }

  if (odooOperation === 'create' && !skipDuplicateCheck) {
    let duplicateId: number | null = null
    if (odooModel === 'product.category' && (mergedSettings)?.odoo_category_id) {
      duplicateId = Number((mergedSettings).odoo_category_id)
      console.info(`[SyncEngine] Using manual category mapping Odoo ID for create check: ${duplicateId}`)
    } else {
      duplicateId = (odooModel === 'sale.order' ? existingSaleOrderId : await findExistingOdooRecord(client, odooModel, zidData, odooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, execPlatform))
    }
    if (duplicateId !== null) {
      if (odooModel === 'product.template') assertProductWriteAllowed(mergedSettings, true)
      console.info(`[SyncEngine] Matching ${odooModel} #${duplicateId} already exists in Odoo. Updating existing record...`)
      // Mirror Zid lines into the existing order (replace, never append → no duplicates)
      if (odooModel === 'sale.order') {
        await prepareSaleOrderForUpdate(client, duplicateId, zidData, effectiveOdooValues)
      }
      const ok = await writePreparedRecord(duplicateId)
      if (!ok) throw new Error(`Odoo write returned false for ${odooModel} #${duplicateId}`)
      await persistCategoryIdentity(duplicateId)
      if (odooModel === 'sale.order') {
        if (isSallaOrderCreate) await finishSallaOrderCreate(duplicateId)
        else await maybeApplyOrderStatusAction(client, duplicateId, zidData, mapping.workspace_id, execPlatform, storeId)
      }
      console.info(`[SyncEngine] ✅ Updated existing ${odooModel} #${duplicateId} in Odoo (zid_id="${zidEntityId}")`)
      if (odooModel === 'product.template') {
        await syncProductTemplateStock(client, duplicateId, zidData, effectiveOdooValues, mergedSettings, mapping.workspace_id, execPlatform)
        await syncProductBom(client, duplicateId, zidData, mergedSettings, execPlatform, mapping.workspace_id, storeId)
      }
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: duplicateId, status: 'success', payload: zidData, trigger_type: triggerType, platform: execPlatform })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: duplicateId, message: `Updated existing ${odooModel} #${duplicateId}` }
    }

    const newId = await createPreparedRecord()
    await persistCategoryIdentity(newId)
    console.info(`[SyncEngine] ✅ Created ${odooModel} #${newId} in Odoo (zid_id="${zidEntityId}")`)
    if (odooModel === 'sale.order') {
      if (isSallaOrderCreate) await finishSallaOrderCreate(newId)
      else {
        await ensureSaleOrderTaxes(client, newId, zidData, mapping.workspace_id, execPlatform, storeId)
        await maybeApplyOrderStatusAction(client, newId, zidData, mapping.workspace_id, execPlatform, storeId)
      }
    }
    if (odooModel === 'product.template') {
      await syncProductTemplateStock(client, newId, zidData, effectiveOdooValues, mergedSettings, mapping.workspace_id, execPlatform)
      await syncProductBom(client, newId, zidData, mergedSettings, execPlatform, mapping.workspace_id, storeId)
    }

    // Persist a stable platform ID (x_zid_id/x_salla_id/x_shopify_id) on the new record
    // so future webhooks can re-match it without relying on sync_logs or SKU.
    if ((odooModel === 'product.template' || odooModel === 'res.partner')) {
      const platformIdFieldNamesToCheck = platformIdFieldNames(execPlatform)
      const alreadyStored = platformIdFieldNamesToCheck.some(f => effectiveOdooValues[f] !== undefined || odooValues[f] !== undefined)
      if (!alreadyStored) {
        await persistPlatformIdOnRecord(client, odooModel, newId, execPlatform, String(zidData.id || zidEntityId))
      }
    }



    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: newId, status: 'success', payload: zidData, trigger_type: triggerType, platform: execPlatform })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: newId }
  }

  let existingId: number | null = null
  let deleteModel = odooModel
  if (odooModel === 'product.category' && (mergedSettings)?.odoo_category_id) {
    existingId = Number((mergedSettings).odoo_category_id)
    console.info(`[SyncEngine] Using manual category mapping Odoo ID for update: ${existingId}`)
  } else {
    // Child updates already use the variant-mode executors above. Generic
    // template updates must resolve a template ID: a product.product ID can
    // coincide with an unrelated template ID. Only deletion switches its model.
    if (odooModel === 'product.template' && odooOperation === 'delete') {
      const variantId = await findExistingOdooRecord(client, 'product.product', zidData, odooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, execPlatform)
      if (variantId !== null) {
        existingId = variantId
        deleteModel = 'product.product'
        console.info(`[SyncEngine] Resolved product/variant operation to product.product #${variantId}`)
      }
    }
    if (existingId === null) {
      existingId = (odooModel === 'sale.order' ? existingSaleOrderId : await findExistingOdooRecord(client, odooModel, zidData, odooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, execPlatform))
    }
  }

  // ── Out-of-order resolution for sale.order updates ───────────────────────
  // When an order status update arrives before the order is created in Odoo:
  // Pending creates remain owned by the fenced queue worker. Never execute or
  // delete another job opportunistically from an update operation.
  // 1) With full order details (items), auto-create through the effect ledger.
  // 2) If creation is not possible yet, return 'failed' so the queue retries it
  //    (rather than 'skipped' which permanently deletes the event).
  if (existingId === null && odooModel === 'sale.order' && odooOperation === 'update' && mapping.workspace_id) {
    // 2. Upsert: auto-create order if items are available
    if (existingId === null) {
      const hasOrderItems = ['products', 'items', 'order_items', 'order_items_list', 'line_items']
        .some(k => Array.isArray((zidData as any)?.[k]) && ((zidData as any)[k] as any[]).length > 0)
      if (hasOrderItems) {
        console.info(`[SyncEngine] Order #${zidEntityId} not found in Odoo for update; auto-creating order with available items...`)
        try {
          if (!('order_line' in effectiveOdooValues)) {
            let orderStdSettings: Record<string, any> | null = null
            try {
              orderStdSettings = await getCachedStandardMappingSettings(mapping.workspace_id, execPlatform, 'orders', storeId || mapping.merchant_id || '')
            } catch {}
            const orderLines = await buildOrderLineItems(
              client,
              mapping,
              zidData,
              new Map<string, OdooFieldMeta>(),
              effectiveOdooValues,
              execPlatform,
              orderStdSettings,
              storeId,
              event,
              'create'
            )
            if (orderLines.length > 0) {
              effectiveOdooValues.order_line = orderLines.map(item => [0, 0, item])
            }
          }

          if (effectiveOdooValues.order_line && (effectiveOdooValues.order_line as any[]).length > 0) {
            const newId = await createPreparedRecord()
            console.info(`[SyncEngine] ✅ Auto-created ${odooModel} #${newId} in Odoo for update (zid_id="${zidEntityId}")`)
            await maybeApplyOrderStatusAction(client, newId, zidData, mapping.workspace_id, execPlatform, storeId)
            await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: newId, status: 'success', payload: zidData, trigger_type: triggerType, platform: execPlatform })
            return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: newId, message: `Created and updated ${odooModel} #${newId}` }
          }
        } catch (autoCreateErr: any) {
          console.warn(`[SyncEngine] Auto-create order #${zidEntityId} for update failed:`, autoCreateErr?.message || autoCreateErr)
        }
      }
    }
  }

  if (existingId === null) {
    const isOrderUpdate = odooModel === 'sale.order' && odooOperation === 'update'
    const isProductUpdate =
      (odooModel === 'product.template' || odooModel === 'product.product')
      && odooOperation === 'update'
    const productCreateAllowed =
      !mergedSettings.disabled
      && (
        !Array.isArray(mergedSettings.enabled_actions)
        || mergedSettings.enabled_actions.length === 0
        || mergedSettings.enabled_actions.includes('create')
      )
    const retryMissingProduct = isProductUpdate && productCreateAllowed

    const msg = isOrderUpdate
      ? `Sale order #${zidEntityId} not yet found in Odoo for status update; rescheduled to retry`
      : retryMissingProduct
        ? `Product #${zidEntityId} not yet found in Odoo for ${event}; retry after product.create`
        : `No matching ${odooModel} record found in Odoo for ${odooOperation}`
    console.warn(`[SyncEngine] ${msg}`)
    const logStatus = (isOrderUpdate || retryMissingProduct) ? 'failed' : 'skipped'
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: logStatus, error_message: msg, payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: logStatus, message: msg }
  }

  if (odooOperation === 'update') {
    // Mirror Zid lines into the existing order (replace, never append → no duplicates)
    if (odooModel === 'sale.order') {
      await prepareSaleOrderForUpdate(client, existingId, zidData, effectiveOdooValues)
    }
    const ok = await writePreparedRecord(existingId)
    if (!ok) throw new Error(`Odoo write returned false for ${odooModel} #${existingId}`)
    await persistCategoryIdentity(existingId)
    if (odooModel === 'sale.order') {
      await ensureSaleOrderTaxes(client, existingId, zidData, mapping.workspace_id, execPlatform, storeId)
      await maybeApplyOrderStatusAction(client, existingId, zidData, mapping.workspace_id, execPlatform, storeId)
    }
    console.info(`[SyncEngine] ✅ Updated ${odooModel} #${existingId} in Odoo (zid_id="${zidEntityId}")`)
    if (odooModel === 'product.template') {
      await syncProductTemplateStock(client, existingId, zidData, effectiveOdooValues, mergedSettings, mapping.workspace_id, execPlatform)
      await syncProductBom(client, existingId, zidData, mergedSettings, execPlatform, mapping.workspace_id, storeId)
    }
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType, platform: execPlatform })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: existingId }
  }

  // odooOperation is 'delete' here
  // Priority: FixedMappingSettings.delete.strategy > DynamicMapping __settings.deleteBehavior > 'try_delete_archive'
  const deleteStrategy = (mergedSettings)?.delete?.strategy
    || (mapping.mappings as any)?.__settings?.deleteBehavior
    || 'try_delete_archive'

  // Skip strategy: gracefully skip deletion without error
  if (deleteStrategy === 'skip') {
    console.info(`[SyncEngine] Skip delete for ${deleteModel} #${existingId} (strategy=skip)`)
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: deleteModel, odoo_record_id: existingId, status: 'skipped', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: deleteModel, status: 'skipped', odooRecordId: existingId }
  }

  const behaviorArray: string[] = deleteStrategy === 'archive'
    ? ['archive']
    : deleteStrategy === 'try_delete_archive'
      ? ['delete', 'archive']
      : ['delete']

  console.info(`[SyncEngine] Resolved Odoo delete behavior:`, behaviorArray)

  let deleteSucceeded = false
  let deleteError: any = null

  if (behaviorArray.includes('delete')) {
    console.info(`[SyncEngine] Attempting to delete Odoo record ${deleteModel} #${existingId}...`)
    try {
      const ok = await client.unlink(deleteModel, [existingId])
      if (ok) {
        deleteSucceeded = true
        console.info(`[SyncEngine] ✅ Deleted ${deleteModel} #${existingId} from Odoo (zid_id="${zidEntityId}")`)
      } else {
        deleteError = new Error(`Odoo unlink returned false for ${deleteModel} #${existingId}`)
      }
    } catch (err: any) {
      deleteError = err
      console.warn(`[SyncEngine] Delete failed for Odoo ${deleteModel} #${existingId}:`, err?.message || err)
    }
  }

  if (deleteSucceeded) {
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: deleteModel, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: deleteModel, status: 'success', odooRecordId: existingId }
  }

  // Fallbacks: If we didn't try to delete or delete failed, check archive and run_map
  const fallbacksExecuted: string[] = []

  if (behaviorArray.includes('run_map')) {
    console.info(`[SyncEngine] Executing fallback mapping lines for Odoo ${odooModel} #${existingId}...`)
    try {
      const ok = await client.write(odooModel, [existingId], effectiveOdooValues)
      if (!ok) throw new Error(`Odoo write returned false`)
      fallbacksExecuted.push('run_map')
      console.info(`[SyncEngine] ✅ Fallback mapping executed successfully for Odoo ${odooModel} #${existingId}`)
    } catch (err: any) {
      console.error(`[SyncEngine] Fallback mapping failed for Odoo ${odooModel} #${existingId}:`, err?.message || err)
    }
  }

  if (behaviorArray.includes('archive')) {
    console.info(`[SyncEngine] Executing archive strategy for Odoo ${odooModel} #${existingId}...`)
    try {
      if (deleteModel === 'product.category') {
        const ok = await archiveCategory(client, existingId)
        if (!ok) throw new Error(`Failed to archive product.category #${existingId}`)
        fallbacksExecuted.push('archive')
      } else {
        const ok = await client.write(deleteModel, [existingId], { active: false })
        if (!ok) throw new Error(`Odoo write (active: false) returned false`)
        fallbacksExecuted.push('archive')

        // Archive child variants if configured via archive_variants setting
        const archiveVariants = (mergedSettings)?.delete?.archive_variants !== false
        if (archiveVariants && deleteModel === 'product.template') {
          try {
            const variantIds = await client.search('product.product', [['product_tmpl_id', '=', existingId], ['active', '=', true]])
            if (variantIds.length > 0) {
              console.info(`[SyncEngine] Archiving ${variantIds.length} child variant(s) for product.template #${existingId}`)
              await client.write('product.product', variantIds, { active: false })
            }
          } catch (varErr: any) {
            console.warn(`[SyncEngine] Failed to archive child variants for product.template #${existingId}:`, varErr?.message || varErr)
          }
        }
      }

      console.info(`[SyncEngine] ✅ Archive executed successfully for Odoo ${deleteModel} #${existingId}`)
    } catch (err: any) {
      console.error(`[SyncEngine] Archive failed for Odoo ${deleteModel} #${existingId}:`, err?.message || err)
    }
  }

  if (fallbacksExecuted.length > 0) {
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: deleteModel, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: deleteModel, status: 'success', odooRecordId: existingId }
  }

  // If we attempted to delete and failed, and no fallbacks were run/successful, throw the delete error
  if (deleteError) {
    throw deleteError
  } else {
    throw new Error(`Delete behavior specified fallback actions but none were executed successfully.`)
  }
}
