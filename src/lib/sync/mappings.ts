import { decrypt } from '@/lib/crypto'
import { legacyFixedMappingTablesEnabled } from '@/lib/legacy-fixed-mappings'
import { withErpExecutionContext } from '@/lib/erp-effect-context'
import { getErpExecutionScope, resolveExecutionTarget, validateExecutionTarget, withErpTarget } from '@/lib/erp-execution-target'
import { processErpNextMapping } from '@/lib/erpnext/mappings'
import { fetchFieldMeta } from '@/lib/odoo/field-meta'
import { createOdooOperations } from '@/lib/odoo/operations'
import { OdooClient } from '@/lib/odoo-client'
import { allPlatformIdFieldNames } from '@/lib/platform-fields'
import { derivePresetKey, getPlatformFromEvent, normalizeEvent, normalizeOdooOperation, presetEntityType, storeEntityIdFromPayload } from '@/lib/sync/events'
import { skipNoFieldItems } from '@/lib/sync/mapping-results'
import { getCachedStandardMappingSettings, isEntityOperationAllowed } from '@/lib/sync/settings'
import { logSync, supabaseAdmin } from '@/lib/sync-runtime'
import type { FieldMappingItem, FieldMappingRow, OdooConnectionRow, OdooOperation, SyncEngineResult } from '@/lib/sync-types'

export const { resolveSingleRelationId, buildOdooValues, executeOdooOperation, syncProductBom } = createOdooOperations(syncMissingOdooProduct)

// ─── Standard Mapping preset: runs FIRST on every webhook (when enabled) ──
// ثم تعمل field_mappings (الكاستوم) بعده بالترتيب. يرجع null لو معطّل
// عبر standard_mapping_settings (الحارس داخله) فلا يضيف شيئاً.
export async function processFixedMappingFallback(
  presetKey: string, event: string, storeIdStr: string, zidData: Record<string, unknown>,
  platform: 'zid' | 'salla' | 'shopify', existingMappings: FieldMappingRow[] | null,
  deliveryWorkspaceId?: string | null
): Promise<SyncEngineResult['records'][number] | null> {
  const scope = getErpExecutionScope()
  if (!scope || scope.workspaceId !== deliveryWorkspaceId || scope.platform !== platform || scope.storeId !== storeIdStr) throw new Error('Preset ERP execution scope mismatch')
  const rootModel = presetKey.includes('category') ? 'product.category' : presetKey.includes('product') ? 'product.template' : presetKey.includes('customer') ? 'res.partner' : 'sale.order'
  return withErpExecutionContext({ ...scope, storeEntityId: storeEntityIdFromPayload(zidData), rootModel },
    () => processFixedMappingFallbackInternal(presetKey, event, storeIdStr, zidData, platform, existingMappings, deliveryWorkspaceId))
}

