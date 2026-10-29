/**
 * Sync Engine — Zid → Odoo
 *
 * When a Zid webhook arrives, this engine:
 *   1. Looks up all active field_mappings for (storeId + event)
 *   2. Resolves nested Zid data paths (e.g. "name.ar" → data.name.ar)
 *   3. Handles Many2one/Many2many fields by resolving names → IDs in Odoo
 *   4. Calls OdooClient to create/update the record
 *   5. Logs every attempt to the sync_logs table in Supabase
 */

import { getSmartDefaultOrderState } from '@/lib/auto-bootstrap'
import { decrypt } from '@/lib/crypto'
import { resolveEntityLinkId, STORED_ODOO_ID_FIELD, upsertEntityLink } from '@/lib/entity-links'
import {
  buildErpNextValues,
  ErpNextClient,
  executeErpNextOperation,
  fetchErpNextFieldMeta,
} from '@/lib/erpnext-engine'
import { resolveOperationForEvent } from '@/lib/event-operation'
import { isInventorySyncErpToStoreEnabled } from '@/lib/inventory-sync-settings'
import { getEffectiveStandardMappingSettings } from '@/lib/mapping-settings'
import {
  paymentKeysFromOrder,
  resolveAnalyticDistribution,
  toOdooAnalyticFields,
} from '@/lib/odoo/analytic-distribution'
import { OdooClient } from '@/lib/odoo-client'
import {
  allPlatformIdFieldNames,
  pickExistingIdField,
  platformIdField,
  platformIdFieldNames,
  platformLegacyIdField,
} from '@/lib/platform-fields'
import { extractSallaRefundedLines, isReturnSignal, type StoreReturnLine } from '@/lib/returns/detect'
import { processReturnEvent } from '@/lib/returns/engine'
import { normalizeReturnSettings } from '@/lib/returns/settings'
import { fetchZidReturnState } from '@/lib/returns/zid'
import { resolvePath, resolveShopifyCustomerFullName, resolveZidMatchValue, toNameString } from '@/lib/sync-helpers'
import { logSync, supabaseAdmin } from '@/lib/sync-runtime'
import type {
  FieldMappingItem,
  FieldMappingRow,
  OdooConnectionRow,
  OdooFieldMeta,
  OdooOperation,
  SyncEngineResult,
} from '@/lib/sync-types'
import { notifySyncResult } from '@/lib/telegram-notifier'
import type { SyncRecordSummary } from '@/lib/telegram-notifier'
import { ttlCache } from '@/lib/ttl-cache'
import {
  isSaudiShippingAddress,
  resolveZidCodAmount,
  resolveOrderDiscountAmount,
  resolveZidShippingCost,
  resolveZidStatus,
} from '@/lib/zid/order-helpers'

// Types live in sync-types.ts so erpnext-engine.ts can share them without
// importing this file. Re-exported here: this was their original path.
export type {
  FieldMappingItem,
  FieldMappingRow,
  OdooConnectionRow,
  OdooFieldMeta,
  OdooOperation,
  SyncEngineResult,
} from '@/lib/sync-types'

// resolvePath / toNameString moved to sync-helpers.ts, and the supabaseAdmin
// client + logSync moved to sync-runtime.ts (shared with erpnext-engine.ts).
// Re-exported here: this was their original path.
export { resolvePath, toNameString }

/**
 * Look up per-category overrides from the category_mappings table
 * and return an override object matching the standard_mapping_settings shape.
 */
async function applyCategoryMappingOverrides(
  workspaceId: string,
  platform: string,
  zidData: Record<string, unknown>,
  storeId = '',
): Promise<Record<string, any>> {
  try {
    // Extract a category name from zidData using known field paths
    let catName = ''
    const flatName = resolvePath(zidData, 'flat_name')
    if (flatName && typeof flatName === 'string') { catName = flatName.trim() }
    if (!catName) {
      const nameVal = zidData.name ?? (zidData as any).names ?? zidData.title
      catName = toNameString(nameVal)
    }
    if (!catName) return {}

    // Per-store row first, platform default ('') as fallback — two stores
    // of one platform may map the same category name differently.
    const { data: rows } = await supabaseAdmin
      .from('category_mappings')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('platform', platform)
      .ilike('source_category_name', catName)
      .in('store_id', storeId ? [storeId, ''] : [''])

    const row = (rows ?? []).find((r: any) => (r.store_id || '') === storeId)
      ?? (rows ?? []).find((r: any) => !r.store_id)
      ?? (rows ?? [])[0]
    if (!row) return {}

    const override: Record<string, any> = {}
    if (row.property_cost_method || row.property_valuation) {
      override.inventory_valuation = {}
      if (row.property_cost_method) override.inventory_valuation.property_cost_method = row.property_cost_method
      if (row.property_valuation) override.inventory_valuation.property_valuation = row.property_valuation
    }
    if (row.income_account_id || row.expense_account_id || row.stock_valuation_account_id) {
      override.accounting = {}
      if (row.income_account_id && Number(row.income_account_id) > 0) override.accounting.income_account_id = row.income_account_id
      if (row.expense_account_id && Number(row.expense_account_id) > 0) override.accounting.expense_account_id = row.expense_account_id
      if (row.stock_valuation_account_id && Number(row.stock_valuation_account_id) > 0) override.accounting.stock_valuation_account_id = row.stock_valuation_account_id
    }
    if (row.stock_journal_id && Number(row.stock_journal_id) > 0) {
      if (!override.accounting) override.accounting = {}
      override.accounting.stock_journal_id = row.stock_journal_id
    }
    if (row.stock_input_account_id && Number(row.stock_input_account_id) > 0) {
      if (!override.accounting) override.accounting = {}
      override.accounting.stock_input_account_id = row.stock_input_account_id
    }
    if (row.stock_output_account_id && Number(row.stock_output_account_id) > 0) {
      if (!override.accounting) override.accounting = {}
      override.accounting.stock_output_account_id = row.stock_output_account_id
    }
    if (row.odoo_category_id && Number(row.odoo_category_id) > 0) {
      override.odoo_category_id = Number(row.odoo_category_id)
    }
    if (Object.keys(override).length > 0) {
      console.info(`[SyncEngine] Applied per-category mapping for "${catName}":`, override)
    }
    return override
  } catch (err) {
    console.warn('[SyncEngine] applyCategoryMappingOverrides error:', err)
    return {}
  }
}

async function fetchAndBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    })
    if (!res.ok) {
      console.warn(`[SyncEngine] Failed to fetch binary from URL ${url}: ${res.status} ${res.statusText}`)
      return null
    }
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) {
      console.warn(`[SyncEngine] URL ${url} returned non-image content-type: ${contentType}`)
    }
    const buffer = await res.arrayBuffer()
    if (buffer.byteLength === 0) {
      console.warn(`[SyncEngine] Empty response from URL ${url}`)
      return null
    }
    return Buffer.from(buffer).toString('base64')
  } catch (err) {
    console.warn(`[SyncEngine] Error fetching/encoding binary from URL ${url}:`, err)
    return null
  }
}

async function resolveBinaryField(rawValue: unknown): Promise<string | null> {
  if (!rawValue) return null

  // 1. If it's a string, check if it's a URL or already base64
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim()
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return fetchAndBase64(trimmed)
    }
    // Check if it's already a base64 string
    if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length > 50) {
      return trimmed
    }
    // Data URL
    if (trimmed.startsWith('data:')) {
      const parts = trimmed.split(';base64,')
      if (parts.length === 2) return parts[1]
    }
    return null
  }

  // 2. If it's an array (like Zid images array)
  if (Array.isArray(rawValue)) {
    if (rawValue.length === 0) return null
    console.info(`[SyncEngine] resolveBinaryField: array of ${rawValue.length} items, first=${JSON.stringify(rawValue[0]).slice(0, 300)}`)
    const mainImg = rawValue.find((img: any) => img && (img.is_main === true || img.is_default === true)) || rawValue[0]
    if (mainImg) {
      const url = typeof mainImg === 'string'
        ? mainImg
        : (mainImg.url ?? mainImg.image_url ?? mainImg.src ?? mainImg.image?.url ?? mainImg.path ?? mainImg.full_path ?? null)
      if (!url && typeof mainImg === 'object') {
        console.warn(`[SyncEngine] resolveBinaryField: mainImg keys=${Object.keys(mainImg).join(', ')} — no known URL key found`)
      }
      console.info(`[SyncEngine] resolveBinaryField: extracted url="${url}" from mainImg type=${typeof mainImg}`)
      if (url && typeof url === 'string') {
        return fetchAndBase64(url.trim())
      }
    }
    console.warn(`[SyncEngine] resolveBinaryField: no valid image found in array`)
    return null
  }

  // 3. If it's an object
  if (typeof rawValue === 'object' && rawValue !== null) {
    const obj = rawValue as Record<string, unknown>
    const url = obj.url ?? obj.image_url ?? obj.src ?? null
    if (url && typeof url === 'string') {
      return fetchAndBase64(url.trim())
    }
  }

  return null
}

// ─── Helper: send Telegram notification for a sync result record ─────────────
function extractDetailsFromPayload(event: string, data?: Record<string, unknown>): SyncRecordSummary['details'] | undefined {
  if (!data || typeof data !== 'object') return undefined
  const d = data as any
  const ev = (event || '').toLowerCase()

  if (ev.includes('order') || ev.includes('sale') || ev.includes('cart')) {
    const customer = d.customer || {}
    const custName = customer.name || [customer.first_name, customer.last_name].filter(Boolean).join(' ') || d.customer_name || d.shipping?.address?.name
    const custPhone = customer.mobile || customer.phone || d.customer_mobile || d.customer_phone || d.shipping?.address?.phone
    const orderNum = d.order_number || d.code || d.id || d.reference || d.name
    const total = d.order_total || d.total || d.grand_total || d.total_amount
    const curr = d.currency || d.currency_code || 'SAR'
    const payMethod = d.payment?.method || d.payment_method || d.payment_method_name || d.gateway
    const shipMethod = d.shipping?.method || d.shipping_method || d.shipping_method_name
    const itemsCount = Array.isArray(d.products) ? d.products.length : Array.isArray(d.items) ? d.items.length : Array.isArray(d.line_items) ? d.line_items.length : undefined

    return {
      orderNumber: orderNum ? String(orderNum) : null,
      customerName: custName ? String(custName) : null,
      customerPhone: custPhone ? String(custPhone) : null,
      totalAmount: total ? String(total) : null,
      currency: curr ? String(curr) : 'SAR',
      paymentMethod: payMethod ? String(payMethod) : null,
      shippingMethod: shipMethod ? String(shipMethod) : null,
      itemsCount,
    }
  }

  if (ev.includes('product') || ev.includes('item')) {
    const prod = (d.product && typeof d.product === 'object') ? d.product : d
    const prodName = prod.name?.ar || prod.name?.en || prod.name || prod.title || d.name?.ar || d.name?.en || d.name || d.title
    const sku = prod.sku || prod.code || prod.barcode || d.sku || d.code || d.barcode
    return {
      productName: prodName ? String(prodName) : null,
      productSku: sku ? String(sku) : null,
    }
  }

  if (ev.includes('category')) {
    const cat = (d.category && typeof d.category === 'object') ? d.category : d
    const catName = cat.name?.ar || cat.name?.en || cat.name || cat.title || d.name?.ar || d.name?.en || d.name || d.title
    return {
      categoryName: catName ? String(catName) : null,
    }
  }

  if (ev.includes('customer') || ev.includes('contact') || ev.includes('partner')) {
    const cust = (d.customer && typeof d.customer === 'object') ? d.customer : d
    const custName = cust.name || [cust.first_name, cust.last_name].filter(Boolean).join(' ') || d.name || [d.first_name, d.last_name].filter(Boolean).join(' ') || d.customer_name || cust.customer_name
    const phone = cust.mobile || cust.phone || cust.telephone || d.mobile || d.phone || d.telephone || d.customer_mobile || d.customer_phone
    return {
      customerName: custName ? String(custName) : null,
      customerPhone: phone ? String(phone) : null,
    }
  }

  return undefined
}

async function notifySyncForRecord(
  workspaceId: string | null | undefined,
  record: SyncEngineResult['records'][number],
  event: string,
  mappingName: string,
  mappingId: string,
  model: string,
  storeId?: string,
  errorMessage?: string | null,
  payloadData?: Record<string, unknown>,
  eventKey?: string | null
) {
  let wsId = workspaceId
  if (!wsId && storeId) {
    try {
      const { data: tok } = await supabaseAdmin
        .from('merchant_tokens')
        .select('workspace_id')
        .or(`store_id.eq.${storeId},merchant_id.eq.${storeId}`)
        .maybeSingle()
      wsId = tok?.workspace_id
    } catch { /* ignore */ }
  }
  if (!wsId && storeId) {
    try {
      const { data: sallaTok } = await supabaseAdmin
        .from('salla_tokens')
        .select('workspace_id')
        .eq('merchant_id', storeId)
        .maybeSingle()
      wsId = sallaTok?.workspace_id
    } catch { /* ignore */ }
  }
  if (!wsId && storeId) {
    try {
      const { data: shopTok } = await supabaseAdmin
        .from('shopify_tokens')
        .select('workspace_id')
        .eq('shop_domain', storeId)
        .maybeSingle()
      wsId = shopTok?.workspace_id
    } catch { /* ignore */ }
  }

  if (!wsId) return

  const details = extractDetailsFromPayload(event, payloadData)

  const summary: SyncRecordSummary = {
    status: record.status === 'success' ? 'success' : record.status === 'failed' ? 'failed' : 'skipped',
    event,
    mappingName,
    mappingId,
    model,
    odooRecordId: record.odooRecordId,
    errorMessage: errorMessage || record.message,
    workspaceId: wsId,
    storeId,
    receivedAt: new Date().toISOString(),
    details,
  }
  await notifySyncResult({ workspaceId: wsId, record: summary, eventKey: eventKey ?? null }).catch(() => {})
}

// ─── Helper: fetch Odoo field metadata (ttype + relation) for a model ─────────

export async function fetchFieldMeta(
  client: OdooClient,
  model: string,
  fieldNames: string[]
): Promise<Map<string, OdooFieldMeta>> {
  try {
    const rows = await client.execute<Array<{ name: string; ttype: string; relation: string }>>(
      'ir.model.fields',
      'search_read',
      [[['model', '=', model], ['name', 'in', fieldNames]]],
      { fields: ['name', 'ttype', 'relation'] }
    )
    const map = new Map<string, OdooFieldMeta>()
    for (const r of rows) map.set(r.name, r)
    console.info(`[SyncEngine] Fetched field meta for [${fieldNames.join(', ')}]:`,
      rows.map(r => `${r.name}(${r.ttype}${r.relation ? '→' + r.relation : ''})`).join(', '))
    return map
  } catch (err) {
    console.warn('[SyncEngine] Could not fetch field meta, will skip relational resolution:', err)
    return new Map()
  }
}

// ─── Helper: known selection keys of a sale.order custom field ──────────────
// The order custom-status feature writes the platform status string into a
// Selection field (x_zid_order_status / x_salla_order_status). Odoo validates
// selection values on write — an unmapped status (e.g. a Salla shipment slug
// like "in_progress", or raw Arabic text) would fail the WHOLE order create
// with a ValidationError. So both injection sites check membership first and
// skip unknown values with a warning instead of killing the sync.
// Returns null when the options cannot be read (fail-open: inject as before,
// preserving the old behaviour in degraded mode). Cached 10 min per field.
const SELECTION_KEYS_TTL_MS = 10 * 60 * 1000

export async function getSaleOrderSelectionKeys(
  client: OdooClient,
  workspaceId: string,
  fieldName: string
): Promise<Set<string> | null> {
  try {
    return await ttlCache.get<Set<string> | null>(
      `selopts:${workspaceId}:sale.order:${fieldName}`,
      SELECTION_KEYS_TTL_MS,
      async () => {
        const rows = await client.execute<Array<{ selection?: string }>>(
          'ir.model.fields',
          'search_read',
          [[['model', '=', 'sale.order'], ['name', '=', fieldName]]],
          { fields: ['selection'], limit: 1 }
        )
        const sel = rows?.[0]?.selection
        if (!sel) return null
        const keys = new Set<string>()
        const regex = /\('([^']+)',\s*'([^']+)'\)/g
        let match: RegExpExecArray | null
        while ((match = regex.exec(sel)) !== null) keys.add(match[1])
        return keys.size > 0 ? keys : null
      }
    )
  } catch {
    return null
  }
}

// ─── Helper: Determine platform from webhook event ──────────────────────────

export function getPlatformFromEvent(event: string): 'zid' | 'salla' | 'shopify' {
  // Shopify events use "shopify:" prefix, contain "shopify", or use "/" syntax (orders/create, products/create)
  if (event.startsWith('shopify:') || event.includes('shopify') || event.includes('/')) return 'shopify'
  if (event.includes('salla')) return 'salla'
  if (event.includes('zid')) return 'zid'

  // Explicit Zid events (Zid uses .update present-tense and specific status names)
  if (
    event === 'order.status.update' ||
    event === 'order.payment_status.update' ||
    event === 'order_status_update' ||
    event === 'order_payment_status_update' ||
    event === 'order.create' ||
    event === 'order.created' ||
    event === 'order_create' ||
    event === 'order_created'
  ) {
    return 'zid'
  }

  // Salla events use past-tense verbs (.updated, .cancelled, etc.)
  if (
    event === 'order.status.updated' ||
    event.endsWith('.cancelled') ||
    event.endsWith('.refunded') ||
    event.endsWith('.low') ||
    event.endsWith('.available') ||
    event.endsWith('.changed')
  ) {
    return 'salla'
  }
  return 'zid'
}

// ─── Helper: resolve a single relational value (ID Match → Name Match → Creation) ───

export async function resolveSingleRelationId(
  client: any,
  relation: string,
  itemValue: unknown,
  platform: 'zid' | 'salla' | 'shopify',
  _operation?: any,
  _item?: any,
  workspaceId?: any,
  storeId = '',
  _payload?: any,
  _extra?: Record<string, unknown>,
  _dryRun?: boolean
): Promise<number | null> {
  if (itemValue === undefined || itemValue === null) return null

  // 1. Extract platformId and nameVal
  let platformId: string | null = null
  let nameVal: string | null = null

  if (itemValue && typeof itemValue === 'object') {
    const obj = itemValue as Record<string, unknown>
    const rawId = obj.id ?? obj.uuid ?? obj.merchant_id
    if (rawId !== undefined && rawId !== null) {
      platformId = String(rawId).trim()
    }
    nameVal = toNameString(itemValue)
  } else if (typeof itemValue === 'number') {
    platformId = String(itemValue)
    nameVal = String(itemValue)
  } else if (typeof itemValue === 'string') {
    const trimmed = itemValue.trim()
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    const isNumeric = /^\d+$/.test(trimmed)
    if (isUuid || isNumeric) {
      platformId = trimmed
    }
    nameVal = trimmed
  }

  if (!nameVal || nameVal === '[object Object]' || nameVal === 'undefined') {
    if (!platformId) return null
  }

  try {
    // ─── Case 0: Resolve from previous sync_logs ───────────────────────────
    if (platformId && workspaceId) {
      try {
        const { data: previousLog } = await supabaseAdmin
          .from('sync_logs')
          .select('odoo_record_id')
          .eq('workspace_id', workspaceId)
          .eq('zid_entity_id', String(platformId))
          .eq('odoo_model', relation)
          .eq('status', 'success')
          .not('odoo_record_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (previousLog?.odoo_record_id) {
          const idNum = Number(previousLog.odoo_record_id)
          if (Number.isInteger(idNum) && idNum > 0) {
            const exists = await client.search(relation, [['id', '=', idNum]], 1)
            if (exists && exists.length > 0) {
              console.info(`[SyncEngine] Case 0 (sync_logs): Resolved ${relation} #${idNum} for platform ID "${platformId}"`)
              return idNum
            }
          }
        }
      } catch (logErr) {
        console.warn(`[SyncEngine] sync_logs check failed for ${relation}:`, logErr)
      }
    }

    // Fetch target relation fields meta to verify field existence (avoiding Odoo RPC errors on non-existing columns)
    const relationFields = await fetchFieldMeta(client, relation, ['name', 'x_zid_id', 'zid_id', 'x_salla_id', 'salla_id', 'x_shopify_id', 'shopify_id'])

    // ─── Case 1: Search by Platform ID (Fixed Mapping check) ─────────────────
    if (platformId) {
      // Stage 1: current-then-legacy resolution now has a single definition.
      const searchField = pickExistingIdField(relationFields, platform)

      if (searchField) {
        const ids = await client.search(relation, [[searchField, '=', platformId]])
        if (ids && ids.length > 0) {
          console.info(`[SyncEngine] Case 1 (ID Match): Resolved ${relation} with ${searchField}="${platformId}" → ID #${ids[0]}`)
          return ids[0]
        }
      }

      // ─── Case 1.5: Try Match Field from standard_mapping_settings ────────
      if (workspaceId && relation) {
        const entityMap: Record<string, string> = {
          'product.category': 'categories',
          'product.template': 'products',
          'res.partner': 'customers',
          'sale.order': 'orders',
        }
        const entityType = entityMap[relation]
        if (entityType) {
          const storeType = platform === 'shopify' ? 'shopify'
            : platform === 'salla' ? 'salla'
            : 'zid'
          try {
            // Must be store-scoped: an unscoped/`maybeSingle()` read returns the
            // platform default (or throws PGRST116) once a per-store row exists,
            // so this store's configured match field was silently ignored.
            const stdSettings = await getEffectiveStandardMappingSettings(
              supabaseAdmin,
              workspaceId,
              storeType,
              entityType,
              storeId
            )
            if (stdSettings) {
              const odooMatchField = stdSettings.match_odoo_field
              if (odooMatchField && (odooMatchField === 'id' || relationFields.has(odooMatchField))) {
                const mfIds = await client.search(relation, [[odooMatchField, '=', platformId]])
                if (mfIds && mfIds.length > 0) {
                  console.info(`[SyncEngine] Case 1.5 (Match Field): Resolved ${relation} via ${odooMatchField}="${platformId}" → ID #${mfIds[0]}`)
                  return mfIds[0]
                }
              }
            }
          } catch (err) {
            console.warn(`[SyncEngine] Match Field lookup failed for ${relation}:`, err)
          }
        }
      }
    }

    // ─── Special Resolution for product.category (Parent Category) ─────────
    // Salla exposes `parent_id` as a bare numeric Salla category ID. If that ID
    // was never synced (the parent is usually created before the child, but a
    // pre-existing parent never syncs at all), every lookup below misses and
    // the ID is skipped — so Parent Category stayed empty in Odoo. Same fetch
    // the Zid branch does, just from Salla's own API.
    if (relation === 'product.category' && (platform === 'zid' || platform === 'salla') && platformId && workspaceId) {
      try {
        let parentCat: any = null
        let catName: string | null = null

        if (platform === 'salla') {
          const { data: tokenRow } = await supabaseAdmin
            .from('salla_tokens')
            .select('merchant_id')
            .eq('workspace_id', workspaceId)
            .limit(1)
            .maybeSingle()

          if (tokenRow?.merchant_id) {
            const { getSallaCategory } = await import('@/lib/salla-client')
            parentCat = await getSallaCategory(String(tokenRow.merchant_id), platformId)
            if (parentCat) {
              const n = parentCat.name
              catName = typeof n === 'string' && n.trim() ? n.trim() : null
            }
            if (!catName) {
              console.warn(`[SyncEngine] Salla category API returned response without name for ID "${platformId}":`, parentCat)
            }
          } else {
            console.warn(`[SyncEngine] No salla_token found for workspace "${workspaceId}" to resolve parent category`)
          }
        } else {
          const { data: tokenRow } = await supabaseAdmin
            .from('merchant_tokens')
            .select('*')
            .eq('workspace_id', workspaceId)
            .limit(1)
            .maybeSingle()

          if (tokenRow?.access_token && tokenRow?.authorization_token) {
            const { ZidAPI } = await import('@/lib/zid-client')
            const creds = {
              authorization: tokenRow.authorization_token,
              managerToken: tokenRow.access_token,
              storeId: tokenRow.store_id || tokenRow.merchant_id,
            }
            const catRes = await ZidAPI.categories.get(creds, platformId)
            parentCat = (catRes.data as any)?.categories ?? (catRes.data as any)?.category ?? catRes.data
            catName = parentCat?.names?.ar || parentCat?.names?.en || parentCat?.name?.ar || parentCat?.name?.en || (typeof parentCat?.name === 'string' ? parentCat.name : null)
            if (!catName) {
              console.warn(`[SyncEngine] Zid category API returned response without name for ID "${platformId}":`, catRes.data)
            }
          } else {
            console.warn(`[SyncEngine] No merchant_token found for workspace "${workspaceId}" to resolve parent category`)
          }
        }

        if (catName) {
          {
            console.info(`[SyncEngine] Fetched parent category "${catName}" from ${platform} for ID "${platformId}"`)
            const found = await client.search('product.category', [['name', '=', catName]])
            if (found && found.length > 0) {
              try {
                await supabaseAdmin.from('sync_logs').insert([{
                  workspace_id: workspaceId,
                  event: 'category.create',
                  zid_entity_id: String(platformId),
                  odoo_model: 'product.category',
                  odoo_record_id: found[0],
                  status: 'success',
                  payload: parentCat,
                }])
              } catch {}
              return found[0]
            }
            const createdParentId = await client.create('product.category', { name: catName })
            if (createdParentId) {
              console.info(`[SyncEngine] Created missing parent category "${catName}" in Odoo #${createdParentId}`)
              try {
                await supabaseAdmin.from('sync_logs').insert([{
                  workspace_id: workspaceId,
                  event: 'category.create',
                  zid_entity_id: String(platformId),
                  odoo_model: 'product.category',
                  odoo_record_id: createdParentId,
                  status: 'success',
                  payload: parentCat,
                }])
              } catch {}
              return createdParentId
            }
          }
        }
      } catch (catErr) {
        console.warn(`[SyncEngine] Failed to resolve parent category from ${platform} for ID "${platformId}":`, catErr)
      }
    }

    const looksLikePlatformId = typeof nameVal === 'string' &&
      (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameVal) ||
       /^\d+$/.test(nameVal))

    // ─── Case 2: Search by Name inside Odoo ──────────────────────────────────────
    if (nameVal && !looksLikePlatformId && nameVal !== '[object Object]' && nameVal !== 'undefined') {
      const ids = await client.search(relation, [['name', '=', nameVal]])
      if (ids && ids.length > 0) {
        console.info(`[SyncEngine] Case 2 (Name Match): Resolved ${relation} with name="${nameVal}" → ID #${ids[0]}`)
        return ids[0]
      }
    }

    // ─── Case 3: Create it if not found ──────────────────────────────────────────
    if (nameVal && !looksLikePlatformId && nameVal !== '[object Object]' && nameVal !== 'undefined') {
      console.info(`[SyncEngine] Case 3 (Creation): Record not found in "${relation}". Creating a new one with name="${nameVal}"`)
      
      const createData: Record<string, unknown> = {
        name: nameVal
      }

      if (relation === 'res.partner' && itemValue && typeof itemValue === 'object') {
        const obj = itemValue as Record<string, unknown>
        if (obj.email) createData.email = String(obj.email)
        const partnerPhone = obj.telephone || obj.phone || obj.mobile
        if (partnerPhone) createData.phone = String(partnerPhone)
        if (obj.business_name || obj.company_name) createData.company_name = String(obj.business_name || obj.company_name)
        if (obj.tax_number || obj.vat) createData.vat = String(obj.tax_number || obj.vat)
        if (obj.commercial_registration) createData.company_registry = String(obj.commercial_registration)

        // Address fields from nested city
        if (obj.city && typeof obj.city === 'object') {
          const cityObj = obj.city as Record<string, any>
          const cityName = cityObj.ar_name || cityObj.name || cityObj.en_name
          if (cityName) createData.city = String(cityName)
        }

        // Determine company type (Zid is 'business', Salla is 'corporate')
        const typeStr = typeof obj.type === 'string' ? obj.type.toLowerCase() : ''
        const isCorp =
          typeStr === 'corporate' ||
          typeStr === 'business' ||
          typeStr === 'company' ||
          !!obj.business_name ||
          !!obj.tax_number ||
          !!obj.commercial_registration
        createData.company_type = isCorp ? 'company' : 'person'

        if (workspaceId) {
          try {
            // Store-scoped: the receivable/payable accounts are per-store page
            // settings. Unscoped, this read the platform default (or threw
            // PGRST116 with a per-store row present) and applied store #1's
            // accounts to every store's new partners.
            const stdSettings = await getEffectiveStandardMappingSettings(
              supabaseAdmin,
              workspaceId,
              platform,
              'customers',
              storeId
            )

            if (stdSettings) {
              if (stdSettings.receivable_account_id && Number(stdSettings.receivable_account_id) > 0) {
                createData.property_account_receivable_id = Number(stdSettings.receivable_account_id)
              }
              if (stdSettings.payable_account_id && Number(stdSettings.payable_account_id) > 0) {
                createData.property_account_payable_id = Number(stdSettings.payable_account_id)
              }
            }
          } catch (acctErr) {
            console.warn(`[SyncEngine] Failed to load default customer accounts:`, acctErr)
          }
        }
      }

      if (platformId) {
        // No shopify branch on purpose: this create path has never written
        // x_shopify_id. Routing it through pickExistingIdField would start
        // writing the column, so keep it out of the Stage 1 unification.
        if (platform === 'zid') {
          if (relationFields.has('x_zid_id')) createData.x_zid_id = platformId
          else if (relationFields.has('zid_id')) createData.zid_id = platformId
        } else if (platform === 'salla') {
          if (relationFields.has('x_salla_id')) createData.x_salla_id = platformId
          else if (relationFields.has('salla_id')) createData.salla_id = platformId
        }
      }

      try {
        const newRecordId = await client.create(relation, createData)
        if (newRecordId) {
          console.info(`[SyncEngine] Successfully created new ${relation} #${newRecordId} (name="${nameVal}")`)
          return newRecordId
        }
      } catch (createErr: any) {
        console.warn(`[SyncEngine] Failed to create new record in "${relation}" with name="${nameVal}":`, createErr?.message ?? createErr)
      }
    }
  } catch (err: any) {
    console.warn(`[SyncEngine] Error resolving/creating relation for ${relation}:`, err?.message ?? err)
  }

  return null
}

interface GenericVariant {
  id: string | number
  sku: string
  price: number
  barcode?: string
  quantity?: number
  product_id?: string | number
  attributes: Record<string, string> // e.g. { Color: "Red", Size: "Large" }
  cost?: number
  weight?: number
  description?: string
  image?: string // URL or base64 of variant image
}

export function extractGenericVariants(payload: any, platform: 'zid' | 'salla' | 'shopify'): GenericVariant[] {
  if (!payload) return []

  // Locate the variants array (could be variants, options, or other variations)
  // NOTE: For Zid, payload.options contains option definitions, not variant products,
  // so Zid must strictly read payload.variants.
  let rawVariants = Array.isArray(payload.variants) && payload.variants.length > 0
    ? payload.variants
    : (platform !== 'zid' && Array.isArray(payload.options) && payload.options.length > 0 ? payload.options : [])

  // Shopify options check
  if (platform === 'shopify' && !Array.isArray(rawVariants)) {
    rawVariants = payload.variants || []
  }

  if (!Array.isArray(rawVariants) || rawVariants.length === 0) {
    return []
  }

  return rawVariants.map((v: any) => {
    const variantId = v.id || v.uuid || v.variant_id || ''
    const sku = v.sku || v.default_code || v.sku_code || ''
    const price = parseFloat(v.sale_price || v.price || v.regular_price || v.price_after_discount || '0') || 0
    const barcode = v.barcode || v.gtin || v.upc || undefined
    
    // Quantity mapping across platforms
    const quantity = v.quantity !== undefined 
      ? Number(v.quantity) 
      : (v.stock_quantity !== undefined 
        ? Number(v.stock_quantity) 
        : (v.inventory_quantity !== undefined 
          ? Number(v.inventory_quantity) 
          : undefined))

    const attributes: Record<string, string> = {}

    if (platform === 'shopify') {
      const options = payload.options || []
      if (v.option1 && options[0]) attributes[options[0].name] = v.option1
      if (v.option2 && options[1]) attributes[options[1].name] = v.option2
      if (v.option3 && options[2]) attributes[options[2].name] = v.option3
    } else {
      const rawAttrs = v.attributes || v.features || v.option_values || []
      if (Array.isArray(rawAttrs)) {
        rawAttrs.forEach((attr: any) => {
          const attrName = toNameString(attr.name || attr.label || attr.option_name || attr.option_label || attr.slug)
          const attrVal = toNameString(attr.value || attr.value_name || attr.option_value || attr.option_value_name || attr.val || attr.text)
          if (attrName && attrVal) {
            attributes[attrName] = attrVal
          }
        })
      } else if (rawAttrs && typeof rawAttrs === 'object') {
        Object.entries(rawAttrs).forEach(([key, val]) => {
          const attrName = key
          const attrVal = toNameString(val)
          if (attrName && attrVal) {
            attributes[attrName] = attrVal
          }
        })
      }
    }

    const cost = parseFloat(v.cost || v.cost_price || '0') || 0
    
    const rawWeight = v.weight ?? payload.weight
    let weight = 0
    if (typeof rawWeight === 'object' && rawWeight !== null) {
      weight = parseFloat((rawWeight as any).value ?? (rawWeight as any).weight ?? '0') || 0
    } else {
      weight = parseFloat(String(rawWeight ?? '0')) || 0
    }

    const description = toNameString(v.description || payload.description || payload.short_description || payload.body_html || '')

    // Extract variant image URL from platform-specific formats
    const variantImage = v.image?.src || v.main_image || v.image_url
      || (Array.isArray(v.images) && v.images[0]?.url)
      || (Array.isArray(v.images) && typeof v.images[0] === 'string' ? v.images[0] : null)
      || (typeof v.image === 'string' ? v.image : null)
      || (typeof v.image?.url === 'string' ? v.image.url : null)
      || ''

    return {
      id: variantId,
      sku,
      price,
      barcode,
      quantity: isNaN(quantity as number) ? undefined : quantity,
      product_id: v.product_id || payload.id || payload.product_id || undefined,
      attributes,
      cost,
      weight,
      description,
      image: variantImage || undefined
    }
  })
}

