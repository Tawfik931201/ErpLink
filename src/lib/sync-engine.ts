/**
 * Sync Engine â€” Zid â†’ Odoo
 *
 * When a Zid webhook arrives, this engine:
 *   1. Looks up all active field_mappings for (storeId + event)
 *   2. Resolves nested Zid data paths (e.g. "name.ar" â†’ data.name.ar)
 *   3. Handles Many2one/Many2many fields by resolving names â†’ IDs in Odoo
 *   4. Calls OdooClient to create/update the record
 *   5. Logs every attempt to the sync_logs table in Supabase
 */

import { createClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/crypto'
import { OdooClient } from '@/lib/odoo-client'
import { notifySyncResult } from '@/lib/telegram-notifier'
import type { SyncRecordSummary } from '@/lib/telegram-notifier'

// â”€â”€â”€ Supabase admin client (bypasses RLS) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Webhook requests have NO Clerk auth session, so the standard supabase client
// would be blocked by Row Level Security on field_mappings / erp_connections.
// We use the service role key here which has full read access.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface FieldMappingRow {
  id: string
  workspace_id: string
  erp_connection_id: string | null
  merchant_id: string
  store_id: string | null
  action: string          // e.g. 'product.create'
  odoo_model: string      // e.g. 'product.template'
  odoo_operation?: OdooOperation
  odoo_match_field?: string | null
  zid_match_field?: string | null
  mappings: Record<string, FieldMappingItem[]>
  name: string
}

type OdooOperation = 'create' | 'update' | 'delete' | 'cancel' | 'deliver'

interface FieldMappingItem {
  id: string
  erpField: string  // Odoo field name  e.g. 'categ_id'
  zidField?: string  // Zid data path    e.g. 'categories' or 'name.ar'
  staticValue?: unknown
}

interface OdooConnectionRow {
  id: string
  url: string
  db_name: string
  username: string
  password: string  // API key stored here
  erp_type?: string
}

interface OdooFieldMeta {
  name: string
  ttype: string      // 'many2one' | 'many2many' | 'char' | 'float' etc.
  relation: string   // related model, e.g. 'product.category'
}

export interface SyncEngineResult {
  processed: number
  success: number
  failed: number
  skipped: number
  records: Array<{
    mappingId: string
    mappingName: string
    model: string
    status: 'success' | 'failed' | 'skipped'
    odooRecordId?: number | string
    message?: string
  }>
}

// â”€â”€â”€ Helper: resolve a nested path like "name.ar" from a plain object â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const subPaths = path.split('||').map(p => p.trim())
  for (const subPath of subPaths) {
    const value = subPath.split('.').reduce<unknown>((acc, key) => {
      // If acc is a string, and it looks like a stringified object/array, try to parse it
      if (typeof acc === 'string') {
        const trimmed = acc.trim()
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            // Convert Python dict format to valid JSON
            const jsonStr = trimmed
              .replace(/'/g, '"')
              .replace(/:\s*None/g, ': null')
              .replace(/:\s*True/g, ': true')
              .replace(/:\s*False/g, ': false')
            acc = JSON.parse(jsonStr)
          } catch {
            // Ignore parsing error, keep it as string
          }
        }
      }

      if (acc && typeof acc === 'object') {
        if (Array.isArray(acc)) {
          const idx = parseInt(key, 10)
          return isNaN(idx) ? undefined : acc[idx]
        }
        return (acc as Record<string, unknown>)[key]
      }
      return undefined
    }, obj)

    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }

  // Zid can send localized fields either as { ar, en } or as a plain string.
  // If a mapping asks for "name.ar" but the webhook has "name": "..." use it.
  const firstPath = subPaths[0] ?? ''
  const [root] = firstPath.split('.')
  return obj[root]
}

// â”€â”€â”€ Helper: resolve a Match Field value with common Zid field aliases â”€â”€â”€â”€â”€â”€â”€â”€
// Zid webhook payloads use prefixed names ("category_id", "category_uuid"),
// but the UI dropdown shows generic names ("id", "uuid"). This helper tries
// the user-selected field first, then common aliases so Match Field values
// are always extracted regardless of which name the admin picked.

const ZID_FIELD_ALIASES: Record<string, string[]> = {
  id: ['customer_id', 'product_id', 'category_id', 'category_uuid', 'uuid'],
  uuid: ['customer_id', 'product_id', 'category_uuid', 'category_id', 'id'],
  customer_id: ['id', 'uuid'],
  product_id: ['id', 'uuid'],
  category_id: ['id', 'uuid', 'category_uuid'],
  category_uuid: ['uuid', 'id', 'category_id'],
}

export function resolveZidMatchValue(zidData: Record<string, unknown>, zidField: string): unknown {
  const direct = resolvePath(zidData, zidField)
  if (direct !== undefined && direct !== null && direct !== '') return direct

  const aliases = ZID_FIELD_ALIASES[zidField] || []
  for (const alias of aliases) {
    const v = resolvePath(zidData, alias)
    if (v !== undefined && v !== null && v !== '') return v
  }

  return undefined
}

// â”€â”€â”€ Helper: extract a display name from a raw value â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function toNameString(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>
    
    // First, look for a string property directly on obj: name, title, ar, en, name_ar, name_en, names
    const directKeys = ['name', 'title', 'ar', 'en', 'name_ar', 'name_en', 'names']
    for (const key of directKeys) {
      const val = obj[key]
      if (val !== undefined && val !== null) {
        if (typeof val === 'string') return val.trim()
        if (typeof val === 'number') return String(val)
        if (typeof val === 'object') {
          // Recurse to resolve the sub-object (e.g. obj.name is { ar: "...", en: "..." })
          const subResolved = toNameString(val)
          if (subResolved && subResolved !== '[object Object]') {
            return subResolved
          }
        }
      }
    }

    // Fallback: If it's a localized object directly, look for any string/number fields
    if (typeof obj.ar === 'string') return obj.ar.trim()
    if (typeof obj.en === 'string') return obj.en.trim()
    
    // As a last resort, convert it to JSON or string
    return String(obj.name ?? obj.title ?? obj.ar ?? obj.en ?? JSON.stringify(v))
  }
  return String(v ?? '')
}

/**
 * Look up per-category overrides from the category_mappings table
 * and return an override object matching the standard_mapping_settings shape.
 */
async function applyCategoryMappingOverrides(
  workspaceId: string,
  platform: string,
  zidData: Record<string, unknown>,
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

    const { data: rows } = await supabaseAdmin
      .from('category_mappings')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('platform', platform)
      .ilike('source_category_name', catName)
      .maybeSingle()

    if (!rows) return {}

    const override: Record<string, any> = {}
    if (rows.property_cost_method || rows.property_valuation) {
      override.inventory_valuation = {}
      if (rows.property_cost_method) override.inventory_valuation.property_cost_method = rows.property_cost_method
      if (rows.property_valuation) override.inventory_valuation.property_valuation = rows.property_valuation
    }
    if (rows.income_account_id || rows.expense_account_id || rows.stock_valuation_account_id) {
      override.accounting = {}
      if (rows.income_account_id && Number(rows.income_account_id) > 0) override.accounting.income_account_id = rows.income_account_id
      if (rows.expense_account_id && Number(rows.expense_account_id) > 0) override.accounting.expense_account_id = rows.expense_account_id
      if (rows.stock_valuation_account_id && Number(rows.stock_valuation_account_id) > 0) override.accounting.stock_valuation_account_id = rows.stock_valuation_account_id
    }
    if (rows.stock_journal_id && Number(rows.stock_journal_id) > 0) {
      if (!override.accounting) override.accounting = {}
      override.accounting.stock_journal_id = rows.stock_journal_id
    }
    if (rows.stock_input_account_id && Number(rows.stock_input_account_id) > 0) {
      if (!override.accounting) override.accounting = {}
      override.accounting.stock_input_account_id = rows.stock_input_account_id
    }
    if (rows.stock_output_account_id && Number(rows.stock_output_account_id) > 0) {
      if (!override.accounting) override.accounting = {}
      override.accounting.stock_output_account_id = rows.stock_output_account_id
    }
    if (rows.odoo_category_id && Number(rows.odoo_category_id) > 0) {
      override.odoo_category_id = Number(rows.odoo_category_id)
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
        console.warn(`[SyncEngine] resolveBinaryField: mainImg keys=${Object.keys(mainImg).join(', ')} â€” no known URL key found`)
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

// â”€â”€â”€ Helper: send Telegram notification for a sync result record â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function notifySyncForRecord(
  workspaceId: string | null | undefined,
  record: SyncEngineResult['records'][number],
  event: string,
  mappingName: string,
  mappingId: string,
  model: string,
  storeId?: string,
  errorMessage?: string | null,
) {
  if (!workspaceId) return
  const summary: SyncRecordSummary = {
    status: record.status === 'success' ? 'success' : record.status === 'failed' ? 'failed' : 'skipped',
    event,
    mappingName,
    mappingId,
    model,
    odooRecordId: record.odooRecordId,
    errorMessage: errorMessage || record.message,
    workspaceId,
    storeId,
    receivedAt: new Date().toISOString(),
  }
  await notifySyncResult({ workspaceId, record: summary }).catch(() => {})
}

// â”€â”€â”€ Helper: fetch Odoo field metadata (ttype + relation) for a model â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
      rows.map(r => `${r.name}(${r.ttype}${r.relation ? 'â†’' + r.relation : ''})`).join(', '))
    return map
  } catch (err) {
    console.warn('[SyncEngine] Could not fetch field meta, will skip relational resolution:', err)
    return new Map()
  }
}