async function processFixedMappingFallbackInternal(
  presetKey: string,
  event: string,
  storeIdStr: string,
  zidData: Record<string, unknown>,
  platform: 'zid' | 'salla' | 'shopify',
  existingMappings: FieldMappingRow[] | null,
  deliveryWorkspaceId?: string | null
): Promise<SyncEngineResult['records'][number] | null> {
  // Borrow workspace + connection from an existing field_mapping if available
  let workspaceId: string | undefined
  let erpConnectionId: string | null = null

  if (deliveryWorkspaceId) {
    // مساحة التسليم تفوز دائماً: صفوفة field_mappings قد تعود لمساحة لم تعد
    // تملك المتجر، والاستعير منها يطبّق إعداداتها واتصال Odoo الخاص بها.
    // الاتصال يُستعار فقط من صفوفة بنفس المساحة، وإلا يُترك null فيلتقطه
    // البحث بـ workspace_id تحت (erp_connections الخاص بالمساحة الصحيحة).
    workspaceId = deliveryWorkspaceId
    const sameWsMapping = existingMappings?.find((m) => m.workspace_id === deliveryWorkspaceId)
    erpConnectionId = sameWsMapping?.erp_connection_id ?? null
  } else if (existingMappings && existingMappings.length > 0) {
    const anyMapping = existingMappings[0]
    workspaceId = anyMapping.workspace_id
    erpConnectionId = anyMapping.erp_connection_id
  } else {
    // No field_mappings at all — look up workspace from merchant_tokens / salla_tokens
    const { data: tokens } = await supabaseAdmin
      .from('merchant_tokens')
      .select('workspace_id')
      .or(`store_id.eq.${storeIdStr},merchant_id.eq.${storeIdStr}`)
      .limit(1)
    if (tokens && tokens.length > 0 && tokens[0]?.workspace_id) {
      workspaceId = tokens[0].workspace_id
    }
    if (!workspaceId) {
      const { data: sallaTokens } = await supabaseAdmin
        .from('salla_tokens')
        .select('workspace_id')
        .or(`merchant_id.eq.${storeIdStr}`)
        .limit(1)
      if (sallaTokens && sallaTokens.length > 0 && sallaTokens[0]?.workspace_id) {
        workspaceId = sallaTokens[0].workspace_id
      }
    }
    if (!workspaceId) {
      // Shopify stores are keyed by shop_domain (not merchant/store id), so the
      // two lookups above can never match them. Without this, a Shopify store
      // with zero custom field_mappings (pure Standard Mapping) resolves no
      // workspace and the preset silently returns null — nothing ever syncs.
      const { data: shopifyTokens } = await supabaseAdmin
        .from('shopify_tokens')
        .select('workspace_id')
        .eq('shop_domain', storeIdStr)
        .limit(1)
      if (shopifyTokens && shopifyTokens.length > 0 && shopifyTokens[0]?.workspace_id) {
        workspaceId = shopifyTokens[0].workspace_id
      }
    }
  }

  if (!workspaceId) {
    console.warn(`[FixedMapping] Cannot resolve workspace_id for store=${storeIdStr}, preset=${presetKey}`)
    return null
  }

  // ——— Check Standard Mapping settings for entity operation allowance —————
  // كان هذا الحارس مكرراً أربع مرات بنفس Shape تقريباً، مع انحراف: كتلة
  // الطلبات وحدها كانت تفحص cancel/deliver بينما الثلاث الأخرى لا. الآن
  // مسار واحد يستعمل `normalizeOdooOperation` — نفس ما يستعمله
  // `processSingleMapping` — فلا يحدث اختلاف سلوكي بين المسارين.
  const presetEntity = presetEntityType(presetKey)
  if (presetEntity) {
    const storeType = presetKey.split('_')[0]
    const operation = normalizeOdooOperation(undefined, event, storeType)
    const presetCheck = await isEntityOperationAllowed(workspaceId, storeType, operation, presetEntity, storeIdStr)
    if (!presetCheck.allowed) {
      console.info(`[FixedMapping] ${presetEntity} operation blocked for preset="${presetKey}": ${presetCheck.reason}`)
      // ⚠️ كان هذا الفرع يرجّع `null` **بلا أي سجل** ⇒ الصف يُحذف من الطابور
      // كـ«نجاح» والحدث يختفي بلا أثر، والعميل لا يعرف why. الآن يُكتب صف
      // `skipped` ظاهر في شاشة السجلات.
      try {
        const { logWebhookSkip } = await import('@/lib/webhook-skip-log')
        await logWebhookSkip({
          workspaceId,
          platform: (storeType as 'zid' | 'salla' | 'shopify') || 'zid',
          event,
          storeId: storeIdStr,
          reason: 'disabled_in_settings',
          detail: presetCheck.reason,
          odooModel: `preset:${presetKey}`,
        })
      } catch {
        // التوثيق لا يكسر المزامنة أبداً.
      }
      return null
    }
  }

  // Legacy tables do not exist in the current production schema.
  // The default Standard Mapping fallback stays unchanged, without a 404 on every event.
  const { data: customRows } = legacyFixedMappingTablesEnabled()
    ? await supabaseAdmin
        .from('fixed_mappings')
        .select('field_rows')
        .eq('workspace_id', workspaceId)
        .eq('preset_key', presetKey)
        .eq('is_preset', false)
    : { data: null }
  const customFieldPairs: any[] = []
  if (customRows) {
    for (const cr of customRows) {
      const rows = (cr as any)?.field_rows || []
      customFieldPairs.push(...rows)
    }
  }
  const fieldPairs: any[] = [...customFieldPairs]

  const nonArchived = fieldPairs.filter((r: any) => r.odoo_field && r.platform_field && !r.archived)
  if (nonArchived.length === 0) {
    // ——— Hardcoded fallback for known presets (Standard Odoo fields ONLY — NO custom x_* columns) ———
    const KNOWN_PRESET_FIELDS: Record<string, { odoo_field: string; platform_field: string }[]> = {
      'zid_category': [
        { odoo_field: 'name', platform_field: 'names.ar || name.ar || name || names.en || name.en' },
        { odoo_field: 'parent_id', platform_field: 'parent_id || parent.id || parent_category_id' },
      ],
      'salla_category': [
        { odoo_field: 'name', platform_field: 'name' },
        // Salla's category payload carries the parent as a numeric Salla ID.
        // Without this row the preset wrote `name` only, so a child category
        // synced fine while Parent Category stayed empty in Odoo.
        { odoo_field: 'parent_id', platform_field: 'parent_id || parent.id || parent_category_id' },
      ],
      'shopify_category': [
        { odoo_field: 'name', platform_field: 'title' },
      ],
      'zid_product_create': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'default_code', platform_field: 'sku' },
        { odoo_field: 'barcode', platform_field: 'barcode' },
        { odoo_field: 'list_price', platform_field: 'price' },
        { odoo_field: 'standard_price', platform_field: 'cost' },
        { odoo_field: 'weight', platform_field: 'weight.value' },
      ],
      'zid_product_update': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'default_code', platform_field: 'sku' },
        { odoo_field: 'barcode', platform_field: 'barcode' },
        { odoo_field: 'list_price', platform_field: 'price' },
        { odoo_field: 'standard_price', platform_field: 'cost' },
        { odoo_field: 'weight', platform_field: 'weight.value' },
      ],
      'zid_product_delete': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'default_code', platform_field: 'sku' },
        { odoo_field: 'barcode', platform_field: 'barcode' },
        { odoo_field: 'list_price', platform_field: 'price' },
        { odoo_field: 'standard_price', platform_field: 'cost' },
        { odoo_field: 'weight', platform_field: 'weight.value' },
      ],
      'salla_product_create': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'default_code', platform_field: 'sku' },
        { odoo_field: 'barcode', platform_field: 'barcode' },
        { odoo_field: 'list_price', platform_field: 'price.amount || price' },
        { odoo_field: 'standard_price', platform_field: 'cost_price.amount || cost_price || cost' },
      ],
      'salla_product_update': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'default_code', platform_field: 'sku' },
        { odoo_field: 'barcode', platform_field: 'barcode' },
        { odoo_field: 'list_price', platform_field: 'price.amount || price' },
        { odoo_field: 'standard_price', platform_field: 'cost_price.amount || cost_price || cost' },
      ],
      'salla_product_delete': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'default_code', platform_field: 'sku' },
        { odoo_field: 'barcode', platform_field: 'barcode' },
        { odoo_field: 'list_price', platform_field: 'price.amount' },
        { odoo_field: 'standard_price', platform_field: 'cost_price' },
      ],
      'shopify_product_create': [
        { odoo_field: 'name', platform_field: 'title' },
        // NOTE: dot-index form only — resolvePath() splits on '.' and parses
        // each segment with parseInt for arrays, so 'variants[0].sku' resolves
        // to undefined and silently drops SKU/barcode/price. The mapping-centre
        // catalogue (platforms/shopify/fields.ts) already uses 'variants.0.*'.
        { odoo_field: 'default_code', platform_field: 'variants.0.sku' },
        { odoo_field: 'barcode', platform_field: 'variants.0.barcode' },
        { odoo_field: 'list_price', platform_field: 'variants.0.price' },
      ],
      'shopify_product_update': [
        { odoo_field: 'name', platform_field: 'title' },
        { odoo_field: 'default_code', platform_field: 'variants.0.sku' },
        { odoo_field: 'barcode', platform_field: 'variants.0.barcode' },
        { odoo_field: 'list_price', platform_field: 'variants.0.price' },
      ],
      'shopify_product_delete': [
        { odoo_field: 'name', platform_field: 'title' },
        { odoo_field: 'default_code', platform_field: 'variants.0.sku' },
        { odoo_field: 'barcode', platform_field: 'variants.0.barcode' },
        { odoo_field: 'list_price', platform_field: 'variants.0.price' },
      ],
      'zid_customer_create': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'email', platform_field: 'email' },
        { odoo_field: 'mobile', platform_field: 'mobile' },
        { odoo_field: 'phone', platform_field: 'telephone' },
        { odoo_field: 'vat', platform_field: 'tax_number || vat' },
        { odoo_field: 'company_registry', platform_field: 'commercial_registration' },
        { odoo_field: 'company_name', platform_field: 'business_name || company_name' },
      ],
      'zid_customer_update': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'email', platform_field: 'email' },
        { odoo_field: 'mobile', platform_field: 'mobile' },
        { odoo_field: 'phone', platform_field: 'telephone' },
        { odoo_field: 'vat', platform_field: 'tax_number || vat' },
        { odoo_field: 'company_registry', platform_field: 'commercial_registration' },
        { odoo_field: 'company_name', platform_field: 'business_name || company_name' },
      ],
      'zid_customer_delete': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'email', platform_field: 'email' },
        { odoo_field: 'mobile', platform_field: 'mobile' },
        { odoo_field: 'phone', platform_field: 'telephone' },
      ],
      'salla_customer_create': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'email', platform_field: 'email' },
        { odoo_field: 'mobile', platform_field: 'mobile' },
        // Odoo 19 removed `mobile` on res.partner, so the number would be
        // silently dropped (see the "Skipping field mobile" guard). Mirror it
        // to the core `phone` field as well; instances that still have
        // `mobile` simply receive both.
        { odoo_field: 'phone', platform_field: 'mobile' },
      ],
      'salla_customer_update': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'email', platform_field: 'email' },
        { odoo_field: 'mobile', platform_field: 'mobile' },
        { odoo_field: 'phone', platform_field: 'mobile' },
      ],
      'salla_customer_delete': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'email', platform_field: 'email' },
        { odoo_field: 'mobile', platform_field: 'mobile' },
        { odoo_field: 'phone', platform_field: 'mobile' },
      ],
      // NOTE: name <- first_name is completed to the full "first last" name in
      // executeOdooOperation via resolveShopifyCustomerFullName (see the
      // res.partner block) — the preset stays a single path because resolvePath
      // supports `||` fallback, not concatenation.
      'shopify_customer_create': [
        { odoo_field: 'name', platform_field: 'first_name' },
        { odoo_field: 'email', platform_field: 'email' },
        { odoo_field: 'phone', platform_field: 'phone' },
      ],
      'shopify_customer_update': [
        { odoo_field: 'name', platform_field: 'first_name' },
        { odoo_field: 'email', platform_field: 'email' },
        { odoo_field: 'phone', platform_field: 'phone' },
      ],
      'shopify_customer_delete': [
        { odoo_field: 'name', platform_field: 'first_name' },
        { odoo_field: 'email', platform_field: 'email' },
        { odoo_field: 'phone', platform_field: 'phone' },
      ],
      'zid_order_create': [
        { odoo_field: 'client_order_ref', platform_field: 'id' },
        { odoo_field: 'date_order', platform_field: 'order_date || created_at' },
      ],
      'zid_order_update': [
        { odoo_field: 'client_order_ref', platform_field: 'id' },
        { odoo_field: 'date_order', platform_field: 'order_date || created_at' },
      ],
      'zid_order_delete': [
        { odoo_field: 'client_order_ref', platform_field: 'id' },
      ],
      'salla_order_create': [
        { odoo_field: 'client_order_ref', platform_field: 'id' },
        { odoo_field: 'date_order', platform_field: 'date.date' },
      ],
      'salla_order_update': [
        { odoo_field: 'client_order_ref', platform_field: 'id' },
        { odoo_field: 'date_order', platform_field: 'date.date' },
      ],
      'salla_order_delete': [
        { odoo_field: 'client_order_ref', platform_field: 'id' },
      ],
      'shopify_order_create': [
        { odoo_field: 'client_order_ref', platform_field: 'id' },
        { odoo_field: 'amount_total', platform_field: 'total_price' },
        { odoo_field: 'date_order', platform_field: 'created_at' },
      ],
      'shopify_order_update': [
        { odoo_field: 'client_order_ref', platform_field: 'id' },
        { odoo_field: 'date_order', platform_field: 'created_at' },
      ],
      // No `shopify_order_delete`: derivePresetKey keys `orders/delete` as
      // `shopify_order_cancel` (the engine cancels sale.orders, never deletes
      // them) — see the note in derivePresetKey.
      'zid_order_cancel': [],
      'zid_order_deliver': [],
      'salla_order_cancel': [],
      'salla_order_deliver': [],
      'shopify_order_cancel': [],
      'shopify_order_deliver': [],
    }
    const fallbackRows = KNOWN_PRESET_FIELDS[presetKey]
    if (fallbackRows) {
      fieldPairs.push(...fallbackRows)
      console.info(`[FixedMapping] Using standard fallback fields for preset "${presetKey}"`)
    } else {
      console.info(`[FixedMapping] Preset "${presetKey}" has no mapped fields`)
      return null
    }
  }

  // ——— Merge Match Field from standard_mapping_settings (per-store per-entity) —
  if (presetKey && workspaceId) {
    const storeType = presetKey.split('_')[0]
    const entityType = presetKey.includes('category') ? 'categories'
      : presetKey.includes('product') ? 'products'
      : presetKey.includes('customer') ? 'customers'
      : presetKey.includes('order') ? 'orders'
      : null
    if (entityType) {
      const stdSettings = await getCachedStandardMappingSettings(workspaceId, storeType, entityType, storeIdStr)
      if (stdSettings) {
        if (stdSettings.match_odoo_field && stdSettings.match_zid_field) {
          // Filter out default ID fields mapping so the user's custom match field override is utilized
          const defaultOdooFields = allPlatformIdFieldNames()
          const defaultPlatformFields = ['id']

          const filteredPairs = fieldPairs.filter((r: any) => {
            const isDefaultOdoo = defaultOdooFields.includes(r.odoo_field)
            const isDefaultPlatform = defaultPlatformFields.includes(r.platform_field)
            const isDuplicateOdoo = r.odoo_field === stdSettings.match_odoo_field
            const isDuplicatePlatform = r.platform_field === stdSettings.match_zid_field
            return !(isDefaultOdoo || isDefaultPlatform || isDuplicateOdoo || isDuplicatePlatform)
          })

          fieldPairs.length = 0
          fieldPairs.push(...filteredPairs, {
            odoo_field: stdSettings.match_odoo_field,
            platform_field: stdSettings.match_zid_field,
          })
          console.info(`[FixedMapping] Added/Overrode Match Field from standard_mapping_settings: ${stdSettings.match_odoo_field} ↔ ${stdSettings.match_zid_field}`)
        }
      }
    }
  }

  // Resolve Odoo connection
  const pinnedScope = getErpExecutionScope()
  if (pinnedScope) {
    if (erpConnectionId && erpConnectionId !== pinnedScope.erpConnectionId) throw new Error('Preset ERP connection changed')
    erpConnectionId = pinnedScope.erpConnectionId
  }
  if (!erpConnectionId) {
    const { data: conn } = await supabaseAdmin
      .from('erp_connections')
      .select('id')
      .eq('workspace_id', workspaceId)
      .limit(1)
    if (conn && conn.length > 0) erpConnectionId = conn[0].id
  }

  if (!erpConnectionId) {
    console.warn(`[FixedMapping] No ERP connection for workspace=${workspaceId}, preset=${presetKey}`)
    return null
  }

  // The webhook entry validated the generation and workspace already. Reuse
  // that exact event-scoped connection instead of another credential lookup.
  // Legacy/manual callers still use the original scoped DB query.
  const trustedConnection =
    pinnedScope?.validatedConn?.id === erpConnectionId &&
    pinnedScope.validatedConn.workspace_id === workspaceId &&
    pinnedScope.platform === platform &&
    pinnedScope.storeId === storeIdStr
      ? pinnedScope.validatedConn
      : null
  const { data: odooConn } = trustedConnection
    ? { data: trustedConnection }
    : await supabaseAdmin
        .from('erp_connections')
        .select('id, url, db_name, username, password, erp_type')
        .eq('id', erpConnectionId)
        .eq('workspace_id', workspaceId)
        .single()

  if (!odooConn) {
    console.warn(`[FixedMapping] ERP connection ${erpConnectionId} not found`)
    return null
  }
  // Standard presets are Odoo model definitions. ERPNext remains supported
  // through its explicit custom mappings, never through the XML-RPC client.
  if (odooConn.erp_type && odooConn.erp_type !== 'odoo') return null

  const decryptedPassword = decrypt(odooConn.password)
  const client = new OdooClient({
    url: odooConn.url,
    db: odooConn.db_name || '',
    username: odooConn.username,
    apiKey: decryptedPassword,
  })

  // Determine Odoo model from preset key
  const odooModel = presetKey.includes('category') ? 'product.category'
    : presetKey.includes('product') ? 'product.template'
    : presetKey.includes('customer') ? 'res.partner'
    : presetKey.includes('order') ? 'sale.order'
    : 'product.template'
  // This is the classifier the actual Odoo write obeys, so it must be the shared
  // one. It used to be a third inline copy of the substring ladder, which is how
  // `order.shipment.cancelled` reached `{state:'cancel'}` on a whole sale.order
  // even though the gate agreed it was a `cancel` for a *shipment*.
  const odooOperation: OdooOperation = normalizeOdooOperation(undefined, event, platform)

  // Build mapping items from fixed field_rows
  const mappingItems: FieldMappingItem[] = fieldPairs
    .filter((r: any) => r.odoo_field && r.platform_field && !r.archived)
    .map((r: any) => ({
    id: `fixed_${r.odoo_field}`,
    erpField: r.odoo_field,
    zidField: r.platform_field,
  }))

  // Fetch field meta
  const erpFieldNames = mappingItems.map(m => m.erpField)
  const fieldMeta = await fetchFieldMeta(client, odooModel, erpFieldNames)

  // Build Odoo values
  // Preserve Shopify as 'shopify' so relation lookups search x_shopify_id correctly.
  const syncPlatform: 'zid' | 'salla' | 'shopify' = platform
  const productSettings = odooModel === 'product.template'
    ? await getCachedStandardMappingSettings(workspaceId, syncPlatform, 'products', storeIdStr) : null
  const odooValues = await buildOdooValues(client, mappingItems, zidData, fieldMeta, syncPlatform, workspaceId, storeIdStr, productSettings)

  if (Object.keys(odooValues).length === 0 && odooOperation !== 'delete' && odooOperation !== 'cancel' && odooOperation !== 'deliver') {
    console.warn(`[FixedMapping] No values extracted for preset="${presetKey}"`)
    return null
  }

  // Create a minimal virtual mapping for logging.
  // merchant_id carries the store so the execute path resolves the SAME
  // per-store standard_mapping_settings row the preset discovery used
  // (getCachedStandardMappingSettings filters on store_id), the durable
  // odoo_entity_links read stops being skipped, and the sync_logs lookup
  // is store-scoped instead of workspace-wide. It used to be '' here,
  // which silently dropped a per-store match config (the Standard Mapping
  // match fields) and left update/delete matching on name only —
  // so any rename (e.g. Salla category.updated) missed and skipped.
  const virtualMapping: FieldMappingRow = {
    id: `fixed_${presetKey}`,
    workspace_id: workspaceId,
    erp_connection_id: erpConnectionId,
    merchant_id: storeIdStr,
    store_id: storeIdStr,
    action: '',
    odoo_model: odooModel,
    odoo_operation: odooOperation,
    odoo_match_field: null,
    zid_match_field: null,
    mappings: {},
    name: `Fixed Mapping: ${presetKey}`,
  }

  // Execute Odoo operation (create/update)
  try {
    return await executeOdooOperation({
      client,
      mapping: virtualMapping,
      event,
      storeId: storeIdStr,
      zidEntityId: storeEntityIdFromPayload(zidData),
      zidData,
      odooModel,
      odooOperation,
      odooValues,
      presetKey,
      triggerType: 'automatic',
      platformHint: platform,
    })
  } catch (err: any) {
    const errMsg = err?.message ?? String(err)
    console.error(`[FixedMapping] ❌ Failed to ${odooOperation} ${odooModel}:`, errMsg)
    await logSync({
      workspace_id: workspaceId || virtualMapping.workspace_id,
      field_mapping_id: virtualMapping.id,
      event,
      store_id: storeIdStr,
      zid_entity_id: storeEntityIdFromPayload(zidData),
      odoo_model: odooModel,
      status: 'failed',
      error_message: errMsg,
      payload: zidData,
      trigger_type: 'automatic',
      platform: platform,
    }).catch(() => {})
    return {
      mappingId: virtualMapping.id,
      mappingName: virtualMapping.name,
      model: odooModel,
      status: 'failed',
      message: errMsg,
    }
  }
}