export async function updateOdooStock(client: OdooClient, productId: number, qty: number, locationId?: number, infiniteValue?: number, workspaceId?: string): Promise<boolean> {
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

// ─── Helper: build sale.order.line items for sale.order mappings ────────────

// ──── Helper: normalize sale.order lines for update writes ─────
// Converts (0,0,...) line creates into a full replace [(5,0,0), ...] so Zid
// edits (including line changes) mirror into Odoo without duplicating lines.
// Replace happens ONLY when all of these hold:
//   - the payload actually carries products AND at least one line resolved;
//   - the Odoo order is still a quotation (draft/sent).
// Otherwise order_line is dropped → header-only update, existing Odoo lines
// untouched (protects confirmed/invoiced orders, partial payloads and
// transient product-resolution failures).
async function normalizeOrderLinesForUpdate(
  client: OdooClient,
  odooRecordId: number,
  zidData: Record<string, unknown>,
  effectiveOdooValues: Record<string, unknown>,
): Promise<void> {
  if (!('order_line' in effectiveOdooValues)) return
  const drop = (reason: string) => {
    delete effectiveOdooValues.order_line
    console.info(`[SyncEngine] Order lines left untouched on Odoo #${odooRecordId}: ${reason}`)
  }
  const cmds: unknown = effectiveOdooValues.order_line
  const creates = (Array.isArray(cmds) ? cmds : []).filter(
    (c): c is [number, number, Record<string, unknown>] => Array.isArray(c) && c[0] === 0
  )
  if (creates.length === 0) {
    drop('no lines built from payload')
    return
  }
  const payloadHasProducts = ['products', 'items', 'order_items', 'line_items', 'order_items_list'].some((k) => {
    const arr: unknown = zidData[k]
    return Array.isArray(arr) && arr.length > 0
  })
  if (!payloadHasProducts) {
    drop('no products in payload')
    return
  }
  let state = ''
  try {
    const recs = await client.searchRead<any>('sale.order', [['id', '=', odooRecordId]], ['state'])
    state = String(recs?.[0]?.state || '')
  } catch {
    state = ''
  }
  if (state !== 'draft' && state !== 'sent') {
    drop(`order state is "${state || 'unknown'}" (lines are replaced only on draft/sent quotations)`)
    return
  }
  effectiveOdooValues.order_line = [[5, 0, 0], ...creates]
  console.info(`[SyncEngine] Order update will REPLACE ${creates.length} line(s) on Odoo #${odooRecordId} (no duplicates)`)
}

const odooProductLookupCache = new Map<string, { id: number; timestamp: number }>()
const LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000

async function findOdooProductByCodeOrBarcode(client: OdooClient, code: string): Promise<number | null> {
  const trimmed = code.trim()
  if (!trimmed) return null
  const cacheKey = `${client.url}:${client.db}:${trimmed}`
  const cached = odooProductLookupCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < LOOKUP_CACHE_TTL_MS) {
    return cached.id
  }
  try {
    // 1. Search default_code (SKU) exact
    let ids = await client.execute<number[]>('product.product', 'search', [
      [['default_code', '=', trimmed]]
    ], { limit: 1 })
    if (ids && ids.length > 0) {
      odooProductLookupCache.set(cacheKey, { id: ids[0], timestamp: Date.now() })
      return ids[0]
    }

    // 1b. Search default_code case-insensitive
    ids = await client.execute<number[]>('product.product', 'search', [
      [['default_code', '=ilike', trimmed]]
    ], { limit: 1 })
    if (ids && ids.length > 0) {
      odooProductLookupCache.set(cacheKey, { id: ids[0], timestamp: Date.now() })
      return ids[0]
    }

    // 2. Search barcode exact & case-insensitive
    let barcodeIds = await client.execute<number[]>('product.product', 'search', [
      [['barcode', '=', trimmed]]
    ], { limit: 1 })
    if (!barcodeIds || barcodeIds.length === 0) {
      barcodeIds = await client.execute<number[]>('product.product', 'search', [
        [['barcode', '=ilike', trimmed]]
      ], { limit: 1 })
    }
    if (barcodeIds && barcodeIds.length > 0) {
      odooProductLookupCache.set(cacheKey, { id: barcodeIds[0], timestamp: Date.now() })
      return barcodeIds[0]
    }

    // 3. Search name exact/ilike
    const nameIds = await client.execute<number[]>('product.product', 'search', [
      [['name', '=ilike', trimmed]]
    ], { limit: 1 })
    if (nameIds && nameIds.length > 0) {
      odooProductLookupCache.set(cacheKey, { id: nameIds[0], timestamp: Date.now() })
      return nameIds[0]
    }
  } catch (err) {
    console.warn(`[SyncEngine] findOdooProductByCodeOrBarcode failed for "${trimmed}":`, err)
  }
  return null
}

/**
 * Build order_line array from Zid payload with discount + shipping support.
 *
 * Three discount modes (per user choice):
 *   A) Line-level: each product has its own discount %
 *   B) Order-level: a discount line item is appended (like shipping)
 *   C) Auto-detect: only apply if discount data exists in payload
 *
 * Reads `__settings` from the field_mapping.mappings:
 *   - addShippingAsLine, shippingProductId, shippingProductSku
 *   - addDiscountAsLine, discountProductId, discountProductSku, discountMode
 *
 * Reads line-level mappings from mapping.mappings['sale.order.line'].
 */
async function buildOrderLineItems(
  client: OdooClient,
  mapping: FieldMappingRow,
  zidData: Record<string, unknown>,
  parentFieldMeta: Map<string, OdooFieldMeta>,
  parentOdooValues: Record<string, unknown>,
  platform?: 'zid' | 'salla' | 'shopify',
  orderStdSettings?: Record<string, any> | null,
  storeId = '',
): Promise<Record<string, unknown>[]> {
  const lines: Record<string, unknown>[] = []

  // 1. Find products array in Zid payload
  const candidates = ['products', 'items', 'order_items', 'line_items', 'order_items_list']
  let products: any[] = []
  for (const key of candidates) {
    const raw = (zidData as any)[key]
    if (Array.isArray(raw) && raw.length > 0) {
      products = raw
      console.info(`[SyncEngine] Found order items at payload.${key} (${products.length})`)
      break
    }
  }

  if (products.length === 0) {
    console.warn('[SyncEngine] No order items found in Zid payload (tried: ' + candidates.join(', ') + ')')
    return lines
  }

  // 2. Read line-level mappings for sale.order.line
  const lineMappings: FieldMappingItem[] = (mapping.mappings as any)?.['sale.order.line'] ?? []
  // Standard fallback: when there is no line-level mapping (fixed/standard mapping
  // path), resolve the Odoo product by the Zid line SKU so lines are actually created.
  const effectiveLineMappings = lineMappings.length > 0
    ? lineMappings
    : [{ id: 'std_product_id', erpField: 'product_id', zidField: 'sku' }]
  const settings: Record<string, any> = (mapping.mappings as any)?.['__settings'] ?? {}
  const settingsKeys = new Set(Object.keys(settings))

  // Priority: __settings (camelCase) > orderStdSettings (snake_case) > hardcoded defaults
  const keyMap: Record<string, string> = {
    addShippingAsLine: 'add_shipping_as_line',
    shippingProductId: 'shipping_product_id',
    shippingProductSku: 'shipping_product_sku',
    addDiscountAsLine: 'add_discount_as_line',
    discountProductId: 'discount_product_id',
    discountProductSku: 'discount_product_sku',
    discountMode: 'discount_mode',
    addCodAsLine: 'add_cod_as_line',
    codProductId: 'cod_product_id',
    codProductSku: 'cod_product_sku',
    codAmount: 'cod_amount',
    productFallbackPolicy: 'product_fallback_policy',
    defaultProductId: 'default_product_id',
    enableVat: 'enable_vat',
    vatSaudiTaxId: 'vat_saudi_tax_id',
    vatNonSaudiTaxId: 'vat_non_saudi_tax_id',
  }
  const orDefault = (camelKey: string, fallback: any) => {
    if (settingsKeys.has(camelKey)) return settings[camelKey]
    const snakeKey = keyMap[camelKey]
    if (orderStdSettings && snakeKey && snakeKey in orderStdSettings) return orderStdSettings[snakeKey]
    if (orderStdSettings?.order && snakeKey && snakeKey in orderStdSettings.order) return orderStdSettings.order[snakeKey]
    return fallback
  }

  const enableVat = !!orDefault('enableVat', false)
  const vatSaudiTaxId = orDefault('vatSaudiTaxId', null) ? Number(orDefault('vatSaudiTaxId', null)) : null
  const vatNonSaudiTaxId = orDefault('vatNonSaudiTaxId', null) ? Number(orDefault('vatNonSaudiTaxId', null)) : null

  const isSaudi = isSaudiShippingAddress(zidData)
  let resolvedVatTaxId: number | null = null
  if (enableVat) {
    if (isSaudi) {
      resolvedVatTaxId = vatSaudiTaxId && Number(vatSaudiTaxId) > 0 ? Number(vatSaudiTaxId) : null
    } else {
      resolvedVatTaxId = vatNonSaudiTaxId && Number(vatNonSaudiTaxId) > 0 ? Number(vatNonSaudiTaxId) : null
    }
    console.info(`[SyncEngine] VAT enabled for order: destination=${isSaudi ? 'Saudi' : 'Non-Saudi'}, applied tax ID: ${resolvedVatTaxId ?? 'None'}`)
  } else {
    console.info('[SyncEngine] VAT disabled for order in Standard Mapping: lines will be sent without tax')
  }
  const defaultLineTaxCmd: [number, number, number[]] = enableVat && resolvedVatTaxId
    ? [6, 0, [resolvedVatTaxId]]
    : [6, 0, []]


  const productFallbackPolicy = String(orDefault('productFallbackPolicy', 'create_new') || 'create_new')
  const defaultProductIdRaw = orDefault('defaultProductId', null)
  const defaultProductId = defaultProductIdRaw ? Number(defaultProductIdRaw) : null

  const shippingProductId = String(orDefault('shippingProductId', '') || '')
  const shippingProductSku = String(orDefault('shippingProductSku', '') || '')
  const addShippingAsLine = !!orDefault('addShippingAsLine', false) || !!shippingProductId

  const addDiscountAsLine = !!orDefault('addDiscountAsLine', false)
  const discountProductId = String(orDefault('discountProductId', '') || '')
  const discountProductSku = String(orDefault('discountProductSku', '') || '')
  const discountMode = String(orDefault('discountMode', 'fixed') || 'fixed')

  const addCodAsLine = !!orDefault('addCodAsLine', false)
  const codProductId = String(orDefault('codProductId', '') || '')
  const codProductSku = String(orDefault('codProductSku', '') || '')
  const codAmount = parseFloat(String(orDefault('codAmount', 0) ?? 0)) || 0
  // COD fee comes from the Zid payload first (payment.invoice[] COD row or named
  // keys); the settings amount is only a fallback when Zid sends none.
  // Shopify sends no COD fee amount at all (only the gateway name), so for
  // Shopify orders this is always the configured `cod_amount` — that is the
  // intended behaviour, not a missing read.
  const codFeeAmount = resolveZidCodAmount(zidData) || codAmount

  const shippingCost = resolveZidShippingCost(zidData)
  const orderLevelDiscount = resolveOrderDiscountAmount(zidData)
  console.info(`[SyncEngine] Order line settings: addShipping=${addShippingAsLine} addDiscount=${addDiscountAsLine} discountMode=${discountMode} shippingCost=${shippingCost} addCod=${addCodAsLine} codFee=${codFeeAmount} orderDiscount=${orderLevelDiscount}`)

  // 3. Fetch line field meta (for many2one resolution and tax field detection)
  // analytic_distribution (Odoo 17+) / analytic_account_id (<=16) are probed
  // with the rest so the distribution can be attached without a second call,
  // and so an explicit line mapping for them survives the allowlist below.
  const lineFieldNames = [...new Set([
    ...effectiveLineMappings.map(m => m.erpField),
    'tax_id',
    'tax_ids',
    'analytic_distribution',
    'analytic_account_id',
  ])]
  const lineFieldMeta = lineFieldNames.length > 0
    ? await fetchFieldMeta(client, 'sale.order.line', lineFieldNames)
    : new Map<string, OdooFieldMeta>()

  // Odoo <= 17 uses `tax_id` on sale.order.line; Odoo 18+ (including 19) uses `tax_ids`
  let lineTaxField = 'tax_ids'
  if (lineFieldMeta.has('tax_ids')) {
    lineTaxField = 'tax_ids'
  } else if (lineFieldMeta.has('tax_id')) {
    lineTaxField = 'tax_id'
  } else {
    try {
      const fg = await client.execute<Record<string, unknown>>(
        'sale.order.line',
        'fields_get',
        [['tax_ids', 'tax_id']],
        { attributes: ['type'] }
      )
      if (fg?.tax_ids) {
        lineTaxField = 'tax_ids'
      } else if (fg?.tax_id) {
        lineTaxField = 'tax_id'
      }
    } catch {
      // Default to tax_ids
    }
  }
  console.info(`[SyncEngine] Using "${lineTaxField}" for sale.order.line taxes in Odoo`)

  // 4. Build each line
  let subtotalBeforeDiscount = 0
  let totalDiscountAmount = 0

  // First positive number from candidate keys (Zid price keys vary by payload
  // version and values may be numeric strings like "150.00 SAR").
  const numFromKeys = (source: Record<string, unknown>, keys: string[]): number => {
    for (const key of keys) {
      let raw = resolvePath(source, key)
      if (raw === undefined || raw === null) continue
      // Handle nested object amounts (e.g. Salla { amount: 150, currency: 'SAR' })
      if (typeof raw === 'object' && !Array.isArray(raw)) {
        const obj = raw as Record<string, unknown>
        raw = obj.amount ?? obj.value ?? obj.price ?? obj.total ?? undefined
      }
      if (raw === undefined || raw === null || typeof raw === 'object') continue
      const num = parseFloat(String(raw).replace(/[^0-9.\-]/g, ''))
      if (!isNaN(num) && num > 0) return num
    }
    return 0
  }

  // Check if user mapped a discount field at line level (Option A)
  const hasLineDiscountMapping = effectiveLineMappings.some(m => m.erpField === 'discount')
  // Track whether any product will actually carry discount to satisfy Option C rule
  let anyProductHasDiscount = false

  for (const product of products) {
    const productData = (product && typeof product === 'object') ? product as Record<string, unknown> : {}
    const line: Record<string, unknown> = {}

    for (const fm of effectiveLineMappings) {
      if (!fm.erpField) continue
      if (fm.erpField === 'discount') {
        // Option A handled below
        continue
      }
      const rawValue = fm.zidField ? resolvePath(productData, fm.zidField) : fm.staticValue
      if (rawValue === undefined || rawValue === null) continue

      const meta = lineFieldMeta.get(fm.erpField)
      const ttype = meta?.ttype ?? ''
      const relation = meta?.relation ?? ''

      // Many2one: resolve product (e.g. product_id) via default_code or barcode (cached)
      if (ttype === 'many2one' && relation) {
        try {
          const trimmedVal = String(rawValue).trim()
          if (relation === 'product.product' || fm.erpField === 'product_id') {
            const foundId = await findOdooProductByCodeOrBarcode(client, trimmedVal)
            if (foundId) {
              line[fm.erpField] = foundId
            } else {
              console.warn(`[SyncEngine] Product not found in Odoo for SKU/barcode "${trimmedVal}". Refusing to assign raw numeric SKU as Odoo internal ID.`)
            }
          } else {
            const fallback = parseInt(trimmedVal, 10)
            if (!isNaN(fallback) && fallback > 0) line[fm.erpField] = fallback
          }
        } catch (err) {
          console.warn(`[SyncEngine] Failed to resolve ${relation} for "${rawValue}":`, err)
        }
        continue
      }

      // Numeric
      let val: any = rawValue
      if (typeof val === 'string' && ['integer', 'float', 'monetary'].includes(ttype)) {
        const parsed = parseFloat(val)
        if (!isNaN(parsed)) val = parsed
      }
      line[fm.erpField] = val
    }

    // Apply line-level discount (Option A)
    // Zid order-line price keys vary by payload version (price / net_sale_price /
    // gross_sale_price / price_before / net_price / total ...). Prefer explicit
    // unit keys, then derive the unit from line totals / quantity.
    const qty = parseFloat(String(productData.quantity ?? productData.qty ?? 1)) || 1
    const zidPrice = numFromKeys(productData, ['price_before', 'net_price', 'gross_price', 'price', 'unit_price', 'amount'])
      || numFromKeys(productData, ['total_before', 'total']) / qty
    const zidSalePrice = numFromKeys(productData, ['net_sale_price', 'gross_sale_price', 'sale_price', 'price_after_discount', 'discounted_price', 'discounted_total', 'price'])
      || numFromKeys(productData, ['discounted_total', 'total']) / qty
      || zidPrice
    const zidDiscountDirect = numFromKeys(productData, ['discount', 'discount_percentage'])
    console.info(`[SyncEngine] Order line sku=${String(productData.sku ?? '')} qty=${qty} price=${zidPrice} salePrice=${zidSalePrice} discountDirect=${zidDiscountDirect}`)

    if (zidDiscountDirect > 0 || (zidSalePrice > 0 && zidSalePrice < zidPrice)) {
      anyProductHasDiscount = true
    }

    const shouldApplyPercentToLine = hasLineDiscountMapping || (addDiscountAsLine && discountMode === 'percent')

    if (shouldApplyPercentToLine) {
      let discountPercent = 0
      if (zidDiscountDirect > 0) {
        // Use Zid's explicit discount value
        discountPercent = zidDiscountDirect
      } else if (zidPrice > 0 && zidSalePrice > 0 && zidSalePrice < zidPrice) {
        // Calculate from price difference (Option C fallback)
        discountPercent = Math.round(((zidPrice - zidSalePrice) / zidPrice) * 100 * 100) / 100
      }

      if (discountPercent > 0) {
        line['discount'] = discountPercent
        // Odoo expects price_unit to be the FULL pre-discount price
        if (zidPrice > 0) line['price_unit'] = zidPrice
      }
    }

    // If price_unit wasn't set from mapping, derive it
    if (!line['price_unit']) {
      line['price_unit'] = (zidPrice > 0) ? zidPrice : (zidSalePrice > 0 ? zidSalePrice : 0)
    }

    const baseUnit = zidPrice > 0 ? zidPrice : (zidSalePrice > 0 ? zidSalePrice : 0)
    subtotalBeforeDiscount += baseUnit * qty
    totalDiscountAmount += Math.max(0, zidPrice - zidSalePrice) * qty

    // Auto-set product_uom_qty if user didn't map it explicitly
    if (!('product_uom_qty' in line)) {
      const hasQtyMapping = effectiveLineMappings.some(m => m.erpField === 'product_uom_qty')
      if (!hasQtyMapping) {
        line['product_uom_qty'] = qty
      }
    }

    // Migrate between tax_id and tax_ids if mapped differently
    if (line['tax_id'] && lineTaxField === 'tax_ids') {
      line['tax_ids'] = line['tax_id']
      delete line['tax_id']
    } else if (line['tax_ids'] && lineTaxField === 'tax_id') {
      line['tax_id'] = line['tax_ids']
      delete line['tax_ids']
    }

    // Resolve line-level tax from Standard Mapping VAT setting (or DB tax_mappings fallback)
    if (!line[lineTaxField]) {
      let resolvedMappingTaxId: number | null = null
      const zidTaxName = String(productData.tax_name ?? productData.tax ?? productData.tax_rate ?? '')
      if (mapping.workspace_id && zidTaxName && !enableVat) {
        try {
          const { data: taxRow } = await supabaseAdmin
            .from('tax_mappings')
            .select('odoo_tax_id')
            .eq('workspace_id', mapping.workspace_id)
            .eq('source_tax_name', zidTaxName)
            .maybeSingle()
          if (taxRow?.odoo_tax_id) {
            resolvedMappingTaxId = taxRow.odoo_tax_id
          }
        } catch (err) {
          console.warn(`[SyncEngine] Failed to resolve tax for "${zidTaxName}":`, err)
        }
      }
      if (resolvedMappingTaxId) {
        line[lineTaxField] = [[6, 0, [resolvedMappingTaxId]]]
      } else {
        line[lineTaxField] = [defaultLineTaxCmd]
      }
    }

    // Ensure 'name' (Description) is always populated; Odoo sale.order.line requires 'name'
    if (!line['name']) {
      let resolvedName = ''
      const rawProdName = productData.name ?? productData.title ?? productData.product_name
      if (typeof rawProdName === 'string') {
        resolvedName = rawProdName.trim()
      } else if (rawProdName && typeof rawProdName === 'object') {
        const ar = (rawProdName as any).ar
        const en = (rawProdName as any).en
        resolvedName = String(ar || en || Object.values(rawProdName)[0] || '').trim()
      }
      if (!resolvedName && productData.sku) {
        resolvedName = `[${String(productData.sku).trim()}]`
      }
      line['name'] = resolvedName || 'Product'
    }

    // If product_id was not matched in Odoo yet, try matching via productData properties
    if (!line['product_id']) {
      const candidates = [
        productData.sku,
        productData.code,
        productData.barcode,
        (productData as any).product_sku,
        (productData as any).product_barcode,
        line['name'],
      ].filter(Boolean).map(c => String(c).trim()).filter(Boolean)

      for (const candidate of candidates) {
        const found = await findOdooProductByCodeOrBarcode(client, candidate)
        if (found) {
          line['product_id'] = found
          console.info(`[SyncEngine] Resolved product #${found} for candidate "${candidate}"`)
          break
        }
      }
    }

    // If product_id was not matched in Odoo, apply the configured product fallback policy
    if (!line['product_id']) {
      if (productFallbackPolicy === 'default_product' && defaultProductId && defaultProductId > 0) {
        line['product_id'] = defaultProductId
        console.info(`[SyncEngine] Product not matched in Odoo for item "${String(productData.name || productData.sku || '')}". Using default product #${defaultProductId}`)
      } else if (productFallbackPolicy === 'skip_order') {
        const prodIdentifier = String(productData.name || productData.title || productData.sku || productData.id || 'Unknown')
        const skipErr = new Error(`تم إلغاء تسجيل الطلب: المنتج "${prodIdentifier}" (SKU: ${String(productData.sku || '-')}) غير مسجل في أودو وإعداد المطابقة محدد على إلغاء تسجيل الطلب (Order skipped: Product "${prodIdentifier}" not found in Odoo and policy is skip_order)`)
        ;(skipErr as any).isOrderSkipped = true
        throw skipErr
      } else if (productFallbackPolicy === 'create_new') {
        try {
          let newName = ''
          const rawProdName = productData.name ?? productData.title ?? productData.product_name
          if (typeof rawProdName === 'string') {
            newName = rawProdName.trim()
          } else if (rawProdName && typeof rawProdName === 'object') {
            const ar = (rawProdName as any).ar
            const en = (rawProdName as any).en
            newName = String(ar || en || Object.values(rawProdName)[0] || '').trim()
          }
          const sku = String(productData.sku ?? productData.code ?? productData.barcode ?? '').trim()
          if (!newName && sku) {
            newName = `Product [${sku}]`
          }
          const barcode = String(productData.barcode ?? '').trim()
          let price = numFromKeys(productData, ['price', 'sale_price', 'unit_price', 'amount']) || 0

          let prodStd: Record<string, any> | null = null
          if (mapping.workspace_id && platform) {
            try {
              prodStd = await getCachedStandardMappingSettings(mapping.workspace_id, platform, 'products', storeId || mapping.merchant_id || '')
            } catch (stdErr) {
              console.warn('[SyncEngine] Failed to load product standard mapping:', stdErr)
            }
          }

          // Calculate price markup if configured in Product Standard Mapping
          if (prodStd?.price?.markup_percent && Number(prodStd.price.markup_percent) > 0) {
            price = price * (1 + Number(prodStd.price.markup_percent) / 100)
            if (prodStd.price.rounding === 'round') price = Math.round(price)
            else if (prodStd.price.rounding === 'ceil') price = Math.ceil(price)
            else if (prodStd.price.rounding === 'floor') price = Math.floor(price)
          }

          // Resolve product type from standard mapping ('consu' | 'service')
          const rawType = typeof prodStd?.product_type === 'object'
            ? prodStd?.product_type?.default_type
            : prodStd?.product_type
          const validType = (rawType && typeof rawType === 'string' && rawType !== 'product') ? rawType : 'consu'

          const prodVals: Record<string, any> = {
            name: newName || (sku ? `Product ${sku}` : 'Unnamed Product'),
            type: validType,
            sale_ok: true,
            purchase_ok: true,
          }
          if (sku) prodVals.default_code = sku
          if (barcode) prodVals.barcode = barcode
          if (price > 0) prodVals.list_price = price

          // Apply Product Standard Mapping attributes
          if (prodStd) {
            // Category
            if (prodStd.category_id && Number(prodStd.category_id) > 0) {
              prodVals.categ_id = Number(prodStd.category_id)
            }
            // Customer Taxes
            const taxIds = prodStd.tax?.default_tax_ids || (prodStd.taxes_id ? [prodStd.taxes_id] : [])
            if (Array.isArray(taxIds) && taxIds.length > 0) {
              const cleanTaxIds = taxIds.map(Number).filter(n => !isNaN(n) && n > 0)
              if (cleanTaxIds.length > 0) {
                prodVals.taxes_id = [[6, 0, cleanTaxIds]]
              }
            }
            // Company
            if (prodStd.link_company !== false && prodStd.company_id && Number(prodStd.company_id) > 0) {
              prodVals.company_id = Number(prodStd.company_id)
            }
            // Tracking (lots/serials)
            if (prodStd.inventory?.tracking && prodStd.inventory.tracking !== 'none') {
              prodVals.tracking = prodStd.inventory.tracking
            }
            // Match field
            if (prodStd.match_odoo_field) {
              const zidProdId = productData.id || productData.product_id || productData[prodStd.match_zid_field || 'id']
              if (zidProdId) prodVals[prodStd.match_odoo_field] = String(zidProdId)
            }
          }

          try {
            const newProdId = await client.create('product.product', prodVals)
            if (newProdId) {
              line['product_id'] = newProdId
              if (sku) odooProductLookupCache.set(`sku:${sku}`, { id: newProdId, timestamp: Date.now() })
              if (barcode) odooProductLookupCache.set(`barcode:${barcode}`, { id: newProdId, timestamp: Date.now() })
              console.info(`[SyncEngine] Auto-created new product #${newProdId} in Odoo for SKU "${sku}" according to Standard Mapping`)
            }
          } catch (createErr: any) {
            console.warn('[SyncEngine] Failed to create product with full settings, retrying with basic fields:', createErr?.message || createErr)
            try {
              const basicProdVals: Record<string, any> = {
                name: newName || (sku ? `Product ${sku}` : 'Unnamed Product'),
                type: 'consu',
                sale_ok: true,
                purchase_ok: true,
              }
              if (sku) basicProdVals.default_code = sku
              if (barcode) basicProdVals.barcode = barcode
              if (price > 0) basicProdVals.list_price = price
              const retryProdId = await client.create('product.product', basicProdVals)
              if (retryProdId) {
                line['product_id'] = retryProdId
                if (sku) odooProductLookupCache.set(`sku:${sku}`, { id: retryProdId, timestamp: Date.now() })
                if (barcode) odooProductLookupCache.set(`barcode:${barcode}`, { id: retryProdId, timestamp: Date.now() })
                console.info(`[SyncEngine] Auto-created product #${retryProdId} on basic retry`)
              }
            } catch (retryErr: any) {
              console.error('[SyncEngine] Basic product creation retry failed:', retryErr?.message || retryErr)
            }
          }
        } catch (createErr) {
          console.warn('[SyncEngine] Failed to auto-create missing product in Odoo:', createErr)
        }
      }
    }

    // Without a resolvable product there is no valid sale.order.line in Odoo
    if (!line['product_id']) {
      if (defaultProductId && defaultProductId > 0) {
        line['product_id'] = defaultProductId
        console.warn(`[SyncEngine] Fallback: assigned default product #${defaultProductId} for unresolvable line`)
      } else {
        const prodIdentifier = String(line['name'] || productData.sku || productData.id || 'Unknown')
        const skipErr = new Error(`تم إلغاء تسجيل الطلب: المنتج "${prodIdentifier}" غير مسجل في أودو وإعداد المطابقة لم يتمكن من حله (Order skipped: Product "${prodIdentifier}" not found in Odoo)`)
        ;(skipErr as any).isOrderSkipped = true
        throw skipErr
      }
    }
    lines.push(line)
  }

  if (orderLevelDiscount > 0) {
    totalDiscountAmount = Math.max(totalDiscountAmount, orderLevelDiscount)
    anyProductHasDiscount = true
  }

  // When discountMode is 'percent', apply discount directly to product lines.
  // If individual lines did not have explicit discounts, distribute the overall order discount % across lines
  if (addDiscountAsLine && discountMode === 'percent' && totalDiscountAmount > 0 && subtotalBeforeDiscount > 0) {
    const overallDiscountPercent = Math.round((totalDiscountAmount / subtotalBeforeDiscount) * 100 * 100) / 100
    if (overallDiscountPercent > 0) {
      for (const l of lines) {
        if (!l['discount'] || Number(l['discount']) <= 0) {
          l['discount'] = overallDiscountPercent
        }
      }
      console.info(`[SyncEngine] Applied ${overallDiscountPercent}% discount to sale order lines`)
    }
  }

  if (lines.length === 0) {
    const emptyErr = new Error('تم إلغاء تسجيل الطلب: لا توجد بنود منتجات صالحة للتسجيل في أمر البيع بأودو (Order skipped: No valid product lines found for Odoo sales order)')
    ;(emptyErr as any).isOrderSkipped = true
    throw emptyErr
  }

  // ─── Shipping as Line Item ──────────────────────────────────────────────
  if (addShippingAsLine) {
    const shippingLine: Record<string, unknown> = {
      name: 'Shipping (شحن)',
      product_uom_qty: 1,
      price_unit: shippingCost,
      [lineTaxField]: [defaultLineTaxCmd],
    }

    if (shippingProductId) {
      shippingLine['product_id'] = parseInt(shippingProductId)
    } else if (shippingProductSku) {
      const foundId = await findOdooProductByCodeOrBarcode(client, shippingProductSku)
      if (foundId) shippingLine['product_id'] = foundId
    }

    // Resolve carrier_id from static shipping method mapping
    const zidShippingName = String(resolvePath(zidData, 'shipping_method.title')
      || resolvePath(zidData, 'shipping.title')
      || resolvePath(zidData, 'shipping_method')
      || '')
    if (zidShippingName && mapping.workspace_id) {
      try {
        const carrier = await resolveShippingCarrier(mapping.workspace_id, zidShippingName, platform)
        if (carrier?.carrier_id) {
          // carrier_id lives on sale.order, NOT on sale.order.line — putting it on
          // the line makes the whole create fail. Promote it to the parent order
          // values instead; safeWriteOdooRecord strips it if the delivery field
          // does not exist in this Odoo database.
          if (parentOdooValues && !('carrier_id' in parentOdooValues)) {
            parentOdooValues['carrier_id'] = carrier.carrier_id
          }
        }
        if (carrier?.product_id && !shippingLine['product_id']) {
          shippingLine['product_id'] = carrier.product_id
        }
      } catch (err) {
        console.warn(`[SyncEngine] Failed to resolve shipping carrier for "${zidShippingName}":`, err)
      }
    }

    // Only push the line when an Odoo product could actually be resolved; a
    // sale.order.line without product_id would make the whole order fail.
    if (shippingProductId || shippingProductSku || shippingLine['product_id']) {
      lines.push(shippingLine)
    } else {
      console.warn('[SyncEngine] Shipping line skipped: add_shipping_as_line is enabled but no shipping product was resolved. Set shipping_product_id or shipping_product_sku in Standard Mapping settings.')
    }
  }

  // ─── Discount as Order Line (Fixed Mode Only) ──────────────────────────
  // If discountMode is 'percent', discount was applied to the order lines directly above.
  // In 'fixed' mode, append the discount line item with negative price_unit.
  if (addDiscountAsLine && discountMode !== 'percent' && anyProductHasDiscount && totalDiscountAmount > 0) {
    const discountValue = -Math.abs(totalDiscountAmount)
    const nameStr = 'Discount (خصم)'

    const discountLine: Record<string, unknown> = {
      name: nameStr,
      product_uom_qty: 1,
      price_unit: discountValue,
      [lineTaxField]: [defaultLineTaxCmd],
    }

    if (discountProductId) {
      discountLine['product_id'] = parseInt(discountProductId)
    } else if (discountProductSku) {
      const foundId = await findOdooProductByCodeOrBarcode(client, discountProductSku)
      if (foundId) discountLine['product_id'] = foundId
    }

    if (!discountLine['product_id']) {
      console.warn('[SyncEngine] Discount line item skipped: no discount product ID/SKU configured. Configure addDiscountAsLine discountProductId in the mapping settings.')
    } else {
      lines.push(discountLine)
      console.info(`[SyncEngine] Discount line item appended: name="${nameStr}" price_unit=${discountValue}`)
    }
  }

  // ──── Cash on Delivery fee as Order Line ────
  // Zid payloads carry NO separate COD fee field, so the fee is a fixed amount
  // from Standard Mapping settings. Only added when the payment method is COD.
  const payMethodTitle = String(
    resolvePath(zidData, 'payment_method.title')
    || resolvePath(zidData, 'payment_gateway.title')
    || resolvePath(zidData, 'payment.method.name')
    || resolvePath(zidData, 'payment_method')
    || ''
  )
  const payMethodCode = String(resolvePath(zidData, 'payment_method.code') || '')
  const isCodPayment = payMethodCode === 'zid_cod'
    || /cod|cash.?on.?delivery|الدفع عند الاستلام|عند الاستلام/i.test(payMethodTitle)
    || (zidData as any)?.cod_confirmed === true
  if (addCodAsLine && isCodPayment && codFeeAmount > 0) {
    const codLine: Record<string, unknown> = {
      name: 'Cash on Delivery (الدفع عند الاستلام)',
      product_uom_qty: 1,
      price_unit: codFeeAmount,
      [lineTaxField]: [defaultLineTaxCmd],
    }
    if (codProductId) {
      codLine['product_id'] = parseInt(codProductId)
    } else if (codProductSku) {
      const foundId = await findOdooProductByCodeOrBarcode(client, codProductSku)
      if (foundId) codLine['product_id'] = foundId
    }
    if (codLine['product_id']) {
      lines.push(codLine)
      console.info(`[SyncEngine] COD line item appended: price_unit=${codFeeAmount}`)
    } else {
      console.warn('[SyncEngine] COD line skipped: add_cod_as_line is enabled and payment is COD but no COD product was resolved. Set cod_product_id or cod_product_sku in Standard Mapping settings.')
    }
  }

  // Defensive: Odoo rejects the WHOLE order when a line carries an unknown key,
  // and safeWriteOdooRecord cannot strip nested one2many keys (it retried the
  // same failing payload 3 times in production). Drop anything outside the
  // known-good set — but keep live-validated mapped fields and custom x_ fields.
  const ALLOWED_LINE_KEYS = new Set([
    'product_id', 'name', 'product_uom_qty', 'product_uom',
    'price_unit', 'discount', 'tax_id', 'tax_ids',
  ])
  const inactiveTaxField = lineTaxField === 'tax_ids' ? 'tax_id' : 'tax_ids'
  for (const built of lines) {
    delete built[inactiveTaxField]
    for (const key of Object.keys(built)) {
      if (!ALLOWED_LINE_KEYS.has(key) && !lineFieldMeta.has(key) && !key.startsWith('x_')) {
        console.warn(`[SyncEngine] Dropping unsupported sale.order.line key "${key}" to avoid a failed order create`)
        delete built[key]
      }
    }
  }

  // Analytic distribution — Standard Mapping orders tab, Zid + Salla only.
  // Runs AFTER the allowlist so the JSON is attached to every built line
  // (products, shipping, discount, COD); a line that already carries an
  // explicit mapping for either analytic field is left untouched.
  if (platform === 'zid' || platform === 'salla') {
    const analyticConfig =
      (settings as any)?.analytic ??
      (orderStdSettings as any)?.analytic ??
      (orderStdSettings as any)?.order?.analytic

    if (analyticConfig?.enabled) {
      try {
        const { locationId, locationName } = extractOrderLocationInfo(zidData, platform)
        const distribution = resolveAnalyticDistribution({
          config: analyticConfig,
          locationId,
          locationName,
          paymentKeys: paymentKeysFromOrder(zidData, platform),
          // Send the merchant's configured percentages verbatim — no
          // re-normalisation to 100. Odoo accepts analytic_distribution
          // values whose percentages do not sum to 100.
          preservePercentages: true,
        })

        if (distribution.length > 0) {
          const hasDistributionField = lineFieldMeta.has('analytic_distribution')
          const hasAccountField = lineFieldMeta.has('analytic_account_id')

          if (!hasDistributionField && !hasAccountField) {
            console.warn('[SyncEngine] Analytic rules are enabled but sale.order.line has neither analytic_distribution nor analytic_account_id; skipped.')
          } else {
            if (!hasDistributionField && distribution.length > 1) {
              const top = [...distribution].sort((a, b) => b.percentage - a.percentage)[0]
              console.warn(`[SyncEngine] Odoo without analytic_distribution; using analytic_account_id=${top?.accountId} although ${distribution.length} accounts were configured.`)
            }
            const analyticFields = toOdooAnalyticFields(distribution, hasDistributionField, hasAccountField)
            if (Object.keys(analyticFields).length > 0) {
              let applied = 0
              for (const line of lines) {
                if ('analytic_distribution' in line || 'analytic_account_id' in line) continue
                Object.assign(line, analyticFields)
                applied += 1
              }
              console.info(`[SyncEngine] Applied analytic distribution to ${applied}/${lines.length} order line(s):`, analyticFields)
            }
          }
        }
      } catch (err: any) {
        // Never fail the order because of analytics.
        console.warn('[SyncEngine] Analytic distribution failed; continuing without it:', err?.message || err)
      }
    }
  }

  return lines
}