// â”€â”€â”€ Helper: Determine platform from webhook event â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function getPlatformFromEvent(event: string): 'zid' | 'salla' | 'shopify' {
  // Shopify events use "shopify:" prefix, contain "shopify", or use "/" syntax (orders/create, products/create)
  if (event.startsWith('shopify:') || event.includes('shopify')) return 'shopify'
  if (event.includes('/')) return 'shopify'
  if (event.includes('salla')) return 'salla'
  // Salla events use ".created", ".updated", ".cancelled" etc.
  if (
    event.endsWith('.created') ||
    event.includes('.status.') ||
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

// â”€â”€â”€ Helper: resolve a single relational value (ID Match â†’ Name Match â†’ Creation) â”€â”€â”€

export async function resolveSingleRelationId(
  client: any,
  relation: string,
  itemValue: unknown,
  platform: 'zid' | 'salla' | 'shopify',
  _operation?: any,
  _item?: any,
  workspaceId?: any,
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
    // Fetch target relation fields meta to verify field existence (avoiding Odoo RPC errors on non-existing columns)
    const relationFields = await fetchFieldMeta(client, relation, ['x_zid_id', 'zid_id', 'x_salla_id', 'salla_id', 'x_shopify_id', 'shopify_id', 'name'])

    // â”€â”€â”€ Case 1: Search by Platform ID (Fixed Mapping check) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (platformId) {
      let searchField: string | null = null
      if (platform === 'zid') {
        if (relationFields.has('x_zid_id')) searchField = 'x_zid_id'
        else if (relationFields.has('zid_id')) searchField = 'zid_id'
      } else if (platform === 'salla') {
        if (relationFields.has('x_salla_id')) searchField = 'x_salla_id'
        else if (relationFields.has('salla_id')) searchField = 'salla_id'
      } else if (platform === 'shopify') {
        if (relationFields.has('x_shopify_id')) searchField = 'x_shopify_id'
        else if (relationFields.has('shopify_id')) searchField = 'shopify_id'
      }

      if (searchField) {
        const ids = await client.search(relation, [[searchField, '=', platformId]])
        if (ids && ids.length > 0) {
          console.info(`[SyncEngine] Case 1 (ID Match): Resolved ${relation} with ${searchField}="${platformId}" â†’ ID #${ids[0]}`)
          return ids[0]
        }
      }

      // â”€â”€â”€ Case 1.5: Try Match Field from standard_mapping_settings â”€â”€â”€â”€â”€â”€â”€â”€
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
            const { data: stdRow } = await supabaseAdmin
              .from('standard_mapping_settings')
              .select('settings')
              .eq('workspace_id', workspaceId)
              .eq('store_type', storeType)
              .eq('entity_type', entityType)
              .maybeSingle()
            if (stdRow?.settings) {
              const stdSettings = stdRow.settings as Record<string, any>
              if (stdSettings.match_odoo_field && stdSettings.match_zid_field) {
                const idLikeZidFields = ['id', 'uuid', 'category_id', 'product_id', 'customer_id', 'order_id', 'parent_id']
                if (idLikeZidFields.includes(stdSettings.match_zid_field)) {
                  const mfIds = await client.search(relation, [[stdSettings.match_odoo_field, '=', platformId]])
                  if (mfIds && mfIds.length > 0) {
                    console.info(`[SyncEngine] Case 1.5 (Match Field): Resolved ${relation} via ${stdSettings.match_odoo_field}="${platformId}" â†’ ID #${mfIds[0]}`)
                    return mfIds[0]
                  }
                }
              }
            }
          } catch (err) {
            console.warn(`[SyncEngine] Match Field lookup failed for ${relation}:`, err)
          }
        }
      }
    }

    // â”€â”€â”€ Case 2: Search by Name inside Odoo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (nameVal && nameVal !== '[object Object]' && nameVal !== 'undefined') {
      const ids = await client.search(relation, [['name', '=', nameVal]])
      if (ids && ids.length > 0) {
        console.info(`[SyncEngine] Case 2 (Name Match): Resolved ${relation} with name="${nameVal}" â†’ ID #${ids[0]}`)

        // Proactive linking: if we found it by name and have a platform ID, let's link them!
        if (platformId) {
          let linkField: string | null = null
          if (platform === 'zid') {
            if (relationFields.has('x_zid_id')) linkField = 'x_zid_id'
            else if (relationFields.has('zid_id')) linkField = 'zid_id'
          } else if (platform === 'salla') {
            if (relationFields.has('x_salla_id')) linkField = 'x_salla_id'
            else if (relationFields.has('salla_id')) linkField = 'salla_id'
          } else if (platform === 'shopify') {
            if (relationFields.has('x_shopify_id')) linkField = 'x_shopify_id'
            else if (relationFields.has('shopify_id')) linkField = 'shopify_id'
          }

          if (linkField) {
            console.info(`[SyncEngine] Proactive Link: Linking existing ${relation}#${ids[0]} to platform ID "${platformId}"`)
            await client.write(relation, [ids[0]], { [linkField]: platformId }).catch((err: any) => {
              console.warn(`[SyncEngine] Proactive Link failed for ${relation}#${ids[0]}:`, err)
            })
          }
        }

        return ids[0]
      }
    }

    // â”€â”€â”€ Case 3: Create it if not found â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (nameVal && nameVal !== '[object Object]' && nameVal !== 'undefined') {
      // Safety: do NOT auto-create a relation using a platform ID/Uuid-like
      // string as the name. If we only have a platform id (no real human name)
      // and no x_/zid field exists on the relation to link them, we have no
      // way to verify identity â€” creating using a UUID/name would be wrong.
      const looksLikePlatformId = typeof nameVal === 'string' &&
        (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameVal) ||
         /^\d+$/.test(nameVal))
      const canLinkByPlatformId = Boolean(platformId) && (
        (platform === 'zid'   && (relationFields.has('x_zid_id')   || relationFields.has('zid_id'))) ||
        (platform === 'salla' && (relationFields.has('x_salla_id') || relationFields.has('salla_id'))) ||
        (platform === 'shopify' && (relationFields.has('x_shopify_id') || relationFields.has('shopify_id')))
      )
      if (looksLikePlatformId && !canLinkByPlatformId) {
        // Fallback: try to search by the platform-id field anyway. The field
        // might exist even if fetchFieldMeta didn't find it (race, cache, or
        // the field was just created). If the field truly doesn't exist, the
        // Odoo RPC call will error and be caught by the outer try/catch.
        const fallbackField = platform === 'zid' ? 'x_zid_id'
          : platform === 'salla' ? 'x_salla_id'
          : 'x_shopify_id'
        try {
          const fallbackIds = await client.search(relation, [[fallbackField, '=', platformId]])
          if (fallbackIds && fallbackIds.length > 0) {
            console.info(`[SyncEngine] Resolved ${relation} via fallback ${fallbackField}="${platformId}" â†’ ID #${fallbackIds[0]}`)
            return fallbackIds[0]
          }
        } catch {
          // Field doesn't exist â€” ignore and continue
        }
        console.warn(`[SyncEngine] Relation ${relation} has no platform-id field (x_*_id); cannot auto-resolve parent for "${nameVal}"`)
        return null
      }
      console.info(`[SyncEngine] Case 3 (Creation): Record not found in "${relation}". Creating a new one with name="${nameVal}"`)
      
      const createData: Record<string, unknown> = {
        name: nameVal
      }

      if (relation === 'res.partner' && itemValue && typeof itemValue === 'object') {
        const obj = itemValue as Record<string, unknown>
        if (obj.email) createData.email = String(obj.email)
        if (obj.mobile) createData.mobile = String(obj.mobile)
        if (obj.telephone || obj.phone) createData.phone = String(obj.telephone || obj.phone)
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
            const { data: stdRow } = await supabaseAdmin
              .from('standard_mapping_settings')
              .select('settings')
              .eq('workspace_id', workspaceId)
              .eq('store_type', platform)
              .eq('entity_type', 'customers')
              .maybeSingle()

            if (stdRow?.settings) {
              const stdSettings = stdRow.settings as Record<string, any>
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
  let rawVariants = payload.variants || payload.options || []

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
          const attrName = toNameString(attr.name || attr.label || attr.option_name || attr.option_label)
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

export async function updateOdooStock(client: OdooClient, productId: number, qty: number, locationId?: number, infiniteValue?: number): Promise<boolean> {
  if (infiniteValue !== undefined && infiniteValue > 0 && qty >= infiniteValue) {
    console.info(`[SyncEngine] Skipping stock update for product #${productId}: qty ${qty} >= infinite value ${infiniteValue}`)
    return true
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

// â”€â”€â”€ Helper: build sale.order.line items for sale.order mappings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  }
  const orDefault = (camelKey: string, fallback: any) => {
    if (settingsKeys.has(camelKey)) return settings[camelKey]
    const snakeKey = keyMap[camelKey]
    if (orderStdSettings && snakeKey && snakeKey in orderStdSettings) return orderStdSettings[snakeKey]
    return fallback
  }

  const addShippingAsLine = !!orDefault('addShippingAsLine', false)
  const shippingProductId = String(orDefault('shippingProductId', '') || '')
  const shippingProductSku = String(orDefault('shippingProductSku', '') || '')

  const addDiscountAsLine = !!orDefault('addDiscountAsLine', false)
  const discountProductId = String(orDefault('discountProductId', '') || '')
  const discountProductSku = String(orDefault('discountProductSku', '') || '')
  const discountMode = String(orDefault('discountMode', 'fixed') || 'fixed')

  console.info(`[SyncEngine] Order line settings: addShipping=${addShippingAsLine} addDiscount=${addDiscountAsLine} discountMode=${discountMode}`)

  // 3. Fetch line field meta (for many2one resolution)
  const lineFieldNames = lineMappings.map(m => m.erpField)
  const lineFieldMeta = lineFieldNames.length > 0
    ? await fetchFieldMeta(client, 'sale.order.line', lineFieldNames)
    : new Map<string, OdooFieldMeta>()

  // 4. Build each line
  let subtotalBeforeDiscount = 0
  let totalDiscountAmount = 0
  const shippingCost = parseFloat(resolvePath(zidData, 'amounts.shipping_cost.amount') as string ?? '0') || 0

  // Check if user mapped a discount field at line level (Option A)
  const hasLineDiscountMapping = lineMappings.some(m => m.erpField === 'discount')
  // Track whether any product will actually carry discount to satisfy Option C rule
  let anyProductHasDiscount = false

  for (const product of products) {
    const productData = (product && typeof product === 'object') ? product as Record<string, unknown> : {}
    const line: Record<string, unknown> = {}

    for (const fm of lineMappings) {
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

      // Many2one: resolve product (e.g. product_id) via name_search by default_code
      if (ttype === 'many2one' && relation) {
        try {
          const ids = await client.execute<number[]>('product.product', 'search', [
            [['default_code', '=', String(rawValue)]]
          ], { limit: 1 })
          if (ids && ids.length > 0) {
            line[fm.erpField] = ids[0]
          } else {
            const fallback = parseInt(String(rawValue))
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
    const zidPrice = parseFloat(String(productData.price ?? productData.unit_price ?? productData.amount ?? 0)) || 0
    const zidSalePrice = parseFloat(String(productData.sale_price ?? productData.price_after_discount ?? productData.discounted_price ?? zidPrice)) || 0
    const zidDiscountDirect = parseFloat(String(productData.discount ?? 0)) || 0

    if (zidDiscountDirect > 0 || (zidSalePrice > 0 && zidSalePrice < zidPrice)) {
      anyProductHasDiscount = true
    }

    if (hasLineDiscountMapping) {
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

    // If price_unit wasn't set from mapping, derive it (prefer original price)
    if (!line['price_unit'] && zidPrice > 0) {
      line['price_unit'] = zidPrice
    }

    const qty = parseFloat(String(productData.quantity ?? productData.qty ?? 1)) || 1
    subtotalBeforeDiscount += zidPrice * qty
    totalDiscountAmount += Math.max(0, zidPrice - zidSalePrice) * qty

    // Auto-set product_uom_qty if user didn't map it explicitly
    if (!('product_uom_qty' in line)) {
      const hasQtyMapping = lineMappings.some(m => m.erpField === 'product_uom_qty')
      if (!hasQtyMapping) {
        line['product_uom_qty'] = qty
      }
    }

    // Resolve line-level tax from DB tax_mappings
    if (mapping.workspace_id && !line['tax_id']) {
      const zidTaxName = String(productData.tax_name ?? productData.tax ?? productData.tax_rate ?? '')
      if (zidTaxName) {
        try {
          const { data: taxRow } = await supabaseAdmin
            .from('tax_mappings')
            .select('odoo_tax_id')
            .eq('workspace_id', mapping.workspace_id)
            .eq('source_tax_name', zidTaxName)
            .maybeSingle()
          if (taxRow?.odoo_tax_id) {
            line['tax_id'] = [[6, 0, [taxRow.odoo_tax_id]]]
          }
        } catch (err) {
          console.warn(`[SyncEngine] Failed to resolve tax for "${zidTaxName}":`, err)
        }
      }
    }

    lines.push(line)
  }

  // â”€â”€â”€ Shipping as Line Item â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (addShippingAsLine && shippingCost > 0) {
    const shippingLine: Record<string, unknown> = {
      name: 'Shipping (Ø´Ø­Ù†)',
      quantity: 1,
      price_unit: shippingCost,
    }

    if (shippingProductId) {
      shippingLine['product_id'] = parseInt(shippingProductId)
    } else if (shippingProductSku) {
      try {
        const ids = await client.execute<number[]>('product.product', 'search', [
          [['default_code', '=', shippingProductSku]]
        ], { limit: 1 })
        if (ids.length > 0) shippingLine['product_id'] = ids[0]
      } catch (err) {
        console.warn(`[SyncEngine] Failed to resolve shipping product by SKU=${shippingProductSku}:`, err)
      }
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
          shippingLine['carrier_id'] = carrier.carrier_id
        }
        if (carrier?.product_id && !shippingLine['product_id']) {
          shippingLine['product_id'] = carrier.product_id
        }
      } catch (err) {
        console.warn(`[SyncEngine] Failed to resolve shipping carrier for "${zidShippingName}":`, err)
      }
    }

    lines.push(shippingLine)
  }

  // â”€â”€â”€ Discount as Order Line (Option B) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Only append a discount line if the user enabled the setting AND discount exists in payload
  if (addDiscountAsLine && anyProductHasDiscount && totalDiscountAmount > 0) {
    let discountValue: number
    let nameStr: string

    if (discountMode === 'percent') {
      discountValue = subtotalBeforeDiscount > 0
        ? Math.round((totalDiscountAmount / subtotalBeforeDiscount) * 100 * 100) / 100
        : 0
      nameStr = `Discount ${discountValue}%`
    } else {
      // fixed mode: negative price_unit = a discount line in Odoo
      discountValue = -Math.abs(totalDiscountAmount)
      nameStr = 'Discount'
    }

    const discountLine: Record<string, unknown> = {
      name: nameStr,
      quantity: 1,
      price_unit: discountValue,
    }

    if (discountProductId) {
      discountLine['product_id'] = parseInt(discountProductId)
    } else if (discountProductSku) {
      try {
        const ids = await client.execute<number[]>('product.product', 'search', [
          [['default_code', '=', discountProductSku]]
        ], { limit: 1 })
        if (ids.length > 0) discountLine['product_id'] = ids[0]
      } catch (err) {
        console.warn(`[SyncEngine] Failed to resolve discount product by SKU=${discountProductSku}:`, err)
      }
    }

    if (!discountLine['product_id']) {
      console.warn('[SyncEngine] Discount line item skipped: no discount product ID/SKU configured. Configure addDiscountAsLine discountProductId or discountProductSku in the mapping settings.')
    } else {
      lines.push(discountLine)
      console.info(`[SyncEngine] Discount line item appended: name="${nameStr}" price_unit=${discountValue}`)
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
  x_store_id: { ttype: 'char' },
  x_cr_no: { ttype: 'char' },
  x_payment_method: { ttype: 'char' },
  x_payment_status: { ttype: 'char' },
  x_shipping_fee: { ttype: 'float' },
}

// Note: Fixed mapping presets are now sourced exclusively from the database
// (fixed_mappings and fixed_mapping_preset_definitions tables), seeded via migration.
// No hardcoded fallback needed.

// â”€â”€â”€ Helper: derive fixed-mapping preset_key from event + platform â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  }
  if (!model || !action) {
    // Match both "<entity>.create" and "<entity>_create" (and the past-tense variants)
    const m = ev.match(/^(\w+)\.(create|update|delete)d?$/) ?? ev.match(/^(\w+)_(create|update|delete)d?$/)
    if (m) {
      const entity = m[1]
      const verb = m[2]
      // â”€â”€ CRITICAL: each domain maps to its own model. Category events must
      //    resolve to `category` (Odoo model `product.category`), not `product`.
      if      (entity === 'customer')  model = 'customer'
      else if (entity === 'order')     model = 'order'
      else if (entity === 'category')  model = 'category'
      else                              model = 'product'
      action = verb
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

// â”€â”€â”€ Helper: apply fixed mapping settings to Odoo values â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ product.category only gets inventory_valuation + accounting settings â”€â”€
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

  // â”€â”€ Product type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Odoo 18+ changed type selection: 'product' removed, 'consu' means "Goods".
  // Use is_storable + tracking fields instead.  Skip if values.type is already
  // provided by a row-level field mapping.
  const isV18Plus = (odooMajorVersion ?? 0) >= 18
  const inventoryCfg = settings.inventory

  if (!values.type) {
    const defaultType = settings.product_type?.default_type

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

  // â”€â”€ Status fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Price transformations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Price rounding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Name language selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Description language selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Description fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Warehouse / Stock Location â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Resolve warehouse from static DB mapping using Zid location data
  if (workspaceId) {
    const zidLocId = resolvePath(zidData, 'location_id') as string | undefined
    const zidLocName = resolvePath(zidData, 'location_name') as string | undefined
    if (zidLocId || zidLocName) {
      const wh = await resolveWarehouse(workspaceId, platform, zidLocId, zidLocName)
      if (wh) {
        if (wh.warehouse_id && !values.warehouse_id) values.warehouse_id = wh.warehouse_id
        if (wh.location_id && !values.location_id) values.location_id = wh.location_id
      }
    }
  }

  // â”€â”€ Tax sync_mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Category sync_mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Image sync_mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ UOM auto_create â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const uomCfg = settings.uom
  if (uomCfg) {
    if (!uomCfg.auto_create && values.uom_id === undefined) {
      delete values.uom_id
    }
  }



  // â”€â”€ Website settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const webCfg = settings.website
  if (webCfg) {
    if (values.active !== undefined && (webCfg.published === 'always_published' || webCfg.published === 'from_platform')) {
      values.is_published = values.active === true
    }
    if (Array.isArray(webCfg.public_categ_ids) && webCfg.public_categ_ids.length > 0) {
      values.public_categ_ids = [[6, 0, webCfg.public_categ_ids]]
    }
  }

  // â”€â”€ Accounting settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Inventory Valuation settings (product.category) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Helper: safe Odoo create with field-level error fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function safeCreateOdooRecord(
  client: OdooClient,
  model: string,
  values: Record<string, unknown>,
  fallbackValues: Record<string, unknown>,
): Promise<number> {
  try {
    return await client.create(model, values)
  } catch (err: any) {
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

// â”€â”€â”€ Helper: safe Odoo write with field-level error fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function safeWriteOdooRecord(
  client: OdooClient,
  model: string,
  id: number,
  values: Record<string, unknown>,
  fallbackValues: Record<string, unknown>,
): Promise<boolean> {
  try {
    await client.write(model, [id], values)
    return true
  } catch (err: any) {
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

// â”€â”€â”€ Helper: evaluate a single condition against zidData â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Helper: resolve platform order status â†’ Odoo state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Uses DB order_status_mappings table; falls back to defaults from settings.
async function resolveOrderState(
  workspaceId: string,
  zidStatus: string,
  platform?: 'zid' | 'salla' | 'shopify',
): Promise<string | null> {
  let query = supabaseAdmin
    .from('order_status_mappings')
    .select('odoo_state')
    .eq('workspace_id', workspaceId)
    .eq('zid_status', zidStatus) as any
  if (platform) query = query.eq('platform', platform)
  const { data } = await query.maybeSingle()
  if (data?.odoo_state) return data.odoo_state
  return null
}

// â”€â”€â”€ Helper: extract fulfilled items from platform payload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Helper: process partial delivery in Odoo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
          location_id: (await client.searchRead<any>('stock.location', [['usage', '=', 'customer']], ['id'], 1))[0]?.id,
          location_dest_id: (await client.searchRead<any>('stock.location', [['usage', '=', 'internal']], ['id'], 1))[0]?.id,
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

// â”€â”€â”€ Helper: resolve platform payment method â†’ Odoo journal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Helper: resolve platform shipping method â†’ Odoo carrier â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Helper: resolve platform location â†’ Odoo warehouse / stock location â”€â”€â”€â”€
async function resolveWarehouse(
  workspaceId: string,
  platform?: 'zid' | 'salla' | 'shopify',
  zidLocationId?: string,
  zidLocationName?: string,
): Promise<{ warehouse_id?: number; location_id?: number } | null> {
  let query = supabaseAdmin
    .from('warehouse_mappings')
    .select('odoo_warehouse_id, odoo_location_id')
    .eq('workspace_id', workspaceId) as any

  if (platform) query = query.eq('platform', platform)
  if (zidLocationId) {
    query = query.eq('source_location_id', zidLocationId)
  } else if (zidLocationName) {
    query = query.eq('source_location_name', zidLocationName)
  } else {
    return null
  }

  const { data } = await query.maybeSingle()
  if (!data) return null
  return {
    warehouse_id: data.odoo_warehouse_id ?? undefined,
    location_id: data.odoo_location_id ?? undefined,
  }
}

// â”€â”€â”€ Helper: apply conditional rules and currency conversion from DB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Helper: build the Odoo values dict from Zid data + field meta â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function buildOdooValues(
  client: OdooClient,
  mappingItems: FieldMappingItem[],
  zidData: Record<string, unknown>,
  fieldMeta: Map<string, OdooFieldMeta>,
  platform: 'zid' | 'salla' | 'shopify' = 'zid',
  workspaceId?: string
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

    // â”€â”€ Many2one: needs an integer record ID â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (ttype === 'many2one' && relation) {
      if (hasStaticValue) {
        const id = Number(Array.isArray(rawValue) ? rawValue[0] : rawValue)
        if (Number.isInteger(id) && id > 0) {
          values[item.erpField] = id
          continue
        }
      }

      const singleValue = Array.isArray(rawValue) ? rawValue[0] : rawValue
      const resolvedId = await resolveSingleRelationId(client, relation, singleValue, platform, undefined, undefined, workspaceId)
      if (resolvedId !== null) {
        values[item.erpField] = resolvedId
      } else {
        const nameStr = toNameString(singleValue)
        console.warn(`[SyncEngine] Skipping "${item.erpField}" â€” could not resolve "${nameStr}" in ${relation}`)
      }
      continue
    }

    // â”€â”€ Many2many / One2many: needs [(6, 0, [ids])] syntax â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        const resolvedId = await resolveSingleRelationId(client, relation, v, platform, undefined, undefined, workspaceId)
        if (resolvedId !== null) ids.push(resolvedId)
      }
      if (ids.length > 0) {
        values[item.erpField] = [[6, 0, ids]]
      } else {
        console.warn(`[SyncEngine] Skipping "${item.erpField}" â€” no IDs resolved`)
      }
      continue
    }

    // â”€â”€ Binary fields: Odoo expects base64 encoded data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (ttype === 'binary') {
      const base64Data = await resolveBinaryField(rawValue)
      if (base64Data) {
        values[item.erpField] = base64Data
      } else {
        console.warn(`[SyncEngine] Skipping binary field "${item.erpField}" â€” could not resolve. rawValue type=${typeof rawValue} isArray=${Array.isArray(rawValue)} value=${JSON.stringify(rawValue).slice(0, 300)}`)
      }
      continue
    }

    // â”€â”€ Numeric fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let value: unknown = rawValue
    if (ttype === 'boolean' && typeof value === 'string') {
      value = value === 'true'
    } else if (typeof value === 'string' && (item.erpField.endsWith('_ok') || item.erpField === 'active')) {
      value = value === 'true' || value === '1' || value === 'yes'
    }

    // Zid may send weight / cost as { value: 0, unit: "kg" } â€” extract the number
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

    // â”€â”€ Arrays â†’ comma-separated string for plain text fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (Array.isArray(value)) {
      value = value.map(toNameString).join(', ')
    }

    // â”€â”€ Flatten language objects for char/text fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Zid/Salla may send name/description as {ar: '...', en: '...'}.
    // Odoo plain fields expect a string, not a language dict.
    // We flatten here so the fallback values in safeCreateOdooRecord are also clean.
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>
      if ('ar' in obj || 'en' in obj) {
        value = String(obj['ar'] || obj['en'] || '')
      }
    }

    values[item.erpField] = value
  }

  return values
}

// â”€â”€â”€ Log a sync attempt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function logSync(entry: {
  id?: string
  workspace_id: string
  field_mapping_id: string
  event: string
  store_id: string
  zid_entity_id: string | undefined
  odoo_model: string
  odoo_record_id?: number | string | null
  status: 'success' | 'failed' | 'skipped' | 'processing'
  error_message?: string | null
  payload: Record<string, unknown>
  trigger_type?: string
}) {
  console.info(`[SyncEngine] logSync status="${entry.status}" event="${entry.event}" model="${entry.odoo_model}" trigger_type="${entry.trigger_type || 'automatic'}" id="${entry.id || 'new'}"`)
  try {
    // field_mapping_id must be a valid UUID or null â€” non-UUID strings (e.g.
    // "fixed_zid_product_create") cause 22P02 errors in the UUID column.
    const rawId = entry.field_mapping_id
    const isUuid = typeof rawId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)
    const logData: Record<string, any> = {
      workspace_id: entry.workspace_id,
      field_mapping_id: isUuid ? rawId : null,
      event: entry.event,
      store_id: entry.store_id,
      zid_entity_id: entry.zid_entity_id ?? null,
      odoo_model: entry.odoo_model,
      odoo_record_id: entry.odoo_record_id ?? null,
      status: entry.status,
      error_message: entry.error_message ?? null,
      payload: entry.payload,
      trigger_type: entry.trigger_type || 'automatic',
    }

    let query
    if (entry.id) {
      // Fetch current status to check precedence
      const { data: currentLog } = await supabaseAdmin
        .from('sync_logs')
        .select('status, odoo_record_id, error_message, field_mapping_id')
        .eq('id', entry.id)
        .maybeSingle()

      if (currentLog) {
        let finalStatus = entry.status
        const finalRecordId = entry.odoo_record_id || currentLog.odoo_record_id
        let finalError = entry.error_message ?? null
        let finalMappingId = entry.field_mapping_id

        // Status & Mapping ID precedence logic:
        if (currentLog.status === 'success' && entry.status === 'failed') {
          finalStatus = 'failed'
          finalError = entry.error_message ?? null
          finalMappingId = currentLog.field_mapping_id
        } else if (currentLog.status === 'failed' && entry.status === 'success') {
          finalStatus = 'success'
          finalError = null
          finalMappingId = entry.field_mapping_id
        } else if (currentLog.status === 'success' && ['skipped', 'processing'].includes(entry.status)) {
          finalStatus = 'success'
          finalError = null
          finalMappingId = currentLog.field_mapping_id
        } else if (currentLog.status === 'failed' && ['skipped', 'processing'].includes(entry.status)) {
          finalStatus = 'failed'
          finalError = currentLog.error_message ?? null
          finalMappingId = currentLog.field_mapping_id
        } else if (currentLog.status === 'skipped' && entry.status === 'success') {
          finalStatus = 'success'
          finalError = null
          finalMappingId = entry.field_mapping_id
        } else if (currentLog.status === 'skipped' && entry.status === 'failed') {
          finalStatus = 'failed'
          finalError = entry.error_message ?? null
          finalMappingId = entry.field_mapping_id
        } else if (currentLog.status === 'skipped' && ['skipped', 'processing'].includes(entry.status)) {
          finalStatus = 'skipped'
          finalMappingId = currentLog.field_mapping_id
        }

        logData.status = finalStatus
        logData.odoo_record_id = finalRecordId
        logData.error_message = finalError
        logData.field_mapping_id = finalMappingId
      }

      query = supabaseAdmin.from('sync_logs').update(logData).eq('id', entry.id)
    } else {
      query = supabaseAdmin.from('sync_logs').insert([logData])
    }

    const { error: logErr } = await query
    if (logErr) {
      console.error('[SyncEngine] sync_logs write error:', logErr)

      // Self-healing database adapter fallbacks
      if (logErr.code === '22P02' || logErr.code === '23514') {
        console.info('[SyncEngine] Retrying sync_log write with database type-safe fallbacks...')
        const safeLogData = { ...logData }

        // Fix for 22P02 (invalid input syntax for type integer)
        if (logErr.code === '22P02') {
          safeLogData.odoo_record_id = null
          if (entry.odoo_record_id) {
            safeLogData.error_message = `[Record Name: ${entry.odoo_record_id}] ${safeLogData.error_message || ''}`.trim()
          }
        }

        // Fix for 23514 (check constraint violation for 'processing' status)
        if (logErr.code === '23514') {
          if (safeLogData.status === 'processing') {
            console.info('[SyncEngine] Skipping initial processing log due to check constraint')
            return
          }
        }

        let retryQuery
        if (entry.id) {
          retryQuery = supabaseAdmin.from('sync_logs').update(safeLogData).eq('id', entry.id)
        } else {
          retryQuery = supabaseAdmin.from('sync_logs').insert([safeLogData])
        }

        const { error: retryErr } = await retryQuery
        if (retryErr) {
          console.error('[SyncEngine] Failed retry sync_log write:', retryErr)
        } else {
          console.info('[SyncEngine] sync_log written successfully via database fallback route âœ…')
        }
      }
    } else {
      console.info(`[SyncEngine] sync_log ${entry.id ? 'updated' : 'written'} âœ…`)
    }
  } catch (err) {
    console.error('[SyncEngine] Failed to write sync_log (exception):', err)
  }
}

// â”€â”€â”€ Event normalization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  'order.cancelled':            'order.cancel',
  'order.delivered':            'order.deliver',
  'order.payment_status.update':'order.update',
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

function normalizeOdooOperation(operation: unknown, event: string): OdooOperation {
  if (operation === 'create' || operation === 'update' || operation === 'delete' || operation === 'cancel' || operation === 'deliver') {
    return operation as OdooOperation
  }

  const normalizedEvent = normalizeEvent(event)
  if (normalizedEvent.includes('cancel')) return 'cancel'
  if (normalizedEvent.includes('deliver')) return 'deliver'
  if (normalizedEvent.includes('delete')) return 'delete'
  if (normalizedEvent.includes('update') || normalizedEvent.includes('publish')) return 'update'
  return 'create'
}

// â”€â”€â”€ Helper: check if category sync operation is allowed via Standard Mapping settings â”€â”€

async function isEntityOperationAllowed(
  workspaceId: string,
  storeType: string,
  operation: 'create' | 'update' | 'delete' | 'cancel' | 'deliver',
  entityType: string = 'categories'
): Promise<{ allowed: boolean; reason?: string }> {
  const { data: stdRow } = await supabaseAdmin
    .from('standard_mapping_settings')
    .select('settings')
    .eq('workspace_id', workspaceId)
    .eq('store_type', storeType)
    .eq('entity_type', entityType)
    .maybeSingle()

  if (!stdRow?.settings) return { allowed: true }

  const settings = stdRow.settings as Record<string, any>

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

// â”€â”€â”€ Main entry point â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Called from the webhook handler for every incoming Zid event.
 * Finds matching field_mappings and pushes data to Odoo.
 */
export async function processWebhookEvent(
  event: string,
  storeId: number | string,
  data: Record<string, unknown>,
  platformHint?: 'zid' | 'salla' | 'shopify'
): Promise<SyncEngineResult> {
  const storeIdNum = Number(storeId)
  const storeIdStr = Number.isNaN(storeIdNum) ? String(storeId) : String(storeIdNum)
  const normalizedEvent = normalizeEvent(event)
  const result: SyncEngineResult = {
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    records: [],
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
            data = {
              ...response.data.customer,
              ...data,
            }
          }
        }
      } catch (err: any) {
        console.warn(`[SyncEngine] Failed to fetch full Zid customer details for ID ${customerId}:`, err?.message ?? err)
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
            data = {
              ...productData,
              ...data,
            }
          }
        }
      } catch (err: any) {
        console.warn(`[SyncEngine] Failed to fetch full Zid product details for ID ${productId}:`, err?.message ?? err)
      }
    }
  }

  // Run cleanup of expired logs in the background
  cleanupExpiredLogs().catch(err => console.error('[SyncEngine] Background cleanup failed:', err))

  // 1. Find all field_mappings matching this store + event
  if (!isProduct) {
    console.info(`[SyncEngine] Querying field_mappings...`)
  }
  const { data: mappingRows, error: mappingErr } = await supabaseAdmin
    .from('field_mappings')
    .select('*')
    .or('store_id.eq.' + storeIdStr + ',merchant_id.eq.' + storeIdStr)

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

  // â”€â”€ 1a. Fixed Mapping as FALLBACK (only when no field_mappings exist) â”€â”€â”€â”€
  // This prevents duplicate writes: if the user has custom field mappings,
  // those take priority over the preset. The preset only runs as a default
  // when the user hasn't created any field_mapping for this event.
  if (filteredRows.length === 0) {
    const platform: 'zid' | 'salla' | 'shopify' = platformHint ?? (
      normalizedEvent.includes('shopify') ? 'shopify'
      : normalizedEvent.includes('salla') ? 'salla'
      : 'zid'
    )
    const presetKey = derivePresetKey(normalizedEvent, platform)

    if (presetKey) {
      const presetRecord = await processFixedMappingFallback(
        presetKey, event, storeIdStr, data, platform, mappingRows as FieldMappingRow[] | null
      )
      if (presetRecord) {
        result.records.push(presetRecord)
        result.processed += 1
        result[presetRecord.status] += 1
        if (presetRecord.status === 'failed') {
          try {
            const { enqueueFailedSync } = await import('./sync-queue')
            enqueueFailedSync({
              workspaceId: mappingRows?.[0]?.workspace_id || '',
              storeId: storeIdStr,
              event,
              platform: platformHint || 'zid',
              payload: data,
              errorMessage: presetRecord.message || '',
            }).catch(() => {})
          } catch { /* ignore */ }
        }
        await notifySyncForRecord(
          mappingRows?.[0]?.workspace_id ?? undefined,
          presetRecord,
          event,
          presetRecord.mappingName,
          presetRecord.mappingId,
          presetRecord.model,
          storeIdStr,
          presetRecord.message,
        )
      }
    }
    console.info(`[SyncEngine] ===== processWebhookEvent END (fixed mapping fallback, total=${result.processed}) =====`)
    return result
  }

  // â”€â”€ 1b. Field mappings (when user-defined mappings exist) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (!isProduct) {
    console.info(`[SyncEngine] Found ${filteredRows.length} field_mapping(s) to process`)
  }

  for (const row of filteredRows as FieldMappingRow[]) {
    const record = await processSingleMapping(row, event, storeIdStr, data, 'automatic', undefined, platformHint)
    result.records.push(record)
    result.processed += 1
    result[record.status] += 1
    // Enqueue failed operations for retry
    if (record.status === 'failed' && row.workspace_id) {
      try {
        const { enqueueFailedSync } = await import('./sync-queue')
        enqueueFailedSync({
          workspaceId: row.workspace_id,
          storeId: storeIdStr,
          event,
          platform: platformHint || 'zid',
          payload: data,
          errorMessage: record.message || '',
        }).catch(() => {})
      } catch { /* ignore queue errors */ }
    }
    await notifySyncForRecord(
      row.workspace_id,
      record,
      event,
      record.mappingName,
      record.mappingId,
      record.model,
      storeIdStr,
      record.message,
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

// â”€â”€â”€ Fixed Mapping fallback: runs independently when no field_mapping matches â”€â”€
// Also runs BEFORE field_mappings so Fixed Mapping values are sent to Odoo first.
async function processFixedMappingFallback(
  presetKey: string,
  event: string,
  storeIdStr: string,
  zidData: Record<string, unknown>,
  platform: 'zid' | 'salla' | 'shopify',
  existingMappings: FieldMappingRow[] | null
): Promise<SyncEngineResult['records'][number] | null> {
  // Borrow workspace + connection from an existing field_mapping if available
  let workspaceId: string | undefined
  let erpConnectionId: string | null = null

  if (existingMappings && existingMappings.length > 0) {
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
  }

  if (!workspaceId) {
    console.warn(`[FixedMapping] Cannot resolve workspace_id for store=${storeIdStr}, preset=${presetKey}`)
    return null
  }

  // Check workspace-level active state
  const { data: wsState } = await supabaseAdmin
    .from('fixed_mapping_settings')
    .select('active')
    .eq('workspace_id', workspaceId)
    .eq('preset_key', presetKey)
    .maybeSingle()
  const isActive = wsState?.active !== false
  if (!isActive) {
    console.info(`[FixedMapping] Preset "${presetKey}" is disabled for workspace=${workspaceId}`)
    return null
  }

  // ——— Check Standard Mapping settings for entity operation allowance —————
  if (presetKey.includes('category') && workspaceId) {
    const storeType = presetKey.split('_')[0]
    const normalizedEvent = normalizeEvent(event)
    const operation: 'create' | 'update' | 'delete' = normalizedEvent.includes('delete') ? 'delete'
      : normalizedEvent.includes('update') || normalizedEvent.includes('publish') ? 'update'
      : 'create'
    const catCheck = await isEntityOperationAllowed(workspaceId, storeType, operation, 'categories')
    if (!catCheck.allowed) {
      console.info(`[FixedMapping] Category operation blocked for preset="${presetKey}": ${catCheck.reason}`)
      return null
    }
  }
  if (presetKey.includes('product') && workspaceId) {
    const storeType = presetKey.split('_')[0]
    const normalizedEvent = normalizeEvent(event)
    const operation: 'create' | 'update' | 'delete' = normalizedEvent.includes('delete') ? 'delete'
      : normalizedEvent.includes('update') || normalizedEvent.includes('publish') ? 'update'
      : 'create'
    const prodCheck = await isEntityOperationAllowed(workspaceId, storeType, operation, 'products')
    if (!prodCheck.allowed) {
      console.info(`[FixedMapping] Product operation blocked for preset="${presetKey}": ${prodCheck.reason}`)
      return null
    }
  }
  if (presetKey.includes('customer') && workspaceId) {
    const storeType = presetKey.split('_')[0]
    const normalizedEvent = normalizeEvent(event)
    const operation: 'create' | 'update' | 'delete' = normalizedEvent.includes('delete') ? 'delete'
      : normalizedEvent.includes('update') || normalizedEvent.includes('publish') ? 'update'
      : 'create'
    const custCheck = await isEntityOperationAllowed(workspaceId, storeType, operation, 'customers')
    if (!custCheck.allowed) {
      console.info(`[FixedMapping] Customer operation blocked for preset="${presetKey}": ${custCheck.reason}`)
      return null
    }
  }

  // Merge field rows from DB
  const defaultFieldPairs: any[] = []
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
  const fieldPairs = [...defaultFieldPairs, ...customFieldPairs]

  const nonArchived = fieldPairs.filter((r: any) => r.odoo_field && r.platform_field && !r.archived)
  if (nonArchived.length === 0) {
    // ——— Hardcoded fallback for known presets —————————————————————————————
    const KNOWN_PRESET_FIELDS: Record<string, { odoo_field: string; platform_field: string }[]> = {
      'zid_category': [
        { odoo_field: 'name', platform_field: 'name.ar' },
        { odoo_field: 'parent_id', platform_field: 'parent_id' },
        { odoo_field: 'x_zid_id', platform_field: 'id' },
      ],
      'salla_category': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'x_salla_id', platform_field: 'id' },
      ],
      'shopify_category': [
        { odoo_field: 'name', platform_field: 'title' },
        { odoo_field: 'x_zid_id', platform_field: 'id' },
      ],
      'zid_product_create': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'default_code', platform_field: 'sku' },
        { odoo_field: 'barcode', platform_field: 'barcode' },
        { odoo_field: 'list_price', platform_field: 'price' },
        { odoo_field: 'standard_price', platform_field: 'cost' },
        { odoo_field: 'description_sale', platform_field: 'description' },
        { odoo_field: 'weight', platform_field: 'weight' },
        { odoo_field: 'x_zid_id', platform_field: 'id' },
      ],
      'zid_product_update': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'default_code', platform_field: 'sku' },
        { odoo_field: 'barcode', platform_field: 'barcode' },
        { odoo_field: 'list_price', platform_field: 'price' },
        { odoo_field: 'standard_price', platform_field: 'cost' },
        { odoo_field: 'description_sale', platform_field: 'description' },
        { odoo_field: 'weight', platform_field: 'weight' },
        { odoo_field: 'x_zid_id', platform_field: 'id' },
      ],
      'zid_product_delete': [
        { odoo_field: 'x_zid_id', platform_field: 'id' },
      ],
      'zid_customer_create': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'email', platform_field: 'email' },
        { odoo_field: 'mobile', platform_field: 'mobile' },
        { odoo_field: 'phone', platform_field: 'telephone' },
        { odoo_field: 'vat', platform_field: 'tax_number' },
        { odoo_field: 'company_name', platform_field: 'business_name' },
        { odoo_field: 'company_registry', platform_field: 'commercial_registration' },
        { odoo_field: 'street', platform_field: 'default_address.address_street || addresses.0.address_street' },
        { odoo_field: 'street2', platform_field: 'default_address.address_district || addresses.0.address_district' },
        { odoo_field: 'city', platform_field: 'default_address.city.ar_name || addresses.0.city.ar_name || city.ar_name' },
        { odoo_field: 'country_id', platform_field: 'default_address.country.ar_name || addresses.0.country.ar_name' },
        { odoo_field: 'x_zid_id', platform_field: 'id' },
      ],
      'zid_customer_update': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'email', platform_field: 'email' },
        { odoo_field: 'mobile', platform_field: 'mobile' },
        { odoo_field: 'phone', platform_field: 'telephone' },
        { odoo_field: 'vat', platform_field: 'tax_number' },
        { odoo_field: 'company_name', platform_field: 'business_name' },
        { odoo_field: 'company_registry', platform_field: 'commercial_registration' },
        { odoo_field: 'street', platform_field: 'default_address.address_street || addresses.0.address_street' },
        { odoo_field: 'street2', platform_field: 'default_address.address_district || addresses.0.address_district' },
        { odoo_field: 'city', platform_field: 'default_address.city.ar_name || addresses.0.city.ar_name || city.ar_name' },
        { odoo_field: 'country_id', platform_field: 'default_address.country.ar_name || addresses.0.country.ar_name' },
        { odoo_field: 'x_zid_id', platform_field: 'id' },
      ],
      'salla_customer_create': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'email', platform_field: 'email' },
        { odoo_field: 'mobile', platform_field: 'mobile' },
        { odoo_field: 'x_salla_id', platform_field: 'id' },
      ],
      'shopify_customer_create': [
        { odoo_field: 'name', platform_field: 'first_name' },
        { odoo_field: 'email', platform_field: 'email' },
        { odoo_field: 'x_zid_id', platform_field: 'id' },
      ],
      'zid_order_create': [
        { odoo_field: 'name', platform_field: 'code' },
        { odoo_field: 'amount_total', platform_field: 'order_total' },
        { odoo_field: 'date_order', platform_field: 'created_at' },
        { odoo_field: 'x_zid_id', platform_field: 'id' },
      ],
      'salla_order_create': [
        { odoo_field: 'name', platform_field: 'reference_id' },
        { odoo_field: 'amount_total', platform_field: 'total' },
        { odoo_field: 'date_order', platform_field: 'created_at.date' },
        { odoo_field: 'x_salla_id', platform_field: 'id' },
      ],
      'shopify_order_create': [
        { odoo_field: 'name', platform_field: 'name' },
        { odoo_field: 'amount_total', platform_field: 'total_price' },
        { odoo_field: 'date_order', platform_field: 'created_at' },
        { odoo_field: 'x_zid_id', platform_field: 'id' },
      ],
    }
    const fallbackRows = KNOWN_PRESET_FIELDS[presetKey]
    if (fallbackRows) {
      fieldPairs.push(...fallbackRows)
      console.info(`[FixedMapping] Using hardcoded fallback fields for preset "${presetKey}"`)
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
      const { data: stdRow } = await supabaseAdmin
        .from('standard_mapping_settings')
        .select('settings')
        .eq('workspace_id', workspaceId)
        .eq('store_type', storeType)
        .eq('entity_type', entityType)
        .maybeSingle()
      if (stdRow?.settings) {
        const stdSettings = stdRow.settings as Record<string, any>
        if (stdSettings.match_odoo_field && stdSettings.match_zid_field) {
          // Filter out default ID fields mapping so the user's custom match field override is utilized
          const defaultOdooFields = ['x_zid_id', 'zid_id', 'x_salla_id', 'salla_id', 'x_shopify_id', 'shopify_id']
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
  const normalizedEvent = normalizeEvent(event)
  const odooOperation: OdooOperation = normalizedEvent.includes('cancel') ? 'cancel'
    : normalizedEvent.includes('deliver') ? 'deliver'
    : normalizedEvent.includes('delete') ? 'delete'
    : normalizedEvent.includes('update') || normalizedEvent.includes('publish') ? 'update'
    : 'create'

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
  let odooValues = await buildOdooValues(client, mappingItems, zidData, fieldMeta, syncPlatform, workspaceId)

  if (Object.keys(odooValues).length === 0 && odooOperation !== 'delete') {
    console.warn(`[FixedMapping] No values extracted for preset="${presetKey}"`)
    return null
  }

  // Create a minimal virtual mapping for logging
  const virtualMapping: FieldMappingRow = {
    id: `fixed_${presetKey}`,
    workspace_id: workspaceId,
    erp_connection_id: erpConnectionId,
    merchant_id: '',
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
      zidEntityId: String(zidData.id ?? zidData.product_id ?? ''),
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
  const odooOperation = normalizeOdooOperation(mapping.odoo_operation, event)

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
    const check = await isEntityOperationAllowed(mapping.workspace_id, storeType, odooOperation, entityType)
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
      console.warn(`[SyncEngine] No field items configured for model "${odooModel}"`)
      await logSync({ id: logId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: 'No field mapping items configured', payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: 'No field mapping items configured' }
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
  let mappingItems: FieldMappingItem[] = mapping.mappings?.[odooModel] ?? []

  if (mappingItems.length === 0 && odooOperation !== 'delete') {
    console.warn(`[SyncEngine] No field items configured for model "${odooModel}"`)
    await logSync({ id: logId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: 'No field mapping items configured', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: 'No field mapping items configured' }
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
  const odooValues = await buildOdooValues(client, mappingItems, zidData, fieldMeta, platform, mapping.workspace_id)

  // ——— 5a. If this is sale.order, build order_line items with discount/shipping —
  if (odooModel === 'sale.order') {
    // Load standard mapping settings once (avoid duplicate DB query inside buildOrderLineItems)
    let orderStdSettings: Record<string, any> | null = null
    if (mapping.workspace_id && platform) {
      try {
        const { data: stdRow } = await supabaseAdmin
          .from('standard_mapping_settings')
          .select('settings')
          .eq('workspace_id', mapping.workspace_id)
          .eq('store_type', platform)
          .eq('entity_type', 'orders')
          .maybeSingle()
        if (stdRow?.settings) {
          orderStdSettings = stdRow.settings as Record<string, any>
        }
      } catch (err) {
        console.warn('[SyncEngine] Failed to load standard mapping settings for order line fallbacks:', err)
      }
    }
    const orderLines = await buildOrderLineItems(
      client,
      mapping,
      zidData,
      fieldMeta,
      odooValues,
      platform,
      orderStdSettings
    )
    if (orderLines.length > 0) {
      odooValues['order_line'] = orderLines.map(item => [0, 0, item])
    }
  }

  if (Object.keys(odooValues).length === 0 && odooOperation !== 'delete') {
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
  const mainDuplicateId = await findExistingOdooRecord(client, 'product.template', zidData, odooValues, mapping, matchStrategy, fixedMatch)
  let mainRecordId: number | null = null
  if (mainDuplicateId !== null) {
    console.info(`[SyncEngine] 🔄 المنتج الرئيسي موجود بالفعل (ID: #${mainDuplicateId}). جاري تحديث البيانات...`)
    await client.write('product.template', [mainDuplicateId], odooValues)
    mainRecordId = mainDuplicateId
  } else {
    console.info(`[SyncEngine] ➕ جاري إنشاء المنتج الرئيسي "${mainProductName}" في أودو...`)
    mainRecordId = await client.create('product.template', odooValues)
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
      default_code: variant.sku || odooValues.default_code,
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
    const duplicateId = await findExistingOdooRecord(client, 'product.template', variantMockData, variantOdooValues, mapping, matchStrategy, fixedMatch)

    let recordId: number
    if (duplicateId !== null) {
      await client.write('product.template', [duplicateId], variantOdooValues)
      recordId = duplicateId
    } else {
      console.info(`[SyncEngine] ➕ جاري إنشاء متغير كمنتج منفصل "${variantName}" في أودو...`)
      recordId = await client.create('product.template', variantOdooValues)
    }

    // Trigger stock/inventory update if quantity is provided
    if (variant.quantity !== undefined) {
      await updateOdooStock(client, recordId, variant.quantity, defaultLocationId, infiniteValue).catch(err => {
        console.warn(`[SyncEngine] Failed to update stock for standalone variant #${recordId}:`, err)
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
  const duplicateId = await findExistingOdooRecord(client, 'product.template', zidData, odooValues, mapping, matchStrategy, fixedMatch)
  
  let templateId: number
  if (duplicateId !== null) {
    console.info(`[SyncEngine] 🔄 المنتج الرئيسي موجود بالفعل (ID: #${duplicateId}). جاري تحديث البيانات...`)
    await client.write('product.template', [duplicateId], odooValues)
    templateId = duplicateId
  } else {
    console.info(`[SyncEngine] ➕ جاري إنشاء المنتج الرئيسي في أودو...`)
    templateId = await client.create('product.template', odooValues)
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
      const v1 = attrs1[k]
      const keyMatch = keys2.find(k2 => k2.toLowerCase() === k.toLowerCase())
      if (!keyMatch) return false
      return v1.toLowerCase() === attrs2[keyMatch].toLowerCase()
    })
  }

  const settings = (mapping.mappings as any)?.__settings || {}
  const varOdooField = (mapping as any).variant_odoo_match_field || settings.variantOdooMatchField || ''
  const varZidField = (mapping as any).variant_zid_match_field || settings.variantZidMatchField || ''

  // Step 6: Variant Update (Update matching product.product records)
  const basePrice = parseFloat(String(odooValues.list_price || zidData.price || '0')) || 0
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
        await updateOdooStock(client, matchingOdooVar.id, variant.quantity, defaultLocationId, infiniteValue).catch(err => {
          console.warn(`[SyncEngine] Failed to update stock for variant product #${matchingOdooVar.id}:`, err)
        })
      }
      updatedCount++
    } else {
      console.warn(`[SyncEngine] No matching Odoo variant found for attributes:`, JSON.stringify(variant.attributes))
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
    const searchField = platform === 'salla' ? 'x_salla_id'
      : platform === 'shopify' ? 'x_shopify_id'
      : 'x_zid_id'
    try {
      parentIds = await client.search('product.template', [[searchField, '=', String(parentZidId)]], 1)
    } catch {
      const fallbackField = platform === 'salla' ? 'salla_id'
        : platform === 'shopify' ? 'shopify_id'
        : 'zid_id'
      try {
        parentIds = await client.search('product.template', [[fallbackField, '=', String(parentZidId)]], 1)
      } catch {
        // Leave parentIds empty
      }
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
  const templateRead = await client.read<any>('product.template', [templateId], ['list_price']).catch(() => [])
  const basePrice = templateRead.length > 0 ? (templateRead[0].list_price || 0) : 0

  const rawAttrs = zidData.attributes || zidData.features || zidData.option_values || []
  const attributes: Record<string, string> = {}
  if (Array.isArray(rawAttrs)) {
    rawAttrs.forEach((attr: any) => {
      const attrName = toNameString(attr.name || attr.label || attr.option_name || attr.option_label)
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
      await updateOdooStock(client, matchingOdooVar.id, qtyVal, defaultLocationId, infiniteValue).catch(err => {
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
    const errorMsg = `Could not match variant with attributes: ${JSON.stringify(attributes)}`
    console.warn(`[SyncEngine] âš ï¸  ${errorMsg}`)
    await logSync({
      id: existingLogId,
      workspace_id: mapping.workspace_id,
      field_mapping_id: mapping.id,
      event,
      store_id: storeId,
      zid_entity_id: zidEntityId,
      odoo_model: 'product.product',
      status: 'failed',
      error_message: errorMsg,
      payload: zidData,
      trigger_type: triggerType
    })
    return {
      mappingId: mapping.id,
      mappingName: mapping.name,
      model: 'product.product',
      status: 'failed',
      message: errorMsg
    }
  }
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

  // â”€â”€â”€ Merge settings for the Odoo model (product.template, res.partner, sale.order, product.category) â”€â”€
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
      const { data: stdRow } = await supabaseAdmin
        .from('standard_mapping_settings')
        .select('settings')
        .eq('workspace_id', mapping.workspace_id)
        .eq('store_type', storeType)
        .eq('entity_type', entityType)
        .maybeSingle()
      if (stdRow?.settings) {
        const stdSettings = stdRow.settings as Record<string, any>
        const override: Record<string, any> = { ...stdSettings }
        if (stdSettings.costing_method !== undefined || stdSettings.inventory_valuation !== undefined) {
          override.inventory_valuation = {
            ...((mergedSettings as any)?.inventory_valuation || {}),
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
            ...((mergedSettings as any)?.[matchKey] || {}),
            ...(stdSettings.match_zid_field ? { zid_match_field: stdSettings.match_zid_field } : {}),
            ...(stdSettings.match_odoo_field ? { odoo_match_field: stdSettings.match_odoo_field } : {}),
          }
        }
        if (stdSettings.on_delete) {
          override.delete = {
            ...((mergedSettings as any)?.delete || {}),
            strategy: stdSettings.on_delete === 'delete_or_archive' ? 'try_delete_archive'
              : stdSettings.on_delete === 'nothing' ? 'skip'
              : stdSettings.on_delete,
          }
        }
        if (Object.keys(override).length > 0) {
          ms = { ...override, ...ms }
          mergedSettings = ms
          if (entityType !== 'products') {
            console.info(`[SyncEngine] Merged standard_mapping_settings for ${storeType}/${entityType}:`, override)
          }
        }
      }
    }
  }

  // Resolve platform once for reuse across order/cancel/deliver operations
  const execPlatform: 'zid' | 'salla' | 'shopify' = (() => {
    const e = event.toLowerCase()
    return platformHint ?? (
      e.startsWith('shopify:') || e.includes('shopify') ? 'shopify'
      : e.includes('salla') ? 'salla'
      : e.endsWith('.created') || e.endsWith('.updated') || e.includes('.status.') ? 'salla'
      : 'zid'
    )
  })()

  const matchStrategy = (mergedSettings as any)?.matching?.strategy
  let fixedMatch = (mergedSettings as any)?.matching?.odoo_field && (mergedSettings as any)?.matching?.zid_field
    ? { odoo_field: (mergedSettings as any).matching.odoo_field, zid_field: (mergedSettings as any).matching.zid_field }
    : undefined

  // ── Entity-specific matching: override fixedMatch with settings ──
  const entityMatchModels = ['product.category', 'product.template', 'res.partner', 'sale.order']
  if (entityMatchModels.includes(odooModel)) {
    const cfgKey = odooModel === 'product.category' ? 'category'
      : odooModel === 'product.template' ? 'product'
      : odooModel === 'res.partner' ? 'customer'
      : 'order'
    const entityCfg = (mergedSettings as any)?.[cfgKey]
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
      const defaultFields = ['x_zid_id', 'zid_id', 'x_salla_id', 'salla_id', 'x_shopify_id', 'shopify_id']
      defaultFields.forEach(f => {
        if (f !== odooField) {
          delete effectiveOdooValues[f]
          delete odooValues[f]
        }
      })
      console.info(`[SyncEngine] Generic Injected Match Field: ${odooField} = ${JSON.stringify(effectiveOdooValues[odooField])}`)
    }
  }
  const defaultLocationId = (mergedSettings as any)?.inventory?.default_location_id ?? undefined
  const skipDuplicateCheck = (mergedSettings as any)?.matching?.action === 'create_duplicate'
  const infiniteValue = (mergedSettings as any)?.stock?.infinite_value
  const pSettings = (mergedSettings as any)?.price
    ? { markup_percent: (mergedSettings as any).price.markup_percent || 0, rounding: (mergedSettings as any).price.rounding || 'nearest', decimal_places: (mergedSettings as any).price.decimal_places ?? 2 }
    : undefined

  if (odooModel === 'product.template' && (odooOperation === 'create' || odooOperation === 'update')) {
    const ev = event.toLowerCase()
    const platform: 'zid' | 'salla' | 'shopify' = ev.startsWith('shopify:') || ev.includes('shopify') ? 'shopify'
      : ev.endsWith('.created') || ev.endsWith('.updated') || ev.includes('salla') ? 'salla'
      : 'zid'
    const variantSyncMode = (mergedSettings as any)?.variant?.sync_mode || (mapping as any).variant_sync_mode || 'AS_VARIANTS'
    const companyName = (mergedSettings as any)?.company_id ? `المعرف ${(mergedSettings as any).company_id}` : 'الافتراضية'
    console.info(`[SyncEngine] ⚙️ إعدادات تسجيل المنتج في أودو: [الشركة: ${companyName}] | [طريقة المزامنة للمتغيرات: ${variantSyncMode}]`)
    console.info(`[SyncEngine] ⏳ محاولة التسجيل في أودو للموديل: ${odooModel} (العملية: ${odooOperation})...`)

    // Apply fixed mapping settings to values (type, sale_ok, price, warehouse, etc.)
    const majorVersion = await client.getMajorVersion().catch(() => 17)
    effectiveOdooValues = await applyFixedSettingsToValues(odooValues, mergedSettings, zidData, majorVersion, mapping.workspace_id, platform, odooModel)

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
    const catOverride = mapping.workspace_id ? await applyCategoryMappingOverrides(mapping.workspace_id, catPlatform, zidData) : {}
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
    const catCfg = (mergedSettings as any)?.category
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
  }

  // â”€â”€ Order-specific settings (sale.order) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (odooModel === 'sale.order' && (odooOperation === 'create' || odooOperation === 'update')) {
    const ev = event.toLowerCase()
    const platform = (platformHint || (ev.startsWith('shopify:') || ev.includes('shopify') ? 'shopify'
      : ev.endsWith('.created') || ev.endsWith('.updated') || ev.includes('salla') ? 'salla'
      : 'zid')) as 'zid' | 'salla' | 'shopify'
    const majorVersion = await client.getMajorVersion().catch(() => 17)
    effectiveOdooValues = await applyFixedSettingsToValues(odooValues, mergedSettings, zidData, majorVersion, mapping.workspace_id, platform, odooModel)

    const orderSettings = (mergedSettings as any)?.order
    // ── Auto-resolve partner_id from customer data ──────────────
    if (!effectiveOdooValues.partner_id) {
      const customerData = (zidData as any)?.customer || {}
      const custName = String(customerData.name || customerData.first_name || '')
      const custEmail = String(customerData.email || '')
      const custPhone = String(customerData.phone || customerData.mobile || '')
      const custTaxId = String(customerData.tax_number || customerData.vat || '')
      const custCommercialReg = String(customerData.commercial_registration || '')
      if (custName || custEmail || custPhone || custTaxId) {
        try {
          let partnerId: number | null = null
          // Priority 1: Search by tax_id/vat (most reliable identifier)
          if (custTaxId && !partnerId) {
            const ids = await client.search('res.partner', [
              ['|', ['vat', '=', custTaxId], ['tax_id', '=', custTaxId]]
            ], 1)
            if (ids.length > 0) partnerId = ids[0]
          }
          // Priority 2: Search by email
          if (custEmail && !partnerId) {
            const ids = await client.search('res.partner', [[['email', '=', custEmail]]], 1)
            if (ids.length > 0) partnerId = ids[0]
          }
          // Priority 3: Search by phone with ilike
          if (custPhone && !partnerId) {
            const ids = await client.search('res.partner', [
              ['|', ['phone', 'ilike', custPhone], ['mobile', 'ilike', custPhone]]
            ], 1)
            if (ids.length > 0) partnerId = ids[0]
          }
          // Priority 4: Search by name with ilike
          if (custName && !partnerId) {
            const ids = await client.search('res.partner', [[['name', 'ilike', custName]]], 1)
            if (ids.length > 0) partnerId = ids[0]
          }
          // Priority 5: Search by commercial registration
          if (custCommercialReg && !partnerId) {
            const ids = await client.search('res.partner', [[['company_registry', '=', custCommercialReg]]], 1)
            if (ids.length > 0) partnerId = ids[0]
          }
          // If no partner found, create one
          if (!partnerId && custName) {
            const partnerVals: Record<string, any> = { name: custName }
            if (custEmail) partnerVals.email = custEmail
            if (custPhone) partnerVals.phone = custPhone
            if (custPhone) partnerVals.mobile = custPhone
            if (custTaxId) partnerVals.vat = custTaxId
            const newId = await client.create('res.partner', partnerVals)
            if (newId) {
              partnerId = newId
              console.info(`[SyncEngine] Created new partner #${partnerId} for "${custName}"`)
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
    if (orderSettings) {
      // Resolve order state from DB mapping or fallback
      const zidStatus = (zidData as any)?.status || (zidData as any)?.order_status || ''
      if (zidStatus && !effectiveOdooValues.state) {
        const resolvedState = await resolveOrderState(
          mapping.workspace_id,
          String(zidStatus),
          platform
        )
        if (resolvedState) {
          effectiveOdooValues.state = resolvedState
        }
      }
      // Resolve payment method â†’ Odoo journal from DB mapping
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
      // Resolve shipping method â†’ Odoo carrier from DB mapping
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
      // Apply store-specific warehouse mapping if available
      const storeWhMappings = (orderSettings as any)?.store_warehouse_mappings as Record<string, number> | undefined
      if (storeWhMappings && !effectiveOdooValues.warehouse_id) {
        const storeKey = String(storeId || '')
        if (storeKey && storeWhMappings[storeKey]) {
          effectiveOdooValues.warehouse_id = storeWhMappings[storeKey]
        }
      }
      // Apply default warehouse from settings if not already set
      if (orderSettings.default_warehouse_id && !effectiveOdooValues.warehouse_id) {
        effectiveOdooValues.warehouse_id = orderSettings.default_warehouse_id
      }
      // Apply default pricelist from settings if not already set
      if (orderSettings.default_pricelist_id && !effectiveOdooValues.pricelist_id) {
        effectiveOdooValues.pricelist_id = orderSettings.default_pricelist_id
      }
      // Apply default payment term from settings if not already set
      if (orderSettings.default_payment_term_id && !effectiveOdooValues.payment_term_id) {
        effectiveOdooValues.payment_term_id = orderSettings.default_payment_term_id
      }
      // Auto-confirm order (set state = 'sale')
      if (orderSettings.auto_confirm && effectiveOdooValues.state === 'draft') {
        effectiveOdooValues.state = 'sale'
      }
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
  }

  // â”€â”€ Cancel operation (sale.order only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (odooOperation === 'cancel') {
    const existingId = await findExistingOdooRecord(client, odooModel, zidData, odooValues, mapping, matchStrategy, fixedMatch)
    if (existingId === null) {
      const msg = `No matching ${odooModel} record found in Odoo for cancel`
      console.warn(`[SyncEngine] ${msg}`)
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: msg, payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: msg }
    }
    try {
      await client.write(odooModel, [existingId], { state: 'cancel' })
      console.info(`[SyncEngine] ✅ Cancelled ${odooModel} #${existingId} in Odoo (zid_id="${zidEntityId}")`)
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: existingId }
    } catch (err: any) {
      const errMsg = err?.message ?? String(err)
      console.error(`[SyncEngine] ❌ Failed to cancel ${odooModel} #${existingId}:`, errMsg)
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'failed', error_message: errMsg, payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'failed', message: errMsg }
    }
  }

  // â”€â”€ Deliver operation (sale.order only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (odooOperation === 'deliver') {
    const existingId = await findExistingOdooRecord(client, odooModel, zidData, odooValues, mapping, matchStrategy, fixedMatch)
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
      const partialFulfillment = (mergedSettings as any)?.order?.partial_fulfillment
      if (partialFulfillment) {
        // Partial fulfillment: deliver only the fulfilled items from the payload
        const fulfilledItems = extractFulfilledItems(zidData)
        if (fulfilledItems.length > 0) {
          await processPartialDelivery(client, odooModel, existingId, fulfilledItems, execPlatform)
        } else {
          // Fallback to full delivery if no fulfillment items found
          await client.execute(odooModel, 'action_picking', [existingId])
        }
      } else {
        // Full delivery: create complete stock picking
        await client.execute(odooModel, 'action_picking', [existingId])
      }
      console.info(`[SyncEngine] ✅ Delivered ${odooModel} #${existingId} in Odoo (zid_id="${zidEntityId}")`)
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType })
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
    if (odooModel === 'product.category' && (mergedSettings as any)?.odoo_category_id) {
      duplicateId = Number((mergedSettings as any).odoo_category_id)
      console.info(`[SyncEngine] Using manual category mapping Odoo ID for create check: ${duplicateId}`)
    } else {
      duplicateId = await findExistingOdooRecord(client, odooModel, zidData, odooValues, mapping, matchStrategy, fixedMatch)
    }
    if (duplicateId !== null) {
      console.info(`[SyncEngine] Matching ${odooModel} #${duplicateId} already exists in Odoo. Updating existing record...`)
      const ok = await safeWriteOdooRecord(client, odooModel, duplicateId, effectiveOdooValues, odooValues)
      if (!ok) throw new Error(`Odoo write returned false for ${odooModel} #${duplicateId}`)
      console.info(`[SyncEngine] ✅ Updated existing ${odooModel} #${duplicateId} in Odoo (zid_id="${zidEntityId}")`)
      if (odooModel === 'product.template') {
        await syncProductBom(client, duplicateId, zidData, mergedSettings, execPlatform, mapping.workspace_id).catch(err => {
          console.warn(`[SyncEngine] Failed to sync BoM for duplicate template:`, err)
        })
      }
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: duplicateId, status: 'success', payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: duplicateId, message: `Updated existing ${odooModel} #${duplicateId}` }
    }

    const newId = await safeCreateOdooRecord(client, odooModel, effectiveOdooValues, odooValues)
    console.info(`[SyncEngine] ✅ Created ${odooModel} #${newId} in Odoo (zid_id="${zidEntityId}")`)
    if (odooModel === 'product.template') {
      await syncProductBom(client, newId, zidData, mergedSettings, execPlatform, mapping.workspace_id).catch(err => {
        console.warn(`[SyncEngine] Failed to sync BoM for new template:`, err)
      })
    }

    // Auto-invoice: confirm + create invoice if enabled
    const autoInvoice = (mergedSettings as any)?.order?.auto_invoice
    if (odooModel === 'sale.order' && autoInvoice) {
      try {
        const recs = await client.searchRead<any>(odooModel, [['id', '=', newId]], ['state'])
        if (recs.length > 0 && (recs[0].state === 'draft' || recs[0].state === 'sent')) {
          await client.execute(odooModel, 'action_confirm', [newId])
          console.info(`[SyncEngine] Confirmed order #${newId} for auto-invoice`)
        }
        await client.execute(odooModel, 'action_invoice_create', [newId])
        console.info(`[SyncEngine] ✅ Invoice created for ${odooModel} #${newId}`)
      } catch (invErr: any) {
        console.warn(`[SyncEngine] Auto-invoice failed for ${odooModel} #${newId}:`, invErr?.message || invErr)
      }
    }

    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: newId, status: 'success', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: newId }
  }

  let existingId: number | null = null
  if (odooModel === 'product.category' && (mergedSettings as any)?.odoo_category_id) {
    existingId = Number((mergedSettings as any).odoo_category_id)
    console.info(`[SyncEngine] Using manual category mapping Odoo ID for update: ${existingId}`)
  } else {
    existingId = await findExistingOdooRecord(client, odooModel, zidData, odooValues, mapping, matchStrategy, fixedMatch)
  }
  if (existingId === null) {
    const msg = `No matching ${odooModel} record found in Odoo for ${odooOperation}`
    console.warn(`[SyncEngine] ${msg}`)
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: msg, payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: msg }
  }

  if (odooOperation === 'update') {
    const ok = await safeWriteOdooRecord(client, odooModel, existingId, effectiveOdooValues, odooValues)
    if (!ok) throw new Error(`Odoo write returned false for ${odooModel} #${existingId}`)
    console.info(`[SyncEngine] ✅ Updated ${odooModel} #${existingId} in Odoo (zid_id="${zidEntityId}")`)
    if (odooModel === 'product.template') {
      await syncProductBom(client, existingId, zidData, mergedSettings, execPlatform, mapping.workspace_id).catch(err => {
        console.warn(`[SyncEngine] Failed to sync BoM for updated template:`, err)
      })
    }
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: existingId }
  }

  // odooOperation is 'delete' here
  // Priority: FixedMappingSettings.delete.strategy > DynamicMapping __settings.deleteBehavior > 'delete'
  const deleteStrategy = (mergedSettings as any)?.delete?.strategy
    || (mapping.mappings as any)?.__settings?.deleteBehavior
    || 'delete'
  
  // Skip strategy: gracefully skip deletion without error
  if (deleteStrategy === 'skip') {
    console.info(`[SyncEngine] Skip delete for ${odooModel} #${existingId} (strategy=skip)`)
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: existingId, status: 'skipped', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', odooRecordId: existingId }
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
    console.info(`[SyncEngine] Attempting to delete Odoo record ${odooModel} #${existingId}...`)
    try {
      const ok = await client.unlink(odooModel, [existingId])
      if (ok) {
        deleteSucceeded = true
        console.info(`[SyncEngine] âœ… Deleted ${odooModel} #${existingId} from Odoo (zid_id="${zidEntityId}")`)
      } else {
        deleteError = new Error(`Odoo unlink returned false for ${odooModel} #${existingId}`)
      }
    } catch (err: any) {
      deleteError = err
      console.warn(`[SyncEngine] Delete failed for Odoo ${odooModel} #${existingId}:`, err?.message || err)
    }
  }

  if (deleteSucceeded) {
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: existingId }
  }

  // Fallbacks: If we didn't try to delete or delete failed, check archive and run_map
  const fallbacksExecuted: string[] = []

  if (behaviorArray.includes('run_map')) {
    console.info(`[SyncEngine] Executing fallback mapping lines for Odoo ${odooModel} #${existingId}...`)
    try {
      const ok = await client.write(odooModel, [existingId], effectiveOdooValues)
      if (!ok) throw new Error(`Odoo write returned false`)
      fallbacksExecuted.push('run_map')
      console.info(`[SyncEngine] âœ… Fallback mapping executed successfully for Odoo ${odooModel} #${existingId}`)
    } catch (err: any) {
      console.error(`[SyncEngine] Fallback mapping failed for Odoo ${odooModel} #${existingId}:`, err?.message || err)
    }
  }

  if (behaviorArray.includes('archive')) {
    console.info(`[SyncEngine] Executing archive strategy for Odoo ${odooModel} #${existingId}...`)
    try {
      if (odooModel === 'product.category') {
        // product.category in standard Odoo has NO 'active' field.
        // First try to delete (unlink). If unlink fails (e.g. products belong to category),
        // update the category name to prefix with "[Archived] ".
        let ok = false
        try {
          ok = await client.unlink(odooModel, [existingId])
          if (ok) console.info(`[SyncEngine] ✅ Deleted ${odooModel} #${existingId} from Odoo`)
        } catch (unlinkErr) {
          console.info(`[SyncEngine] Unlink for ${odooModel} #${existingId} failed (products may be linked), fallback to rename:`, unlinkErr)
        }

        if (!ok) {
          const recs = await client.searchRead<any>(odooModel, [['id', '=', existingId]], ['name'])
          const currentName = recs?.[0]?.name || ''
          const archivedName = currentName.startsWith('[Archived]') || currentName.startsWith('[ملغي]')
            ? currentName
            : `[Archived] ${currentName}`
          ok = await client.write(odooModel, [existingId], { name: archivedName })
          if (ok) console.info(`[SyncEngine] ✅ Archived ${odooModel} #${existingId} by renaming to "${archivedName}"`)
        }
        if (!ok) throw new Error(`Failed to archive or rename product.category #${existingId}`)
        fallbacksExecuted.push('archive')
      } else {
        const ok = await client.write(odooModel, [existingId], { active: false })
        if (!ok) throw new Error(`Odoo write (active: false) returned false`)
        fallbacksExecuted.push('archive')

        // Archive child variants if configured via archive_variants setting
        const archiveVariants = (mergedSettings as any)?.delete?.archive_variants !== false
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

      console.info(`[SyncEngine] ✅ Archive executed successfully for Odoo ${odooModel} #${existingId}`)
    } catch (err: any) {
      console.error(`[SyncEngine] Archive failed for Odoo ${odooModel} #${existingId}:`, err?.message || err)
    }
  }

  if (fallbacksExecuted.length > 0) {
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: existingId }
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
  mapping?: { odoo_match_field?: string | null; zid_match_field?: string | null },
  matchStrategy?: string,
  fixedMatch?: { odoo_field: string; zid_field: string }
): Promise<number | null> {
  const sku = toNameString(zidData.sku || odooValues.default_code)
  const barcode = toNameString(zidData.barcode || odooValues.barcode)
  const zidId = toNameString(zidData.id || zidData.customer_id || zidData.product_id || zidData.category_id || zidData.category_uuid || odooValues.x_zid_id || odooValues.zid_id || odooValues.x_zid_id_categ)
  const numericId = Number(odooValues.id || zidData.odoo_id || zidData.odoo_record_id)

  // Build candidates â€” highest priority first
  const candidates: unknown[][] = []

  // 1) FixedMatch from FixedMappingSettings (user-configured Odoo field â†” Zid field pair)
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

  // 4) Fallback candidates â€” only tried when no explicit match strategy is configured,
  //    OR when the fallback field matches the configured strategy.
  //    This prevents finding a wrong record via an unrelated field.
  if (Number.isInteger(numericId) && numericId > 0) candidates.push(['id', '=', numericId])
  if (zidId && (!matchStrategy || matchStrategy === 'x_zid_id')) {
    if (odooValues.x_zid_id !== undefined) candidates.push(['x_zid_id', '=', zidId])
    if (odooValues.zid_id !== undefined) candidates.push(['zid_id', '=', zidId])
  }
  if (sku && (!matchStrategy || matchStrategy === 'sku')) candidates.push(['default_code', '=', sku])
  if (barcode && (!matchStrategy || matchStrategy === 'barcode')) candidates.push(['barcode', '=', barcode])

  // product.category has no x_zid_id/custom field by default â€” always include name match
  if (model === 'product.category') {
    const name = toNameString(zidData.name || odooValues.name)
    if (name && !candidates.some(c => c[0] === 'name')) {
      candidates.push(['name', '=', name])
      // Also try ilike for case-insensitive partial match (Odoo may store "Parent / Child")
      if (!candidates.some(c => c[0] === 'complete_name')) {
        candidates.push(['complete_name', 'ilike', name])
      }
    }
    if (zidId && !candidates.some(c => c[0] === 'x_zid_id_categ')) {
      candidates.push(['x_zid_id_categ', '=', zidId])
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

  // Filter candidates to only include valid fields (if checkedFieldMeta successfully returned some fields)
  const validCandidates = candidates.filter(domain => {
    const fieldName = domain[0] as string
    if (fieldName === 'id') return true
    if (checkedFieldMeta.size > 0 && !checkedFieldMeta.has(fieldName)) {
      console.info(`[SyncEngine] Skipping candidate search for invalid field "${fieldName}" on ${model}`)
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

  // 5) Fallback lookup in sync_logs: if direct search candidates didn't match
  // (e.g., category delete payload lacks name & x_zid_id field doesn't exist in Odoo),
  // check sync_logs for a previously synced odoo_record_id for this zid_entity_id.
  if (zidId) {
    try {
      const { data: previousLog } = await supabaseAdmin
        .from('sync_logs')
        .select('odoo_record_id')
        .eq('zid_entity_id', zidId)
        .eq('odoo_model', model)
        .eq('status', 'success')
        .not('odoo_record_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (previousLog?.odoo_record_id) {
        const idNum = Number(previousLog.odoo_record_id)
        if (Number.isInteger(idNum) && idNum > 0) {
          console.info(`[SyncEngine] Resolved ${model} #${idNum} from previous sync_logs for zid_entity_id="${zidId}"`)
          return idNum
        }
      }
    } catch (err) {
      console.warn('[SyncEngine] sync_logs lookup failed:', err)
    }
  }

  return null
}

export async function cleanupExpiredLogs() {
  console.info('[SyncEngine] Running cleanupExpiredLogs...')
  try {
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // 1. Delete successful logs older than 72 hours
    const { error: err1 } = await supabaseAdmin
      .from('sync_logs')
      .delete()
      .eq('status', 'success')
      .lt('created_at', seventyTwoHoursAgo)

    // 2. Delete all other logs older than 7 days
    const { error: err2 } = await supabaseAdmin
      .from('sync_logs')
      .delete()
      .lt('created_at', sevenDaysAgo)

    if (err1 || err2) {
      console.error('[SyncEngine] Failed to delete expired logs:', err1 || err2)
    } else {
      console.info('[SyncEngine] Expired sync logs purged successfully.')
    }
  } catch (err) {
    console.error('[SyncEngine] Exception during log purge:', err)
  }
}

// â”€â”€â”€ ERPNext Rest Client & Sync Helper Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class ErpNextClient {
  private url: string
  private authHeader: string

  constructor(params: { url: string; username: string; apiKey: string }) {
    this.url = params.url.replace(/\/+$/, '')
    this.authHeader = `token ${params.username.trim()}:${params.apiKey.trim()}`
  }

  async search(docType: string, filters: any[][]): Promise<string[]> {
    const filtersStr = JSON.stringify(filters)
    const url = `${this.url}/api/resource/${docType}?filters=${encodeURIComponent(filtersStr)}&fields=["name"]&limit_page_length=1`
    
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      throw new Error(`ERPNext search failed with HTTP ${res.status}: ${res.statusText}`)
    }

    const json = await res.json()
    const data = json.data || []
    return data.map((d: any) => d.name)
  }

  async create(docType: string, values: any): Promise<string> {
    const url = `${this.url}/api/resource/${docType}`
    
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(values),
      cache: 'no-store',
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`ERPNext create failed with HTTP ${res.status}: ${errText || res.statusText}`)
    }

    const json = await res.json()
    return json.data?.name || ''
  }

  async update(docType: string, name: string, values: any): Promise<boolean> {
    const url = `${this.url}/api/resource/${docType}/${encodeURIComponent(name)}`
    
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(values),
      cache: 'no-store',
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`ERPNext update failed with HTTP ${res.status}: ${errText || res.statusText}`)
    }

    return true
  }

  async delete(docType: string, name: string): Promise<boolean> {
    const url = `${this.url}/api/resource/${docType}/${encodeURIComponent(name)}`
    
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`ERPNext delete failed with HTTP ${res.status}: ${errText || res.statusText}`)
    }

    return true
  }
}

async function fetchErpNextFieldMeta(
  client: ErpNextClient,
  docType: string,
  fieldNames?: string[]
): Promise<Map<string, OdooFieldMeta>> {
  const map = new Map<string, OdooFieldMeta>()
  try {
    const url = `${client['url']}/api/resource/DocType/${docType}`
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': client['authHeader'],
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (res.ok) {
      const json = await res.json()
      const doc = json.data || {}
      const rawFields = doc.fields || []

      const systemFields = [
        { fieldname: 'name', label: 'Name', fieldtype: 'Data' },
        { fieldname: 'owner', label: 'Owner', fieldtype: 'Data' },
      ]

      const allFields = [...systemFields, ...rawFields]

      for (const f of allFields) {
        if (!fieldNames || fieldNames.includes(f.fieldname)) {
          let ttype = 'char'
          const ftype = (f.fieldtype || '').toLowerCase()
          if (ftype === 'link') ttype = 'many2one'
          else if (ftype === 'table') ttype = 'one2many'
          else if (ftype === 'check') ttype = 'boolean'
          else if (['currency', 'float', 'percent'].includes(ftype)) ttype = 'float'
          else if (ftype === 'int') ttype = 'integer'
          else if (ftype === 'select') ttype = 'selection'

          map.set(f.fieldname, {
            name: f.fieldname,
            ttype,
            relation: f.options || ''
          })
        }
      }
    }
  } catch (err: any) {
    console.warn('[SyncEngine] fetchErpNextFieldMeta failed, skipping relation resolution:', err.message)
  }
  return map
}

async function resolveSingleErpNextRelationName(
  client: ErpNextClient,
  relation: string,
  itemValue: unknown,
  platform: 'zid' | 'salla'
): Promise<string | null> {
  if (itemValue === undefined || itemValue === null) return null

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
    // Fetch target relation fields meta to verify field existence
    const relationFields = await fetchErpNextFieldMeta(client, relation)

    // â”€â”€â”€ Case 1: Search by Platform ID â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (platformId) {
      let searchField: string | null = null
      if (platform === 'zid') {
        if (relationFields.has('x_zid_id')) searchField = 'x_zid_id'
        else if (relationFields.has('zid_id')) searchField = 'zid_id'
      } else if (platform === 'salla') {
        if (relationFields.has('x_salla_id')) searchField = 'x_salla_id'
        else if (relationFields.has('salla_id')) searchField = 'salla_id'
      }

      if (searchField) {
        const names = await client.search(relation, [[searchField, '=', platformId]])
        if (names && names.length > 0) {
          console.info(`[SyncEngine] Resolved ERPNext relation ${relation} by platform ID "${platformId}" â†’ "${names[0]}"`)
          return names[0]
        }
      }
    }

    // â”€â”€â”€ Case 2: Search by Name inside ERPNext â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (nameVal && nameVal !== '[object Object]' && nameVal !== 'undefined') {
      const names = await client.search(relation, [['name', '=', nameVal]])
      if (names && names.length > 0) {
        console.info(`[SyncEngine] Resolved ERPNext relation ${relation} by name="${nameVal}" â†’ "${names[0]}"`)
        return names[0]
      }

      if (relationFields.has('item_code')) {
        const itemNames = await client.search(relation, [['item_code', '=', nameVal]])
        if (itemNames && itemNames.length > 0) return itemNames[0]
      }
    }

    // â”€â”€â”€ Case 3: Create it if not found â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const systemDocTypes = ['currency', 'uom', 'company', 'warehouse', 'payment_term', 'price_list']
    if (nameVal && nameVal !== '[object Object]' && nameVal !== 'undefined' && !systemDocTypes.includes(relation.toLowerCase())) {
      console.info(`[SyncEngine] Creating new ERPNext "${relation}" with name="${nameVal}"`)
      
      const createData: Record<string, any> = {}
      createData.name = nameVal

      // Set specific fields if they exist in the target DocType:
      if (relationFields.has('item_group_name')) createData.item_group_name = nameVal
      if (relationFields.has('customer_name')) createData.customer_name = nameVal
      if (relationFields.has('uom_name')) createData.uom_name = nameVal
      
      // Tree hierarchy defaults
      if (relationFields.has('parent_item_group')) createData.parent_item_group = 'All Item Groups'
      if (relationFields.has('parent_customer_group')) createData.parent_customer_group = 'All Customer Groups'
      if (relationFields.has('parent_territory')) createData.parent_territory = 'All Territories'
      if (relationFields.has('is_group')) createData.is_group = 0

      // Customer defaults
      if (relationFields.has('customer_type')) createData.customer_type = 'Individual'
      if (relationFields.has('customer_group')) createData.customer_group = 'All Customer Groups'
      if (relationFields.has('territory')) createData.territory = 'All Territories'

      // Item defaults
      if (relation.toLowerCase() === 'item') {
        createData.item_code = nameVal
        createData.item_name = nameVal
        createData.item_group = 'All Item Groups'
        createData.stock_uom = 'Nos'
      }

      if (platformId) {
        let key: string | null = null
        if (platform === 'zid') {
          if (relationFields.has('x_zid_id')) key = 'x_zid_id'
          else if (relationFields.has('zid_id')) key = 'zid_id'
        } else if (platform === 'salla') {
          if (relationFields.has('x_salla_id')) key = 'x_salla_id'
          else if (relationFields.has('salla_id')) key = 'salla_id'
        }
        if (key) createData[key] = platformId
      }

      try {
        const newName = await client.create(relation, createData)
        if (newName) {
          console.info(`[SyncEngine] Successfully created ERPNext relation "${relation}" â†’ "${newName}"`)
          return newName
        }
      } catch (createErr: any) {
        console.warn(`[SyncEngine] Failed to create ERPNext relation "${relation}":`, createErr.message)
      }
    }
  } catch (err: any) {
    console.warn(`[SyncEngine] Error resolving ERPNext relation for ${relation}:`, err.message)
  }

  return null
}