// ——— Process one field_mapping —————————————————————————————————————————————

export async function processSingleMapping(
  mapping: FieldMappingRow, event: string, storeId: string, zidData: Record<string, unknown>,
  triggerType: 'automatic' | 'manual' = 'automatic', existingLogId?: string,
  platformHint?: 'zid' | 'salla' | 'shopify'
): Promise<SyncEngineResult['records'][number]> {
  try {
  const platform = platformHint ?? getPlatformFromEvent(event)
  const inherited = getErpExecutionScope()
  const target = inherited ?? await resolveExecutionTarget(mapping.workspace_id, platform, storeId)
  if (inherited && (inherited.workspaceId !== mapping.workspace_id || inherited.storeId !== storeId || inherited.platform !== platform)) throw new Error('Mapping ERP execution scope mismatch')
  if (mapping.erp_destination_retired_at) throw new Error('Mapping belongs to a retired ERP destination')
  if (mapping.erp_connection_id && mapping.erp_connection_id !== target.erpConnectionId) throw new Error('Mapping ERP execution connection changed')
  await validateExecutionTarget(mapping.workspace_id, platform, storeId, target)
  const scope = { ...target, workspaceId: mapping.workspace_id, platform, storeId, eventId: inherited?.eventId || existingLogId || `manual:${event}` }
  return await withErpTarget(scope, () => withErpExecutionContext({ ...scope, storeEntityId: storeEntityIdFromPayload(zidData), rootModel: mapping.odoo_model },
    () => processSingleMappingInternal(mapping, event, storeId, zidData, triggerType, existingLogId, platformHint)))
  } catch (error) {
    return { mappingId: mapping.id, mappingName: mapping.name, model: mapping.odoo_model, status: 'failed', message: error instanceof Error ? error.message : 'ERP execution trust validation failed' }
  }
}