const HARDCODED_FIELD_META: Record<string, { ttype: string; relation?: string }> = {
  image_1920: { ttype: 'binary' },
  image_1024: { ttype: 'binary' },
  image_512: { ttype: 'binary' },
  image_256: { ttype: 'binary' },
  image_128: { ttype: 'binary' },
  image_variant_1920: { ttype: 'binary' },
  // Product fields
  default_code: { ttype: 'char' },
  barcode: { ttype: 'char' },
  name: { ttype: 'char' },
  description: { ttype: 'text' },
  description_sale: { ttype: 'text' },
  list_price: { ttype: 'float' },
  standard_price: { ttype: 'float' },
  weight: { ttype: 'float' },
  volume: { ttype: 'float' },
  sale_ok: { ttype: 'boolean' },
  purchase_ok: { ttype: 'boolean' },
  active: { ttype: 'boolean' },
  categ_id: { ttype: 'many2one', relation: 'product.category' },
  uom_id: { ttype: 'many2one', relation: 'uom.uom' },
  uom_po_id: { ttype: 'many2one', relation: 'uom.uom' },
  taxes_id: { ttype: 'many2many', relation: 'account.tax' },
  supplier_taxes_id: { ttype: 'many2many', relation: 'account.tax' },
  route_ids: { ttype: 'many2many', relation: 'stock.route' },
  // Variant fields
  attribute_line_ids: { ttype: 'one2many', relation: 'product.template.attribute.line' },
  product_variant_ids: { ttype: 'one2many', relation: 'product.product' },
  // Customer / res.partner fields
  street: { ttype: 'char' },
  street2: { ttype: 'char' },
  city: { ttype: 'char' },
  zip: { ttype: 'char' },
  country_id: { ttype: 'many2one', relation: 'res.country' },
  state_id: { ttype: 'many2one', relation: 'res.country.state' },
  email: { ttype: 'char' },
  phone: { ttype: 'char' },
  mobile: { ttype: 'char' },
  website: { ttype: 'char' },
  vat: { ttype: 'char' },
  company_type: { ttype: 'selection' },
  company_name: { ttype: 'char' },
  company_registry: { ttype: 'char' },
  customer_rank: { ttype: 'integer' },
  partner_id: { ttype: 'many2one', relation: 'res.partner' },
  partner_invoice_id: { ttype: 'many2one', relation: 'res.partner' },
  partner_shipping_id: { ttype: 'many2one', relation: 'res.partner' },
  // Order / sale.order fields
  order_line: { ttype: 'one2many', relation: 'sale.order.line' },
  amount_total: { ttype: 'monetary' },
  amount_untaxed: { ttype: 'monetary' },
  amount_tax: { ttype: 'monetary' },
  date_order: { ttype: 'datetime' },
  note: { ttype: 'text' },
  state: { ttype: 'selection' },
  // Category fields
  parent_id: { ttype: 'many2one', relation: 'product.category' },
  // Custom / X fields (commonly used)
  x_zid_id: { ttype: 'char' },
  x_salla_id: { ttype: 'char' },
  x_shopify_id: { ttype: 'char' },
  shopify_id: { ttype: 'char' },
  x_store_id: { ttype: 'char' },
  x_cr_no: { ttype: 'char' },
  x_payment_method: { ttype: 'char' },
  x_payment_status: { ttype: 'char' },
  x_shipping_fee: { ttype: 'float' },
}

// Note: Fixed mapping presets are now sourced exclusively from the database
// (fixed_mappings and fixed_mapping_preset_definitions tables), seeded via migration.
// No hardcoded fallback needed.

// ─── Helper: derive fixed-mapping preset_key from event + platform ────────────
// Known preset_key format: {platform}_{model}_{action}
// e.g. "zid_product_create", "salla_order_update", "shopify_product_create"
//                          "zid_category", "shopify_category_create"
function derivePresetKey(event: string, platform: string): string | null {
  const ev = event.toLowerCase()
  let model = ''
  let action = ''

  if (platform === 'shopify' || ev.includes('shopify')) {
    const m = ev.match(/shopify:(.+?)_(create|update)/)
    if (m) { model = m[1]; action = m[2] === 'create' ? 'create' : 'update' }
    // Shopify slash topics (products/create, orders/paid, ...): حوّلها لنفس مفاتيح presets.
    if (!model || !action) {
      const slash = ev.match(/^(products|orders|customers|collections|carts|checkouts|inventory_levels|inventory_items|refunds)\/(.+)$/)
      if (slash) {
        const domain = slash[1]
        const verb = slash[2]
        if (domain === 'products') model = 'product'
        else if (domain === 'orders') model = 'order'
        else if (domain === 'customers') model = 'customer'
        else if (domain === 'collections') model = 'category'
        else model = domain
        // Shopify deletes the order record on `orders/delete`, but the engine has
        // no sale.order delete branch — event-operation.ts classifies it as
        // `cancel` and normalizeOdooOperation agrees. Key it as cancel so the
        // preset, the gate check and the write all mean the same thing.
        // (products/customers/collections keep `delete`: they do have one.)
        if (/(cancel|delete)/.test(verb)) action = verb.includes('cancel') ? 'cancel' : (domain === 'orders' ? 'cancel' : 'delete')
        else if (/(fulfill|deliver|paid|partial)/.test(verb)) action = verb.includes('cancel') ? 'cancel' : (domain === 'orders' && /fulfill|partial/.test(verb) ? 'deliver' : 'update')
        else if (/update|edit/.test(verb)) action = 'update'
        else action = 'create'
      }
    }
  }
  if (!model || !action) {
    if (ev.includes('order')) {
      model = 'order'
      if (/(cancel|reversed|delete)/.test(ev)) action = 'cancel'
      else if (/(deliver|fulfill)/.test(ev)) action = 'deliver'
      else if (/create/.test(ev)) action = 'create'
      else action = 'update'
    } else if (ev.includes('customer')) {
      model = 'customer'
      if (/delete/.test(ev)) action = 'delete'
      else if (/create/.test(ev)) action = 'create'
      else action = 'update'
    } else if (ev.includes('category') || ev.includes('collection')) {
      model = 'category'
      if (/delete/.test(ev)) action = 'delete'
      else if (/create/.test(ev)) action = 'create'
      else action = 'update'
    } else if (ev.includes('product')) {
      model = 'product'
      if (/delete/.test(ev)) action = 'delete'
      else if (/create/.test(ev)) action = 'create'
      else action = 'update'
    } else {
      const m = ev.match(/^(\w+)\.(create|update|delete|cancel|deliver)d?$/) ?? ev.match(/^(\w+)_(create|update|delete|cancel|deliver)d?$/)
      if (m) {
        const entity = m[1]
        const verb = m[2]
        if      (entity === 'customer')  model = 'customer'
        else if (entity === 'order')     model = 'order'
        else if (entity === 'category')  model = 'category'
        else                             model = 'product'
        action = verb
      }
    }
  }

  if (!model || !action) return null

  // Zid presets: products, customers, orders all have separate create/update/delete.
  // Categories use a SINGLE unified preset "zid_category" (same settings for all ops).
  // The `${platform}_${model}_${action}` key is what the
  // fixed_mapping_preset_definitions table is keyed on.
  if (model === 'category') return `${platform}_category`
  return `${platform}_${model}_${action}`
}

// ─── Helper: apply fixed mapping settings to Odoo values ───────────────────────
// Injects settings-driven defaults/logic (sale_ok, type, price markup, name
// language, etc.) into odooValues.
export async function applyFixedSettingsToValues(
  odooValues: Record<string, unknown>,
  settings: Record<string, any>,
  zidData: Record<string, unknown>,
  odooMajorVersion?: number,
  workspaceId?: string,
  platform?: 'zid' | 'salla' | 'shopify',
  odooModel?: string,
): Promise<Record<string, unknown>> {
  if (!settings || Object.keys(settings).length === 0) return odooValues

  const values = { ...odooValues }

  // ── product.category only gets inventory_valuation + accounting settings ──
  // Skip all product-template fields (type, sale_ok, is_storable, etc.)
  if (odooModel === 'product.category') {
    const invValCfg = settings.inventory_valuation
    if (invValCfg) {
      if (invValCfg.property_cost_method) values.property_cost_method = invValCfg.property_cost_method
      if (invValCfg.property_valuation) values.property_valuation = invValCfg.property_valuation
    }
    // Fallback: also try flat keys (in case the merge step was skipped)
    if (!values.property_cost_method && settings.costing_method) values.property_cost_method = settings.costing_method
    if (!values.property_valuation && settings.inventory_valuation && typeof settings.inventory_valuation === 'string') values.property_valuation = settings.inventory_valuation
    const acctCfg = settings.accounting
    if (acctCfg) {
      if (acctCfg.income_account_id && Number(acctCfg.income_account_id) > 0) values.property_account_income_categ_id = Number(acctCfg.income_account_id)
      if (acctCfg.expense_account_id && Number(acctCfg.expense_account_id) > 0) values.property_account_expense_categ_id = Number(acctCfg.expense_account_id)
      if (acctCfg.stock_valuation_account_id && Number(acctCfg.stock_valuation_account_id) > 0) values.property_stock_valuation_account_id = Number(acctCfg.stock_valuation_account_id)
      if (acctCfg.stock_journal_id && Number(acctCfg.stock_journal_id) > 0) values.property_stock_journal_id = Number(acctCfg.stock_journal_id)
      if (acctCfg.stock_input_account_id && Number(acctCfg.stock_input_account_id) > 0) values.property_stock_input_account_id = Number(acctCfg.stock_input_account_id)
      if (acctCfg.stock_output_account_id && Number(acctCfg.stock_output_account_id) > 0) values.property_stock_output_account_id = Number(acctCfg.stock_output_account_id)
    }
    delete values.company_id
    return values
  }

  // ── res.partner gets customer_type default settings ──
  if (odooModel === 'res.partner') {
    const custType = settings.customer_type || 'auto'
    if (custType === 'company') {
      values.company_type = 'company'
    } else if (custType === 'person') {
      values.company_type = 'person'
    } else if (custType === 'auto') {
      const typeStr = typeof zidData.type === 'string' ? zidData.type.toLowerCase() : ''
      const isZidCorp =
        typeStr === 'corporate' ||
        typeStr === 'business' ||
        typeStr === 'company' ||
        !!zidData.business_name ||
        !!zidData.tax_number ||
        !!zidData.commercial_registration
      values.company_type = isZidCorp ? 'company' : 'person'
    }

    if (settings.receivable_account_id && Number(settings.receivable_account_id) > 0) {
      values.property_account_receivable_id = Number(settings.receivable_account_id)
    }
    if (settings.payable_account_id && Number(settings.payable_account_id) > 0) {
      values.property_account_payable_id = Number(settings.payable_account_id)
    }

    if (settings.link_company !== false) {
      if (settings.company_id && Number(settings.company_id) > 0) {
        values.company_id = Number(settings.company_id)
      }
    } else {
      delete values.company_id
    }

    return values
  }

  // ── Product type ────────────────────────────────────────────────────────────
  // Odoo 18+ changed type selection: 'product' removed, 'consu' means "Goods".
  // Use is_storable + tracking fields instead.  Skip if values.type is already
  // provided by a row-level field mapping.
  const isV18Plus = (odooMajorVersion ?? 0) >= 18
  const inventoryCfg = settings.inventory

  if (odooModel === 'product.template' && !values.type) {
    const defaultType = typeof settings.product_type === 'string'
      ? settings.product_type
      : settings.product_type?.default_type

    // Determine whether inventory should be tracked
    let wantsStorable: boolean
    if (inventoryCfg?.track_inventory !== undefined) {
      wantsStorable = inventoryCfg.track_inventory
    } else {
      wantsStorable = (defaultType === 'product')
    }

    if (isV18Plus) {
      if (defaultType === 'service') {
        values.type = 'service'
        values.is_storable = false
      } else {
        values.type = 'consu'
        values.is_storable = wantsStorable
        if (wantsStorable) {
          values.tracking = 'none'
          if (inventoryCfg?.tracking && inventoryCfg.tracking !== 'none') {
            values.tracking = inventoryCfg.tracking
          }
          if (inventoryCfg?.route_ids && Array.isArray(inventoryCfg.route_ids) && inventoryCfg.route_ids.length > 0) {
            values.route_ids = [[6, 0, inventoryCfg.route_ids]]
          }
        }
      }
    } else {
      if (defaultType === 'service') {
        values.type = 'service'
      } else {
        values.type = wantsStorable ? 'product' : 'consu'
      }
    }
  }

  // ── Status fields ───────────────────────────────────────────────────────────
  const status = settings.status
  if (status) {
    // Only set if not already provided by user mapping
    if (status.sale_ok !== undefined && values.sale_ok === undefined) {
      values.sale_ok = status.sale_ok
    }
    if (status.purchase_ok !== undefined && values.purchase_ok === undefined) {
      values.purchase_ok = status.purchase_ok
    }
    // Active status from published setting
    if (values.active === undefined) {
      const pub = status.published
      if (pub === 'always_published') values.active = true
      else if (pub === 'always_draft') values.active = false
      else if (pub === 'from_platform') {
        const platformActive = resolvePath(zidData, 'is_published')
        values.active = platformActive === true || platformActive === 'true'
      }
    }
  }

  // ── Price transformations ──────────────────────────────────────────────────
  const priceCfg = settings.price
  if (priceCfg) {
    // Apply markup/discount to list_price
    if (values.list_price !== undefined && priceCfg.markup_percent !== 0) {
      const base = Number(values.list_price)
      if (!isNaN(base)) {
        values.list_price = base * (1 + priceCfg.markup_percent / 100)
      }
    }
    // Source cost price from configured field (supports 'cost', 'price', 'cost_price', or any zidData field)
    if (values.standard_price === undefined && priceCfg.cost_source) {
      const costField = priceCfg.cost_source
      const costVal = resolvePath(zidData, costField)
      if (costVal !== undefined) values.standard_price = Number(costVal)
    }
    // Price source: overwrite list_price from an alternative zidData field
    if (priceCfg.source !== undefined && priceCfg.source !== 'price') {
      const srcVal = resolvePath(zidData, priceCfg.source)
      if (srcVal !== undefined) {
        values.list_price = Number(srcVal)
      }
    }
  }

  // ── Price rounding ──────────────────────────────────────────────────────────
  if (priceCfg) {
    if (values.list_price !== undefined && priceCfg.rounding && priceCfg.decimal_places !== undefined) {
      const factor = Math.pow(10, priceCfg.decimal_places)
      const pVal = Number(values.list_price)
      if (!isNaN(pVal)) {
        if (priceCfg.rounding === 'nearest') values.list_price = Math.round(pVal * factor) / factor
        else if (priceCfg.rounding === 'ceil') values.list_price = Math.ceil(pVal * factor) / factor
        else if (priceCfg.rounding === 'floor') values.list_price = Math.floor(pVal * factor) / factor
      }
    }
    if (values.standard_price !== undefined && priceCfg.rounding && priceCfg.decimal_places !== undefined) {
      const factor = Math.pow(10, priceCfg.decimal_places)
      const sVal = Number(values.standard_price)
      if (!isNaN(sVal)) {
        if (priceCfg.rounding === 'nearest') values.standard_price = Math.round(sVal * factor) / factor
        else if (priceCfg.rounding === 'ceil') values.standard_price = Math.ceil(sVal * factor) / factor
        else if (priceCfg.rounding === 'floor') values.standard_price = Math.floor(sVal * factor) / factor
      }
    }
  }

  // ── Name language selection ─────────────────────────────────────────────────
  const nameCfg = settings.name
  const rawName = zidData.name as Record<string, unknown> | string | undefined
  if (nameCfg && nameCfg.language && rawName && typeof rawName === 'object') {
    if (nameCfg.language === 'both') {
      const arName = rawName['ar']
      const enName = rawName['en']
      // Concatenate both languages as a plain string (no dict)
      const parts: string[] = []
      if (arName && typeof arName === 'string') parts.push(arName)
      if (enName && typeof enName === 'string') parts.push(enName)
      if (parts.length > 0) values.name = parts.join(' ')
    } else {
      const langName = rawName[nameCfg.language]
      if (langName && typeof langName === 'string') {
        values.name = langName
      } else if (nameCfg.fallback_to_other) {
        const otherLang = nameCfg.language === 'ar' ? 'en' : 'ar'
        const fallbackName = rawName[otherLang]
        if (fallbackName && typeof fallbackName === 'string') {
          values.name = fallbackName
        }
      }
    }
  }

  // ── Description language selection ─────────────────────────────────────────
  const descCfg = settings.description
  const rawDesc = zidData.description as Record<string, unknown> | string | undefined
  if (descCfg && descCfg.language && rawDesc && typeof rawDesc === 'object') {
    if (descCfg.language === 'both') {
      const arDesc = rawDesc['ar']
      const enDesc = rawDesc['en']
      const descParts: string[] = []
      if (arDesc && typeof arDesc === 'string') descParts.push(arDesc)
      if (enDesc && typeof enDesc === 'string') descParts.push(enDesc)
      if (descParts.length > 0) values.description_sale = descParts.join(' ')
    } else {
      const langDesc = rawDesc[descCfg.language]
      if (langDesc && typeof langDesc === 'string') {
        values.description_sale = langDesc
      } else if (descCfg.fallback === 'name') {
        values.description_sale = values.name
      }
    }
  }

  // ── Description fallback ─────────────────────────────────────────────────────
  if (descCfg) {
      if (descCfg.fallback === 'custom' && descCfg.custom_text && values.description_sale === undefined) {
      values.description_sale = descCfg.custom_text
    } else if (descCfg.fallback === 'empty' && values.description_sale === undefined) {
      values.description_sale = false
    }
  }

  // ── Company ─────────────────────────────────────────────────────────────────
  if (settings.link_company !== false) {
    if (settings.company_id && Number(settings.company_id) > 0) {
      values.company_id = Number(settings.company_id)
    } else {
      const companyCfg = settings.company
      if (companyCfg?.default_company_id && Number(companyCfg.default_company_id) > 0) {
        values.company_id = Number(companyCfg.default_company_id)
      }
    }
  } else {
    delete values.company_id
  }

  // ── Platform ID field ───────────────────────────────────────────────────────
  const matchCfg = settings.matching
  if (matchCfg && matchCfg.platform_id_field && matchCfg.platform_id_field !== 'x_zid_id') {
    // If user configured a custom platform ID field, rename x_zid_id to it
    if (values[matchCfg.platform_id_field] === undefined && values.x_zid_id !== undefined) {
      values[matchCfg.platform_id_field] = values.x_zid_id
      delete values.x_zid_id
    }
  }

  // ── Warehouse / Stock Location ─────────────────────────────────────────────
  // Resolve warehouse from static DB mapping using Zid location data
  if (workspaceId) {
    const { locationId: zidLocId, locationName: zidLocName } = extractOrderLocationInfo(zidData, platform)
    if (zidLocId || zidLocName) {
      const wh = await resolveWarehouse(workspaceId, platform, zidLocId, zidLocName)
      if (wh) {
        if (wh.warehouse_id && !values.warehouse_id) values.warehouse_id = wh.warehouse_id
        if (wh.location_id && !values.location_id && odooModel !== 'sale.order') {
          values.location_id = wh.location_id
        }
      }
    }
  }

  // ── Tax sync_mode ───────────────────────────────────────────────────────────
  const taxCfg = settings.tax
  if (taxCfg) {
    if (taxCfg.sync_mode === 'static_ids' && Array.isArray(taxCfg.default_tax_ids) && taxCfg.default_tax_ids.length > 0) {
      values.taxes_id = [[6, 0, taxCfg.default_tax_ids]]
    } else if (taxCfg.sync_mode === 'skip') {
      delete values.taxes_id
    } else if (taxCfg.sync_mode === 'auto_by_name' || taxCfg.sync_mode === undefined) {
      // Try DB tax_mappings first, then auto_by_name fallback
      const zidTaxName = zidData.tax_name as string || zidData.tax as string || ''
      if (workspaceId && zidTaxName) {
        const { data: taxRow } = await supabaseAdmin
          .from('tax_mappings')
          .select('odoo_tax_id')
          .eq('workspace_id', workspaceId)
          .eq('source_tax_name', zidTaxName)
          .maybeSingle()
        if (taxRow?.odoo_tax_id) {
          values.taxes_id = [[6, 0, [taxRow.odoo_tax_id]]]
        }
      }
    }
  }

  // ── Category sync_mode ──────────────────────────────────────────────────────
  const catCfg = settings.category
  if (catCfg) {
    if (catCfg.sync_mode === 'skip' && values.categ_id !== undefined) {
      delete values.categ_id
    } else if (catCfg.sync_mode === 'map_existing') {
      if (catCfg.match_field === 'name') {
        const catVal = zidData.categories ?? zidData.category
        if (catVal && typeof catVal === 'string') {
          console.info('Category matching by name is handled in buildOdooValues for many2one fields')
        }
      }
    }
  }

  // ── Image sync_mode ─────────────────────────────────────────────────────────
  const imgCfg = settings.image
  if (imgCfg) {
    if (imgCfg.sync_mode === 'skip') {
      values.image_1920 = false
      delete values.image_1024
      delete values.image_512
      delete values.image_256
      delete values.image_128
    } else if (imgCfg.sync_mode === 'main_only') {
      delete values.image_1024
      delete values.image_512
      delete values.image_256
      delete values.image_128
    }
  }

  // ── UOM auto_create ─────────────────────────────────────────────────────────
  const uomCfg = settings.uom
  if (uomCfg) {
    if (!uomCfg.auto_create && values.uom_id === undefined) {
      delete values.uom_id
    }
  }



  // ── Website settings ────────────────────────────────────────────────────────
  const webCfg = settings.website
  if (webCfg) {
    if (values.active !== undefined && (webCfg.published === 'always_published' || webCfg.published === 'from_platform')) {
      values.is_published = values.active === true
    }
    if (Array.isArray(webCfg.public_categ_ids) && webCfg.public_categ_ids.length > 0) {
      values.public_categ_ids = [[6, 0, webCfg.public_categ_ids]]
    }
  }

  // ── Accounting settings ─────────────────────────────────────────────────────
  const acctCfg = settings.accounting
  if (acctCfg) {
    if (odooModel === 'product.category') {
      // product.category uses different property field names
      if (acctCfg.income_account_id && Number(acctCfg.income_account_id) > 0) {
        values.property_account_income_categ_id = Number(acctCfg.income_account_id)
      }
      if (acctCfg.expense_account_id && Number(acctCfg.expense_account_id) > 0) {
        values.property_account_expense_categ_id = Number(acctCfg.expense_account_id)
      }
      if (acctCfg.stock_valuation_account_id && Number(acctCfg.stock_valuation_account_id) > 0) {
        values.property_stock_valuation_account_id = Number(acctCfg.stock_valuation_account_id)
      }
      if (acctCfg.stock_journal_id && Number(acctCfg.stock_journal_id) > 0) {
        values.property_stock_journal_id = Number(acctCfg.stock_journal_id)
      }
      if (acctCfg.stock_input_account_id && Number(acctCfg.stock_input_account_id) > 0) {
        values.property_stock_input_account_id = Number(acctCfg.stock_input_account_id)
      }
      if (acctCfg.stock_output_account_id && Number(acctCfg.stock_output_account_id) > 0) {
        values.property_stock_output_account_id = Number(acctCfg.stock_output_account_id)
      }
    } else {
      if (acctCfg.income_account_id && Number(acctCfg.income_account_id) > 0) {
        values.property_account_income_id = Number(acctCfg.income_account_id)
      }
      if (acctCfg.expense_account_id && Number(acctCfg.expense_account_id) > 0) {
        values.property_account_expense_id = Number(acctCfg.expense_account_id)
      }
    }
  }

  // ── Inventory Valuation settings (product.category) ─────────────────────────
  const invValCfg = settings.inventory_valuation
  if (invValCfg && odooModel === 'product.category') {
    if (invValCfg.property_cost_method) {
      values.property_cost_method = invValCfg.property_cost_method
    }
    if (invValCfg.property_valuation) {
      values.property_valuation = invValCfg.property_valuation
    }
  }

  return values
}