async function buildErpNextValues(
  client: ErpNextClient,
  mappingItems: FieldMappingItem[],
  zidData: Record<string, unknown>,
  fieldMeta: Map<string, OdooFieldMeta>,
  platform: 'zid' | 'salla' = 'zid'
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

    const meta = fieldMeta.get(item.erpField)
    const ttype = meta?.ttype ?? ''
    const relation = meta?.relation ?? ''

    if (ttype === 'many2one' && relation) {
      if (hasStaticValue) {
        const valStr = String(Array.isArray(rawValue) ? rawValue[0] : rawValue)
        values[item.erpField] = valStr
        continue
      }

      const singleValue = Array.isArray(rawValue) ? rawValue[0] : rawValue
      const resolvedName = await resolveSingleErpNextRelationName(client, relation, singleValue, platform)
      if (resolvedName !== null) {
        values[item.erpField] = resolvedName
      } else {
        const nameStr = toNameString(singleValue)
        console.warn(`[SyncEngine] Skipping ERPNext "${item.erpField}" â€” could not resolve "${nameStr}" in ${relation}`)
      }
      continue
    }

    if (ttype === 'one2many' && relation) {
      const items = Array.isArray(rawValue) ? rawValue : [rawValue]
      const childRows: any[] = []
      
      try {
        const childFields = await fetchErpNextFieldMeta(client, relation)
        
        // Find the first Link field in the child schema
        let linkField: string | null = null
        let linkRelation: string | null = null
        
        for (const [name, meta] of childFields.entries()) {
          if (meta.ttype === 'many2one' && meta.relation) {
            linkField = name
            linkRelation = meta.relation
            break
          }
        }

        for (const childItem of items) {
          if (childItem !== undefined && childItem !== null) {
            const rowData: Record<string, any> = {}

            if (linkField && linkRelation) {
              const resolvedName = await resolveSingleErpNextRelationName(client, linkRelation, childItem, platform)
              if (resolvedName) {
                rowData[linkField] = resolvedName
              }
            }

            // Copy any other matching fields from childItem if it's an object
            if (typeof childItem === 'object' && childItem !== null) {
              const childObj = childItem as Record<string, any>
              for (const key of Object.keys(childObj)) {
                let targetKey = key
                if (key === 'quantity' && childFields.has('qty')) targetKey = 'qty'
                else if (key === 'qty' && childFields.has('quantity')) targetKey = 'quantity'
                else if (key === 'price' && childFields.has('rate')) targetKey = 'rate'
                else if (key === 'rate' && childFields.has('price')) targetKey = 'price'

                if (childFields.has(targetKey)) {
                  let val = childObj[key]
                  const type = childFields.get(targetKey)?.ttype
                  if (type === 'float' || type === 'integer') {
                    const parsed = parseFloat(val)
                    if (!isNaN(parsed)) val = parsed
                  }
                  rowData[targetKey] = val
                }
              }
            }

            if (Object.keys(rowData).length > 0) {
              childRows.push(rowData)
            }
          }
        }
      } catch (err: any) {
        console.warn(`[SyncEngine] Failed to resolve child table rows for ${relation}:`, err.message)
      }

      if (childRows.length > 0) {
        values[item.erpField] = childRows
      }
      continue
    }

    let value: unknown = rawValue
    if (ttype === 'boolean' && typeof value === 'string') {
      value = value === 'true'
    }
    if (
      typeof value === 'string' &&
      (['integer', 'float', 'monetary'].includes(ttype) ||
       ['qty', 'rate', 'price', 'quantity', 'amount'].includes(item.erpField.toLowerCase()))
    ) {
      const parsed = parseFloat(value)
      if (!isNaN(parsed)) value = parsed
    }

    if (Array.isArray(value)) {
      value = value.map(toNameString).join(', ')
    }

    values[item.erpField] = value
  }

  return values
}