async function processSingleMappingInternal(
  mapping: FieldMappingRow,
  event: string,
  storeId: string,
  zidData: Record<string, unknown>,
  triggerType: 'automatic' | 'manual' = 'automatic',
  existingLogId?: string,
  platformHint?: 'zid' | 'salla' | 'shopify'
): Promise<SyncEngineResult['records'][number]> {
  // A Zid product delete carries `product_id`, not `id` — see
  // storeEntityIdFromPayload.
  const zidEntityId = storeEntityIdFromPayload(zidData)
  const odooModel = mapping.odoo_model
  const mappingPlatform = platformHint ?? getPlatformFromEvent(event)
  const odooOperation = normalizeOdooOperation(mapping.odoo_operation, event, mappingPlatform)

  // ——— Check Standard Mapping settings for entity operation allowance —————
  const modelToEntityMap: Record<string, string> = {
    'product.category': 'categories',
    'product.template': 'products',
    'res.partner': 'customers',
    'sale.order': 'orders',
  }
  const entityType = modelToEntityMap[odooModel]
  if (entityType) {
    const ev = event.toLowerCase()
    // Use platformHint as authoritative source — avoids misidentifying Zid events
    // ending in '.created'/'.updated' (e.g. "category.created") as Salla.
    const storeType: string = platformHint ?? (
      ev.startsWith('shopify:') || ev.includes('shopify') ? 'shopify'
      : ev.includes('salla') ? 'salla'
      : 'zid'
    )
    // Gate against the store this event is for, not the mapping's own merchant
    // (which is empty for preset mappings and wrong across multi-store setups).
    const check = await isEntityOperationAllowed(mapping.workspace_id, storeType, odooOperation, entityType, storeId || mapping.merchant_id || '')
    if (!check.allowed) {
      console.info(`[SyncEngine] Skipping mapping "${mapping.name}" — ${check.reason}`)
      return {
        mappingId: mapping.id,
        mappingName: mapping.name,
        model: odooModel,
        status: 'skipped',
        message: check.reason,
      }
    }
  }

  if (odooModel !== 'product.template') {
    console.info(`[SyncEngine] Processing mapping "${mapping.name}" → model="${odooModel}" operation="${odooOperation}" triggerType="${triggerType}" existingLogId="${existingLogId || 'none'}"`)
  }

  // ——— Create or Update Initial Log Entry (status: processing) ——————————————
  let logId = existingLogId
  const logExecutionScope = getErpExecutionScope()

  if (!logId && zidEntityId && event) {
    try {
      const tenSecondsAgo = new Date(Date.now() - 10000).toISOString()
      const { data: recentLog } = await supabaseAdmin
        .from('sync_logs')
        .select('id')
        .eq('workspace_id', mapping.workspace_id)
        .eq('erp_connection_id', logExecutionScope?.erpConnectionId ?? '')
        .eq('connection_generation', logExecutionScope?.connectionGeneration ?? '')
        .eq('platform', logExecutionScope?.platform ?? '')
        .eq('store_id', storeId)
        .eq('zid_entity_id', zidEntityId)
        .eq('event', event)
        .gt('created_at', tenSecondsAgo)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (recentLog) {
        logId = recentLog.id
        console.info(`[SyncEngine] Found recent log ID="${logId}" for entity "${zidEntityId}" - reusing it`)
      }
    } catch (err) {
      console.warn('[SyncEngine] Failed to check for recent logs:', err)
    }
  }

  try {
    const logData = {
      workspace_id: mapping.workspace_id,
      erp_connection_id: logExecutionScope?.erpConnectionId,
      connection_generation: logExecutionScope?.connectionGeneration,
      platform: logExecutionScope?.platform,
      field_mapping_id: mapping.id,
      event,
      store_id: storeId,
      zid_entity_id: zidEntityId,
      odoo_model: odooModel,
      status: 'processing',
      payload: zidData,
      trigger_type: triggerType,
      error_message: null,
      odoo_record_id: null
    }

    if (logId) {
      console.info(`[SyncEngine] Updating log to processing ID="${logId}"`)
      // Fetch the current status first to avoid overwriting success/failed statuses prematurely
      const { data: currentLog } = await supabaseAdmin
        .from('sync_logs')
        .select('status')
        .eq('id', logId)
        .eq('workspace_id', mapping.workspace_id)
        .maybeSingle()

      if (!currentLog || !['success', 'failed'].includes(currentLog.status)) {
        await supabaseAdmin.from('sync_logs').update(logData).eq('id', logId).eq('workspace_id', mapping.workspace_id)
      } else {
        console.info(`[SyncEngine] Log ID="${logId}" has status "${currentLog.status}" - skipping initial processing update`)
      }
    } else {
      console.info(`[SyncEngine] Creating initial processing log`)
      const { data: newLog, error: initialLogErr } = await supabaseAdmin
        .from('sync_logs')
        .insert([{
          ...logData,
          created_at: new Date().toISOString()
        }])
        .select('id')
        .maybeSingle()

      if (initialLogErr) {
        if (initialLogErr.code === '23514') {
          console.info('[SyncEngine] Skipping initial processing log due to database check constraint (status: processing). Final status log will be written at the end.')
        } else {
          console.error('[SyncEngine] Failed to write initial sync_log:', initialLogErr)
        }
      } else if (newLog) {
        logId = newLog.id
      }
    }
  } catch (err) {
    console.error('[SyncEngine] Exception during initial log creation:', err)
  }

  // ——— 1. Determine platform + preset key ——————————————————————————————————
  // Use platformHint as authoritative source — avoids misidentifying Zid events
  // ending in '.created'/'.updated' (e.g. "category.created") as Salla.
  let platform: 'zid' | 'salla' | 'shopify'
  const ev = event.toLowerCase()
  if (platformHint) {
    platform = platformHint
  } else if (ev.startsWith('shopify:') || ev.includes('shopify')) {
    platform = 'shopify'
  } else if (ev.includes('salla')) {
    platform = 'salla'
  } else {
    platform = 'zid'
  }
  const normalizedEv = normalizeEvent(event)
  const presetKey = derivePresetKey(normalizedEv, platform)

  // ——— 2. Resolve Odoo connection ——————————————————————————————————————————
  let odooConn: OdooConnectionRow | null = null
  const targetScope = getErpExecutionScope()
  if (targetScope) odooConn = await validateExecutionTarget(mapping.workspace_id, targetScope.platform, storeId, targetScope) as OdooConnectionRow

  if (!odooConn && mapping.erp_connection_id && mapping.workspace_id) {
    const { data: conn, error: connErr } = await supabaseAdmin
      .from('erp_connections')
      .select('id, url, db_name, username, password, erp_type')
      .eq('id', mapping.erp_connection_id)
      .eq('workspace_id', mapping.workspace_id)
      .maybeSingle()
    console.info(`[SyncEngine] erp_connection by id: found=${!!conn} error=${connErr?.message ?? 'none'}`)
    odooConn = conn as any
  }

  // An explicit missing/foreign connection is an error, never a request to
  // redirect pending work to a different ERP database in this workspace.
  if (!odooConn && !mapping.erp_connection_id && mapping.workspace_id) {
    const { data: conn, error: connErr } = await supabaseAdmin
      .from('erp_connections')
      .select('id, url, db_name, username, password, erp_type')
      .eq('workspace_id', mapping.workspace_id)
      .maybeSingle()
    console.info(`[SyncEngine] erp_connection fallback: found=${!!conn} error=${connErr?.message ?? 'none'}`)
    odooConn = conn as any
  }

  if (!odooConn) {
    const errMsg = `No Odoo connection found for mapping "${mapping.name}"`
    console.warn(`[SyncEngine] ${errMsg}`)
    await logSync({ id: logId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'failed', error_message: errMsg, payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'failed', message: errMsg }
  }

  // ——— Route based on ERP type —————————————————————————————————————————————
  if (odooConn.erp_type === 'erpnext') {
    return processErpNextMapping({
      connection: odooConn, mapping, event, storeId, zidEntityId, zidData, odooModel, odooOperation, platformHint, triggerType, logId,
    })
  }

  if (odooConn.erp_type && odooConn.erp_type !== 'odoo') {
    const errMsg = `Sync for ${odooConn.erp_type} is not implemented yet. (المزامنة لنظام ${odooConn.erp_type} غير مدعومة حالياً)`
    console.warn(`[SyncEngine] ${errMsg}`)
    await logSync({ id: logId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'failed', error_message: errMsg, payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'failed', message: errMsg }
  }

  // ——— 2. Use mapping field pairs ——————————————————————————————————————————
  const mappingItems: FieldMappingItem[] = mapping.mappings?.[odooModel] ?? []

  if (mappingItems.length === 0 && odooOperation !== 'delete') {
    return skipNoFieldItems({ logId, mapping, event, storeId, zidEntityId, odooModel, zidData, triggerType })
  }

  // ——— 3. Create OdooClient ————————————————————————————————————————————————
  const decryptedPassword = decrypt(odooConn.password)
  const client = new OdooClient({
    url: odooConn.url,
    db: odooConn.db_name || '',
    username: odooConn.username,
    apiKey: decryptedPassword,
  })

  // ——— 4. Fetch field metadata (ttype + relation) for all mapped fields —————
  const erpFieldNames = mappingItems.map(m => m.erpField)
  const fieldMeta = await fetchFieldMeta(client, odooModel, erpFieldNames)

  // ——— 5. Build Odoo values (resolves Many2one/Many2many to IDs) ————————————
  platform = (platformHint || getPlatformFromEvent(event)) as 'zid' | 'salla' | 'shopify'
  const productSettings = odooModel === 'product.template'
    ? await getCachedStandardMappingSettings(mapping.workspace_id, platform, 'products', storeId) : null
  const odooValues = await buildOdooValues(client, mappingItems, zidData, fieldMeta, platform, mapping.workspace_id, storeId, productSettings)

  // Sales-order lines are built centrally inside executeOdooOperation, after
  // its existing-order check and currency resolution. Building them here too
  // could create products twice and use unconverted prices.

  if (Object.keys(odooValues).length === 0 && odooOperation !== 'delete' && odooOperation !== 'cancel' && odooOperation !== 'deliver') {
    console.warn(`[SyncEngine] No values extracted from Zid data for mapping "${mapping.name}"`)
    await logSync({ id: logId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: 'All mapped Zid fields were empty or missing', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: 'All mapped Zid fields were empty or missing' }
  }

  console.info('[SyncEngine] Odoo values prepared', {
    mappingId: mapping.id, platform, model: odooModel, fieldCount: Object.keys(odooValues).length,
  })

  // ——— 6. Execute the configured generic Odoo operation —————————————————————
  try {
    return await executeOdooOperation({
      client,
      mapping,
      event,
      storeId,
      zidEntityId,
      zidData,
      odooModel,
      odooOperation,
      odooValues,
      presetKey,
      triggerType,
      existingLogId: logId,
      platformHint: platform,
    })
  } catch (err: any) {
    const errMsg = err?.message ?? String(err)
    console.error(`[SyncEngine] ❌ Failed to ${odooOperation} ${odooModel} in Odoo:`, errMsg)
    await logSync({ id: logId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'failed', error_message: errMsg, payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'failed', message: errMsg }
  }
}

async function syncMissingOdooProduct(
  productData: Record<string, unknown>,
  workspaceId: string,
  storeIdStr: string,
  platform: 'zid' | 'salla' | 'shopify',
) {
  const { data: compMappingRows } = await supabaseAdmin
    .from('field_mappings')
    .select('*')
    .is('erp_destination_retired_at', null)
    .eq('workspace_id', workspaceId)
    .eq('erp_connection_id', getErpExecutionScope()?.erpConnectionId || '')

  let syncRes: SyncEngineResult['records'][number] | null = null
  const productMapping = compMappingRows?.find(r => r.action === 'product.created' || r.action === 'product.create')
  if (productMapping) {
    syncRes = await processSingleMapping(
      productMapping,
      'product.created',
      storeIdStr,
      productData as any,
      'automatic',
      undefined,
      platform
    )
  } else {
    console.info(`[SyncEngine] No custom product field mapping found. Using fixed mapping fallback...`)
    const presetKey = derivePresetKey('product.create', platform)
    if (presetKey) {
      syncRes = await processFixedMappingFallback(
        presetKey,
        'product.created',
        storeIdStr,
        productData as any,
        platform,
        compMappingRows as FieldMappingRow[] | null,
        workspaceId
      )
    }
  }
  return syncRes
}