// ─── Helper: safe Odoo create with field-level error fallback ──────────────────
async function safeCreateOdooRecord(
  client: OdooClient,
  model: string,
  values: Record<string, unknown>,
  _fallbackValues: Record<string, unknown>,
): Promise<number> {
  try {
    return await client.create(model, values)
  } catch (err: any) {
    // If error is from an invalid field rejected by Odoo ORM, prune it and retry
    const invalidFieldMatch = String(err?.message || '').match(/Invalid field ['"]([^'"]+)['"]/i)
    if (invalidFieldMatch && invalidFieldMatch[1]) {
      const badField = invalidFieldMatch[1]
      if (badField in values) {
        console.warn(`[SyncEngine] ⚠️ Pruning invalid field "${badField}" from ${model} create and retrying: ${err.message}`)
        const cleanValues = { ...values }
        delete cleanValues[badField]
        return await safeCreateOdooRecord(client, model, cleanValues, _fallbackValues)
      }
    }

    // If error is due to incompatible companies on a specific relational field (e.g. pricelist_id belongs to another company), prune and retry
    const isCompanyIncompatible = String(err?.message || '').toLowerCase().includes('incompatible companies on records')
    if (isCompanyIncompatible) {
      const fieldInParenMatch = String(err?.message || '').match(/\(([a-z0-9_]+):/i)
      const badRelField = fieldInParenMatch ? fieldInParenMatch[1] : (('pricelist_id' in values) ? 'pricelist_id' : null)
      if (badRelField && badRelField in values) {
        console.warn(`[SyncEngine] ⚠️ Pruning incompatible company field "${badRelField}" from ${model} create and retrying: ${err.message}`)
        const cleanValues = { ...values }
        delete cleanValues[badRelField]
        return await safeCreateOdooRecord(client, model, cleanValues, _fallbackValues)
      }
    }

    // If error is from settings fields (not core mapping fields), retry without them
    const settingsKeys = [
      'property_account_income_categ_id', 'property_account_expense_categ_id',
      'property_stock_valuation_account_id', 'property_stock_journal_id',
      'property_stock_input_account_id', 'property_stock_output_account_id',
      'property_cost_method', 'property_valuation',
      'property_account_income_id', 'property_account_expense_id',
      'company_id',
    ]
    const hasSettingsFields = settingsKeys.some(k => k in values)
    if (hasSettingsFields) {
      const cleanValues = { ...values }
      for (const k of settingsKeys) {
        delete cleanValues[k]
      }
      console.warn(`[SyncEngine] Create failed with settings fields, retrying without them: ${err.message}`)
      const newId = await client.create(model, cleanValues)
      // Try to apply the settings fields via a follow-up write
      const settingsOnly: Record<string, unknown> = {}
      for (const k of settingsKeys) {
        if (k in values && values[k] !== undefined) settingsOnly[k] = values[k]
      }
      if (Object.keys(settingsOnly).length > 0) {
        try {
          await client.write(model, [newId], settingsOnly)
          console.info(`[SyncEngine] Applied settings fields via follow-up write on ${model} #${newId}`)
        } catch (writeErr: any) {
          console.warn(`[SyncEngine] Follow-up write for settings failed on ${model} #${newId}: ${writeErr.message}`)
        }
      }
      return newId
    }
    throw err
  }
}

// ─── Helper: safe Odoo write with field-level error fallback ──────────────────
async function safeWriteOdooRecord(
  client: OdooClient,
  model: string,
  id: number,
  values: Record<string, unknown>,
  _fallbackValues: Record<string, unknown>,
): Promise<boolean> {
  try {
    await client.write(model, [id], values)
    return true
  } catch (err: any) {
    // If error is from an invalid field rejected by Odoo ORM, prune it and retry
    const invalidFieldMatch = String(err?.message || '').match(/Invalid field ['"]([^'"]+)['"]/i)
    if (invalidFieldMatch && invalidFieldMatch[1]) {
      const badField = invalidFieldMatch[1]
      if (badField in values) {
        console.warn(`[SyncEngine] ⚠️ Pruning invalid field "${badField}" from ${model} write and retrying: ${err.message}`)
        const cleanValues = { ...values }
        delete cleanValues[badField]
        return await safeWriteOdooRecord(client, model, id, cleanValues, _fallbackValues)
      }
    }

    // If error is due to modifying pricelist on a confirmed order in Odoo, prune pricelist_id and retry
    if (/cannot change the pricelist/i.test(String(err?.message || '')) && 'pricelist_id' in values) {
      console.warn(`[SyncEngine] ⚠️ Pruning pricelist_id from ${model} #${id} write and retrying: ${err.message}`)
      const cleanValues = { ...values }
      delete cleanValues.pricelist_id
      return await safeWriteOdooRecord(client, model, id, cleanValues, _fallbackValues)
    }

    const settingsKeys = [
      'property_account_income_categ_id', 'property_account_expense_categ_id',
      'property_stock_valuation_account_id', 'property_stock_journal_id',
      'property_stock_input_account_id', 'property_stock_output_account_id',
      'property_cost_method', 'property_valuation',
      'property_account_income_id', 'property_account_expense_id',
      'company_id',
    ]
    const hasSettingsFields = settingsKeys.some(k => k in values)
    if (hasSettingsFields) {
      const cleanValues = { ...values }
      for (const k of settingsKeys) {
        delete cleanValues[k]
      }
      console.warn(`[SyncEngine] Update failed with settings fields, retrying without them: ${err.message}`)
      await client.write(model, [id], cleanValues)
      // Try to apply the settings fields via a follow-up write
      const settingsOnly: Record<string, unknown> = {}
      for (const k of settingsKeys) {
        if (k in values && values[k] !== undefined) settingsOnly[k] = values[k]
      }
      if (Object.keys(settingsOnly).length > 0) {
        try {
          await client.write(model, [id], settingsOnly)
          console.info(`[SyncEngine] Applied settings fields via follow-up write on ${model} #${id}`)
        } catch (writeErr: any) {
          console.warn(`[SyncEngine] Follow-up write for settings failed on ${model} #${id}: ${writeErr.message}`)
        }
      }
      return true
    }
    throw err
  }
}

// ─── Helper: evaluate a single condition against zidData ───────────────────────
function evaluateCondition(
  field: string | undefined,
  op: string | undefined,
  value: string | undefined,
  zidData: Record<string, unknown>
): boolean {
  if (!field || !op) return false
  const raw = resolvePath(zidData, field)
  const rawStr = raw == null ? '' : String(raw)
  switch (op) {
    case 'eq':       return rawStr === value
    case 'neq':      return rawStr !== value
    case 'gt':       return Number(raw) > Number(value)
    case 'lt':       return Number(raw) < Number(value)
    case 'is_empty': return !rawStr || rawStr === '0'
    case 'is_not_empty': return !!rawStr && rawStr !== '0'
    default:         return false
  }
}

// ─── Helper: resolve platform order status → Odoo state ──────────────────────
// Uses DB order_status_mappings table; falls back to defaults from settings.
// Per-store rows overlay the platform defaults ('').
async function resolveOrderState(
  workspaceId: string,
  zidStatus: string,
  platform?: 'zid' | 'salla' | 'shopify',
  storeId = '',
): Promise<string | null> {
  let query = supabaseAdmin
    .from('order_status_mappings')
    .select('odoo_state, store_id')
    .eq('workspace_id', workspaceId)
    .eq('zid_status', zidStatus) as any
  if (platform) query = query.eq('platform', platform)
  if (storeId) query = query.in('store_id', [storeId, ''])
  const { data } = await query
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{ odoo_state: string; store_id?: string }>
  const hit = rows.find(r => (r.store_id || '') === storeId) ?? rows.find(r => !r.store_id) ?? rows[0]
  if (hit?.odoo_state) return hit.odoo_state
  return getSmartDefaultOrderState(zidStatus, platform)
}

// ──── Helper: read the status-mapping row (state + enabled flag) ─────
async function getOrderStatusRow(
  workspaceId: string,
  zidStatus: string,
  platform?: 'zid' | 'salla' | 'shopify',
  storeId = '',
): Promise<{
  odoo_state: string
  enabled: boolean
  invoice_action?: string
  picking_action?: string
} | null> {
  try {
    let query = supabaseAdmin
      .from('order_status_mappings')
      .select('odoo_state, enabled, store_id, invoice_action, picking_action')
      .eq('workspace_id', workspaceId)
      .eq('zid_status', zidStatus) as any
    if (platform) query = query.eq('platform', platform)
    if (storeId) query = query.in('store_id', [storeId, ''])
    const { data, error } = await query
    if (error) throw error
    const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{
      odoo_state: string
      enabled?: boolean
      store_id?: string
      invoice_action?: string
      picking_action?: string
    }>
    const hit = rows.find(r => (r.store_id || '') === storeId) ?? rows.find(r => !r.store_id) ?? rows[0]
    let rowResult: { odoo_state: string; enabled: boolean; invoice_action?: string; picking_action?: string } | null = hit
      ? {
          odoo_state: hit.odoo_state || '',
          enabled: hit.enabled !== false,
          invoice_action: hit.invoice_action || '',
          picking_action: hit.picking_action || '',
        }
      : null

    // Dual-storage fallback: check JSON standard_mapping_settings
    try {
      const orderStdSettings = await getCachedStandardMappingSettings(workspaceId, platform || 'zid', 'orders', storeId)
      const statusActions = orderStdSettings?.order?.status_actions || (orderStdSettings as any)?.status_actions
      const jsonConfig = statusActions?.[zidStatus]
      if (jsonConfig && typeof jsonConfig === 'object') {
        const state = String(jsonConfig.state || '')
        const enabled = jsonConfig.enabled !== false
        const invAction = String(jsonConfig.invoice_action || '')
        const pickAction = String(jsonConfig.picking_action || '')

        if (!rowResult) {
          rowResult = { odoo_state: state, enabled, invoice_action: invAction, picking_action: pickAction }
        } else {
          if (!rowResult.invoice_action && invAction) rowResult.invoice_action = invAction
          if (!rowResult.picking_action && pickAction) rowResult.picking_action = pickAction
          if (!rowResult.odoo_state && state) rowResult.odoo_state = state
        }
      }
    } catch {
      // Non-fatal
    }
    return rowResult
  } catch {
    // Pre-migration DBs without invoice_action/picking_action or enabled:
    // fall back to a select without them (backward compatible).
    let rowResult: { odoo_state: string; enabled: boolean; invoice_action?: string; picking_action?: string } | null = null
    try {
      let fallback = supabaseAdmin
        .from('order_status_mappings')
        .select('odoo_state, enabled, store_id')
        .eq('workspace_id', workspaceId)
        .eq('zid_status', zidStatus) as any
      if (platform) fallback = fallback.eq('platform', platform)
      if (storeId) fallback = fallback.in('store_id', [storeId, ''])
      const { data, error } = await fallback
      if (error) throw error
      const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{ odoo_state: string; enabled?: boolean; store_id?: string }>
      const hit = rows.find(r => (r.store_id || '') === storeId) ?? rows.find(r => !r.store_id) ?? rows[0]
      if (hit?.odoo_state) {
        rowResult = { odoo_state: hit.odoo_state, enabled: hit.enabled !== false, invoice_action: '', picking_action: '' }
      }
    } catch {
      try {
        let legacy = supabaseAdmin
          .from('order_status_mappings')
          .select('odoo_state')
          .eq('workspace_id', workspaceId)
          .eq('zid_status', zidStatus) as any
        if (platform) legacy = legacy.eq('platform', platform)
        const { data } = await legacy.maybeSingle()
        if (!data?.odoo_state) {
          // Keep rowResult as null
        } else {
          rowResult = { odoo_state: data.odoo_state, enabled: true, invoice_action: '', picking_action: '' }
        }
      } catch {
        // Fall through
      }
    }

    // Merge JSON settings
    try {
      const orderStdSettings = await getCachedStandardMappingSettings(workspaceId, platform || 'zid', 'orders', storeId)
      const statusActions = orderStdSettings?.order?.status_actions || (orderStdSettings as any)?.status_actions
      const jsonConfig = statusActions?.[zidStatus]
      if (jsonConfig && typeof jsonConfig === 'object') {
        const state = String(jsonConfig.state || '')
        const enabled = jsonConfig.enabled !== false
        const invAction = String(jsonConfig.invoice_action || '')
        const pickAction = String(jsonConfig.picking_action || '')

        if (!rowResult) {
          rowResult = { odoo_state: state, enabled, invoice_action: invAction, picking_action: pickAction }
        } else {
          if (!rowResult.invoice_action && invAction) rowResult.invoice_action = invAction
          if (!rowResult.picking_action && pickAction) rowResult.picking_action = pickAction
          if (!rowResult.odoo_state && state) rowResult.odoo_state = state
        }
      }
    } catch {
      // Non-fatal
    }
    return rowResult
  }
}

// ──── Helper: perform the real Odoo workflow transition for a mapped state ─────
// sale   → action_confirm (from draft/sent only)
// cancel → action_cancel, with direct-write fallback for old versions
// done   → action_done (from sale only; locks the order)
// draft/sent → no-op (never downgrade; new orders are draft by nature)
// Never throws: status actions must not fail an otherwise successful sync.
async function applyOrderStatusAction(
  client: OdooClient,
  odooRecordId: number,
  odooState: string,
  zidStatus: string,
): Promise<void> {
  try {
    const recs = await client.searchRead<any>('sale.order', [['id', '=', odooRecordId]], ['state'])
    const cur = String(recs?.[0]?.state || '')
    if (odooState === 'sale') {
      if (cur === 'sale' || cur === 'done') {
        console.info(`[SyncEngine] Order #${odooRecordId} already "${cur}"; confirm skipped (zid status "${zidStatus}")`)
        return
      }
      if (cur !== 'draft' && cur !== 'sent') {
        console.info(`[SyncEngine] Order #${odooRecordId} state "${cur || 'unknown'}" — confirm skipped (zid status "${zidStatus}")`)
        return
      }
      await client.execute('sale.order', 'action_confirm', [odooRecordId])
      console.info(`[SyncEngine] Order #${odooRecordId} CONFIRMED (zid status "${zidStatus}")`)
      return
    }
    if (odooState === 'cancel') {
      if (cur === 'cancel') {
        console.info(`[SyncEngine] Order #${odooRecordId} already cancelled; cancel skipped (zid status "${zidStatus}")`)
        return
      }
      try {
        await client.execute('sale.order', 'action_cancel', [odooRecordId])
      } catch {
        await client.write('sale.order', [odooRecordId], { state: 'cancel' })
      }
      console.info(`[SyncEngine] Order #${odooRecordId} CANCELLED (zid status "${zidStatus}")`)
      return
    }
    if (odooState === 'done') {
      if (cur === 'done' || cur === 'cancel') {
        console.info(`[SyncEngine] Order #${odooRecordId} already "${cur}"; lock skipped (zid status "${zidStatus}")`)
        return
      }
      if (cur !== 'sale') {
        console.info(`[SyncEngine] Order #${odooRecordId} state "${cur || 'unknown'}" — lock skipped, only confirmed orders can be locked (zid status "${zidStatus}")`)
        return
      }
      await client.execute('sale.order', 'action_done', [odooRecordId])
      console.info(`[SyncEngine] Order #${odooRecordId} LOCKED (zid status "${zidStatus}")`)
      return
    }
    console.info(`[SyncEngine] No status action for target "${odooState}" (zid status "${zidStatus}")`)
  } catch (err: any) {
    console.warn(`[SyncEngine] Status action "${odooState}" failed for order #${odooRecordId} (zid status "${zidStatus}"):`, err?.message || err)
  }
}

// ──── Helper: apply stock picking action for a sales order ─────
async function applyOrderPickingAction(
  client: OdooClient,
  orderId: number,
  action: string,
  zidStatus: string,
): Promise<void> {
  if (!action || action === 'none') return
  try {
    const orders = await client.searchRead<any>('sale.order', [['id', '=', orderId]], ['name', 'state', 'picking_ids'])
    const order = orders?.[0]
    if (!order) return

    // If action is create or create_and_validate, ensure order is confirmed so picking exists
    if (action === 'create' || action === 'create_and_validate') {
      if (order.state === 'draft' || order.state === 'sent') {
        try {
          await client.execute('sale.order', 'action_confirm', [orderId])
          console.info(`[SyncEngine] Confirmed sale.order #${orderId} to generate picking (status "${zidStatus}")`)
        } catch (e: any) {
          try {
            await client.execute('sale.order', 'action_confirm', [[orderId]])
            console.info(`[SyncEngine] Confirmed sale.order #${orderId} via [[orderId]] fallback (status "${zidStatus}")`)
          } catch (e2: any) {
            console.warn(`[SyncEngine] Failed to confirm sale.order #${orderId} for picking:`, e2?.message || e2)
          }
        }
      }
    }

    if (action === 'create') {
      console.info(`[SyncEngine] Picking created/ensured for sale.order #${orderId} (status "${zidStatus}")`)
      return
    }

    if (action === 'validate' || action === 'create_and_validate') {
      await processFullDelivery(client, 'sale.order', orderId)
      console.info(`[SyncEngine] Validated stock picking for sale.order #${orderId} (status "${zidStatus}")`)
      return
    }

    if (action === 'cancel') {
      let pickingIds: number[] = Array.isArray(order?.picking_ids) ? order.picking_ids : []
      if (pickingIds.length === 0 && order?.name) {
        const pickings = await client.searchRead<any>('stock.picking', [
          ['origin', '=', order.name],
          ['state', 'not in', ['cancel', 'done']]
        ], ['id'])
        pickingIds = pickings.map(p => p.id)
      }
      for (const pId of pickingIds) {
        try {
          const [pRec] = await client.searchRead<any>('stock.picking', [['id', '=', pId]], ['state'])
          if (pRec?.state && pRec.state !== 'cancel' && pRec.state !== 'done') {
            await client.execute('stock.picking', 'action_cancel', [pId])
            console.info(`[SyncEngine] Cancelled stock picking #${pId} for sale.order #${orderId}`)
          }
        } catch (pickErr: any) {
          console.warn(`[SyncEngine] Failed to cancel picking #${pId}:`, pickErr?.message || pickErr)
        }
      }
      return
    }
  } catch (err: any) {
    console.warn(`[SyncEngine] Picking action "${action}" failed for order #${orderId} (status "${zidStatus}"):`, err?.message || err)
  }
}

// ──── Helper: apply invoice action for a sales order ─────
async function applyOrderInvoiceAction(
  client: OdooClient,
  orderId: number,
  action: string,
  zidStatus: string,
  workspaceId: string,
  platform: 'zid' | 'salla' | 'shopify',
  storeId: string,
  zidEntityId: string,
): Promise<void> {
  if (!action || action === 'none') return
  try {
    const orders = await client.searchRead<any>('sale.order', [['id', '=', orderId]], ['name', 'state', 'invoice_ids'])
    const order = orders?.[0]
    if (!order) return

    if (action === 'create' || action === 'create_and_post') {
      // In Odoo, sale.order should be confirmed to invoice
      if (order.state === 'draft' || order.state === 'sent') {
        try {
          await client.execute('sale.order', 'action_confirm', [orderId])
          console.info(`[SyncEngine] Confirmed sale.order #${orderId} for invoice creation (status "${zidStatus}")`)
        } catch (e: any) {
          try {
            await client.execute('sale.order', 'action_confirm', [[orderId]])
            console.info(`[SyncEngine] Confirmed sale.order #${orderId} via [[orderId]] fallback before invoice (status "${zidStatus}")`)
          } catch (e2: any) {
            console.warn(`[SyncEngine] Failed to confirm sale.order #${orderId} before invoice:`, e2?.message || e2)
          }
        }
      }

      // Create invoice via modern or legacy method
      try {
        await client.execute('sale.order', '_create_invoices', [[orderId]])
        console.info(`[SyncEngine] Invoice created via _create_invoices for sale.order #${orderId}`)
      } catch (modernErr: any) {
        try {
          await client.execute('sale.order', '_create_invoices', [[orderId]], { final: true })
          console.info(`[SyncEngine] Invoice created via _create_invoices(final=true) for sale.order #${orderId}`)
        } catch (finalErr: any) {
          try {
            await client.execute('sale.order', '_create_invoices', [orderId])
            console.info(`[SyncEngine] Invoice created via _create_invoices [orderId] for sale.order #${orderId}`)
          } catch (singleErr: any) {
            try {
              await client.execute('sale.order', 'action_invoice_create', [orderId])
              console.info(`[SyncEngine] Invoice created via action_invoice_create for sale.order #${orderId}`)
            } catch (legacyErr: any) {
              console.warn(`[SyncEngine] Invoice creation skipped/failed for sale.order #${orderId}: ${legacyErr?.message || legacyErr}. Note: If your products in Odoo use "Delivered quantities" policy, delivery is required before invoicing.`)
            }
          }
        }
      }

      // Re-read invoice_ids to link invoice entity
      const [reloaded] = await client.searchRead<any>('sale.order', [['id', '=', orderId]], ['invoice_ids'])
      const updatedInvoiceIds: number[] = Array.isArray(reloaded?.invoice_ids)
        ? reloaded.invoice_ids.filter((v: unknown) => Number.isInteger(Number(v)) && Number(v) > 0)
        : []

      if (updatedInvoiceIds.length > 0) {
        const invoices = await client.searchRead<any>(
          'account.move',
          [['id', 'in', updatedInvoiceIds], ['move_type', '=', 'out_invoice']],
          ['id', 'name', 'state'],
          updatedInvoiceIds.length
        )
        const latest = (invoices || []).slice().sort((a: any, b: any) => Number(b.id) - Number(a.id))[0]
        if (latest?.id && workspaceId) {
          await upsertEntityLink(
            {
              workspaceId,
              platform,
              storeId: String(storeId),
              odooModel: 'account.move',
              storeEntityId: String(zidEntityId),
            },
            Number(latest.id)
          ).catch(e => console.warn('[SyncEngine] Invoice entity link failed:', e))
        }

        if (action === 'create_and_post') {
          // Post draft invoices
          const draftInvoices = (invoices || []).filter((inv: any) => inv.state === 'draft')
          for (const inv of draftInvoices) {
            try {
              await client.execute('account.move', 'action_post', [inv.id])
              console.info(`[SyncEngine] Posted invoice #${inv.id} for sale.order #${orderId}`)
            } catch (postErr: any) {
              try {
                await client.execute('account.move', 'post', [inv.id])
                console.info(`[SyncEngine] Posted invoice #${inv.id} via post fallback for sale.order #${orderId}`)
              } catch (pErr2: any) {
                console.warn(`[SyncEngine] Failed to post invoice #${inv.id}:`, pErr2?.message || pErr2)
              }
            }
          }
        }
      }
      return
    }

    if (action === 'post') {
      const invoiceIds: number[] = Array.isArray(order.invoice_ids)
        ? order.invoice_ids.filter((v: unknown) => Number.isInteger(Number(v)) && Number(v) > 0)
        : []
      if (invoiceIds.length > 0) {
        const invoicesToPost = await client.searchRead<any>(
          'account.move',
          [['id', 'in', invoiceIds], ['move_type', '=', 'out_invoice'], ['state', '=', 'draft']],
          ['id']
        )
        for (const inv of invoicesToPost || []) {
          try {
            await client.execute('account.move', 'action_post', [inv.id])
            console.info(`[SyncEngine] Posted draft invoice #${inv.id} for sale.order #${orderId}`)
          } catch (postErr: any) {
            try {
              await client.execute('account.move', 'post', [inv.id])
              console.info(`[SyncEngine] Posted invoice #${inv.id} via post fallback for sale.order #${orderId}`)
            } catch (pErr2: any) {
              console.warn(`[SyncEngine] Failed to post invoice #${inv.id}:`, pErr2?.message || pErr2)
            }
          }
        }
      }
      return
    }

    if (action === 'cancel') {
      const invoiceIds: number[] = Array.isArray(order.invoice_ids)
        ? order.invoice_ids.filter((v: unknown) => Number.isInteger(Number(v)) && Number(v) > 0)
        : []
      if (invoiceIds.length > 0) {
        const invoicesToCancel = await client.searchRead<any>(
          'account.move',
          [['id', 'in', invoiceIds], ['move_type', '=', 'out_invoice'], ['state', '!=', 'cancel']],
          ['id', 'state']
        )
        for (const inv of invoicesToCancel || []) {
          try {
            await client.execute('account.move', 'button_cancel', [inv.id])
            console.info(`[SyncEngine] Cancelled invoice #${inv.id} for sale.order #${orderId}`)
          } catch (cancelErr: any) {
            try {
              await client.execute('account.move', 'action_cancel', [inv.id])
            } catch {
              await client.write('account.move', [inv.id], { state: 'cancel' }).catch(() => {})
            }
          }
        }
      }
      return
    }
  } catch (err: any) {
    console.warn(`[SyncEngine] Invoice action "${action}" failed for order #${orderId} (status "${zidStatus}"):`, err?.message || err)
  }
}

// ──── Helper: dispatch the configured status action after the record write ─────
// Looks up the order_status_mappings row for the payload status:
//   - no row      → nothing (legacy passive state write already applied upstream)
//   - disabled    → Odoo fully untouched for this status
//   - enabled     → real workflow transition via applyOrderStatusAction, applyOrderPickingAction, applyOrderInvoiceAction
async function maybeApplyOrderStatusAction(
  client: OdooClient,
  odooRecordId: number,
  zidData: Record<string, unknown>,
  workspaceId: string,
  platform?: 'zid' | 'salla' | 'shopify',
  storeId = '',
): Promise<void> {
  try {
    const zidStatus = resolveZidStatus(zidData)
    if (!zidStatus) return

    const resolvedPlatform = platform || 'zid'

    // ── 1. Always update the custom status selection field in Odoo if configured ──
    try {
      const orderStdSettings = await getCachedStandardMappingSettings(workspaceId, resolvedPlatform, 'orders', storeId)
      const customField = orderStdSettings?.order_status_custom_field || (orderStdSettings as any)?.order?.order_status_custom_field
      const isEnabled = orderStdSettings?.update_custom_status_field !== false && (orderStdSettings as any)?.order?.update_custom_status_field !== false
      if (customField && isEnabled) {
        const knownKeys = await getSaleOrderSelectionKeys(client, workspaceId, customField)
        if (!knownKeys || knownKeys.has(zidStatus)) {
          await client.write('sale.order', [odooRecordId], { [customField]: zidStatus })
          console.info(`[SyncEngine] Synced ${resolvedPlatform} status "${zidStatus}" to custom field "${customField}" on sale.order #${odooRecordId}`)
        } else {
          console.warn(`[SyncEngine] Skipping custom status "${zidStatus}" on sale.order #${odooRecordId} — not an option of "${customField}"`)
        }
      }
    } catch (fieldErr: any) {
      console.warn(`[SyncEngine] Failed to write custom status field on sale.order #${odooRecordId} (non-fatal):`, fieldErr?.message || fieldErr)
    }

    // ── 2. Apply mapped native workflow transition ──
    const row = await getOrderStatusRow(workspaceId, zidStatus, resolvedPlatform, storeId)
    if (!row) {
      console.info(`[SyncEngine] No status mapping row for "${zidStatus}" (${resolvedPlatform}) — status action skipped`)
      return
    }
    if (!row.enabled) {
      console.info(`[SyncEngine] Status "${zidStatus}" mapping is DISABLED — Odoo untouched (#${odooRecordId})`)
      return
    }

    // When store return handling is active (negative_so or stock_return_credit_note),
    // a return status must NOT cancel the original sale order via the status mapping ladder:
    // the return policy manages returns cleanly without voiding the original sale.
    if (zidStatus === 'reversed' || zidStatus === 'partially_reversed') {
      try {
        const orderStdSettings = await getCachedStandardMappingSettings(workspaceId, resolvedPlatform, 'orders', storeId)
        const returnMode = orderStdSettings?.order?.returns?.mode || (orderStdSettings as any)?.returns?.mode
        if (returnMode && returnMode !== 'nothing' && row.odoo_state === 'cancel') {
          console.info(
            `[SyncEngine] Status "${zidStatus}" mapping to "cancel" skipped on order #${odooRecordId} because return handling policy is active ("${returnMode}")`
          )
          return
        }
      } catch {
        // Fall through
      }
    }

    // 2a. Order state action (quotation, confirm, done, cancel)
    if (row.odoo_state) {
      await applyOrderStatusAction(client, odooRecordId, row.odoo_state, zidStatus)
    }

    // 2b. Stock picking action (create, validate, create_and_validate, cancel)
    if (row.picking_action) {
      await applyOrderPickingAction(client, odooRecordId, row.picking_action, zidStatus)
    }

    // 2c. Invoice action (create, post, create_and_post, cancel)
    if (row.invoice_action) {
      const zidEntityId = String(zidData.id || (zidData as any).order_id || '')
      await applyOrderInvoiceAction(
        client,
        odooRecordId,
        row.invoice_action,
        zidStatus,
        workspaceId,
        resolvedPlatform,
        storeId,
        zidEntityId
      )
    }
  } catch (err: any) {
    console.warn('[SyncEngine] Status mapping dispatch failed (non-fatal):', err?.message || err)
  }
}

// ─── Helper: extract fulfilled items from platform payload ───────────────────
function extractFulfilledItems(zidData: Record<string, unknown>): Array<{ sku: string; qty: number }> {
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

// ─── Helper: process partial delivery in Odoo ────────────────────────────────
async function processPartialDelivery(
  client: OdooClient,
  odooModel: string,
  orderId: number,
  fulfilledItems: Array<{ sku: string; qty: number }>,
  _platform?: 'zid' | 'salla' | 'shopify',
): Promise<void> {
  // Find existing pickings for this order
  const pickings = await client.searchRead<any>('stock.picking', [
    ['origin', '=', `${odooModel},${orderId}`],
    ['state', '=', 'assigned']
  ], ['id', 'move_lines'])

  if (pickings.length > 0) {
    // Update existing picking moves with fulfilled quantities
    for (const picking of pickings) {
      const moveIds = await client.searchRead<any>('stock.move', [
        ['picking_id', '=', picking.id]
      ], ['id', 'product_id', 'product_uom_qty'])
      for (const move of moveIds) {
        const fulfilled = fulfilledItems.find(f => {
          const prodId = parseInt(f.sku)
          return !isNaN(prodId) && prodId === move.product_id[0]
        })
        if (fulfilled && fulfilled.qty < move.product_uom_qty) {
          await client.write('stock.move', [move.id], { product_uom_qty: fulfilled.qty })
        }
      }
      // Validate (transfer) the picking — Odoo auto-creates backorder
      await client.execute('stock.picking', 'action_assign', [picking.id])
      await client.execute('stock.picking', 'button_validate', [picking.id])
    }
  } else {
    // No existing picking — create one with partial quantities
    const orderLines = await client.searchRead<any>('sale.order.line', [
      ['order_id', '=', orderId]
    ], ['id', 'product_id', 'product_uom_qty'])
    if (orderLines.length > 0) {
      const moveVals: Record<string, any>[] = []
      for (const ol of orderLines) {
        const fulfilled = fulfilledItems.find(f => {
          const prodId = parseInt(f.sku)
          return !isNaN(prodId) && prodId === ol.product_id[0]
        })
        const qty = fulfilled ? fulfilled.qty : ol.product_uom_qty
        if (qty > 0) {
          moveVals.push({
            product_id: ol.product_id[0],
            product_uom_qty: qty,
            sale_line_id: ol.id,
            name: ol.product_id[1] || 'Delivery',
          })
        }
      }
      if (moveVals.length > 0) {
        const pickingData: Record<string, any> = {
          picking_type_id: (await client.searchRead<any>('stock.picking.type', [['code', '=', 'outgoing']], ['id'], 1))[0]?.id,
          location_id: (await client.searchRead<any>('stock.location', [['usage', '=', 'internal']], ['id'], 1))[0]?.id,
          location_dest_id: (await client.searchRead<any>('stock.location', [['usage', '=', 'customer']], ['id'], 1))[0]?.id,
          origin: `${odooModel},${orderId}`,
          move_lines: moveVals.map(m => [0, 0, m]),
        }
        const newPickingId = await client.create('stock.picking', pickingData)
        await client.execute('stock.picking', 'action_assign', [newPickingId])
        await client.execute('stock.picking', 'button_validate', [newPickingId])
      }
    }
  }
}

// ─── Helper: process complete/full delivery in Odoo via stock.picking ─────────
async function processFullDelivery(client: OdooClient, odooModel: string, orderId: number): Promise<void> {
  const orders = await client.searchRead<any>(odooModel, [['id', '=', orderId]], ['name', 'picking_ids'])
  const order = orders[0]
  let pickingIds: number[] = Array.isArray(order?.picking_ids) ? order.picking_ids : []

  if (pickingIds.length === 0 && order?.name) {
    const pickings = await client.searchRead<any>('stock.picking', [
      ['origin', '=', order.name],
      ['state', 'not in', ['done', 'cancel']]
    ], ['id'])
    pickingIds = pickings.map(p => p.id)
  }

  if (pickingIds.length > 0) {
    for (const pId of pickingIds) {
      try {
        const pRecs = await client.searchRead<any>('stock.picking', [['id', '=', pId]], ['state'])
        const state = pRecs[0]?.state
        if (state === 'done' || state === 'cancel') continue

        if (state === 'draft' || state === 'confirmed') {
          await client.execute('stock.picking', 'action_assign', [pId]).catch(() => {})
        }

        const moves = await client.searchRead<any>('stock.move', [['picking_id', '=', pId]], ['id', 'product_uom_qty'])
        for (const m of moves) {
          try {
            await client.write('stock.move', [m.id], { quantity: m.product_uom_qty }).catch(async () => {
              await client.write('stock.move', [m.id], { quantity_done: m.product_uom_qty }).catch(() => {})
            })
          } catch {
            // ignore field differences across Odoo versions
          }
        }

        await client.execute('stock.picking', 'button_validate', [pId])
        console.info(`[SyncEngine] Validated picking #${pId} for order #${orderId}`)
      } catch (pickErr: any) {
        console.warn(`[SyncEngine] Failed to validate picking #${pId}:`, pickErr?.message || pickErr)
      }
    }
  } else {
    console.info(`[SyncEngine] No pickings found to validate for order #${orderId}`)
  }
}

// ─── Helper: resolve platform payment method → Odoo journal ─────────────────
async function resolvePaymentMethod(
  workspaceId: string,
  zidMethod: string,
  platform?: 'zid' | 'salla' | 'shopify',
): Promise<{ journal_id?: number; payment_method_id?: number } | null> {
  let query = supabaseAdmin
    .from('payment_method_mappings')
    .select('odoo_journal_id, odoo_payment_method_id')
    .eq('workspace_id', workspaceId)
    .eq('source_method', zidMethod) as any
  if (platform) query = query.eq('platform', platform)
  const { data } = await query.maybeSingle()
  if (!data) return null
  return {
    journal_id: data.odoo_journal_id ?? undefined,
    payment_method_id: data.odoo_payment_method_id ?? undefined,
  }
}

// ─── Helper: resolve platform shipping method → Odoo carrier ────────────────
async function resolveShippingCarrier(
  workspaceId: string,
  zidMethodName: string,
  platform?: 'zid' | 'salla' | 'shopify',
): Promise<{ carrier_id?: number; product_id?: number } | null> {
  let query = supabaseAdmin
    .from('shipping_method_mappings')
    .select('odoo_carrier_id, odoo_product_id')
    .eq('workspace_id', workspaceId)
    .eq('source_method_name', zidMethodName) as any
  if (platform) query = query.eq('platform', platform)
  const { data } = await query.maybeSingle()
  if (!data) return null
  return {
    carrier_id: data.odoo_carrier_id ?? undefined,
    product_id: data.odoo_product_id ?? undefined,
  }
}

// ─── Helper: extract location ID and name from order payload across platforms ──
export function extractOrderLocationInfo(
  payload: Record<string, unknown>,
  _platform?: 'zid' | 'salla' | 'shopify'
): { locationId?: string; locationName?: string } {
  if (!payload || typeof payload !== 'object') return {}
  const p = payload as any

  // Collect candidate location IDs in priority order.
  // Salla branch paths (shipment_branch[0], shipments[0].ship_from) sit
  // alongside pickup_branch: Salla order payloads carry the fulfilling branch
  // there (docs.salla.dev/doc-433804). Zid payloads lack these keys, so this
  // is a no-op for them.
  const idCandidates: any[] = [
    p.inventory_address?.id,
    p.inventory_address?.uuid,
    p.inventory_address_id,
    p.shipping?.method?.inventory_address?.id,
    p.shipping?.method?.inventory_address?.uuid,
    p.shipping?.inventory_address?.id,
    p.shipping?.inventory_address?.uuid,
    p.pickup_point?.id,
    p.pickup_point?.uuid,
    p.pickup_location_id,
    p.location_id,
    p.location?.id,
    p.location?.uuid,
    p.store_location_id,
    p.branch_id,
    p.branch?.id,
    p.branch?.uuid,
    p.pickup_branch?.id,
    p.pickup_branch_id,
    p.shipment_branch?.[0]?.id,
    p.shipments?.[0]?.ship_from?.branch_id,
    p.products?.[0]?.inventory_address?.id,
    p.products?.[0]?.inventory_address?.uuid,
    p.products?.[0]?.location_id,
    p.products?.[0]?.store_location_id,
    p.items?.[0]?.inventory_address?.id,
    p.items?.[0]?.inventory_address?.uuid,
    p.items?.[0]?.location_id,
    p.items?.[0]?.branch?.id,
    p.items?.[0]?.branch_id,
    p.line_items?.[0]?.origin_location?.id,
    p.fulfillments?.[0]?.location_id,
  ]

  // Collect candidate location Names in priority order
  const nameCandidates: any[] = [
    p.inventory_address?.name,
    p.shipping?.method?.inventory_address?.name,
    p.shipping?.inventory_address?.name,
    p.pickup_point?.name,
    p.location?.name,
    p.location_name,
    p.branch?.name,
    p.branch_name,
    p.pickup_branch?.name,
    p.shipment_branch?.[0]?.name,
    p.shipments?.[0]?.ship_from?.name,
    p.products?.[0]?.inventory_address?.name,
    p.products?.[0]?.location_name,
    p.items?.[0]?.inventory_address?.name,
    p.items?.[0]?.location_name,
    p.items?.[0]?.branch?.name,
  ]

  const firstValidId = idCandidates.find(v => v !== undefined && v !== null && String(v).trim() !== '')
  const firstValidName = nameCandidates.find(v => v !== undefined && v !== null && String(v).trim() !== '')

  return {
    locationId: firstValidId !== undefined ? String(firstValidId).trim() : undefined,
    locationName: firstValidName !== undefined ? String(firstValidName).trim() : undefined,
  }
}

// ─── Helper: resolve platform location → Odoo warehouse / stock location ────
async function resolveWarehouse(
  workspaceId: string,
  platform?: 'zid' | 'salla' | 'shopify',
  zidLocationId?: string,
  zidLocationName?: string,
): Promise<{ warehouse_id?: number; location_id?: number } | null> {
  if (!workspaceId || (!zidLocationId && !zidLocationName)) return null

  let query = supabaseAdmin
    .from('warehouse_mappings')
    .select('source_location_id, source_location_name, odoo_warehouse_id, odoo_location_id')
    .eq('workspace_id', workspaceId) as any

  if (platform) query = query.eq('platform', platform)
  const { data: rows } = await query
  if (!rows || rows.length === 0) return null

  const clean = (s: string) => String(s || '').trim().toLowerCase().replace(/[-_\s]/g, '')
  const targetIdClean = zidLocationId ? clean(zidLocationId) : ''
  const targetNameClean = zidLocationName ? clean(zidLocationName) : ''

  // 1. Try matching by normalized ID (with or without hyphens)
  if (targetIdClean) {
    const matched = rows.find((r: any) => clean(r.source_location_id) === targetIdClean)
    if (matched) {
      return {
        warehouse_id: matched.odoo_warehouse_id ?? undefined,
        location_id: matched.odoo_location_id ?? undefined,
      }
    }
  }

  // 2. Try matching by location name
  if (targetNameClean) {
    const matched = rows.find((r: any) => clean(r.source_location_name) === targetNameClean)
    if (matched) {
      return {
        warehouse_id: matched.odoo_warehouse_id ?? undefined,
        location_id: matched.odoo_location_id ?? undefined,
      }
    }
  }

  return null
}

// ─── Helper: apply conditional rules and currency conversion from DB ──────────
export async function applyRulesToValues(
  odooValues: Record<string, unknown>,
  workspaceId: string,
  presetKey: string | null | undefined,
  zidData: Record<string, unknown>,
  _client: OdooClient,
): Promise<Record<string, unknown>> {
  if (!presetKey) return odooValues

  const { data: rules, error } = await supabaseAdmin
    .from('fixed_mapping_rules')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('preset_key', presetKey)
    .eq('enabled', true)
    .order('priority', { ascending: true })

  if (error || !rules || rules.length === 0) return odooValues

  const values = { ...odooValues }

  for (const rule of rules) {
    if (rule.rule_type === 'conditional' && rule.condition_field && rule.action_field) {
      const matched = evaluateCondition(rule.condition_field, rule.condition_op, rule.condition_value, zidData)
      if (matched) {
        const actionVal = rule.action_value
        if (actionVal !== undefined) {
          const meta = HARDCODED_FIELD_META[rule.action_field]
          if (meta?.ttype === 'boolean') {
            values[rule.action_field] = actionVal === 'true' || actionVal === '1'
          } else if (['integer', 'float', 'monetary'].includes(meta?.ttype ?? '')) {
            const n = parseFloat(actionVal)
            if (!isNaN(n)) values[rule.action_field] = n
          } else {
            values[rule.action_field] = actionVal
          }
        }
      }
    }

    if (rule.rule_type === 'currency' && rule.from_currency && rule.to_currency) {
      const sourceField = (rule.condition_field) || 'list_price'
      const raw = Number(resolvePath(zidData, sourceField) ?? values[sourceField])
      if (!isNaN(raw) && raw > 0) {
        // Use DB rule rate, or lookup live rate via currency_mappings + API
        if (rule.conversion_rate) {
          values[rule.action_field || sourceField] = raw * Number(rule.conversion_rate)
        } else {
          const rate = null
          if (rate !== null) {
            values[rule.action_field || sourceField] = raw * rate
          }
        }
      }
    }
  }

  return values
}

// ─── Helper: build the Odoo values dict from Zid data + field meta ────────────

export async function buildOdooValues(
  client: OdooClient,
  mappingItems: FieldMappingItem[],
  zidData: Record<string, unknown>,
  fieldMeta: Map<string, OdooFieldMeta>,
  platform: 'zid' | 'salla' | 'shopify' = 'zid',
  workspaceId?: string,
  storeId = ''
): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {}

  for (const item of mappingItems) {
    if (!item.erpField) continue

    const hasStaticValue = Array.isArray(item.staticValue)
      ? item.staticValue.length > 0
      : item.staticValue !== undefined && item.staticValue !== null && item.staticValue !== ''

    const rawValue = hasStaticValue
      ? item.staticValue
      : item.zidField
        ? resolvePath(zidData, item.zidField)
        : undefined
    if (rawValue === undefined || rawValue === null) continue

    let meta = fieldMeta.get(item.erpField)
    if (!meta) {
      // Odoo 19 removed res.partner.mobile. The order-sync path already
      // excludes it (see the hasPartnerField guard in createOrUpdatePartner),
      // and buildOdooValues normally skips any field the model lacks — but that
      // depends on fetchFieldMeta having returned a field set. When the
      // ir.model.fields read fails (empty map on some SaaS tenants), the next
      // branch falls into HARDCODED_FIELD_META, where `mobile` exists, and the
      // resulting write dies with KeyError: 'mobile'. No mapped entity other
      // than res.partner carries a `mobile` column, so skip the column unless
      // Odoo positively confirms the field is there.
      if (item.erpField === 'mobile' && (!fieldMeta || fieldMeta.size === 0)) {
        console.warn(`[SyncEngine] Skipping field "mobile" (not confirmed on Odoo model; removed in Odoo 19)`)
        continue
      }
      if (fieldMeta && fieldMeta.size > 0) {
        console.warn(`[SyncEngine] Skipping field "${item.erpField}" because it does not exist on Odoo model`)
        continue
      }
      const fallback = HARDCODED_FIELD_META[item.erpField]
      if (fallback) {
        meta = {
          name: item.erpField,
          ttype: fallback.ttype,
          relation: fallback.relation ?? ''
        }
      }
    }
    const ttype = meta?.ttype ?? ''
    const relation = meta?.relation ?? ''

    // ── Many2one: needs an integer record ID ──────────────────────────────────
    if (ttype === 'many2one' && relation) {
      if (hasStaticValue) {
        const id = Number(Array.isArray(rawValue) ? rawValue[0] : rawValue)
        if (Number.isInteger(id) && id > 0) {
          values[item.erpField] = id
          continue
        }
      }

      const singleValue = Array.isArray(rawValue) ? rawValue[0] : rawValue

      // If parent_id is empty or 0, it means it is a root category in Zid (no parent).
      // In Odoo, setting parent_id to false clears the parent or keeps it empty.
      if (item.erpField === 'parent_id' && (singleValue === null || singleValue === undefined || singleValue === '' || singleValue === 0 || singleValue === '0' || singleValue === 'null' || singleValue === 'None')) {
        values[item.erpField] = false
        continue
      }

      const resolvedId = await resolveSingleRelationId(client, relation, singleValue, platform, undefined, undefined, workspaceId, storeId)
      if (resolvedId !== null) {
        values[item.erpField] = resolvedId
      } else {
        const nameStr = toNameString(singleValue)
        console.warn(`[SyncEngine] Skipping "${item.erpField}" — could not resolve "${nameStr}" in ${relation}`)
      }
      continue
    }

    // ── Many2many / One2many: needs [(6, 0, [ids])] syntax ────────────────────
    if ((ttype === 'many2many' || ttype === 'one2many') && relation) {
      const items = Array.isArray(rawValue) ? rawValue : [rawValue]
      const ids: number[] = []
      for (const v of items) {
        if (hasStaticValue) {
          const staticId = Number(v)
          if (Number.isInteger(staticId) && staticId > 0) {
            ids.push(staticId)
            continue
          }
        }

        const resolvedId = await resolveSingleRelationId(client, relation, v, platform, undefined, undefined, workspaceId, storeId)
        if (resolvedId !== null) ids.push(resolvedId)
      }
      if (ids.length > 0) {
        values[item.erpField] = [[6, 0, ids]]
      } else {
        console.warn(`[SyncEngine] Skipping "${item.erpField}" — no IDs resolved`)
      }
      continue
    }

    // ── Binary fields: Odoo expects base64 encoded data ────────────────────────
    if (ttype === 'binary') {
      const base64Data = await resolveBinaryField(rawValue)
      if (base64Data) {
        values[item.erpField] = base64Data
      } else {
        console.warn(`[SyncEngine] Skipping binary field "${item.erpField}" — could not resolve. rawValue type=${typeof rawValue} isArray=${Array.isArray(rawValue)} value=${JSON.stringify(rawValue).slice(0, 300)}`)
      }
      continue
    }

    // ── Numeric fields ─────────────────────────────────────────────────────────
    let value: unknown = rawValue
    if (ttype === 'boolean' && typeof value === 'string') {
      value = value === 'true'
    } else if (typeof value === 'string' && (item.erpField.endsWith('_ok') || item.erpField === 'active')) {
      value = value === 'true' || value === '1' || value === 'yes'
    }

    // Zid may send weight / cost as { value: 0, unit: "kg" } — extract the number
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>
      if ('value' in obj || 'weight' in obj) {
        const numCandidate = parseFloat(String((obj as any).value ?? (obj as any).weight ?? ''))
        if (!isNaN(numCandidate)) {
          value = numCandidate
        } else {
          value = 0
        }
      }
    }

    if (
      typeof value === 'string' &&
      (['integer', 'float', 'monetary'].includes(ttype) ||
       ['list_price', 'standard_price', 'qty_available', 'weight', 'volume',
        'price', 'cost', 'taxes_id'].includes(item.erpField))
    ) {
      const parsed = parseFloat(value)
      if (!isNaN(parsed)) value = parsed
    }

    // ── Arrays → comma-separated string for plain text fields ─────────────────
    if (Array.isArray(value)) {
      value = value.map(toNameString).join(', ')
    }

    // ── Flatten language objects for char/text fields ───────────────────────────
    // Zid/Salla may send name/description as {ar: '...', en: '...'}.
    // Odoo plain fields expect a string, not a language dict.
    // We flatten here so the fallback values in safeCreateOdooRecord are also clean.
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>
      if ('ar' in obj || 'en' in obj) {
        value = String(obj['ar'] || obj['en'] || '')
      }
    }

    // ── Datetime/date fields: Odoo's XML-RPC to_datetime is strict ─────────────
    // ('YYYY-MM-DD HH:MM:SS'). Salla sends `date.date` with microseconds
    // ("2022-06-26 12:21:45.000000"), which dies on sale.order.create with
    // "ValueError: unconverted data remains: .000000". Extract the
    // Odoo-compatible prefix; already-clean values pass through unchanged,
    // so Zid/Shopify flows are unaffected.
    if (typeof value === 'string' && (ttype === 'datetime' || ttype === 'date')) {
      const m = value.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2}))?)?/)
      if (m) {
        value = ttype === 'date' ? m[1] : `${m[1]} ${m[2] ? `${m[2]}:${m[3] ?? '00'}` : '00:00:00'}`
      }
    }

    values[item.erpField] = value
  }

  return values
}