async function findExistingErpNextRecord(
  client: ErpNextClient,
  model: string,
  zidData: Record<string, unknown>,
  erpValues: Record<string, unknown>,
  mapping?: { odoo_match_field?: string | null; zid_match_field?: string | null }
): Promise<string | null> {
  const candidates: any[][] = []

  // 1. User defined matching fields
  if (mapping?.odoo_match_field && mapping?.zid_match_field) {
    const matchValue = resolvePath(zidData, mapping.zid_match_field)
    if (matchValue !== undefined && matchValue !== null && matchValue !== '') {
      candidates.push([mapping.odoo_match_field, '=', matchValue])
    }
  }

  // 2. Platform ID (Zid ID / Salla ID)
  const zidId = String(
    zidData.id ??
    zidData.category_id ??
    zidData.category_uuid ??
    zidData.customer_id ??
    zidData.order_id ??
    ''
  )
  if (zidId) {
    try {
      const relationFields = await fetchErpNextFieldMeta(client, model)
      if (relationFields.has('x_zid_id')) candidates.push(['x_zid_id', '=', zidId])
      else if (relationFields.has('zid_id')) candidates.push(['zid_id', '=', zidId])
      else if (relationFields.has('x_salla_id')) candidates.push(['x_salla_id', '=', zidId])
      else if (relationFields.has('salla_id')) candidates.push(['salla_id', '=', zidId])
    } catch {}
  }

  // 3. Match by Name / Item Code / Group Name
  const nameVal = String(
    erpValues.name ??
    erpValues.item_group_name ??
    erpValues.customer_name ??
    (zidData.name ? toNameString(zidData.name) : '') ??
    ''
  ).trim()

  if (nameVal && nameVal !== '[object Object]' && nameVal !== 'undefined') {
    candidates.push(['name', '=', nameVal])
    if (model.toLowerCase() === 'item') {
      candidates.push(['item_code', '=', nameVal])
    }
    if (model.toLowerCase() === 'item group') {
      candidates.push(['item_group_name', '=', nameVal])
    }
  }

  // 4. Match by SKU
  const sku = String(zidData.sku || erpValues.item_code || erpValues.default_code || '')
  if (sku && sku !== 'none') {
    if (model.toLowerCase() === 'item') {
      candidates.push(['item_code', '=', sku])
    } else {
      candidates.push(['name', '=', sku])
    }
  }

  for (const filter of candidates) {
    try {
      const records = await client.search(model, [filter])
      if (records.length > 0) return records[0]
    } catch (err) {
      console.warn(`[SyncEngine] Duplicate check failed for ERPNext ${model}:`, err)
    }
  }

  return null
}