// ─── Event normalization ──────────────────────────────────────────────────────
// Zid sometimes sends 'product.created' while field_mappings stores 'product.create'.

const EVENT_ALIASES: Record<string, string> = {
  'product.created':        'product.create',
  'product.updated':        'product.update',
  'product.deleted':        'product.delete',
  'product.published':      'product.publish',
  'product_create':         'product.create',
  'product_created':        'product.create',
  'product_update':         'product.update',
  'product_updated':        'product.update',
  'product_delete':         'product.delete',
  'product_deleted':        'product.delete',
  'product.stock.create':   'product.create',
  'product.stock.update':   'product.update',
  'product.stock.delete':   'product.delete',
  'order.created':              'order.create',
  'order.updated':              'order.update',
  'order.status.update':        'order.update',
  'order.status.updated':       'order.update',
  'order.status_update':        'order.update',
  'order_status_update':        'order.update',
  'order_status_updated':       'order.update',
  'order.cancelled':            'order.cancel',
  'order.delivered':            'order.deliver',
  'order.payment_status.update':'order.update',
  'order_payment_status_update':'order.update',
  'order.refunded':             'order.update',
  'order.reversed':             'order.cancel',
  'order_create':               'order.create',
  'order_created':              'order.create',
  'order_update':               'order.update',
  'order_cancel':               'order.cancel',
  'order_deliver':              'order.deliver',
  'orders/create':              'order.create',
  'orders/updated':             'order.update',
  'orders/cancelled':           'order.cancel',
  'orders/fulfilled':           'order.deliver',
  'orders/paid':                'order.update',
  'orders/partially_fulfilled': 'order.deliver',
  'orders/edited':              'order.update',
  'orders/delete':              'order.cancel',
  'customer.created':       'customer.create',
  'customer.updated':       'customer.update',
  'customer.merchant.update': 'customer.update',
  'customer.merchant.updated': 'customer.update',
  'customer_create':        'customer.create',
  'customer_created':       'customer.create',
  'customer_update':        'customer.update',
  'customer_updated':       'customer.update',
  'category.created':       'category.create',
  'category.updated':       'category.update',
  'category.deleted':       'category.delete',
  'category_create':        'category.create',
  'category_created':       'category.create',
  'category_update':        'category.update',
  'category_updated':       'category.update',
  'category_delete':        'category.delete',
  'category_deleted':       'category.delete',
  'collections/create':     'category.create',
  'collections/update':     'category.update',
  'collections/delete':     'category.delete',
  'shopify:collections/create': 'category.create',
  'shopify:collections/update': 'category.update',
  'shopify:collections/delete': 'category.delete',
}


function normalizeEvent(event: string): string {
  return EVENT_ALIASES[event] ?? event
}

export function normalizeOdooOperation(operation: unknown, event: string, platform?: string): OdooOperation {
  if (operation === 'create' || operation === 'update' || operation === 'delete' || operation === 'cancel' || operation === 'deliver') {
    return operation as OdooOperation
  }

  // Salla is answered from the shared explicit table BEFORE the substring
  // heuristics below, because the two disagree on real Salla events:
  // `order.shipment.cancelled` would substring-match to `cancel` and cancel the
  // whole sale.order when only a shipment was cancelled, and
  // `product.quantity.low` / `customer.login` would fall through to `create`.
  // The webhook gate resolves the same event through the same table, so the
  // operation a merchant enabled is the operation that runs.
  //
  // Only consulted when the platform is explicitly 'salla'. Zid and Shopify
  // share some slug spellings (`order.created`, `order.deleted`, …) and must
  // keep the alias table below — Salla's table would change their meaning.
  if (platform === 'salla') {
    const sallaOperation = resolveOperationForEvent(event, platform)
    if (sallaOperation) return sallaOperation as OdooOperation
  }

  const normalizedEvent = normalizeEvent(event)
  if (normalizedEvent.includes('cancel')) return 'cancel'
  if (normalizedEvent.includes('deliver')) return 'deliver'
  if (normalizedEvent.includes('delete')) return 'delete'
  if (normalizedEvent.includes('update') || normalizedEvent.includes('publish')) return 'update'
  return 'create'
}

/**
 * مفتاح الـpreset إلى نوع الكيان الذي يفحصه حارس الإعدادات.
 * الترتيب مقصود: أول تطابق يفوز (السلوك السابق كان سلسلة `if` متتابعة).
 * يُرجع null عندما لا يطابق الـpreset أي كيان معروف ⇒ لا يُطبَّق الحارس.
 */
const PRESET_ENTITY_TYPES: ReadonlyArray<readonly [string, string]> = [
  ['category', 'categories'],
  ['product', 'products'],
  ['customer', 'customers'],
  ['order', 'orders'],
]

export function presetEntityType(presetKey: string): string | null {
  for (const [needle, entityType] of PRESET_ENTITY_TYPES) {
    if (presetKey.includes(needle)) return entityType
  }
  return null
}

// ─── Helper: cached standard mapping settings lookup ───

async function getCachedStandardMappingSettings(
  workspaceId: string,
  storeType: string,
  entityType: string,
  storeId = ''
): Promise<Record<string, any> | null> {
  const key = String(storeId ?? '').trim()
  return ttlCache.get(
    `eng:stdsets:${workspaceId}:${storeType}:${key}:${entityType}`,
    30_000,
    // Delegated to the shared reader: per-store row first, platform default
    // ('') as fallback, with store_id compared as TEXT on both sides. The
    // previous inline copy did `r.store_id === storeId`, which never matched a
    // numeric caller and quietly fell back to store #1's row.
    () =>
      getEffectiveStandardMappingSettings(
        supabaseAdmin,
        workspaceId,
        storeType,
        entityType,
        key
      )
  )
}

// ─── Helper: check if category sync operation is allowed via Standard Mapping settings ───

async function isEntityOperationAllowed(
  workspaceId: string,
  storeType: string,
  operation: 'create' | 'update' | 'delete' | 'cancel' | 'deliver',
  entityType: string = 'categories',
  storeId = ''
): Promise<{ allowed: boolean; reason?: string }> {
  const settings = await getCachedStandardMappingSettings(workspaceId, storeType, entityType, storeId)

  if (!settings) return { allowed: true }

  if (settings.disabled === true) {
    return { allowed: false, reason: `${entityType} sync is disabled via Standard Mapping settings` }
  }

  // If the user explicitly configured an "on_delete" strategy (not 'nothing'), that
  // implicitly allows the delete operation, even if 'delete' is not in enabled_actions.
  if (operation === 'delete' && settings.on_delete && settings.on_delete !== 'nothing') {
    return { allowed: true }
  }

  if (Array.isArray(settings.enabled_actions) && settings.enabled_actions.length > 0) {
    if (!settings.enabled_actions.includes(operation)) {
      return { allowed: false, reason: `${entityType} "${operation}" operation is not enabled in Standard Mapping settings` }
    }
  }

  return { allowed: true }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Called from the webhook handler for every incoming Zid event.
 * Finds matching field_mappings and pushes data to Odoo.
 */
export async function processWebhookEvent(
  event: string,
  storeId: number | string,
  data: Record<string, unknown>,
  platformHint?: 'zid' | 'salla' | 'shopify',
  isQueueExecution = false,
  workspaceIdParam?: string,
  /**
   * رقم صف الطابور الذي يعالَج — **هوية الحدث**.
   *
   * تُستخدم كمفتاح `event_key` في صندوق التليجرام ⇒ **رسالة واحدة لكل
   * طلب**: رسالة الوصول (عند الاستقبال) ورسالة النتيجة (بعد المزامنة)
   * تشتركان في المفتاح نفسه، فالأعلى أولوية يُلغي الأدنى.
   */
  queueItemId?: string | null
): Promise<SyncEngineResult> {
  const storeIdNum = Number(storeId)
  const storeIdStr = Number.isNaN(storeIdNum) ? String(storeId) : String(storeIdNum)
  const normalizedEvent = normalizeEvent(event)
  // ختم تصنيف المصادقة الذي يرفقه مسار الدخول (zid_auth / salla_auth) على
  // التسليمات غير المصادقة فقط. يُقرأ هنا ثم يُحذف فوراً حتى لا يدخل في أي
  // تحويل أو كتابة لاحقة. للتسليمات غير المصادقة تُعاد القراءة القيمية من
  // API المنصة (API يفوز في الدمج) — المتصل غير المصادق يبقى محفزاً فقط،
  // لا مصدراً للقيم. التسليمات المصادقة: سلوك الدمج كما هو تماماً.
  const deliveryAuth = String((data as any)?.zid_auth ?? (data as any)?.salla_auth ?? '').toLowerCase()
  if ((data as any)?.zid_auth !== undefined) delete (data as any).zid_auth
  if ((data as any)?.salla_auth !== undefined) delete (data as any).salla_auth
  const isLegacyDelivery = deliveryAuth === 'legacy' || deliveryAuth === 'unconfigured'
  const result: SyncEngineResult = {
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    records: [],
  }

  let resolvedWorkspaceId = workspaceIdParam
  if (!resolvedWorkspaceId) {
    try {
      const { data: tok } = await supabaseAdmin
        .from('merchant_tokens')
        .select('workspace_id')
        .or(`store_id.eq.${storeIdStr},merchant_id.eq.${storeIdStr}`)
        .maybeSingle()
      resolvedWorkspaceId = tok?.workspace_id
    } catch { /* ignore */ }
  }
  if (!resolvedWorkspaceId) {
    try {
      const { data: sallaTok } = await supabaseAdmin
        .from('salla_tokens')
        .select('workspace_id')
        .eq('merchant_id', storeIdStr)
        .maybeSingle()
      resolvedWorkspaceId = sallaTok?.workspace_id
    } catch { /* ignore */ }
  }
  if (!resolvedWorkspaceId) {
    try {
      const { data: shopTok } = await supabaseAdmin
        .from('shopify_tokens')
        .select('workspace_id')
        .eq('shop_domain', storeIdStr)
        .maybeSingle()
      resolvedWorkspaceId = shopTok?.workspace_id
    } catch { /* ignore */ }
  }

  const isProduct = normalizedEvent.includes('product')
  if (!isProduct) {
    console.info(`[SyncEngine] ===== processWebhookEvent START =====`)
    console.info(`[SyncEngine] event="${event}" normalized="${normalizedEvent}" storeId="${storeIdStr}"`)
  }

  // ── If Zid customer event, fetch full details first (Zid webhook payload is minimal) ──
  const syncPlatform: 'zid' | 'salla' | 'shopify' = platformHint ?? (
    normalizedEvent.includes('shopify') ? 'shopify'
    : normalizedEvent.includes('salla') ? 'salla'
    : 'zid'
  )
  if (syncPlatform === 'zid' && normalizedEvent.startsWith('customer.')) {
    const customerId = data.id || data.customer_id
    if (customerId) {
      try {
        const { data: tokenRow } = await supabaseAdmin
          .from('merchant_tokens')
          .select('*')
          .or(`store_id.eq.${storeIdStr},merchant_id.eq.${storeIdStr}`)
          .maybeSingle()

        if (tokenRow) {
          const { getAccessToken } = await import('./zid/token')
          const { ZidAPI } = await import('./zid-client')

          const storedTokens = await getAccessToken(tokenRow.merchant_id)
          const creds = {
            authorization: storedTokens.authorization || '',
            managerToken: storedTokens.accessToken,
            storeId: tokenRow.store_id || tokenRow.merchant_id,
          }
          console.info(`[SyncEngine] Zid customer webhook payload is minimal. Fetching full details for ID ${customerId}...`)
          const response = await ZidAPI.customers.get(creds, String(customerId))
          if (response.data?.customer) {
            console.info(`[SyncEngine] Full Zid customer data fetched. Type: ${response.data.customer.type}`)
            //legacy: API يفوز عليه الجسم (المتصل غير المصادق محفز فقط)
            data = isLegacyDelivery
              ? { ...data, ...response.data.customer }
              : {
                  ...response.data.customer,
                  ...data,
                }
          }
        }
      } catch (err: any) {
        const msg = err?.message ?? String(err)
        const isTokenError = /401|403|unauthorized|token|expired|forbidden/i.test(msg)
        if (isTokenError) {
          console.error(`[SyncEngine] ⚠️ Zid token issue while fetching customer ${customerId} — sync will continue with minimal payload. Error: ${msg}`)
        } else {
          console.warn(`[SyncEngine] Failed to fetch full Zid customer details for ID ${customerId}:`, msg)
        }
      }
    }
  }

  // ── If Zid product event, fetch full details first (webhook payload may be minimal or missing grouped components) ──
  if (syncPlatform === 'zid' && isProduct) {
    const productId = data.id || data.product_id
    if (productId) {
      try {
        const { data: tokenRow } = await supabaseAdmin
          .from('merchant_tokens')
          .select('*')
          .or(`store_id.eq.${storeIdStr},merchant_id.eq.${storeIdStr}`)
          .maybeSingle()

        if (tokenRow) {
          const { getAccessToken } = await import('./zid/token')
          const { ZidAPI } = await import('./zid-client')

          const storedTokens = await getAccessToken(tokenRow.merchant_id)
          const creds = {
            authorization: storedTokens.authorization || '',
            managerToken: storedTokens.accessToken,
            storeId: tokenRow.store_id || tokenRow.merchant_id,
          }
          console.info(`[SyncEngine] Zid product webhook payload may be minimal. Fetching full details for ID ${productId}...`)
          const response = await ZidAPI.products.get(creds, String(productId))
          const productData = response.data?.product || response.data
          if (productData && (productData.id || productData.name)) {
            console.info(`[SyncEngine] Full Zid product data fetched for ID ${productId}. Class: ${productData.product_class}`)
            const apiVariants = Array.isArray((productData as any).variants) && (productData as any).variants.length > 0 ? (productData as any).variants : null
            const apiOptions = Array.isArray((productData as any).options) && (productData as any).options.length > 0 ? (productData as any).options : null
            const apiAttributes = Array.isArray(productData.attributes) && productData.attributes.length > 0 ? productData.attributes : null
            const apiStructure = productData.structure && productData.structure !== 'standalone' ? productData.structure : null
            const apiHasOptions = productData.has_options === true
            //legacy: API يفوز عليه الجسم (المتصل غير المصادق محفز فقط)
            data = isLegacyDelivery
              ? { ...data, ...productData }
              : {
                  ...productData,
                  ...data,
                }
            if (apiVariants) data.variants = apiVariants
            if (apiOptions) data.options = apiOptions
            if (apiAttributes) data.attributes = apiAttributes
            if (apiStructure) data.structure = apiStructure
            if (apiHasOptions) data.has_options = true
          }
        }
      } catch (err: any) {
        const msg = err?.message ?? String(err)
        const isTokenError = /401|403|unauthorized|token|expired|forbidden/i.test(msg)
        if (isTokenError) {
          console.error(`[SyncEngine] ⚠️ Zid token issue while fetching product ${productId} — sync will continue with minimal payload. Error: ${msg}`)
        } else {
          console.warn(`[SyncEngine] Failed to fetch full Zid product details for ID ${productId}:`, msg)
        }
      }
    }
  }

  // ── If Zid order event, fetch full details when the payload is minimal ──
  //
  // ⚠️ إشعار زد لطلب جديد **لا يحمل بنود الطلب** ⇒ لازم نسحبه من زد.
  // وسقف زد 60 قراءة/دقيقة ⇒ في ذروة 1000 طلب/دقيقة نحتاج 1000 سحب.
  // لذلك: (1) ميزانية سحب تحترم سقف زد، (2) ذاكرة قصيرة تُغني عن السحب
  // المتكرر لنفس الطلب. neither نتجاوز سقف المنصة ولا نكتب طلباً بلا بنود.
  if (syncPlatform === 'zid' && normalizedEvent.startsWith('order.')) {
    const hasOrderItems = ['products', 'items', 'order_items', 'order_items_list', 'line_items']
      .some(k => Array.isArray((data as any)?.[k]) && ((data as any)[k] as any[]).length > 0)
    const orderId = data.id || data.order_id
    if (orderId && !hasOrderItems) {
      try {
        const { data: tokenRow } = await supabaseAdmin
          .from('merchant_tokens')
          .select('*')
          .or(`store_id.eq.${storeIdStr},merchant_id.eq.${storeIdStr}`)
          .maybeSingle()

        if (tokenRow) {
          const { getAccessToken } = await import('./zid/token')
          const { ZidAPI } = await import('./zid-client')
          const { acquirePullToken, getCachedOrderDetails, setCachedOrderDetails } =
            await import('./store-pull-budget')

          const orderIdStr = String(orderId)
          const workspaceForCache = resolvedWorkspaceId || storeIdStr

          // ذاكرة السحب: نفس الطلب يُقرأ مرة واحدة لا مرات.
          const cached = getCachedOrderDetails('zid', workspaceForCache, orderIdStr)
          let orderData: Record<string, unknown> | null = cached

          if (!orderData) {
            // ميزانية السحب: لا نتجاوز سقف زد (60/دقيقة).
            const granted = await acquirePullToken('zid', workspaceForCache)
            if (!granted) {
              throw new Error(
                'Zid API pull budget exhausted (60 reads/min) — the order is rescheduled instead of being written without its line items'
              )
            }
            const storedTokens = await getAccessToken(tokenRow.merchant_id)
            const creds = {
              authorization: storedTokens.authorization || '',
              managerToken: storedTokens.accessToken,
              storeId: tokenRow.store_id || tokenRow.merchant_id,
            }
            console.info(`[SyncEngine] Zid order webhook payload is minimal. Fetching full details for ID ${orderId}...`)
            const response = await ZidAPI.orders.get(creds, orderIdStr)
            const raw = response.data?.order || response.data?.data || response.data
            orderData = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
            if (orderData) {
              setCachedOrderDetails('zid', workspaceForCache, orderIdStr, orderData)
            }
          } else {
            console.info(`[SyncEngine] Zid order ${orderId} details served from the pull cache.`)
          }

          if (orderData && (orderData.id || orderData.order_number || orderData.code)) {
            console.info(`[SyncEngine] Full Zid order data fetched for ID ${orderId}. Status: ${orderData.order_status || orderData.status || 'n/a'}`)
            //legacy: API يفوز عليه الجسم (المتصل غير المصادق محفز فقط)
            data = isLegacyDelivery
              ? { ...data, ...orderData }
              : {
                  ...orderData,
                  ...data,
                }
          } else {
            // استُجيب لكن لا يوجد طلب بهذا المعرّف ⇒ لا بنود ⇒ لا نكتب.
            throw new Error(`Zid returned no order data for id ${orderId}`)
          }
        } else {
          throw new Error(`no Zid token row for store ${storeIdStr}`)
        }
      } catch (err: any) {
        const msg = err?.message ?? String(err)
        const isTokenError = /401|403|unauthorized|token|expired|forbidden/i.test(msg)
        // ⚠️ الفشل هنا كان **يُبتلع** ⇒ المتابعة ببيانات ناقصة ⇒ نكتب في
        // أودوو طلباً **بلا بنود** (لا منتجات) ويبدو أنه تمّ بنجاح. التاجر
        // يجد طلباً في أودوو بلا أصناف ولا يعرف why.
        //
        // الصحيح: **تفشل المهمة** ⇒ يُعاد جدولتها (5 محاولات) ثم صندوق
        // الموتى — قابل للاسترجاع ومرئي. لا يُكتب شيء ناقص.
        if (isTokenError) {
          console.error(`[SyncEngine] ⚠️ Zid token issue while fetching order ${orderId} — the order is NOT synced (it would have no line items). Error: ${msg}`)
        } else {
          console.error(`[SyncEngine] Failed to fetch full Zid order details for ID ${orderId} — the order is NOT synced (it would have no line items). Error: ${msg}`)
        }
        result.records.push({
          mappingId: '',
          mappingName: 'zid_order_enrichment',
          model: 'sale.order',
          status: 'failed',
          message: `Zid order details unavailable for id ${orderId}: ${msg}`.slice(0, 300),
        })
        result.processed += 1
        result.failed += 1
        return result
      }
    }
  }

  // ── If Salla event, enrich thin payloads in the BACKGROUND ──
  // (The Salla webhook route enqueues raw payloads only and returns 200
  // immediately — Salla retries on timeout. Enrichment used to block the
  // webhook response; it now happens here inside the queue worker.)
  if (syncPlatform === 'salla') {
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
      ? (data as any)?.order_id ?? (data as any)?.order?.id
      : undefined
    // Payload size alone is the wrong test for orders. An `order.updated` payload
    // can carry a dozen fields and still omit `items`, and it would pass the
    // `keys.length <= 4` check below — so Odoo gets written with no line items and
    // the sync looks like it succeeded. Completeness of an order is decided by
    // `items`, so that is what gates the fetch; the size heuristic stays for the
    // other entities, where a small payload genuinely means "identifier only".
    const missingOrderItems =
      hasEntity && normalizedEvent.startsWith('order.') && orderSource?.items === undefined
    // A category payload can be fat (>4 keys) and still omit `parent_id`. Size
    // alone then passes it through with no parent, which looks exactly like
    // "synced fine but Parent Category is empty". Fetch the full category when
    // the parent key is absent so the mapping always has a value to resolve.
    const missingParentId =
      hasEntity && normalizedEvent.startsWith('category.') && (data as any)?.parent_id === undefined
    const isThin = hasEntity && keys.length <= 4
    // legacy delivery: تُعاد القراءة من API سالا **دائماً** حتى لو كان payload
    // كثيفاً — للمتصل غير المصادق صحة الحدث ليست مضمونة، فالجسم محفز فقط
    // و API هي مصدر القيم (نفس قاعدة ثقة مسار أودو → المتجر).
    const legacyNeedsFetch = isLegacyDelivery && hasEntity
    if (legacyNeedsFetch || missingOrderItems || missingParentId || isThin) {
      try {
        const { getSallaOrder, getSallaCustomer, getSallaCategory, getSallaProduct } = await import('./salla-client')
        if (normalizedEvent.startsWith('order.')) {
          const orderFetchId = isShipmentEvent && !shipmentHasOrder ? shipmentEntityId : entityId
          if (orderFetchId === undefined || orderFetchId === null) {
            // Shipment event with neither a nested order nor an order_id: there
            // is nothing valid to fetch, and `entityId` is a shipment id.
          } else {
            const full = await getSallaOrder(storeIdStr, String(orderFetchId))
          // `full` first, then the event's own order object: when both describe
          // the same order the event wins (it is fresher than our GET), and the
          // thin envelope can no longer overwrite the correct id with a wrong one.
          // legacy delivery: يُعكس الاتجاه — API يفوز وتُتجاهل قيم الجسم المتعارضة.
          if (full) data = isLegacyDelivery ? { ...orderSource, ...full } : { ...full, ...orderSource }
          }
        } else if (normalizedEvent.startsWith('customer.')) {
          const full = await getSallaCustomer(storeIdStr, String(entityId))
          if (full) data = isLegacyDelivery ? { ...data, ...full } : { ...full, ...data }
        } else if (normalizedEvent.startsWith('category.')) {
          const full = await getSallaCategory(storeIdStr, String(entityId))
          if (full) data = isLegacyDelivery ? { ...data, ...full } : { ...full, ...data }
        } else if (normalizedEvent.startsWith('product.') && legacyNeedsFetch) {
          // For authenticated deliveries product.* payloads are already full —
          // no fetch needed. Legacy ones are re-read from Salla before anything
          // reaches Odoo.
          const full = await getSallaProduct(storeIdStr, String(entityId))
          if (full) data = { ...data, ...full }
        }
      } catch {
        // Enrichment is best-effort — fall back to the raw payload.
      }
    }
  }

  // ملاحظة: تنظيف السجلات المنتهية لا يُشغَّل هنا. كان يعمل عند كل ويب هوك،
  // أي عمليتا DELETE غير محدودتين على `sync_logs` في المسار الساخن. الآن
  // `maybeCleanup()` في `sync-queue.ts` يتكفّل به مرة كل ساعة.

  // `order.shipment.*` describes a SHIPMENT, not an order: `data.id` is the
  // shipment id and `reference_id` is not the order id. Point the event at the
  // order it belongs to so the mapping matches (or creates) the right
  // sale.order instead of writing against an unrelated id.
  if (syncPlatform === 'salla' && normalizedEvent.includes('shipment')) {
    const shipmentOrder = (data as any)?.order
    const hasShipmentOrder =
      shipmentOrder && typeof shipmentOrder === 'object' && !Array.isArray(shipmentOrder)
    const targetOrderId = hasShipmentOrder ? (shipmentOrder as any).id : (data as any)?.order_id
    if (targetOrderId !== undefined && targetOrderId !== null && String(targetOrderId) !== '') {
      data = {
        ...(hasShipmentOrder ? (shipmentOrder as Record<string, unknown>) : data),
        id: targetOrderId,
        __shipment_id: (data as any)?.__shipment_id ?? (data as any)?.id,
      }
    }
  }

  // 1. Find all field_mappings matching this store + event
  if (!isProduct) {
    console.info(`[SyncEngine] Querying field_mappings...`)
  }
  let mappingQuery = supabaseAdmin
    .from('field_mappings')
    .select('*')
    .or('store_id.eq.' + storeIdStr + ',merchant_id.eq.' + storeIdStr)
  // حصر الصفوف بمساحة التسليم نفسها. بدون هذا السطر تكفي صفوفة field_mappings
  // قديمة في مساحة أخرى تحمل نفس merchant id أن تخطف المزامنة كاملة: المسار
  // المضبوط يستعير من `existingMappings[0]` إعداداتها واتصال Odoo الخاص بها
  // (2026-10-18: تصنيفات متجر Salla تابعت إعدادات مساحة أخرى القديمة بينما
  // إعدادات صاحب المتجر لا تُقرأ أصلاً — والزد لا يظهر لأن لا صفوفة تطابقه).
  if (resolvedWorkspaceId) mappingQuery = mappingQuery.eq('workspace_id', resolvedWorkspaceId)
  const { data: mappingRows, error: mappingErr } = await mappingQuery

  if (!isProduct) {
    console.info(`[SyncEngine] field_mappings query: rows=${mappingRows?.length ?? 0} error=${mappingErr?.message ?? 'none'}`)
  }

  if (mappingErr) {
    console.error('[SyncEngine] Failed to fetch field_mappings:', JSON.stringify(mappingErr))
    return result
  }

  // Filter in memory by action: either matching normalizedEvent or original event,
  // and ensuring the sync direction includes 'store_to_erp' (default is 'store_to_erp')
  const filteredRows = (mappingRows || []).filter((row) => {
    const actionMatches = row.action === normalizedEvent || row.action === event
    if (!actionMatches) return false
    const direction = row.sync_direction || 'store_to_erp'
    return direction.split(',').map((s: string) => s.trim()).includes('store_to_erp')
  })

  // ── 1a. Standard Mapping FIRST (always when enabled) ────
  // الترتيب المطلوب: الستاندرد أولاً لو مفعّل، ثم الكاستوم.
  // كان السلوك السابق exclusive: لو وُجد field_mapping واحد للحدث،
  // تخطّى الـ preset تماماً ولم يسجّل الستاندرد. الآن يعمل الاثنان
  // بالترتيب: preset الستاندرد (مع حارس isEntityOperationAllowed داخله)
  // ثم كل field_mappings المطابقة. لو الستاندرد معطّل/محظور يرجع
  // processFixedMappingFallback null فلا يضيف شيئاً ويكمل الكاستوم فقط.
  const platform: 'zid' | 'salla' | 'shopify' = platformHint ?? (
    normalizedEvent.includes('shopify') ? 'shopify'
    : normalizedEvent.includes('salla') ? 'salla'
    : 'zid'
  )
  const presetKey = derivePresetKey(normalizedEvent, platform)

  if (presetKey) {
    const presetRecord = await processFixedMappingFallback(
      presetKey, event, storeIdStr, data, platform, mappingRows as FieldMappingRow[] | null,
      resolvedWorkspaceId
    )
    if (presetRecord) {
      result.records.push(presetRecord)
      result.processed += 1
      result[presetRecord.status] += 1
      if (presetRecord.status === 'failed' && !isQueueExecution) {
        try {
          const { enqueueFailedSync } = await import('./sync-queue')
          enqueueFailedSync({
            workspaceId: resolvedWorkspaceId || mappingRows?.[0]?.workspace_id || '',
            storeId: storeIdStr,
            event,
            platform: platformHint || 'zid',
            payload: data,
            errorMessage: presetRecord.message || '',
          }).catch(() => {})
        } catch { /* ignore */ }
      }
      await notifySyncForRecord(
        resolvedWorkspaceId || mappingRows?.[0]?.workspace_id,
        presetRecord,
        event,
        presetRecord.mappingName,
        presetRecord.mappingId,
        presetRecord.model,
        storeIdStr,
        presetRecord.message,
        data,
        queueItemId ? `queue:${queueItemId}` : null
      )
    }
  }

  if (filteredRows.length === 0) {
    console.info(`[SyncEngine] ===== processWebhookEvent END (standard mapping only, total=${result.processed}) =====`)
    return result
  }

  // ── 1b. Field mappings (when user-defined mappings exist) ─────────────────
  if (!isProduct) {
    console.info(`[SyncEngine] Found ${filteredRows.length} field_mapping(s) to process`)
  }

  for (const row of filteredRows as FieldMappingRow[]) {
    const record = await processSingleMapping(row, event, storeIdStr, data, 'automatic', undefined, platformHint)
    result.records.push(record)
    result.processed += 1
    result[record.status] += 1
    // Enqueue failed operations for retry
    if (record.status === 'failed' && (row.workspace_id || resolvedWorkspaceId) && !isQueueExecution) {
      try {
        const { enqueueFailedSync } = await import('./sync-queue')
        enqueueFailedSync({
          workspaceId: row.workspace_id || resolvedWorkspaceId || '',
          storeId: storeIdStr,
          event,
          platform: platformHint || 'zid',
          payload: data,
          errorMessage: record.message || '',
        }).catch(() => {})
      } catch { /* ignore queue errors */ }
    }
    await notifySyncForRecord(
      row.workspace_id || resolvedWorkspaceId,
      record,
      event,
      record.mappingName,
      record.mappingId,
      record.model,
      storeIdStr,
      record.message,
      data,
      queueItemId ? `queue:${queueItemId}` : null
    )
  }
  if (!isProduct) {
    console.info(
      `[SyncEngine] Summary: processed=${result.processed} success=${result.success} skipped=${result.skipped} failed=${result.failed}`
    )
    console.info(`[SyncEngine] ===== processWebhookEvent END =====`)
  }
  return result
}

// ─── Standard Mapping preset: runs FIRST on every webhook (when enabled) ──
// ثم تعمل field_mappings (الكاستوم) بعده بالترتيب. يرجع null لو معطّل
// عبر standard_mapping_settings (الحارس داخله) فلا يضيف شيئاً.
async function processFixedMappingFallback(
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
        const { logWebhookSkip } = await import('./webhook-skip-log')
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

  // Merge field rows from DB
  const { data: customRows } = await supabaseAdmin
    .from('fixed_mappings')
    .select('field_rows')
    .eq('workspace_id', workspaceId)
    .eq('preset_key', presetKey)
    .eq('is_preset', false)
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
        { odoo_field: 'list_price', platform_field: 'price.amount' },
        { odoo_field: 'standard_price', platform_field: 'cost_price' },
      ],
      'salla_product_update': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'default_code', platform_field: 'sku' },
        { odoo_field: 'barcode', platform_field: 'barcode' },
        { odoo_field: 'list_price', platform_field: 'price.amount' },
        { odoo_field: 'standard_price', platform_field: 'cost_price' },
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

  const { data: odooConn } = await supabaseAdmin
    .from('erp_connections')
    .select('id, url, db_name, username, password, erp_type')
    .eq('id', erpConnectionId)
    .single()

  if (!odooConn) {
    console.warn(`[FixedMapping] ERP connection ${erpConnectionId} not found`)
    return null
  }

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
  const odooValues = await buildOdooValues(client, mappingItems, zidData, fieldMeta, syncPlatform, workspaceId, storeIdStr)

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
      zidEntityId: String(zidData.id ?? zidData.category_id ?? zidData.product_id ?? zidData.customer_id ?? zidData.order_id ?? ''),
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
      zid_entity_id: String(zidData.id ?? zidData.category_id ?? zidData.product_id ?? zidData.customer_id ?? zidData.order_id ?? ''),
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

/**
 * لا توجد حقول مُهيّأة لهذا الموديل — تخطٍّ موحّد مع تسجيله في `sync_logs`.
 *
 * كان هذا الكتلة بحجم 14 حقلاً مكروراً في فرعي Odoo وERPNext من
 * `processSingleMapping`. استخراجه يمنع انحراف حمولة السجل بين المسارين.
 * `delete` لا يمرّ من هنا: الحذف لا يحتاج حقولاً.
 */
async function skipNoFieldItems(args: {
  logId?: string
  mapping: FieldMappingRow
  event: string
  storeId: string
  zidEntityId: string
  odooModel: string
  zidData: Record<string, unknown>
  triggerType: 'automatic' | 'manual'
}): Promise<SyncEngineResult['records'][number]> {
  const { logId, mapping, event, storeId, zidEntityId, odooModel, zidData, triggerType } = args
  const message = 'No field mapping items configured'
  console.warn(`[SyncEngine] No field items configured for model "${odooModel}"`)
  await logSync({
    id: logId,
    workspace_id: mapping.workspace_id,
    field_mapping_id: mapping.id,
    event,
    store_id: storeId,
    zid_entity_id: zidEntityId,
    odoo_model: odooModel,
    status: 'skipped',
    error_message: message,
    payload: zidData,
    trigger_type: triggerType,
  })
  return {
    mappingId: mapping.id,
    mappingName: mapping.name,
    model: odooModel,
    status: 'skipped',
    message,
  }
}