async function executeErpNextOperation(params: {
  client: ErpNextClient
  mapping: FieldMappingRow
  event: string
  storeId: string
  zidEntityId: string
  zidData: Record<string, unknown>
  docType: string
  operation: OdooOperation
  values: Record<string, unknown>
  triggerType?: 'automatic' | 'manual'
  existingLogId?: string
}): Promise<SyncEngineResult['records'][number]> {
  const {
    client,
    mapping,
    event,
    storeId,
    zidEntityId,
    zidData,
    docType,
    operation,
    values,
    triggerType,
    existingLogId,
  } = params

  if (operation === 'create') {
    const duplicateId = await findExistingErpNextRecord(client, docType, zidData, values, mapping)
    if (duplicateId !== null) {
      const msg = `Matching ${docType} "${duplicateId}" already exists in ERPNext; create skipped`
      console.info(`[SyncEngine] ${msg}`)
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: docType, odoo_record_id: duplicateId, status: 'skipped', error_message: msg, payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: docType, status: 'skipped', message: msg }
    }

    if (docType.toLowerCase() === 'item') {
      if (!values.item_code && zidData.sku) values.item_code = zidData.sku
      if (!values.item_name && zidData.name) values.item_name = toNameString(zidData.name)
      if (!values.item_group) values.item_group = 'All Item Groups'
      if (!values.stock_uom) values.stock_uom = 'Nos'
    }

    const newName = await client.create(docType, values)
    console.info(`[SyncEngine] âœ… Created ${docType} "${newName}" in ERPNext (zid_id="${zidEntityId}")`)
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: docType, odoo_record_id: newName, status: 'success', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: docType, status: 'success', message: `Created record: ${newName}` }
  }

  const existingId = await findExistingErpNextRecord(client, docType, zidData, values, mapping)
  if (existingId === null) {
    const msg = `No matching ${docType} record found in ERPNext for ${operation}`
    console.warn(`[SyncEngine] ${msg}`)
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: docType, status: 'skipped', error_message: msg, payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: docType, status: 'skipped', message: msg }
  }

  if (operation === 'update') {
    const ok = await client.update(docType, existingId, values)
    if (!ok) throw new Error(`ERPNext update returned false for ${docType} "${existingId}"`)
    console.info(`[SyncEngine] âœ… Updated ${docType} "${existingId}" in ERPNext (zid_id="${zidEntityId}")`)
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: docType, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: docType, status: 'success', message: `Updated record: ${existingId}` }
  }

  const ok = await client.delete(docType, existingId)
  if (!ok) throw new Error(`ERPNext delete returned false for ${docType} "${existingId}"`)
  console.info(`[SyncEngine] âœ… Deleted ${docType} "${existingId}" from ERPNext (zid_id="${zidEntityId}")`)
  await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: docType, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType })
  return { mappingId: mapping.id, mappingName: mapping.name, model: docType, status: 'success', message: `Deleted record: ${existingId}` }
}

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

    const idField = platform === 'shopify' ? 'x_shopify_id'
      : platform === 'salla' ? 'x_salla_id'
      : 'x_zid_id'

    const storeIdStr = String(zidData.store_id || '')
    let zidCreds: any = null
    if (platform === 'zid') {
      try {
        let tokenRow: any = null
        if (workspaceId) {
          const { data } = await supabaseAdmin
            .from('merchant_tokens')
            .select('*')
            .eq('workspace_id', workspaceId)
            .maybeSingle()
          tokenRow = data
        }
        if (!tokenRow && storeIdStr) {
          const { data } = await supabaseAdmin
            .from('merchant_tokens')
            .select('*')
            .or(`store_id.eq.${storeIdStr},merchant_id.eq.${storeIdStr}`)
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
                  compMappingRows as FieldMappingRow[] | null
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