export async function processSingleMapping(
  mapping: FieldMappingRow,
  event: string,
  storeId: string,
  zidData: Record<string, unknown>,
  triggerType: 'automatic' | 'manual' = 'automatic',
  existingLogId?: string,
  platformHint?: 'zid' | 'salla' | 'shopify'
): Promise<SyncEngineResult['records'][number]> {
  const zidEntityId = String(
    zidData.id ??
    zidData.category_id ??
    zidData.category_uuid ??
    zidData.customer_id ??
    zidData.order_id ??
    ''
  )
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

  if (!logId && zidEntityId && event) {
    try {
      const tenSecondsAgo = new Date(Date.now() - 10000).toISOString()
      const { data: recentLog } = await supabaseAdmin
        .from('sync_logs')
        .select('id')
        .eq('workspace_id', mapping.workspace_id)
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
        .maybeSingle()

      if (!currentLog || !['success', 'failed'].includes(currentLog.status)) {
        await supabaseAdmin.from('sync_logs').update(logData).eq('id', logId)
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

  if (mapping.erp_connection_id) {
    const { data: conn, error: connErr } = await supabaseAdmin
      .from('erp_connections')
      .select('id, url, db_name, username, password, erp_type')
      .eq('id', mapping.erp_connection_id)
      .maybeSingle()
    console.info(`[SyncEngine] erp_connection by id: found=${!!conn} error=${connErr?.message ?? 'none'}`)
    odooConn = conn as any
  }

  if (!odooConn && mapping.workspace_id) {
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
    const decryptedPassword = decrypt(odooConn.password)
    const client = new ErpNextClient({
      url: odooConn.url,
      username: odooConn.username,
      apiKey: decryptedPassword,
    })

    const mappingItems: FieldMappingItem[] = mapping.mappings?.[odooModel] ?? []
    if (mappingItems.length === 0 && odooOperation !== 'delete') {
      return skipNoFieldItems({ logId, mapping, event, storeId, zidEntityId, odooModel, zidData, triggerType })
    }

    const erpFieldNames = mappingItems.map(m => m.erpField)
    const fieldMeta = await fetchErpNextFieldMeta(client, odooModel, erpFieldNames)

    platform = (platformHint && platformHint !== 'shopify' ? platformHint : getPlatformFromEvent(event)) as 'zid' | 'salla' | 'shopify'
    const erpValues = await buildErpNextValues(client, mappingItems, zidData, fieldMeta, platform as 'zid' | 'salla')

    if (Object.keys(erpValues).length === 0 && odooOperation !== 'delete') {
      console.warn(`[SyncEngine] No values extracted from Zid data for mapping "${mapping.name}"`)
      await logSync({ id: logId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: 'All mapped Zid fields were empty or missing', payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: 'All mapped Zid fields were empty or missing' }
    }

    console.info(`[SyncEngine] Values to send to ERPNext:`, JSON.stringify(erpValues, null, 2))

    try {
      return await executeErpNextOperation({
        client,
        mapping,
        event,
        storeId,
        zidEntityId,
        zidData,
        docType: odooModel,
        operation: odooOperation,
        values: erpValues,
        triggerType,
        existingLogId: logId,
      })
    } catch (err: any) {
      const errMsg = err?.message ?? String(err)
      console.error(`[SyncEngine] ❌ Failed to ${odooOperation} ${odooModel} in ERPNext:`, errMsg)
      await logSync({ id: logId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'failed', error_message: errMsg, payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'failed', message: errMsg }
    }
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
  const odooValues = await buildOdooValues(client, mappingItems, zidData, fieldMeta, platform, mapping.workspace_id, storeId)

  // ——— 5a. If this is sale.order, build order_line items with discount/shipping —
  if (odooModel === 'sale.order') {
    // Load standard mapping settings once (avoid duplicate DB query inside buildOrderLineItems)
    let orderStdSettings: Record<string, any> | null = null
    if (mapping.workspace_id && platform) {
      try {
        orderStdSettings = await getCachedStandardMappingSettings(mapping.workspace_id, platform, 'orders', storeId || mapping.merchant_id || '')
      } catch (err) {
        console.warn('[SyncEngine] Failed to load standard mapping settings for order line fallbacks:', err)
      }
    }
    try {
      const orderLines = await buildOrderLineItems(
        client,
        mapping,
        zidData,
        fieldMeta,
        odooValues,
        platform,
        orderStdSettings,
        storeId
      )
      if (orderLines.length > 0) {
        odooValues['order_line'] = orderLines.map(item => [0, 0, item])
      }
    } catch (lineErr: any) {
      if (lineErr?.isOrderSkipped) {
        const skipMsg = lineErr.message
        console.warn(`[SyncEngine] ${skipMsg}`)
        await logSync({ id: logId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: skipMsg, payload: zidData, trigger_type: triggerType })
        return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: skipMsg }
      }
      throw lineErr
    }
  }

  if (Object.keys(odooValues).length === 0 && odooOperation !== 'delete' && odooOperation !== 'cancel' && odooOperation !== 'deliver') {
    console.warn(`[SyncEngine] No values extracted from Zid data for mapping "${mapping.name}"`)
    await logSync({ id: logId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: 'All mapped Zid fields were empty or missing', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: 'All mapped Zid fields were empty or missing' }
  }

  console.info(`[SyncEngine] Values to send to Odoo:`, JSON.stringify(odooValues, null, 2))

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

/**
 * Persist the store-side unique ID (x_zid_id / x_salla_id / x_shopify_id, with
 * the legacy zid_id/salla_id/shopify_id fallback) on a freshly created Odoo record.
 * This gives future webhooks a stable match key independent of sync_logs or SKU.
 */
async function persistPlatformIdOnRecord(
  client: OdooClient,
  model: string,
  recordId: number,
  platform: 'zid' | 'salla' | 'shopify',
  idValue: string
) {
  if (!idValue) return
  const [platformIdFieldName, legacyIdFieldName] = platformIdFieldNames(platform)
  try {
    const candidateFields = [platformIdFieldName, legacyIdFieldName]
    if (platform === 'zid') candidateFields.push('x_zid_id_product')
    const meta = await fetchFieldMeta(client, model, candidateFields)
    let idField = pickExistingIdField(meta, platform)
    if (!idField && platform === 'zid' && meta.has('x_zid_id_product')) {
      idField = 'x_zid_id_product'
    }
    // Stage 1: current-then-legacy resolution, shared with the relation lookup.
    if (idField) {
      await client.write(model, [recordId], { [idField]: idValue })
      console.info(`[SyncEngine] ✅ Stored ${idField}="${idValue}" on ${model} #${recordId}`)
    }
  } catch (err: any) {
    console.warn(`[SyncEngine] Failed to persist ${platformIdFieldName} on ${model} #${recordId}:`, err?.message || err)
  }
}

async function syncAsSeparateProducts(
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
  defaultLocationId?: number,
  infiniteValue?: number,
  fixedMatch?: { odoo_field: string; zid_field: string },
  priceSettings?: { markup_percent: number; rounding: string; decimal_places: number }
): Promise<SyncEngineResult['records'][number]> {
  console.info(`[SyncEngine] 📦 مزامنة ${variants.length} متغيرات كمنتجات منفصلة في أودو.`)

  const mainProductName = toNameString(zidData.name || odooValues.name)
  const results: number[] = []

  // Also create/update the main product template itself (not just the variants)
  const mainDuplicateId = await findExistingOdooRecord(client, 'product.template', zidData, odooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, platform)
  let mainRecordId: number | null = null
  if (mainDuplicateId !== null) {
    console.info(`[SyncEngine] 🔄 المنتج الرئيسي موجود بالفعل (ID: #${mainDuplicateId}). جاري تحديث البيانات...`)
    await client.write('product.template', [mainDuplicateId], odooValues)
    mainRecordId = mainDuplicateId
  } else {
    console.info(`[SyncEngine] ➕ جاري إنشاء المنتج الرئيسي "${mainProductName}" في أودو...`)
    mainRecordId = await client.create('product.template', odooValues)
    if (zidData.id) {
      await persistPlatformIdOnRecord(client, 'product.template', mainRecordId, platform, String(zidData.id))
    }
  }
  results.push(mainRecordId)

  for (const variant of variants) {
    const attributeValues = Object.values(variant.attributes)
    // Include the variant's attributes in the product name (e.g., "T-Shirt - Red - Large")
    const variantName = attributeValues.length > 0 
      ? `${mainProductName} - ${attributeValues.join(' - ')}` 
      : mainProductName

    const variantOdooValues: Record<string, any> = {
      ...odooValues,
      name: variantName,
      default_code: variant.sku || undefined,
    }

    if (variant.barcode) {
      variantOdooValues.barcode = variant.barcode
    }
    if (variant.cost !== undefined && variant.cost > 0) {
      variantOdooValues.standard_price = variant.cost
    }
    if (variant.weight !== undefined && variant.weight > 0) {
      variantOdooValues.weight = variant.weight
    }
    if (variant.description) {
      variantOdooValues.description_sale = variant.description
    }
    let variantPrice = variant.price
    if (variantPrice > 0 && priceSettings) {
      if (priceSettings.markup_percent !== 0) {
        variantPrice = variantPrice * (1 + priceSettings.markup_percent / 100)
      }
      if (priceSettings.rounding && priceSettings.decimal_places !== undefined) {
        const factor = Math.pow(10, priceSettings.decimal_places)
        if (priceSettings.rounding === 'nearest') variantPrice = Math.round(variantPrice * factor) / factor
        else if (priceSettings.rounding === 'ceil') variantPrice = Math.ceil(variantPrice * factor) / factor
        else if (priceSettings.rounding === 'floor') variantPrice = Math.floor(variantPrice * factor) / factor
      }
    }
    if (variantPrice > 0) {
      variantOdooValues.list_price = variantPrice
    }

    // Resolve variant image
    if (variant.image) {
      const imgBase64 = await resolveBinaryField(variant.image).catch(() => null)
      if (imgBase64) variantOdooValues.image_1920 = imgBase64
    }

    // Check if this specific variant already exists in Odoo
    const variantMockData = {
      ...zidData,
      id: variant.id,
      sku: variant.sku,
      barcode: variant.barcode
    }
    const duplicateId = await findExistingOdooRecord(client, 'product.template', variantMockData, variantOdooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, platform)

    let recordId: number
    if (duplicateId !== null) {
      await client.write('product.template', [duplicateId], variantOdooValues)
      recordId = duplicateId
    } else {
      console.info(`[SyncEngine] ➕ جاري إنشاء متغير كمنتج منفصل "${variantName}" في أودو...`)
      recordId = await client.create('product.template', variantOdooValues)
      if (variant.id) {
        await persistPlatformIdOnRecord(client, 'product.template', recordId, platform, String(variant.id))
      }
    }

    // Trigger stock/inventory update if quantity is provided
    if (variant.quantity !== undefined) {
      await updateOdooStock(client, recordId, variant.quantity, defaultLocationId, infiniteValue, mapping.workspace_id).catch(err => {
        console.warn(`[SyncEngine] Failed to update stock for standalone variant #${recordId}:`, err)
      })
    }

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

async function syncAsVariants(
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
  defaultLocationId?: number,
  infiniteValue?: number,
  fixedMatch?: { odoo_field: string; zid_field: string },
  priceSettings?: { markup_percent: number; rounding: string; decimal_places: number },
  mergedSettings?: Record<string, any>
): Promise<SyncEngineResult['records'][number]> {
  console.info(`[SyncEngine] 📦 مزامنة ${variants.length} متغيرات تحت منتج رئيسي واحد في أودو.`)

  // Step 1: Create or update the main product.template
  const duplicateId = await findExistingOdooRecord(client, 'product.template', zidData, odooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, platform)
  
  let templateId: number
  if (duplicateId !== null) {
    console.info(`[SyncEngine] 🔄 المنتج الرئيسي موجود بالفعل (ID: #${duplicateId}). جاري تحديث البيانات...`)
    await client.write('product.template', [duplicateId], odooValues)
    templateId = duplicateId
  } else {
    console.info(`[SyncEngine] ➕ جاري إنشاء المنتج الرئيسي في أودو...`)
    templateId = await client.create('product.template', odooValues)
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
    await syncProductBom(client, templateId, zidData, mergedSettings, platform, mapping.workspace_id).catch(err => {
      console.warn(`[SyncEngine] Failed to sync BoM in syncAsVariants:`, err)
    })
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
  const existingLines = await client.searchRead<any>('product.template.attribute.line', [
    ['product_tmpl_id', '=', templateId]
  ], ['attribute_id', 'value_ids'])

  for (const [attrName, attrId] of Object.entries(attributeIdMap)) {
    const desiredValueIds = Object.values(valueIdMap[attrName])
    const existingLine = existingLines.find((line: any) => {
      const lineAttrId = Array.isArray(line.attribute_id) ? line.attribute_id[0] : line.attribute_id
      return lineAttrId === attrId
    })

    if (existingLine) {
      const existingValIds = existingLine.value_ids || []
      const unionValIds = Array.from(new Set([...existingValIds, ...desiredValueIds]))
      await client.write('product.template.attribute.line', [existingLine.id], {
        value_ids: [[6, 0, unionValIds]]
      })
      console.info(`[SyncEngine] Updated product.template.attribute.line #${existingLine.id} with values: [${unionValIds.join(', ')}]`)
    } else {
      const lineId = await client.create('product.template.attribute.line', {
        product_tmpl_id: templateId,
        attribute_id: attrId,
        value_ids: [[6, 0, desiredValueIds]]
      })
      console.info(`[SyncEngine] Created new product.template.attribute.line #${lineId} for attribute "${attrName}"`)
    }
  }

  // Step 4: Force Odoo to generate product.product variants by writing
  // attribute_line_ids back to the template via One2many replace.
  // This triggers Odoo's internal _create_variant_ids hook.
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

  // Step 5: Fetch auto-generated product.product variants linked to the template
  console.info(`[SyncEngine] Fetching generated product.product records for template #${templateId}...`)
  const generatedVariants = await client.searchRead<any>('product.product', [
    ['product_tmpl_id', '=', templateId]
  ], ['id', 'product_template_attribute_value_ids', 'default_code', 'barcode'])

  const ptavs = await client.searchRead<any>('product.template.attribute.value', [
    ['product_tmpl_id', '=', templateId]
  ], ['attribute_id', 'product_attribute_value_id', 'name'])

  const ptavMap: Record<string, { attribute: string; value: string }> = {}
  for (const ptav of ptavs) {
    const attrName = Array.isArray(ptav.attribute_id) ? ptav.attribute_id[1] : ''
    let valName = Array.isArray(ptav.product_attribute_value_id) ? ptav.product_attribute_value_id[1] : ptav.name
    if (valName && attrName) {
      const prefix = attrName.toLowerCase() + ': '
      if (valName.toLowerCase().startsWith(prefix)) {
        valName = valName.substring(prefix.length)
      }
    }
    ptavMap[ptav.id] = { attribute: attrName, value: valName }
  }

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
    if (keys1.length !== keys2.length) return false
    return keys1.every(k => {
      const v1 = String(attrs1[k] ?? '').trim().toLowerCase()
      const keyMatch = keys2.find(k2 => k2.trim().toLowerCase() === k.trim().toLowerCase())
      if (!keyMatch) return false
      return v1 === String(attrs2[keyMatch] ?? '').trim().toLowerCase()
    })
  }

  const settings = (mapping.mappings as any)?.__settings || {}
  const varOdooField = (mapping as any).variant_odoo_match_field || settings.variantOdooMatchField || ''
  const varZidField = (mapping as any).variant_zid_match_field || settings.variantZidMatchField || ''

  // Step 6: Variant Update (Update matching product.product records)
  let updatedCount = 0
  for (const variant of variants) {
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
      console.info(`[SyncEngine] Matched webhook variant (SKU: ${variant.sku}) to Odoo product.product #${matchingOdooVar.id}`)
      
      const updatePayload: Record<string, any> = {
        default_code: variant.sku || matchingOdooVar.default_code
      }
      if (variant.barcode) {
        updatePayload.barcode = variant.barcode
      }
      let variantPrice = variant.price
      if (variantPrice > 0 && priceSettings) {
        if (priceSettings.markup_percent !== 0) {
          variantPrice = variantPrice * (1 + priceSettings.markup_percent / 100)
        }
        if (priceSettings.rounding && priceSettings.decimal_places !== undefined) {
          const factor = Math.pow(10, priceSettings.decimal_places)
          if (priceSettings.rounding === 'nearest') variantPrice = Math.round(variantPrice * factor) / factor
          else if (priceSettings.rounding === 'ceil') variantPrice = Math.ceil(variantPrice * factor) / factor
          else if (priceSettings.rounding === 'floor') variantPrice = Math.floor(variantPrice * factor) / factor
        }
      }
      if (variantPrice > 0) {
        updatePayload.list_price = variantPrice
      }
      if (variant.cost !== undefined && variant.cost > 0) {
        updatePayload.standard_price = variant.cost
      }
      if (variant.weight !== undefined && variant.weight > 0) {
        updatePayload.weight = variant.weight
      }
      if (variant.description) {
        updatePayload.description_sale = variant.description
      }

      if (variant.image) {
        const imgBase64 = await resolveBinaryField(variant.image).catch(() => null)
        if (imgBase64) updatePayload.image_variant_1920 = imgBase64
      }

      await client.write('product.product', [matchingOdooVar.id], updatePayload)

      if (variant.quantity !== undefined) {
        await updateOdooStock(client, matchingOdooVar.id, variant.quantity, defaultLocationId, infiniteValue, mapping.workspace_id).catch(err => {
          console.warn(`[SyncEngine] Failed to update stock for variant product #${matchingOdooVar.id}:`, err)
        })
      }
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

        const createVariantPayload: Record<string, any> = {
          product_tmpl_id: templateId,
          name: `${toNameString(zidData.name || odooValues.name)} - ${Object.values(variant.attributes).join(' / ')}`,
          default_code: variant.sku || undefined,
        }
        if (matchedPtavIds.length > 0) {
          createVariantPayload.product_template_attribute_value_ids = [[6, 0, matchedPtavIds]]
        }
        if (variant.barcode) {
          createVariantPayload.barcode = variant.barcode
        }
        if (variant.price > 0) {
          createVariantPayload.list_price = variant.price
        }
        if (variant.cost !== undefined && variant.cost > 0) {
          createVariantPayload.standard_price = variant.cost
        }
        if (variant.weight !== undefined && variant.weight > 0) {
          createVariantPayload.weight = variant.weight
        }
        if (variant.description) {
          createVariantPayload.description_sale = variant.description
        }
        const createdVarId = await client.create('product.product', createVariantPayload)
        console.info(`[SyncEngine] Created missing Odoo variant product.product #${createdVarId} under template #${templateId}`)
        if (variant.quantity !== undefined) {
          await updateOdooStock(client, createdVarId, variant.quantity, defaultLocationId, infiniteValue, mapping.workspace_id).catch(() => {})
        }
        updatedCount++
      } catch (createErr: any) {
        console.warn(`[SyncEngine] Failed to create missing Odoo variant for ${JSON.stringify(variant.attributes)}: ${createErr?.message ?? createErr}`)
      }
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

async function syncChildVariantAsVariant(
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
  defaultLocationId?: number,
  infiniteValue?: number,
  priceSettings?: { markup_percent: number; rounding: string; decimal_places: number },
  fixedMatch?: { odoo_field: string; zid_field: string }
): Promise<SyncEngineResult['records'][number]> {
  const parentZidId = zidData.parent_id || (zidData.parent as any)?.id
  console.info(`[SyncEngine] Intercepted Zid child variant webhook (ID: ${zidEntityId}, Parent ID: ${parentZidId}).`)

  if (!parentZidId) {
    throw new Error(`Could not resolve parent product ID for child variant ${zidEntityId}`)
  }

  let parentIds: number[] = []
  if (fixedMatch?.odoo_field) {
    parentIds = await client.search('product.template', [[fixedMatch.odoo_field, '=', String(parentZidId)]], 1)
  } else {
    // Field names come from the shared table, but the fallback stays
    // exception-driven on purpose: an empty result here does NOT retry the
    // legacy column, only a thrown error does (missing column in Odoo).
    const searchField = platformIdField(platform)
    try {
      parentIds = await client.search('product.template', [[searchField, '=', String(parentZidId)]], 1)
    } catch {
      const fallbackField = platformLegacyIdField(platform)
      try {
        parentIds = await client.search('product.template', [[fallbackField, '=', String(parentZidId)]], 1)
      } catch {
        // Leave parentIds empty
      }
    }
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
    const skipMsg = `Parent product template (Zid ID: ${parentZidId}) not found in Odoo yet. Skipping child variant sync.`
    console.warn(`[SyncEngine] ${skipMsg}`)
    await logSync({
      id: existingLogId,
      workspace_id: mapping.workspace_id,
      field_mapping_id: mapping.id,
      event,
      store_id: storeId,
      zid_entity_id: zidEntityId,
      odoo_model: 'product.product',
      status: 'skipped',
      error_message: skipMsg,
      payload: zidData,
      trigger_type: triggerType
    })
    return {
      mappingId: mapping.id,
      mappingName: mapping.name,
      model: 'product.product',
      status: 'skipped',
      message: skipMsg
    }
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

  const existingLines = await client.searchRead<any>('product.template.attribute.line', [
    ['product_tmpl_id', '=', templateId]
  ], ['attribute_id', 'value_ids'])

  for (const [attrName, attrId] of Object.entries(attributeIdMap)) {
    const desiredValId = valueIdMap[attrName]
    const existingLine = existingLines.find((line: any) => {
      const lineAttrId = Array.isArray(line.attribute_id) ? line.attribute_id[0] : line.attribute_id
      return lineAttrId === attrId
    })

    if (existingLine) {
      const existingValIds = existingLine.value_ids || []
      if (!existingValIds.includes(desiredValId)) {
        const unionValIds = Array.from(new Set([...existingValIds, desiredValId]))
        await client.write('product.template.attribute.line', [existingLine.id], {
          value_ids: [[6, 0, unionValIds]]
        })
      }
    } else {
      await client.create('product.template.attribute.line', {
        product_tmpl_id: templateId,
        attribute_id: attrId,
        value_ids: [[6, 0, [desiredValId]]]
      })
    }
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

  const generatedVariants = await client.searchRead<any>('product.product', [
    ['product_tmpl_id', '=', templateId]
  ], ['id', 'product_template_attribute_value_ids', 'default_code', 'barcode'])

  const ptavs = await client.searchRead<any>('product.template.attribute.value', [
    ['product_tmpl_id', '=', templateId]
  ], ['attribute_id', 'product_attribute_value_id', 'name'])

  const ptavMap: Record<string, { attribute: string; value: string }> = {}
  for (const ptav of ptavs) {
    const attrName = Array.isArray(ptav.attribute_id) ? ptav.attribute_id[1] : ''
    let valName = Array.isArray(ptav.product_attribute_value_id) ? ptav.product_attribute_value_id[1] : ptav.name
    if (valName && attrName) {
      const prefix = attrName.toLowerCase() + ': '
      if (valName.toLowerCase().startsWith(prefix)) {
        valName = valName.substring(prefix.length)
      }
    }
    ptavMap[ptav.id] = { attribute: attrName, value: valName }
  }

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
    if (keys1.length !== keys2.length) return false
    return keys1.every(k => {
      const v1 = attrs1[k]
      const keyMatch = keys2.find(k2 => k2.toLowerCase() === k.toLowerCase())
      if (!keyMatch) return false
      return v1.toLowerCase() === attrs2[keyMatch].toLowerCase()
    })
  }

  const settings = (mapping.mappings as any)?.__settings || {}
  const varOdooField = (mapping as any).variant_odoo_match_field || settings.variantOdooMatchField || ''
  const varZidField = (mapping as any).variant_zid_match_field || settings.variantZidMatchField || ''

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
    const costVal = parseFloat(String(zidData.cost || zidData.cost_price || '0')) || 0
    const rawWeight = zidData.weight
    let weightVal = 0
    if (typeof rawWeight === 'object' && rawWeight !== null) {
      weightVal = parseFloat((rawWeight as any).value || (rawWeight as any).weight || '0') || 0
    } else {
      weightVal = parseFloat(String(rawWeight || '0')) || 0
    }
    const descVal = toNameString(zidData.description || zidData.short_description || '')

    const updatePayload: Record<string, any> = {
      default_code: zidData.sku || zidData.default_code || zidData.sku_code || matchingOdooVar.default_code
    }
    if (zidData.barcode) {
      updatePayload.barcode = zidData.barcode
    }
    let priceVal = parseFloat(String(zidData.price || zidData.sale_price || '0'))
    if (priceVal > 0 && priceSettings) {
      if (priceSettings.markup_percent !== 0) {
        priceVal = priceVal * (1 + priceSettings.markup_percent / 100)
      }
      if (priceSettings.rounding && priceSettings.decimal_places !== undefined) {
        const factor = Math.pow(10, priceSettings.decimal_places)
        if (priceSettings.rounding === 'nearest') priceVal = Math.round(priceVal * factor) / factor
        else if (priceSettings.rounding === 'ceil') priceVal = Math.ceil(priceVal * factor) / factor
        else if (priceSettings.rounding === 'floor') priceVal = Math.floor(priceVal * factor) / factor
      }
    }
    if (priceVal > 0) {
      updatePayload.list_price = priceVal
    }
    if (costVal > 0) {
      updatePayload.standard_price = costVal
    }
    if (weightVal > 0) {
      updatePayload.weight = weightVal
    }
    if (descVal) {
      updatePayload.description_sale = descVal
    }

    // Resolve variant image from zidData
    const variantImgUrl = (zidData as any).image?.src || (zidData as any).main_image || (zidData as any).image_url
      || (Array.isArray((zidData as any).images) ? (zidData as any).images[0]?.url : null) || ''
    if (variantImgUrl) {
      const imgBase64 = await resolveBinaryField(variantImgUrl).catch(() => null)
      if (imgBase64) updatePayload.image_variant_1920 = imgBase64
    }

    await client.write('product.product', [matchingOdooVar.id], updatePayload)

    const qtyVal = zidData.quantity !== undefined ? Number(zidData.quantity) : (zidData.stock_quantity !== undefined ? Number(zidData.stock_quantity) : (zidData.qty !== undefined ? Number(zidData.qty) : undefined))
    if (qtyVal !== undefined && !isNaN(qtyVal)) {
      await updateOdooStock(client, matchingOdooVar.id, qtyVal, defaultLocationId, infiniteValue, mapping.workspace_id).catch(err => {
        console.warn(`[SyncEngine] Failed to update stock for variant product #${matchingOdooVar.id}:`, err)
      })
    }

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
    const createVariantPayload: Record<string, any> = {
      product_tmpl_id: templateId,
      name: toNameString(zidData.name) || `Variant #${zidEntityId}`,
      default_code: zidData.sku || undefined,
    }
    if (zidData.barcode) {
      createVariantPayload.barcode = zidData.barcode
    }
    const createCostVal = parseFloat(String(zidData.cost || zidData.cost_price || '0')) || 0
    const createRawWeight = zidData.weight
    let createWeightVal = 0
    if (typeof createRawWeight === 'object' && createRawWeight !== null) {
      createWeightVal = parseFloat((createRawWeight as any).value || (createRawWeight as any).weight || '0') || 0
    } else {
      createWeightVal = parseFloat(String(createRawWeight || '0')) || 0
    }
    const createDescVal = toNameString(zidData.description || zidData.short_description || '')
    const createPriceVal = parseFloat(String(zidData.price || zidData.sale_price || '0'))
    if (createPriceVal > 0) {
      createVariantPayload.list_price = createPriceVal
    }
    if (createCostVal > 0) {
      createVariantPayload.standard_price = createCostVal
    }
    if (createWeightVal > 0) {
      createVariantPayload.weight = createWeightVal
    }
    if (createDescVal) {
      createVariantPayload.description_sale = createDescVal
    }
    const createVariantImgUrl = (zidData as any).image?.src || (zidData as any).main_image || (zidData as any).image_url
      || (Array.isArray((zidData as any).images) ? (zidData as any).images[0]?.url : null) || ''
    if (createVariantImgUrl) {
      const imgBase64 = await resolveBinaryField(createVariantImgUrl).catch(() => null)
      if (imgBase64) createVariantPayload.image_variant_1920 = imgBase64
    }

    let createdVarId: number | null = null
    try {
      createdVarId = await client.create('product.product', createVariantPayload)
      console.info(`[SyncEngine] Created missing Odoo variant product.product #${createdVarId} under parent template #${templateId}`)
      const createQtyVal = zidData.quantity !== undefined ? Number(zidData.quantity)
        : (zidData.stock_quantity !== undefined ? Number(zidData.stock_quantity)
        : (zidData.qty !== undefined ? Number(zidData.qty) : undefined))
      if (createQtyVal !== undefined && !isNaN(createQtyVal)) {
        await updateOdooStock(client, createdVarId, createQtyVal, defaultLocationId, infiniteValue, mapping.workspace_id).catch(() => {})
      }
    } catch (createErr: any) {
      console.warn(`[SyncEngine] Failed to create missing child Odoo variant: ${createErr?.message ?? createErr}`)
    }

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

function readNonEmptyString(...values: unknown[]): string {
  for (const v of values) {
    if (v === undefined || v === null) continue
    const s = String(v).trim()
    if (s && s !== 'None' && s !== 'null' && s !== 'undefined') return s
  }
  return ''
}

/**
 * Auto-inject company/tax fields from the platform payload onto a res.partner
 * write, so tax number (الرقم الضريبي) + commercial registry (السجل التجاري)
 * always reach Odoo even when the workspace has no mapping row for them.
 * Explicitly-mapped values win — this only fills gaps.
 */
function injectCustomerCompanyFields(
  odooValues: Record<string, unknown>,
  zidData: Record<string, unknown>
): Record<string, unknown> {
  const values = { ...odooValues }
  const taxNumber = readNonEmptyString(zidData.tax_number, zidData.vat, zidData.tax_id, zidData.vat_number)
  const commercialReg = readNonEmptyString(
    zidData.commercial_registration,
    zidData.cr_number,
    zidData.commercial_registration_number,
    zidData.company_registry
  )
  const businessName = readNonEmptyString(zidData.business_name, zidData.company_name)

  if (taxNumber && values.vat === undefined) values.vat = taxNumber
  if (commercialReg && values.company_registry === undefined) values.company_registry = commercialReg
  if (businessName && values.company_name === undefined) values.company_name = businessName

  const isCompany = !!taxNumber || !!commercialReg || !!businessName
  if (isCompany && values.company_type === undefined) {
    values.company_type = 'company'
  }
  return values
}

async function executeOdooOperation(params: {
  client: OdooClient
  mapping: FieldMappingRow
  event: string
  storeId: string
  zidEntityId: string
  zidData: Record<string, unknown>
  odooModel: string
  odooOperation: OdooOperation
  odooValues: Record<string, unknown>
  presetKey: string | null
  triggerType?: 'automatic' | 'manual'
  existingLogId?: string
  platformHint?: 'zid' | 'salla' | 'shopify'
}): Promise<SyncEngineResult['records'][number]> {
  const {
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
    existingLogId,
    platformHint,
  } = params

  // ─── Merge settings for the Odoo model (product.template, res.partner, sale.order, product.category) ──
  let mergedSettings: Record<string, any> = {}
  let effectiveOdooValues = odooValues
  const inlineSettings: Record<string, any> = (mapping.mappings as any)?.['__settings'] ?? {}
  let ms = inlineSettings
  if (presetKey && mapping.workspace_id) {
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
    const returnSettings = normalizeReturnSettings((mergedSettings as any)?.order?.returns)
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

      let remaining: { known: boolean; lines: StoreReturnLine[] } | undefined
      if (execPlatform === 'zid') {
        const injected = (zidData as any).__returnRemaining
        if (injected && typeof injected.known === 'boolean') {
          remaining = injected
        } else {
          try {
            let tokenRow: any = null
            const { data: byStore } = await supabaseAdmin
              .from('merchant_tokens')
              .select('*')
              .or(`store_id.eq.${storeId},merchant_id.eq.${storeId}`)
              .maybeSingle()
            tokenRow = byStore
            if (!tokenRow && mapping.workspace_id) {
              const { data: byWs } = await supabaseAdmin
                .from('merchant_tokens')
                .select('*')
                .eq('workspace_id', mapping.workspace_id)
                .maybeSingle()
              tokenRow = byWs
            }
            if (tokenRow) {
              const { getAccessToken } = await import('./zid/token')
              const storedTokens = await getAccessToken(tokenRow.merchant_id)
              remaining = await fetchZidReturnState(
                {
                  authorization: storedTokens.authorization || '',
                  managerToken: storedTokens.accessToken,
                  storeId: tokenRow.store_id || tokenRow.merchant_id,
                },
                returnOrderId
              )
            }
          } catch (err: any) {
            console.warn(
              `[Returns] Failed to read Zid view-for-return for order ${returnOrderId}:`,
              err?.message ?? err
            )
          }
        }
      }

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
        remaining,
        autoConfirm: Boolean((mergedSettings as any)?.order?.auto_confirm),
      })

      if (outcome.handled && outcome.status !== 'skipped') {
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
          status: outcome.status,
          error_message: outcome.status === 'failed' ? outcome.message : null,
          payload: zidData,
          trigger_type: triggerType,
          platform: execPlatform,
        })
        return {
          mappingId: mapping.id,
          mappingName: mapping.name,
          model: 'sale.order',
          status: outcome.status,
          odooRecordId: outcome.odooRecordId,
          message: outcome.message,
        }
      }
      if (outcome.handled) {
        console.info(`[Returns] ${execPlatform} order ${returnOrderId}: ${outcome.message} (continuing with normal sync)`)
        if (outcome.message.startsWith('nothing_to_return') || outcome.message.startsWith('already_applied')) {
          return {
            mappingId: mapping.id,
            mappingName: mapping.name,
            model: 'sale.order',
            status: 'success',
            odooRecordId: outcome.odooRecordId,
            message: outcome.message,
          }
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

  // Inject configured match field values for create/update operations
  if (fixedMatch?.odoo_field && fixedMatch?.zid_field && (odooOperation === 'create' || odooOperation === 'update')) {
    const matchVal = resolveZidMatchValue(zidData, fixedMatch.zid_field)
    if (matchVal !== undefined && matchVal !== null && matchVal !== '') {
      const odooField = fixedMatch.odoo_field
      const numVal = Number(matchVal)
      
      // Inject into effectiveOdooValues and odooValues
      effectiveOdooValues = {
        ...effectiveOdooValues,
        [odooField]: (odooField === 'id' || (Number.isInteger(numVal) && numVal > 0)) ? numVal : String(matchVal)
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
  const defaultLocationId = (mergedSettings)?.inventory?.default_location_id ?? undefined
  const skipDuplicateCheck = (mergedSettings)?.matching?.action === 'create_duplicate'
  const infiniteValue = (mergedSettings)?.stock?.infinite_value
  const pSettings = (mergedSettings)?.price
    ? { markup_percent: (mergedSettings).price.markup_percent || 0, rounding: (mergedSettings).price.rounding || 'nearest', decimal_places: (mergedSettings).price.decimal_places ?? 2 }
    : undefined

  if (odooModel === 'product.template' && (odooOperation === 'create' || odooOperation === 'update')) {
    const ev = event.toLowerCase()
    const platform: 'zid' | 'salla' | 'shopify' = ev.startsWith('shopify:') || ev.includes('shopify') ? 'shopify'
      : ev.endsWith('.created') || ev.endsWith('.updated') || ev.includes('salla') ? 'salla'
      : 'zid'
    const variantSyncMode = (mergedSettings)?.variant?.sync_mode || (mapping as any).variant_sync_mode || 'AS_VARIANTS'
    const companyName = (mergedSettings)?.company_id ? `المعرف ${(mergedSettings).company_id}` : 'الافتراضية'
    console.info(`[SyncEngine] ⚙️ إعدادات تسجيل المنتج في أودو: [الشركة: ${companyName}] | [طريقة المزامنة للمتغيرات: ${variantSyncMode}]`)
    console.info(`[SyncEngine] ⏳ محاولة التسجيل في أودو للموديل: ${odooModel} (العملية: ${odooOperation})...`)

    // Apply fixed mapping settings to values (type, sale_ok, price, warehouse, etc.)
    const majorVersion = await client.getMajorVersion().catch(() => 17)
    effectiveOdooValues = await applyFixedSettingsToValues(odooValues, mergedSettings, zidData, majorVersion, mapping.workspace_id, platform, odooModel)

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
      return await syncChildVariantAsVariant(
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
        fixedMatch
      )
    }

    if (isChild && variantSyncMode === 'AS_SEPARATE_PRODUCTS') {
      // Zid child products (structure='child') are already included in the parent's
      // variants array, which syncAsSeparateProducts handles as standalone templates.
      // Processing the child event through the generic path would create a duplicate template.
      const childSkipMsg = `Skipping Zid child product (ID: ${zidEntityId}, Parent: ${String(zidData.parent_id || (zidData.parent as any)?.id)}): variants are synced as separate products via the parent's variants array.`
      console.info(`[SyncEngine] ${childSkipMsg}`)
      await logSync({
        id: existingLogId,
        workspace_id: mapping.workspace_id,
        field_mapping_id: mapping.id,
        event,
        store_id: storeId,
        zid_entity_id: zidEntityId,
        odoo_model: 'product.template',
        status: 'skipped',
        error_message: childSkipMsg,
        payload: zidData,
        trigger_type: triggerType
      })
      return {
        mappingId: mapping.id,
        mappingName: mapping.name,
        model: 'product.template',
        status: 'skipped',
        message: childSkipMsg
      }
    }

    const variants = extractGenericVariants(zidData, platform)
    if (variants.length > 0) {

      if (variantSyncMode === 'AS_SEPARATE_PRODUCTS') {
        return await syncAsSeparateProducts(
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
          pSettings
        )
      } else {
        return await syncAsVariants(
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
        )
      }
    }
  }

  // ── Category-specific settings (product.category) ──────────────────────────
  if (odooModel === 'product.category' && (odooOperation === 'create' || odooOperation === 'update')) {
    const catEv = event.toLowerCase()
    const catPlatform: 'zid' | 'salla' | 'shopify' = platformHint ?? (
      catEv.startsWith('shopify:') || catEv.includes('shopify') ? 'shopify'
      : catEv.includes('salla') ? 'salla'
      : 'zid'
    )
    // ── Merge per-category overrides from category_mappings ─────
    const catOverride = mapping.workspace_id ? await applyCategoryMappingOverrides(mapping.workspace_id, catPlatform, zidData, mapping.merchant_id || '') : {}
    if (Object.keys(catOverride).length > 0) {
      mergedSettings = {
        ...mergedSettings,
        ...catOverride,
        inventory_valuation: {
          ...(typeof mergedSettings.inventory_valuation === 'object' ? mergedSettings.inventory_valuation : {}),
          ...(catOverride.inventory_valuation || {}),
        },
        accounting: {
          ...(mergedSettings.accounting || {}),
          ...(catOverride.accounting || {}),
        }
      }
    }

    const majorVersion = await client.getMajorVersion().catch(() => 17)
    effectiveOdooValues = await applyFixedSettingsToValues(odooValues, mergedSettings, zidData, majorVersion, mapping.workspace_id, catPlatform, odooModel)

    // Inject the zid match field value into Odoo so the link is persisted
    const catCfg = (mergedSettings)?.category
    if (catCfg?.odoo_match_field && catCfg?.zid_match_field && (odooOperation === 'create' || odooOperation === 'update')) {
      const matchVal = resolveZidMatchValue(zidData, catCfg.zid_match_field)
      if (matchVal !== undefined && matchVal !== null && matchVal !== '') {
        const odooField = catCfg.odoo_match_field
        const numVal = Number(matchVal)
        effectiveOdooValues[odooField] = (odooField === 'id' || Number.isInteger(numVal) && numVal > 0) ? numVal : String(matchVal)
        console.info(`[SyncEngine] Injected match value: ${odooField} = ${JSON.stringify(effectiveOdooValues[odooField])} (from zid field "${catCfg.zid_match_field}")`)
      }
    }
  }

  // ── Customer-specific settings (res.partner) ─────────────────────────────
  if (odooModel === 'res.partner' && (odooOperation === 'create' || odooOperation === 'update')) {
    const custEv = event.toLowerCase()
    const custPlatform: 'zid' | 'salla' | 'shopify' = platformHint ?? (
      custEv.startsWith('shopify:') || custEv.includes('shopify') ? 'shopify'
      : custEv.includes('salla') ? 'salla'
      : 'zid'
    )
    const majorVersion = await client.getMajorVersion().catch(() => 17)
    effectiveOdooValues = await applyFixedSettingsToValues(odooValues, mergedSettings, zidData, majorVersion, mapping.workspace_id, custPlatform, odooModel)

    // Apply conditional rules and currency conversion
    effectiveOdooValues = await applyRulesToValues(
      effectiveOdooValues,
      mapping.workspace_id,
      presetKey,
      zidData,
      client
    )

    // Company fields always persist, even without explicit mapping rows
    effectiveOdooValues = injectCustomerCompanyFields(effectiveOdooValues, zidData)

    // Shopify and Salla send first_name / last_name separately while the
    // standard presets map name <- a single source, which drops the family
    // name ("Bob" instead of "Bob Biller") — and Salla sends no `name` at
    // all, so without this a Salla create reaches Odoo nameless and fails
    // with "Contacts require a name". Compose the full name here so both the
    // standard preset and a custom mapping of name <- first_name resolve
    // correctly. An explicit mapping to any other source (email, company,
    // static value) is left alone: only an empty name or one that equals
    // first_name alone is replaced.
    if (custPlatform === 'shopify' || custPlatform === 'salla') {
      const fullName = resolveShopifyCustomerFullName(zidData)
      if (fullName) {
        const current = typeof effectiveOdooValues.name === 'string' ? effectiveOdooValues.name.trim() : ''
        const firstOnly = typeof zidData.first_name === 'string' ? zidData.first_name.trim() : ''
        if (!current || (firstOnly && current === firstOnly)) {
          effectiveOdooValues.name = fullName
          odooValues.name = fullName
        }
      }
    }
  }

  // ── Order-specific settings (sale.order) ──────────────────────────────────
  if (odooModel === 'sale.order' && (odooOperation === 'create' || odooOperation === 'update')) {
    const platform = (platformHint || getPlatformFromEvent(event)) as 'zid' | 'salla' | 'shopify'
    const majorVersion = await client.getMajorVersion().catch(() => 17)
    effectiveOdooValues = await applyFixedSettingsToValues(odooValues, mergedSettings, zidData, majorVersion, mapping.workspace_id, platform, odooModel)

    // NEVER send the technical `name` field on sale.order (create or update):
    // Odoo owns the SO... sequence. Sending it overrides the sequence and breaks
    // numbering, so strip it unconditionally here (covers presets, dynamic
    // mappings, and the duplicate-create-update branch below).
    if ('name' in effectiveOdooValues) {
      delete effectiveOdooValues.name
    }
    // NEVER send location_id on sale.order:
    // Odoo's sale.order does NOT have a location_id field (only warehouse_id).
    delete (effectiveOdooValues as any).location_id
    delete (odooValues as any).location_id

    const orderSettings = (mergedSettings)?.order
    // ── Auto-resolve partner_id from customer data ──────────────
    if (!effectiveOdooValues.partner_id) {
      const customerData = (zidData as any)?.customer || (zidData as any)?.order?.customer || {}
      const shippingAddress = (zidData as any)?.shipping_address || (zidData as any)?.order?.shipping_address || {}
      const billingAddress = (zidData as any)?.billing_address || (zidData as any)?.order?.billing_address || {}

      const rawName = customerData.name
        || [customerData.first_name, customerData.last_name].filter(Boolean).join(' ')
        || (zidData as any)?.customer_name
        || shippingAddress.name
        || [shippingAddress.first_name, shippingAddress.last_name].filter(Boolean).join(' ')
        || billingAddress.name
        || [billingAddress.first_name, billingAddress.last_name].filter(Boolean).join(' ')
        || ''
      const custName = String(rawName).trim()

      // Shopify puts the buyer contact on the order top level (`email` /
      // `contact_email`, `phone`) and splits address names into
      // `first_name` / `last_name` with the street in `address1` — none of
      // which the Zid-shaped keys above cover. Without these fallbacks a
      // guest order (customer === null) matches no partner and mints a
      // duplicate on every delivery.
      const custEmail = String(customerData.email || (zidData as any)?.customer_email || (zidData as any)?.email || (zidData as any)?.contact_email || shippingAddress.email || billingAddress.email || '').trim()
      const custPhone = String(customerData.phone || customerData.mobile || customerData.telephone || (zidData as any)?.customer_phone || (zidData as any)?.phone || shippingAddress.mobile || shippingAddress.phone || billingAddress.mobile || billingAddress.phone || '').trim()
      const custTaxId = String(customerData.tax_number || customerData.vat || customerData.tax_id || (zidData as any)?.tax_number || '').trim()
      const custCommercialReg = String(customerData.commercial_registration || customerData.cr_number || (zidData as any)?.commercial_registration || '').trim()
      const custBusinessName = String(customerData.business_name || customerData.company_name || (zidData as any)?.company_name || '').trim()

      const rawStreet = shippingAddress.address || shippingAddress.address1 || shippingAddress.street || billingAddress.address || billingAddress.address1 || billingAddress.street || customerData.address || customerData.address1 || ''
      const custStreet = typeof rawStreet === 'string' ? rawStreet.trim() : (rawStreet?.name || '')

      const rawCity = shippingAddress.city || billingAddress.city || customerData.city || ''
      const custCity = typeof rawCity === 'string' ? rawCity.trim() : (rawCity?.name || rawCity?.en || rawCity?.ar || '')

      const custZip = String(shippingAddress.postal_code || shippingAddress.zip || billingAddress.postal_code || '').trim()

      if (custName || custEmail || custPhone || custTaxId || custCommercialReg || custBusinessName) {
        try {
          let partnerId: number | null = null

          const partnerFieldsToCheck = [
            'phone', 'mobile', 'email', 'vat', 'company_registry', 'name',
            'street', 'city', 'zip', 'company_type', 'is_company', 'customer_rank',
            'company_name', 'property_account_receivable_id', 'property_account_payable_id', 'company_id'
          ]
          const partnerFieldMeta = await fetchFieldMeta(client, 'res.partner', partnerFieldsToCheck)
          const hasPartnerField = (f: string) => f === 'mobile' ? false : (partnerFieldMeta.size === 0 ? true : partnerFieldMeta.has(f))

          // Load Customer Standard Mapping settings early
          let custStd: Record<string, any> | null = null
          if (mapping.workspace_id && platform) {
            try {
              custStd = await getCachedStandardMappingSettings(mapping.workspace_id, platform, 'customers', storeId || mapping.merchant_id || '')
            } catch (custStdErr) {
              console.warn('[SyncEngine] Failed to load customer standard mapping:', custStdErr)
            }
          }

          // Priority 0: Search by custom match field from Customer Standard Mapping if configured
          if (custStd?.match_odoo_field && !partnerId && hasPartnerField(custStd.match_odoo_field)) {
            const zidCustMatchVal = customerData[custStd.match_zid_field || 'id'] || customerData.id
            if (zidCustMatchVal) {
              try {
                const ids = await client.search('res.partner', [[custStd.match_odoo_field, '=', String(zidCustMatchVal)]], 1)
                if (ids && ids.length > 0) {
                  partnerId = ids[0]
                  console.info(`[SyncEngine] Matched partner #${partnerId} via ${custStd.match_odoo_field}="${zidCustMatchVal}"`)
                }
              } catch (e) {
                console.warn(`[SyncEngine] Search partner by ${custStd.match_odoo_field} failed:`, e)
              }
            }
          }

          // Priority 1: Search by tax_id/vat (most reliable identifier)
          if (custTaxId && !partnerId && hasPartnerField('vat')) {
            try {
              const ids = await client.search('res.partner', [['vat', '=', custTaxId]], 1)
              if (ids && ids.length > 0) partnerId = ids[0]
            } catch (e) {
              console.warn('[SyncEngine] Search partner by vat failed:', e)
            }
          }

          // Priority 2: Search by email
          if (custEmail && !partnerId && hasPartnerField('email')) {
            try {
              const ids = await client.search('res.partner', [['email', '=', custEmail]], 1)
              if (ids && ids.length > 0) partnerId = ids[0]
            } catch (e) {
              console.warn('[SyncEngine] Search partner by email failed:', e)
            }
          }

          // Priority 3: Search by phone (standard in all Odoo versions, avoiding invalid mobile field in Odoo 19)
          if (custPhone && !partnerId) {
            try {
              // Prepare phone variants (with and without country codes)
              const phoneVariants = [custPhone]
              const noPlus = custPhone.replace(/^\+/, '')
              if (noPlus !== custPhone) phoneVariants.push(noPlus)
              if (noPlus.startsWith('9665')) phoneVariants.push('05' + noPlus.slice(4))
              if (noPlus.startsWith('201')) phoneVariants.push('01' + noPlus.slice(3))

              for (const phoneToTry of phoneVariants) {
                if (partnerId) break
                const ids = await client.search('res.partner', [['phone', 'ilike', phoneToTry]], 1)
                if (ids && ids.length > 0) {
                  partnerId = ids[0]
                  console.info(`[SyncEngine] Matched partner #${partnerId} via phone="${phoneToTry}"`)
                  break
                }
              }
            } catch (e) {
              console.warn('[SyncEngine] Search partner by phone failed:', e)
            }
          }

          // Priority 4: Search by name with ilike
          if (custName && !partnerId && hasPartnerField('name')) {
            try {
              const ids = await client.search('res.partner', [['name', '=ilike', custName]], 1)
              if (ids && ids.length > 0) partnerId = ids[0]
              else {
                const ids2 = await client.search('res.partner', [['name', 'ilike', custName]], 1)
                if (ids2 && ids2.length > 0) partnerId = ids2[0]
              }
            } catch (e) {
              console.warn('[SyncEngine] Search partner by name failed:', e)
            }
          }

          // Priority 5: Search by commercial registration
          if (custCommercialReg && !partnerId && hasPartnerField('company_registry')) {
            try {
              const ids = await client.search('res.partner', [['company_registry', '=', custCommercialReg]], 1)
              if (ids && ids.length > 0) partnerId = ids[0]
            } catch (e) {
              console.warn('[SyncEngine] Search partner by commercial registration failed:', e)
            }
          }

          const customerPolicy = (mergedSettings)?.customer_fallback_policy
            || orderSettings?.customer_fallback_policy
            || 'create_new'
          const defaultCustomerId = (mergedSettings)?.default_customer_id
            || orderSettings?.default_customer_id
            || null

          // If no partner found, apply customer fallback policy
          if (!partnerId) {
            if (customerPolicy === 'default_customer' && defaultCustomerId && Number(defaultCustomerId) > 0) {
              partnerId = Number(defaultCustomerId)
              console.info(`[SyncEngine] Customer not matched in Odoo. Using configured default customer #${partnerId}`)
            } else if (customerPolicy === 'skip_order') {
              const skipMsg = `تم إلغاء تسجيل الطلب: العميل "${custName || custEmail || custPhone || 'غير معروف'}" غير مسجل في أودو وإعداد المطابقة محدد على إلغاء تسجيل الطلب (Order skipped: Customer not found in Odoo and policy is skip_order)`
              console.warn(`[SyncEngine] ${skipMsg}`)
              await logSync({
                id: existingLogId,
                workspace_id: mapping.workspace_id,
                field_mapping_id: mapping.id,
                event,
                store_id: storeId,
                zid_entity_id: zidEntityId,
                odoo_model: odooModel,
                status: 'skipped',
                error_message: skipMsg,
                payload: zidData,
                trigger_type: triggerType,
              })
              return {
                mappingId: mapping.id,
                mappingName: mapping.name,
                model: odooModel,
                status: 'skipped',
                message: skipMsg,
              }
            } else {
              // policy is 'create_new' (auto-register customer in Odoo according to Customer Standard Mapping)
              const resolvedName = custName || custBusinessName || custPhone || custEmail || `عميل متجر #${zidEntityId || 'جديد'}`
              const partnerVals: Record<string, any> = {
                name: resolvedName,
              }
              if (hasPartnerField('customer_rank')) partnerVals.customer_rank = 1
              if (custEmail && hasPartnerField('email')) partnerVals.email = custEmail
              if (custPhone) {
                partnerVals.phone = custPhone
              }
              if (custTaxId && hasPartnerField('vat')) partnerVals.vat = custTaxId
              if (custCommercialReg && hasPartnerField('company_registry')) partnerVals.company_registry = custCommercialReg
              if (custBusinessName && hasPartnerField('company_name')) partnerVals.company_name = custBusinessName
              if (custStreet && hasPartnerField('street')) partnerVals.street = custStreet
              if (custCity && hasPartnerField('city')) partnerVals.city = custCity
              if (custZip && hasPartnerField('zip')) partnerVals.zip = custZip

              // Apply Customer Standard Mapping settings (receivable/payable accounts, company, customer_type)
              if (custStd) {
                if (custStd.customer_type === 'company' && hasPartnerField('company_type')) {
                  partnerVals.company_type = 'company'
                  if (hasPartnerField('is_company')) partnerVals.is_company = true
                } else if (custStd.customer_type === 'person' && hasPartnerField('company_type')) {
                  partnerVals.company_type = 'person'
                  if (hasPartnerField('is_company')) partnerVals.is_company = false
                } else if (hasPartnerField('company_type')) {
                  // auto detect
                  const isComp = !!(custTaxId || custCommercialReg || custBusinessName)
                  partnerVals.company_type = isComp ? 'company' : 'person'
                  if (isComp && hasPartnerField('is_company')) partnerVals.is_company = true
                }

                if (custStd.receivable_account_id && Number(custStd.receivable_account_id) > 0 && hasPartnerField('property_account_receivable_id')) {
                  partnerVals.property_account_receivable_id = Number(custStd.receivable_account_id)
                }
                if (custStd.payable_account_id && Number(custStd.payable_account_id) > 0 && hasPartnerField('property_account_payable_id')) {
                  partnerVals.property_account_payable_id = Number(custStd.payable_account_id)
                }
                if (custStd.link_company !== false && custStd.company_id && Number(custStd.company_id) > 0 && hasPartnerField('company_id')) {
                  partnerVals.company_id = Number(custStd.company_id)
                }
                if (custStd.match_odoo_field && hasPartnerField(custStd.match_odoo_field)) {
                  const zidCustVal = customerData[custStd.match_zid_field || 'id'] || customerData.id || ''
                  if (zidCustVal) partnerVals[custStd.match_odoo_field] = String(zidCustVal)
                }
              } else {
                if ((custTaxId || custCommercialReg || custBusinessName) && hasPartnerField('company_type')) {
                  partnerVals.company_type = 'company'
                  if (hasPartnerField('is_company')) partnerVals.is_company = true
                }
              }

              try {
                const newId = await safeCreateOdooRecord(client, 'res.partner', partnerVals, {})
                if (newId) {
                  partnerId = newId
                  console.info(`[SyncEngine] Created new partner #${partnerId} for "${resolvedName}" according to Customer Standard Mapping`)
                }
              } catch (createErr: any) {
                console.warn(`[SyncEngine] Failed to create partner with full settings, retrying with core fields:`, createErr?.message || createErr)
                try {
                  const basicPartnerVals: Record<string, any> = {
                    name: resolvedName,
                  }
                  if (hasPartnerField('customer_rank')) basicPartnerVals.customer_rank = 1
                  if (custEmail && hasPartnerField('email')) basicPartnerVals.email = custEmail
                  if (custPhone) basicPartnerVals.phone = custPhone
                  if (custStreet && hasPartnerField('street')) basicPartnerVals.street = custStreet
                  if (custCity && hasPartnerField('city')) basicPartnerVals.city = custCity
                  const retryId = await safeCreateOdooRecord(client, 'res.partner', basicPartnerVals, {})
                  if (retryId) {
                    partnerId = retryId
                    console.info(`[SyncEngine] Created partner #${partnerId} on basic retry for "${resolvedName}"`)
                  }
                } catch (retryErr: any) {
                  console.error(`[SyncEngine] Basic partner creation retry failed:`, retryErr?.message || retryErr)
                }
              }
            }
          }

          if (partnerId) {
            effectiveOdooValues.partner_id = partnerId
            if (!effectiveOdooValues.partner_invoice_id) {
              effectiveOdooValues.partner_invoice_id = partnerId
            }
            if (!effectiveOdooValues.partner_shipping_id) {
              effectiveOdooValues.partner_shipping_id = partnerId
            }
          }
        } catch (err) {
          console.warn('[SyncEngine] Failed to auto-resolve partner for order:', err)
        }
      }
    }

    // Fallback check if partner_id is still missing after customer processing
    if (!effectiveOdooValues.partner_id) {
      const customerPolicy = (mergedSettings)?.customer_fallback_policy
        || orderSettings?.customer_fallback_policy
        || 'create_new'
      const defaultCustomerId = (mergedSettings)?.default_customer_id
        || orderSettings?.default_customer_id
        || null

      if (customerPolicy === 'default_customer' && defaultCustomerId && Number(defaultCustomerId) > 0) {
        const defId = Number(defaultCustomerId)
        effectiveOdooValues.partner_id = defId
        if (!effectiveOdooValues.partner_invoice_id) effectiveOdooValues.partner_invoice_id = defId
        if (!effectiveOdooValues.partner_shipping_id) effectiveOdooValues.partner_shipping_id = defId
        console.info(`[SyncEngine] Customer not resolved from data. Using configured default customer #${defId}`)
      } else if (customerPolicy === 'skip_order') {
        const skipMsg = `تم إلغاء تسجيل الطلب: لم يتم التعرف على العميل في أودو وإعداد المطابقة محدد على إلغاء تسجيل الطلب (Order skipped: Customer not resolved and policy is skip_order)`
        console.warn(`[SyncEngine] ${skipMsg}`)
        await logSync({
          id: existingLogId,
          workspace_id: mapping.workspace_id,
          field_mapping_id: mapping.id,
          event,
          store_id: storeId,
          zid_entity_id: zidEntityId,
          odoo_model: odooModel,
          status: 'skipped',
          error_message: skipMsg,
          payload: zidData,
          trigger_type: triggerType,
        })
        return {
          mappingId: mapping.id,
          mappingName: mapping.name,
          model: odooModel,
          status: 'skipped',
          message: skipMsg,
        }
      } else if (defaultCustomerId && Number(defaultCustomerId) > 0) {
        // Safety net: if create_new failed or customer data was empty, fallback to configured default customer
        const defId = Number(defaultCustomerId)
        effectiveOdooValues.partner_id = defId
        if (!effectiveOdooValues.partner_invoice_id) effectiveOdooValues.partner_invoice_id = defId
        if (!effectiveOdooValues.partner_shipping_id) effectiveOdooValues.partner_shipping_id = defId
        console.warn(`[SyncEngine] Safety fallback: assigned default customer #${defId} because partner_id was not set`)
      } else {
        const skipMsg = `تم إلغاء تسجيل الطلب: تعذر التعرف على العميل في أودو وفشل إنشاؤه تلقائياً ولا يوجد عميل افتراضي محدد (Order skipped: Customer could not be identified or created in Odoo)`
        console.warn(`[SyncEngine] ${skipMsg}`)
        await logSync({
          id: existingLogId,
          workspace_id: mapping.workspace_id,
          field_mapping_id: mapping.id,
          event,
          store_id: storeId,
          zid_entity_id: zidEntityId,
          odoo_model: odooModel,
          status: 'skipped',
          error_message: skipMsg,
          payload: zidData,
          trigger_type: triggerType,
        })
        return {
          mappingId: mapping.id,
          mappingName: mapping.name,
          model: odooModel,
          status: 'skipped',
          message: skipMsg,
        }
      }
    }
    // Resolve order state from DB mapping or fallback
    const zidStatus = resolveZidStatus(zidData)
    if (!zidStatus) {
      console.info(`[SyncEngine] No order status in payload (top keys: ${Object.keys((zidData as any) || {}).slice(0, 25).join(',')})`)
    }
    // Status mapping with teeth: when a mapping row exists AND is enabled, skip
    // the passive `state` write (Odoo state is workflow-driven — direct writes
    // fake the state without creating pickings) and let
    // maybeApplyOrderStatusAction perform the real transition after the record
    // write. Disabled rows leave Odoo fully untouched for this status;
    // unmapped statuses keep the legacy smart-default passive write.
    if (zidStatus && !effectiveOdooValues.state) {
      const statusRow = await getOrderStatusRow(mapping.workspace_id, zidStatus, platform, storeId)
      if (!statusRow) {
        const resolvedState = await resolveOrderState(
          mapping.workspace_id,
          zidStatus,
          platform,
          storeId
        )
        if (resolvedState) {
          effectiveOdooValues.state = resolvedState
        }
      } else if (statusRow.enabled) {
        console.info(`[SyncEngine] Status "${zidStatus}" → Odoo "${statusRow.odoo_state}" action armed (mapping enabled)`)
      } else {
        console.info(`[SyncEngine] Status "${zidStatus}" mapping is DISABLED — Odoo state untouched`)
      }
    }

    // ── Inject Platform Status into Custom Selection Field on sale.order ──
    const customStatusField = orderSettings?.order_status_custom_field
      || (mergedSettings)?.order_status_custom_field
      || (mergedSettings)?.order?.order_status_custom_field
    const isCustomStatusEnabled = (
      orderSettings?.update_custom_status_field !== false &&
      (mergedSettings)?.update_custom_status_field !== false &&
      (mergedSettings)?.order?.update_custom_status_field !== false
    )
    if (zidStatus && customStatusField && isCustomStatusEnabled) {
      const knownKeys = await getSaleOrderSelectionKeys(client, mapping.workspace_id, customStatusField)
      if (!knownKeys || knownKeys.has(zidStatus)) {
        effectiveOdooValues[customStatusField] = zidStatus
        console.info(`[SyncEngine] Injected ${execPlatform} status "${zidStatus}" into custom field "${customStatusField}" on sale.order`)
      } else {
        console.warn(`[SyncEngine] Skipping custom status "${zidStatus}" — not an option of "${customStatusField}" on sale.order (Odoo would reject the whole order write)`)
      }
    }

    if (orderSettings) {
      // Resolve payment method → Odoo journal from DB mapping
      const zidPaymentMethod = (zidData as any)?.payment_method?.title
        || (zidData as any)?.payment_gateway?.title
        || (zidData as any)?.payment_method
        || ''
      if (zidPaymentMethod && !effectiveOdooValues.journal_id) {
        const pm = await resolvePaymentMethod(mapping.workspace_id, String(zidPaymentMethod), platform)
        if (pm) {
          if (pm.journal_id) effectiveOdooValues.journal_id = pm.journal_id
          if (pm.payment_method_id) effectiveOdooValues.x_payment_method_id = pm.payment_method_id
        }
      }
      // Resolve shipping method → Odoo carrier from DB mapping
      const zidShippingMethod = (zidData as any)?.shipping_method?.title
        || (zidData as any)?.shipping?.title
        || (zidData as any)?.shipping_method
        || ''
      if (zidShippingMethod && !effectiveOdooValues.carrier_id) {
        const carrier = await resolveShippingCarrier(mapping.workspace_id, String(zidShippingMethod), platform)
        if (carrier?.carrier_id) {
          effectiveOdooValues.carrier_id = carrier.carrier_id
        }
      }
      // Resolve currency from DB currency_mappings
      const zidCurrency = String((zidData as any)?.currency || (zidData as any)?.amounts?.currency || (zidData as any)?.payment?.currency || '')
      if (zidCurrency && !effectiveOdooValues.currency_id) {
        try {
          const { data: curRow } = await supabaseAdmin
            .from('currency_mappings')
            .select('odoo_currency_id')
            .eq('workspace_id', mapping.workspace_id)
            .eq('source_currency', zidCurrency)
            .maybeSingle()
          if (curRow?.odoo_currency_id) {
            effectiveOdooValues.currency_id = curRow.odoo_currency_id
          }
        } catch (err) {
          console.warn(`[SyncEngine] Failed to resolve currency "${zidCurrency}":`, err)
        }
      }
      // Apply per-warehouse rule if one matches. Rules are keyed by the platform
      // side: the order's location (ID, UUID, or Name), then the store id (legacy
      // free-text keys). The default warehouse below covers the rest.
      const storeWhMappings = (orderSettings as any)?.store_warehouse_mappings as Record<string, unknown> | undefined
      const { locationId: orderLocId, locationName: orderLocName } = extractOrderLocationInfo(zidData, execPlatform)

      console.info(`[SyncEngine] 🏬 Warehouse resolution for order:`, {
        orderId: zidEntityId,
        orderLocId,
        orderLocName,
        storeId,
        rulesCount: storeWhMappings ? Object.keys(storeWhMappings).length : 0,
        defaultWarehouseId: orderSettings?.default_warehouse_id,
      })

      if (storeWhMappings && !effectiveOdooValues.warehouse_id) {
        const clean = (s: string) => String(s || '').trim().toLowerCase().replace(/[-_\s]/g, '')
        const normalizedRules = new Map<string, number>()
        for (const [rKey, rVal] of Object.entries(storeWhMappings)) {
          const num = Number(rVal)
          if (!Number.isNaN(num) && num > 0) {
            normalizedRules.set(clean(rKey), num)
            normalizedRules.set(rKey.trim().toLowerCase(), num)
          }
        }

        const candidates = [
          orderLocId ? clean(orderLocId) : '',
          orderLocId ? orderLocId.trim().toLowerCase() : '',
          orderLocName ? clean(orderLocName) : '',
          orderLocName ? orderLocName.trim().toLowerCase() : '',
          storeId ? clean(String(storeId)) : '',
          storeId ? String(storeId).trim().toLowerCase() : '',
        ].filter(Boolean)

        for (const cand of candidates) {
          const whId = normalizedRules.get(cand)
          if (whId) {
            effectiveOdooValues.warehouse_id = whId
            console.info(`[SyncEngine] ✅ Multi-warehouse rule matched: "${cand}" → Odoo warehouse_id=${whId}`)
            break
          }
        }
      }

      // If not resolved from multi-warehouse rules, check warehouse_mappings table
      if (!effectiveOdooValues.warehouse_id && mapping.workspace_id && (orderLocId || orderLocName)) {
        try {
          const wh = await resolveWarehouse(mapping.workspace_id, execPlatform, orderLocId, orderLocName)
          if (wh?.warehouse_id) {
            effectiveOdooValues.warehouse_id = wh.warehouse_id
            console.info(`[SyncEngine] ✅ Static warehouse_mappings table matched → Odoo warehouse_id=${wh.warehouse_id}`)
          }
        } catch (err) {
          console.warn('[SyncEngine] Error in static warehouse resolution:', err)
        }
      }

      // Apply default warehouse from settings if not already set
      if (orderSettings.default_warehouse_id && !effectiveOdooValues.warehouse_id) {
        effectiveOdooValues.warehouse_id = orderSettings.default_warehouse_id
        console.info(`[SyncEngine] Using default warehouse_id=${orderSettings.default_warehouse_id}`)
      }
      // Apply default pricelist from settings if not already set
      if (odooOperation === 'create' && orderSettings.default_pricelist_id && !effectiveOdooValues.pricelist_id) {
        effectiveOdooValues.pricelist_id = orderSettings.default_pricelist_id
      }
      // Apply default payment term from settings if not already set
      if (orderSettings.default_payment_term_id && !effectiveOdooValues.payment_term_id) {
        effectiveOdooValues.payment_term_id = orderSettings.default_payment_term_id
      }
      // Auto-confirm order (state is computed in Odoo — real confirmation happens
      // after create via action_confirm; see the create branch below)
      // Auto-extract order notes from common payload paths (if not already mapped)
      if (!effectiveOdooValues.note) {
        const zidNote = String(
          (zidData as any)?.notes
          || (zidData as any)?.customer_notes
          || (zidData as any)?.note
          || (zidData as any)?.shipping?.notes
          || (zidData as any)?.customer?.note
          || ''
        )
        if (zidNote) {
          effectiveOdooValues.note = zidNote
        }
      }
      // Auto-extract coupon/promotion code and append to note or set x_coupon_code
      const couponCode = String(
        (zidData as any)?.coupon?.code
        || (zidData as any)?.coupon_code
        || (zidData as any)?.promotion?.code
        || (zidData as any)?.discount_code
        || ''
      )
      if (couponCode) {
        const existingNote = String(effectiveOdooValues.note || '')
        const couponPrefix = 'Coupon: '
        if (!existingNote.includes(couponCode)) {
          effectiveOdooValues.note = existingNote
            ? `${existingNote}\n${couponPrefix}${couponCode}`
            : `${couponPrefix}${couponCode}`
        }
        if (!effectiveOdooValues.x_coupon_code) {
          effectiveOdooValues.x_coupon_code = couponCode
        }
      }
    }
    // ── Build order_lines (products + shipping + discount) for create operations ──
    // The fixed/standard mapping path never built lines (only the dynamic mapping
    // path did), so orders were created header-only. Rows follow the standard
    // mapping settings (add_shipping_as_line / add_discount_as_line, product ids).
    // Built for create AND update; update writes convert the (0,0) creates into a
    // full replace [(5,0,0), ...] via normalizeOrderLinesForUpdate (mirror Zid, no dups).
    if ((odooOperation === 'create' || odooOperation === 'update') && !('order_line' in effectiveOdooValues)) {
      let orderStdSettings: Record<string, any> | null = null
      if (mapping.workspace_id && platform) {
        try {
          orderStdSettings = await getCachedStandardMappingSettings(mapping.workspace_id, platform, 'orders', storeId || mapping.merchant_id || '')
        } catch (err) {
          console.warn('[SyncEngine] Failed to load standard mapping settings for order lines:', err)
        }
      }
      try {
        const orderLines = await buildOrderLineItems(
          client,
          mapping,
          zidData,
          new Map<string, OdooFieldMeta>(),
          effectiveOdooValues,
          platform,
          orderStdSettings,
          storeId
        )
        if (orderLines.length > 0) {
          effectiveOdooValues.order_line = orderLines.map(item => [0, 0, item])
        }
      } catch (lineErr: any) {
        if (lineErr?.isOrderSkipped) {
          const skipMsg = lineErr.message
          console.warn(`[SyncEngine] ${skipMsg}`)
          await logSync({
            id: existingLogId,
            workspace_id: mapping.workspace_id,
            field_mapping_id: mapping.id,
            event,
            store_id: storeId,
            zid_entity_id: zidEntityId,
            odoo_model: odooModel,
            status: 'skipped',
            error_message: skipMsg,
            payload: zidData,
            trigger_type: triggerType,
          })
          return {
            mappingId: mapping.id,
            mappingName: mapping.name,
            model: odooModel,
            status: 'skipped',
            message: skipMsg,
          }
        }
        throw lineErr
      }
    }
  }

  if (odooModel === 'sale.order') {
    delete (effectiveOdooValues as any).location_id
    delete (odooValues as any).location_id
  }

  // ── Cancel operation (sale.order only) ────────────────────────────────────────
  if (odooOperation === 'cancel') {
    const existingId = await findExistingOdooRecord(client, odooModel, zidData, odooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, execPlatform)
    if (existingId === null) {
      const msg = `No matching ${odooModel} record found in Odoo for cancel`
      console.warn(`[SyncEngine] ${msg}`)
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: msg, payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: msg }
    }
    try {
      await client.write(odooModel, [existingId], { state: 'cancel' })
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
    const existingId = await findExistingOdooRecord(client, odooModel, zidData, odooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, execPlatform)
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
      duplicateId = await findExistingOdooRecord(client, odooModel, zidData, odooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, execPlatform)
    }
    if (duplicateId !== null) {
      console.info(`[SyncEngine] Matching ${odooModel} #${duplicateId} already exists in Odoo. Updating existing record...`)
      // Mirror Zid lines into the existing order (replace, never append → no duplicates)
      if (odooModel === 'sale.order') {
        await normalizeOrderLinesForUpdate(client, duplicateId, zidData, effectiveOdooValues)
        delete effectiveOdooValues.pricelist_id
      }
      const ok = await safeWriteOdooRecord(client, odooModel, duplicateId, effectiveOdooValues, odooValues)
      if (!ok) throw new Error(`Odoo write returned false for ${odooModel} #${duplicateId}`)
      if (odooModel === 'sale.order') {
        await maybeApplyOrderStatusAction(client, duplicateId, zidData, mapping.workspace_id, execPlatform, storeId)
      }
      console.info(`[SyncEngine] ✅ Updated existing ${odooModel} #${duplicateId} in Odoo (zid_id="${zidEntityId}")`)
      if (odooModel === 'product.template') {
        await syncProductBom(client, duplicateId, zidData, mergedSettings, execPlatform, mapping.workspace_id).catch(err => {
          console.warn(`[SyncEngine] Failed to sync BoM for duplicate template:`, err)
        })
      }
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: duplicateId, status: 'success', payload: zidData, trigger_type: triggerType, platform: execPlatform })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: duplicateId, message: `Updated existing ${odooModel} #${duplicateId}` }
    }

    const newId = await safeCreateOdooRecord(client, odooModel, effectiveOdooValues, odooValues)
    console.info(`[SyncEngine] ✅ Created ${odooModel} #${newId} in Odoo (zid_id="${zidEntityId}")`)
    if (odooModel === 'sale.order') {
      await maybeApplyOrderStatusAction(client, newId, zidData, mapping.workspace_id, execPlatform, storeId)
    }
    if (odooModel === 'product.template') {
      await syncProductBom(client, newId, zidData, mergedSettings, execPlatform, mapping.workspace_id).catch(err => {
        console.warn(`[SyncEngine] Failed to sync BoM for new template:`, err)
      })
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
    // Zid child product delete: search product.product (not template) since variants are product.product records
    if (odooOperation === 'delete' && odooModel === 'product.template' && (zidData.parent_id || (zidData.parent as any)?.id)) {
      const childId = await findExistingOdooRecord(client, 'product.product', zidData, odooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, execPlatform)
      if (childId !== null) {
        existingId = childId
        deleteModel = 'product.product'
        console.info(`[SyncEngine] Resolved child product delete to product.product #${childId}`)
      }
    }
    if (existingId === null) {
      existingId = await findExistingOdooRecord(client, odooModel, zidData, odooValues, mapping, matchStrategy, fixedMatch, mapping.workspace_id, execPlatform)
    }
  }
  if (existingId === null) {
    const msg = `No matching ${odooModel} record found in Odoo for ${odooOperation}`
    console.warn(`[SyncEngine] ${msg}`)
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: msg, payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: msg }
  }

  if (odooOperation === 'update') {
    // Mirror Zid lines into the existing order (replace, never append → no duplicates)
    if (odooModel === 'sale.order') {
      await normalizeOrderLinesForUpdate(client, existingId, zidData, effectiveOdooValues)
      delete effectiveOdooValues.pricelist_id
    }
    const ok = await safeWriteOdooRecord(client, odooModel, existingId, effectiveOdooValues, odooValues)
    if (!ok) throw new Error(`Odoo write returned false for ${odooModel} #${existingId}`)
    if (odooModel === 'sale.order') {
      await maybeApplyOrderStatusAction(client, existingId, zidData, mapping.workspace_id, execPlatform, storeId)
    }
    console.info(`[SyncEngine] ✅ Updated ${odooModel} #${existingId} in Odoo (zid_id="${zidEntityId}")`)
    if (odooModel === 'product.template') {
      await syncProductBom(client, existingId, zidData, mergedSettings, execPlatform, mapping.workspace_id).catch(err => {
        console.warn(`[SyncEngine] Failed to sync BoM for updated template:`, err)
      })
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
        // product.category in standard Odoo has NO 'active' field.
        // First try to delete (unlink). If unlink fails (e.g. products belong to category),
        // update the category name to prefix with "[Archived] ".
        let ok = false
        try {
          ok = await client.unlink(deleteModel, [existingId])
          if (ok) console.info(`[SyncEngine] ✅ Deleted ${deleteModel} #${existingId} from Odoo`)
        } catch (unlinkErr) {
          console.info(`[SyncEngine] Unlink for ${deleteModel} #${existingId} failed (products may be linked), fallback to rename:`, unlinkErr)
        }

        if (!ok) {
          const recs = await client.searchRead<any>(deleteModel, [['id', '=', existingId]], ['name'])
          const currentName = recs?.[0]?.name || ''
          const archivedName = currentName.startsWith('[Archived]') || currentName.startsWith('[ملغي]')
            ? currentName
            : `[Archived] ${currentName}`
          ok = await client.write(deleteModel, [existingId], { name: archivedName })
          if (ok) console.info(`[SyncEngine] ✅ Archived ${deleteModel} #${existingId} by renaming to "${archivedName}"`)
        }
        if (!ok) throw new Error(`Failed to archive or rename product.category #${existingId}`)
        fallbacksExecuted.push('archive')
      } else {
        const ok = await client.write(deleteModel, [existingId], { active: false })
        if (!ok) throw new Error(`Odoo write (active: false) returned false`)
        fallbacksExecuted.push('archive')

        // Archive child variants if configured via archive_variants setting
        const archiveVariants = (mergedSettings)?.delete?.archive_variants !== false
        if (archiveVariants && odooModel === 'product.template') {
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

export async function findExistingOdooRecord(
  client: OdooClient,
  model: string,
  zidData: Record<string, unknown>,
  odooValues: Record<string, unknown>,
  mapping?: { odoo_match_field?: string | null; zid_match_field?: string | null; merchant_id?: string },
  matchStrategy?: string,
  fixedMatch?: { odoo_field: string; zid_field: string },
  workspaceId?: string,
  platform?: string
): Promise<number | null> {
  const sku = toNameString(zidData.sku || odooValues.default_code)
  const barcode = toNameString(zidData.barcode || odooValues.barcode)
  const zidId = toNameString(zidData.id || zidData.customer_id || zidData.product_id || zidData.category_id || zidData.category_uuid || odooValues.x_zid_id || odooValues.zid_id || odooValues.x_zid_id_categ)
  const numericId = Number(odooValues.id || zidData.odoo_id || zidData.odoo_record_id)

  // Build candidates — highest priority first
  const candidates: unknown[][] = []

  // 0) Priority check: If this entity was already synced, check sync_logs first.
  // This matches previously synced records accurately with ZERO reliance on custom Odoo columns.
  //
  // ⚠️ SECURITY: `zid_entity_id` alone is NOT unique across tenants — two
  // merchants can legitimately have product id 123. The lookup is therefore
  // ALWAYS scoped by workspace_id + platform. Without this filter, a record
  // synced for workspace A could be matched in workspace B's Odoo.
  // Multi-store: when the mapping carries its own store (merchant_id), the
  // lookup is additionally scoped by store_id — two Salla stores under one
  // workspace that both have order "1234" must never resolve to each other.
  if (zidId && workspaceId) {
    try {
      const prevLogBase = supabaseAdmin
        .from('sync_logs')
        .select('odoo_record_id')
        .eq('workspace_id', workspaceId)
        .eq('zid_entity_id', zidId)
        .eq('odoo_model', model)
        .eq('status', 'success')
        .not('odoo_record_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
      const { data: previousLog } = mapping?.merchant_id
        ? await prevLogBase.eq('store_id', mapping.merchant_id).maybeSingle()
        : await prevLogBase.maybeSingle()

      if (previousLog?.odoo_record_id) {
        const idNum = Number(previousLog.odoo_record_id)
        if (Number.isInteger(idNum) && idNum > 0) {
          try {
            const exists = await client.search(model, [['id', '=', idNum]], 1)
            if (exists.length > 0) {
              console.info(`[SyncEngine] Resolved ${model} #${idNum} from sync_logs for zid_entity_id="${zidId}"`)
              return idNum
            }
          } catch {
            // Record might have been deleted in Odoo, continue with other candidates
          }
        }
      }
    } catch (err) {
      console.warn('[SyncEngine] Early sync_logs lookup failed:', err)
    }
  }

  // 0.25) Durable entity link (odoo_entity_links) — fully store-scoped.
  // Unlike sync_logs (success rows are purged after 72h and unscoped by
  // store), links are permanent and keyed per (workspace, platform, store,
  // model, store-entity), so an update arriving days later still resolves —
  // and two stores sharing an order number never collide. The record is
  // verified to still exist in Odoo before use; a stale link is ignored.
  // Skipped when the mapping carries no store: an unscoped lookup would
  // risk another store's record, so those keep the legacy behaviour below
  // instead of guessing. (Standard-preset flows now carry the store on
  // the virtual mapping, so they use this path too.)
  if (zidId && workspaceId && mapping?.merchant_id && platform) {
    try {
      const linkedId = await resolveEntityLinkId({
        workspaceId,
        platform: platform as 'zid' | 'salla' | 'shopify',
        storeId: mapping.merchant_id,
        odooModel: model,
        storeEntityId: zidId,
      })
      if (linkedId) {
        try {
          const exists = await client.search(model, [['id', '=', linkedId]], 1)
          if (exists.length > 0) {
            console.info(`[SyncEngine] Resolved ${model} #${linkedId} from odoo_entity_links for store "${mapping.merchant_id}" entity "${zidId}"`)
            return linkedId
          }
        } catch {
          // Record was deleted in Odoo — fall through to other candidates.
        }
      }
    } catch (err) {
      console.warn('[SyncEngine] entity-link lookup failed:', err)
    }
  }

  // 0.5) Priority check: manual product mapping (product_mappings table).
  // This lets the admin hand-pick the Odoo product a store product MUST sync into.
  // Per-store first, platform default ('') as fallback — two stores of one
  // platform may map the same source product id differently.
  if (workspaceId && (model === 'product.template' || model === 'product.product') && (zidId || sku)) {
    try {
      const pmStoreId = mapping?.merchant_id || ''
      let q = supabaseAdmin
        .from('product_mappings')
        .select('odoo_product_id, store_id')
        .eq('workspace_id', workspaceId)
        .not('odoo_product_id', 'is', null)
      if (platform) q = q.eq('platform', platform)
      if (zidId) q = q.eq('source_product_id', zidId)
      if (pmStoreId) q = q.in('store_id', [pmStoreId, ''])
      const { data: pmRows } = await q
      const pmList = (Array.isArray(pmRows) ? pmRows : pmRows ? [pmRows] : []) as Array<{ odoo_product_id: unknown; store_id?: string }>
      const pmRow = pmList.find(r => (r.store_id || '') === pmStoreId) ?? pmList.find(r => !r.store_id) ?? pmList[0]

      let pmRecordId: number | null = pmRow ? Number(pmRow.odoo_product_id) : null
      if (pmRecordId === null && sku) {
        let qs = supabaseAdmin
          .from('product_mappings')
          .select('odoo_product_id, store_id')
          .eq('workspace_id', workspaceId)
          .eq('source_sku', sku)
          .not('odoo_product_id', 'is', null)
        if (platform) qs = qs.eq('platform', platform)
        if (pmStoreId) qs = qs.in('store_id', [pmStoreId, ''])
        const { data: pmRowsSku } = await qs
        const pmSkuList = (Array.isArray(pmRowsSku) ? pmRowsSku : pmRowsSku ? [pmRowsSku] : []) as Array<{ odoo_product_id: unknown; store_id?: string }>
        const pmRowSku = pmSkuList.find(r => (r.store_id || '') === pmStoreId) ?? pmSkuList.find(r => !r.store_id) ?? pmSkuList[0]
        if (pmRowSku?.odoo_product_id) pmRecordId = Number(pmRowSku.odoo_product_id)
      }

      if (pmRecordId && Number.isInteger(pmRecordId) && pmRecordId > 0) {
        try {
          const exists = await client.search(model, [['id', '=', pmRecordId]], 1)
          if (exists.length > 0) {
            console.info(`[SyncEngine] Resolved ${model} #${pmRecordId} from manual product_mappings (source_id="${zidId}", sku="${sku}")`)
            return pmRecordId
          }
        } catch {
          // Record might have been deleted in Odoo, continue with other candidates
        }
      }
    } catch (err) {
      console.warn('[SyncEngine] product_mappings lookup failed:', err)
    }
  }

  // 1) FixedMatch from FixedMappingSettings (user-configured Odoo field ↔ Zid field pair)
  if (fixedMatch?.odoo_field && fixedMatch?.zid_field) {
    const rawVal = resolveZidMatchValue(zidData, fixedMatch.zid_field)
    if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
      const val = fixedMatch.odoo_field === 'id' ? Number(rawVal) : toNameString(rawVal)
      if (fixedMatch.odoo_field !== 'id' || (Number.isInteger(val) && Number(val) > 0)) {
        console.info(`[SyncEngine] Fixed match: ${model}.${fixedMatch.odoo_field} = ${JSON.stringify(val)}`)
        candidates.push([fixedMatch.odoo_field, '=', val])
      }
    }
  }

  // 2) Strategy-based matching (from FixedMappingSettings.matching.strategy)
  if (matchStrategy === 'x_zid_id' && zidId) {
    candidates.push(['x_zid_id', '=', zidId])
    if (odooValues.zid_id !== undefined) candidates.push(['zid_id', '=', zidId])
  } else if (matchStrategy === 'sku' && sku) {
    candidates.push(['default_code', '=', sku])
  } else if (matchStrategy === 'barcode' && barcode) {
    candidates.push(['barcode', '=', barcode])
  } else if (matchStrategy === 'name') {
    const name = toNameString(zidData.name || odooValues.name)
    if (name) candidates.push(['name', '=', name])
  }

  // 3) Dynamic mapping custom match field (from field_mapping row)
  if (mapping?.odoo_match_field && mapping?.zid_match_field) {
    if (mapping.zid_match_field === STORED_ODOO_ID_FIELD) {
      // Reserved: "the Odoo id saved for this record". Never read from the
      // webhook payload — resolved from the durable, store-scoped link that
      // the create flow wrote. Requires the Odoo side to be `id`.
      if (mapping.odoo_match_field === 'id' && zidId && workspaceId && mapping.merchant_id && platform) {
        const linkedId = await resolveEntityLinkId({
          workspaceId,
          platform: platform as 'zid' | 'salla' | 'shopify',
          storeId: mapping.merchant_id,
          odooModel: model,
          storeEntityId: zidId,
        })
        if (linkedId) {
          console.info(`[SyncEngine] Using saved Odoo link: ${model}.id = ${linkedId} (store "${mapping.merchant_id}", entity "${zidId}")`)
          candidates.push(['id', '=', linkedId])
        } else {
          console.warn(`[SyncEngine] No saved Odoo link for store "${mapping.merchant_id}" entity "${zidId}" (${model}) — falling back to other candidates`)
        }
      } else if (mapping.odoo_match_field !== 'id') {
        console.warn(`[SyncEngine] Reserved match field ${STORED_ODOO_ID_FIELD} requires the Odoo match field to be "id" — ignoring`)
      }
    } else {
      const matchValue = resolveZidMatchValue(zidData, mapping.zid_match_field)
      if (matchValue !== undefined && matchValue !== null && matchValue !== '') {
        const value = mapping.odoo_match_field === 'id'
          ? Number(matchValue)
          : toNameString(matchValue)
        if (mapping.odoo_match_field !== 'id' || (Number.isInteger(value) && Number(value) > 0)) {
          console.info(`[SyncEngine] Using configured match key: ${model}.${mapping.odoo_match_field} = ${JSON.stringify(value)}`)
          candidates.push([mapping.odoo_match_field, '=', value])
        }
      }
    }
  }

  // 4) Fallback candidates — only tried when no explicit match strategy is configured,
  //    OR when the fallback field matches the configured strategy.
  //    This prevents finding a wrong record via an unrelated field.
  if (Number.isInteger(numericId) && numericId > 0) candidates.push(['id', '=', numericId])
  if (zidId) {
    if (odooValues.x_zid_id !== undefined) candidates.push(['x_zid_id', '=', zidId])
    if (odooValues.zid_id !== undefined) candidates.push(['zid_id', '=', zidId])
  }
  if (sku && (!matchStrategy || matchStrategy === 'sku')) candidates.push(['default_code', '=', sku])
  if (barcode && (!matchStrategy || matchStrategy === 'barcode')) candidates.push(['barcode', '=', barcode])

  // product.template and product.product: name fallback
  if (model === 'product.template' || model === 'product.product') {
    const name = toNameString(zidData.name || odooValues.name)
    if (name && !candidates.some(c => c[0] === 'name')) {
      candidates.push(['name', '=', name])
    }
  }

  // product.category has no custom fields by default — match on name or complete_name
  if (model === 'product.category') {
    // ID-first: a rename (category.updated with a new name) can never match
    // by name, so try ID columns before falling back to it. No custom field
    // name is hardcoded here — matching follows only what is configured:
    // the explicit fixedMatch/strategy candidates above (from the Standard
    // Mapping match fields) keep priority, and below we only reuse platform
    // ID columns the values actually carry (i.e. mapped or match-injected).
    // Missing columns are filtered by the field-meta check below.
    for (const f of allPlatformIdFieldNames()) {
      const v = toNameString(odooValues[f])
      if (v && !candidates.some(c => c[0] === f)) candidates.push([f, '=', v])
    }
    const name = toNameString(zidData.name || odooValues.name)
    if (name && !candidates.some(c => c[0] === 'name')) {
      candidates.push(['name', '=', name])
      // Also try ilike for case-insensitive partial match (Odoo may store "Parent / Child")
      if (!candidates.some(c => c[0] === 'complete_name')) {
        candidates.push(['complete_name', 'ilike', name])
      }
    }
  }

  // res.partner has email & phone/mobile fallbacks
  if (model === 'res.partner') {
    const email = toNameString(zidData.email || odooValues.email)
    const mobile = toNameString(zidData.mobile || zidData.phone || odooValues.mobile || odooValues.phone)
    if (email && !candidates.some(c => c[0] === 'email')) {
      candidates.push(['email', '=', email])
    }
    if (mobile) {
      if (!candidates.some(c => c[0] === 'mobile')) candidates.push(['mobile', '=', mobile])
      if (!candidates.some(c => c[0] === 'phone')) candidates.push(['phone', '=', mobile])
    }
  }

  // Fetch fields metadata to ensure we only search on fields that exist in Odoo
  const fieldNamesToCheck = Array.from(new Set(candidates.map(c => c[0] as string).filter(name => name !== 'id')))
  let checkedFieldMeta = new Map<string, OdooFieldMeta>()
  if (fieldNamesToCheck.length > 0) {
    try {
      checkedFieldMeta = await fetchFieldMeta(client, model, fieldNamesToCheck)
    } catch (err) {
      console.warn(`[SyncEngine] Failed to fetch field meta in findExistingOdooRecord:`, err)
    }
  }

  // Filter candidates to only include valid fields:
  // - Always allow 'id'
  // - If checkedFieldMeta has records, verify presence
  // - If a field starts with 'x_' (custom studio field), NEVER query it unless explicitly confirmed by checkedFieldMeta
  const validCandidates = candidates.filter(domain => {
    const fieldName = domain[0] as string
    if (fieldName === 'id') return true
    if (checkedFieldMeta.size > 0 && !checkedFieldMeta.has(fieldName)) {
      console.info(`[SyncEngine] Skipping candidate search for missing field "${fieldName}" on ${model}`)
      return false
    }
    if (fieldName.startsWith('x_') && !checkedFieldMeta.has(fieldName)) {
      console.info(`[SyncEngine] Skipping candidate search for unverified custom field "${fieldName}" on ${model}`)
      return false
    }
    return true
  })

  console.info(`[SyncEngine] findExistingOdooRecord model=${model} candidates=${validCandidates.length} domains=${JSON.stringify(validCandidates)}`)
  for (const domain of validCandidates) {
    try {
      const ids = await client.search(model, [domain], 1)
      if (ids.length > 0) {
        console.info(`[SyncEngine] Matched ${model} #${ids[0]} via domain ${JSON.stringify(domain)}`)
        return ids[0]
      }
    } catch (err) {
      console.warn(`[SyncEngine] Duplicate check failed for ${model} with domain ${JSON.stringify(domain)}:`, err)
    }
  }

  return null
}

/**
 * سياسة الاحتفاظ بسجلات المزامنة (حتى لا تزدحم قاعدة البيانات):
 * - الناجح: يُحذف بعد 72 ساعة (3 أيام) — انتهت فائدته التشغيلية.
 * - غير الناجح (failed/skipped/processing): يُحذف بعد 60 يوماً — يبقى
 *   متاحاً للتدقيق وإعادة الإرسال طوال الموسم وما بعده بفترة كافية.
 */
export const SYNC_LOG_SUCCESS_RETENTION_HOURS = 72
export const SYNC_LOG_FAILURE_RETENTION_DAYS = 60

export async function cleanupExpiredLogs() {
  console.info('[SyncEngine] Running cleanupExpiredLogs...')
  try {
    const successCutoff = new Date(
      Date.now() - SYNC_LOG_SUCCESS_RETENTION_HOURS * 60 * 60 * 1000
    ).toISOString()
    const failureCutoff = new Date(
      Date.now() - SYNC_LOG_FAILURE_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString()

    // 1. Delete successful logs older than 72 hours
    const { error: err1 } = await supabaseAdmin
      .from('sync_logs')
      .delete()
      .eq('status', 'success')
      .lt('created_at', successCutoff)

    // 2. Delete all other logs older than 60 days
    const { error: err2 } = await supabaseAdmin
      .from('sync_logs')
      .delete()
      .neq('status', 'success')
      .lt('created_at', failureCutoff)

    if (err1 || err2) {
      console.error('[SyncEngine] Failed to delete expired logs:', err1 || err2)
    } else {
      console.info('[SyncEngine] Expired sync logs purged successfully.')
    }
  } catch (err) {
    console.error('[SyncEngine] Exception during log purge:', err)
  }
}

// --- ERPNext engine moved ---
// The ERPNext REST client + its sync helpers now live in
// src/lib/erpnext-engine.ts. Shared types: src/lib/sync-types.ts.

// ─── BoM / Kit sync (Odoo only — uses OdooClient XML-RPC) ───────────────
async function syncProductBom(
  client: OdooClient,
  templateId: number,
  zidData: Record<string, unknown>,
  mergedSettings: Record<string, any>,
  platform: 'zid' | 'salla' | 'shopify',
  workspaceId: string
): Promise<void> {
  const bomEnabled = !!mergedSettings.bom?.enabled
  if (!bomEnabled) return

  const bomType = mergedSettings.bom?.type || 'phantom'

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

  console.info(`[SyncEngine] 🛠️ Product is classified as a grouped/bundle product. Syncing BoM in Odoo for template #${templateId}...`)

  const groupedProducts = Array.isArray(zidData.group_products)
    ? zidData.group_products
    : (Array.isArray(zidData.grouped_products)
      ? zidData.grouped_products
      : (Array.isArray(zidData.components)
        ? zidData.components
        : (Array.isArray(zidData.bundle_products) ? zidData.bundle_products : [])))

  if (groupedProducts.length === 0) {
    console.info(`[SyncEngine] No components found in the Zid grouped product payload. Skipping BoM.`)
    return
  }

  try {
    const resolvedComponents: { product_id: number; product_qty: number }[] = []

    // Deliberately current-only: this lookup has never had a legacy fallback,
    // unlike the relation/persist paths. Do not "fix" this to
    // pickExistingIdField without a migration note for legacy Odoo instances.
    const idField = platformIdField(platform)

    const storeIdStr = String(zidData.store_id || '')
    let zidCreds: any = null
    if (platform === 'zid') {
      try {
        let tokenRow: any = null
        // Store-keyed first (exact under multi-store), then newest workspace row.
        if (storeIdStr) {
          const { data } = await supabaseAdmin
            .from('merchant_tokens')
            .select('*')
            .or(`store_id.eq.${storeIdStr},merchant_id.eq.${storeIdStr}`)
            .maybeSingle()
          tokenRow = data
        }
        if (!tokenRow && workspaceId) {
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
          const { getAccessToken } = await import('./zid/token')
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

      if (!compId && !compSku && !compBarcode) continue

      // Search matching product.product in Odoo
      let matchedId: number | null = null

      if (compId) {
        const ids = await client.search('product.product', [[idField, '=', String(compId)]], 1)
        if (ids.length > 0) matchedId = ids[0]
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
          const { ZidAPI } = await import('./zid-client')
          const response = await ZidAPI.products.get(zidCreds, String(compId))
          const productData = response.data?.product || response.data
          if (productData && (productData.id || productData.name)) {
            const { data: compMappingRows } = await supabaseAdmin
              .from('field_mappings')
              .select('*')
              .eq('workspace_id', workspaceId)
            
            let syncRes: any = null
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

            if (syncRes && syncRes.status === 'success') {
              const newOdooId = syncRes.odooRecordId || syncRes.odoo_record_id
              if (newOdooId) {
                const ids = await client.search('product.product', [[idField, '=', String(compId)]], 1)
                if (ids.length > 0) matchedId = ids[0]
              }
            }
          }
        } catch (compErr: any) {
          console.warn(`[SyncEngine] Failed to auto-sync missing component product ID ${compId}:`, compErr?.message ?? compErr)
        }
      }

      if (matchedId) {
        const qty = parseFloat(String(comp.item_quantity || comp.quantity || comp.qty || '1')) || 1
        resolvedComponents.push({ product_id: matchedId, product_qty: qty })
      } else {
        console.warn(`[SyncEngine] Could not find component product in Odoo (ID Field: ${idField}, Value: ${compId}, SKU: ${compSku}, Barcode: ${compBarcode}). Skipping this component in BoM.`)
      }
    }

    if (resolvedComponents.length === 0) {
      console.info(`[SyncEngine] No component products could be matched in Odoo. Skipping BoM creation/update.`)
      return
    }

    // Check if BoM already exists
    const existingBomIds = await client.search('mrp.bom', [['product_tmpl_id', '=', templateId]], 1)

    let bomId: number
    if (existingBomIds.length > 0) {
      bomId = existingBomIds[0]
      console.info(`[SyncEngine] Found existing BoM #${bomId} for product template #${templateId}. Recreating lines...`)
      
      // Update the BoM type in Odoo
      await client.write('mrp.bom', [bomId], { type: bomType })

      // Delete old lines
      const lineIds = await client.search('mrp.bom.line', [['bom_id', '=', bomId]], 100)
      if (lineIds.length > 0) {
        await client.execute('mrp.bom.line', 'unlink', [lineIds])
      }
    } else {
      bomId = await client.create('mrp.bom', {
        product_tmpl_id: templateId,
        type: bomType,
        product_qty: 1
      })
      console.info(`[SyncEngine] Created new BoM #${bomId} of type ${bomType} for product template #${templateId}.`)
    }

    // Create new BoM lines
    for (const comp of resolvedComponents) {
      await client.create('mrp.bom.line', {
        bom_id: bomId,
        product_id: comp.product_id,
        product_qty: comp.product_qty
      })
    }
    console.info(`[SyncEngine] ✅ BoM for template #${templateId} successfully updated with ${resolvedComponents.length} components.`)
  } catch (err: any) {
    console.warn(`[SyncEngine] Failed to sync BoM/Kit for product template #${templateId} (ensure Manufacturing module is installed in Odoo):`, err?.message || err)
  }
}
