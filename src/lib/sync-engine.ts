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

import { createClient } from '@supabase/supabase-js'
import { OdooClient } from '@/lib/odoo-client'
import { decrypt } from '@/lib/crypto'

// ─── Supabase admin client (bypasses RLS) ────────────────────────────────────
// Webhook requests have NO Clerk auth session, so the standard supabase client
// would be blocked by Row Level Security on field_mappings / erp_connections.
// We use the service role key here which has full read access.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Types ────────────────────────────────────────────────────────────────────

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

type OdooOperation = 'create' | 'update' | 'delete'

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

// ─── Helper: resolve a nested path like "name.ar" from a plain object ─────────

export function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const value = path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && !Array.isArray(acc)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)

  if (value !== undefined) return value

  // Zid can send localized fields either as { ar, en } or as a plain string.
  // If a mapping asks for "name.ar" but the webhook has "name": "..." use it.
  const [root] = path.split('.')
  return obj[root]
}

// ─── Helper: extract a display name from a raw value ──────────────────────────

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

// ─── Helper: Determine platform from webhook event ──────────────────────────

export function getPlatformFromEvent(event: string): 'zid' | 'salla' {
  if (
    event.endsWith('.created') ||
    event.includes('.status.') ||
    event.endsWith('.cancelled') ||
    event.endsWith('.refunded') ||
    event.endsWith('.low') ||
    event.endsWith('.available') ||
    event.endsWith('.changed') ||
    event.includes('salla')
  ) {
    return 'salla'
  }
  return 'zid'
}

// ─── Helper: resolve a single relational value (ID Match → Name Match → Creation) ───

async function resolveSingleRelationId(
  client: OdooClient,
  relation: string,
  itemValue: unknown,
  platform: 'zid' | 'salla'
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
    const relationFields = await fetchFieldMeta(client, relation, ['x_zid_id', 'zid_id', 'x_salla_id', 'salla_id', 'name'])

    // ─── Case 1: Search by Platform ID (Fixed Mapping check) ─────────────────
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
        const ids = await client.search(relation, [[searchField, '=', platformId]])
        if (ids && ids.length > 0) {
          console.info(`[SyncEngine] Case 1 (ID Match): Resolved ${relation} with ${searchField}="${platformId}" → ID #${ids[0]}`)
          return ids[0]
        }
      }
    }

    // ─── Case 2: Search by Name inside Odoo ──────────────────────────────────
    if (nameVal && nameVal !== '[object Object]' && nameVal !== 'undefined') {
      const ids = await client.search(relation, [['name', '=', nameVal]])
      if (ids && ids.length > 0) {
        console.info(`[SyncEngine] Case 2 (Name Match): Resolved ${relation} with name="${nameVal}" → ID #${ids[0]}`)

        // Proactive linking: if we found it by name and have a platform ID, let's link them!
        if (platformId) {
          let linkField: string | null = null
          if (platform === 'zid') {
            if (relationFields.has('x_zid_id')) linkField = 'x_zid_id'
            else if (relationFields.has('zid_id')) linkField = 'zid_id'
          } else if (platform === 'salla') {
            if (relationFields.has('x_salla_id')) linkField = 'x_salla_id'
            else if (relationFields.has('salla_id')) linkField = 'salla_id'
          }

          if (linkField) {
            console.info(`[SyncEngine] Proactive Link: Linking existing ${relation}#${ids[0]} to platform ID "${platformId}"`)
            await client.write(relation, [ids[0]], { [linkField]: platformId }).catch(err => {
              console.warn(`[SyncEngine] Proactive Link failed for ${relation}#${ids[0]}:`, err)
            })
          }
        }

        return ids[0]
      }
    }

    // ─── Case 3: Create it if not found ──────────────────────────────────────
    if (nameVal && nameVal !== '[object Object]' && nameVal !== 'undefined') {
      console.info(`[SyncEngine] Case 3 (Creation): Record not found in "${relation}". Creating a new one with name="${nameVal}"`)
      
      const createData: Record<string, unknown> = {
        name: nameVal
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

// ─── Helper: build the Odoo values dict from Zid data + field meta ────────────

export async function buildOdooValues(
  client: OdooClient,
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
      const resolvedId = await resolveSingleRelationId(client, relation, singleValue, platform)
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

        const resolvedId = await resolveSingleRelationId(client, relation, v, platform)
        if (resolvedId !== null) ids.push(resolvedId)
      }
      if (ids.length > 0) {
        values[item.erpField] = [[6, 0, ids]]
      } else {
        console.warn(`[SyncEngine] Skipping "${item.erpField}" — no IDs resolved`)
      }
      continue
    }

    // ── Numeric fields ─────────────────────────────────────────────────────────
    let value: unknown = rawValue
    if (ttype === 'boolean' && typeof value === 'string') {
      value = value === 'true'
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

    values[item.erpField] = value
  }

  return values
}

// ─── Log a sync attempt ───────────────────────────────────────────────────────

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
    const logData: Record<string, any> = {
      workspace_id: entry.workspace_id,
      field_mapping_id: entry.field_mapping_id,
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
        let finalRecordId = entry.odoo_record_id || currentLog.odoo_record_id
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
          console.info('[SyncEngine] sync_log written successfully via database fallback route ✅')
        }
      }
    } else {
      console.info(`[SyncEngine] sync_log ${entry.id ? 'updated' : 'written'} ✅`)
    }
  } catch (err) {
    console.error('[SyncEngine] Failed to write sync_log (exception):', err)
  }
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
  'order.created':          'order.create',
  'order.updated':          'order.update',
  'order.cancelled':        'order.cancel',
  'order.delivered':        'order.deliver',
  'order_create':           'order.create',
  'order_created':          'order.create',
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
}


function normalizeEvent(event: string): string {
  return EVENT_ALIASES[event] ?? event
}

function normalizeOdooOperation(operation: unknown, event: string): OdooOperation {
  if (operation === 'create' || operation === 'update' || operation === 'delete') {
    return operation
  }

  const normalizedEvent = normalizeEvent(event)
  if (normalizedEvent.includes('delete')) return 'delete'
  if (normalizedEvent.includes('update') || normalizedEvent.includes('publish')) return 'update'
  return 'create'
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
  platformHint?: 'zid' | 'salla'
): Promise<SyncEngineResult> {
  // Sanitize to prevent PostgREST filter injection via the .or() string below
  const storeIdStr = String(storeId).replace(/[^a-zA-Z0-9_-]/g, '')
  const normalizedEvent = normalizeEvent(event)
  const result: SyncEngineResult = {
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    records: [],
  }

  console.info(`[SyncEngine] ===== processWebhookEvent START =====`)
  console.info(`[SyncEngine] event="${event}" normalized="${normalizedEvent}" storeId="${storeIdStr}"`)

  // Run cleanup of expired logs in the background
  cleanupExpiredLogs().catch(err => console.error('[SyncEngine] Background cleanup failed:', err))

  // 1. Find all field_mappings matching this store + event
  console.info(`[SyncEngine] Querying field_mappings...`)
  const { data: mappingRows, error: mappingErr } = await supabaseAdmin
    .from('field_mappings')
    .select('*')
    .or(`store_id.eq.${storeIdStr},merchant_id.eq.${storeIdStr}`)

  console.info(`[SyncEngine] field_mappings query: rows=${mappingRows?.length ?? 0} error=${mappingErr?.message ?? 'none'}`)

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

  if (filteredRows.length === 0) {
    console.warn(`[SyncEngine] No field_mappings for event="${normalizedEvent}" or "${event}" storeId/merchantId="${storeIdStr}"`)
    return result
  }

  console.info(`[SyncEngine] Found ${filteredRows.length} field_mapping(s) to process`)

  for (const row of filteredRows as FieldMappingRow[]) {
    const record = await processSingleMapping(row, event, storeIdStr, data, 'automatic', undefined, platformHint)
    result.records.push(record)
    result.processed += 1
    result[record.status] += 1
  }
  console.info(
    `[SyncEngine] Summary: processed=${result.processed} success=${result.success} skipped=${result.skipped} failed=${result.failed}`
  )
  console.info(`[SyncEngine] ===== processWebhookEvent END =====`)
  return result
}

// ─── Process one field_mapping ────────────────────────────────────────────────

export async function processSingleMapping(
  mapping: FieldMappingRow,
  event: string,
  storeId: string,
  zidData: Record<string, unknown>,
  triggerType: 'automatic' | 'manual' = 'automatic',
  existingLogId?: string,
  platformHint?: 'zid' | 'salla'
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

  console.info(`[SyncEngine] Processing mapping "${mapping.name}" → model="${odooModel}" operation="${odooOperation}" triggerType="${triggerType}" existingLogId="${existingLogId || 'none'}"`)

  // ── Create or Update Initial Log Entry (status: processing) ─────────────────
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
        console.error('[SyncEngine] Failed to write initial sync_log:', initialLogErr)
      } else if (newLog) {
        logId = newLog.id
      }
    }
  } catch (err) {
    console.error('[SyncEngine] Exception during initial log creation:', err)
  }

  // ── 1. Resolve Odoo connection ──────────────────────────────────────────────
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

  // ── Route based on ERP type ────────────────────────────────────────────────
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

    const platform = getPlatformFromEvent(event)
    const erpValues = await buildErpNextValues(client, mappingItems, zidData, fieldMeta, platform)

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

  // ── 2. Get mapping items ────────────────────────────────────────────────────
  const mappingItems: FieldMappingItem[] = mapping.mappings?.[odooModel] ?? []

  if (mappingItems.length === 0 && odooOperation !== 'delete') {
    console.warn(`[SyncEngine] No field items configured for model "${odooModel}"`)
    await logSync({ id: logId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: 'No field mapping items configured', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: 'No field mapping items configured' }
  }

  // ── 3. Create OdooClient ────────────────────────────────────────────────────
  const decryptedPassword = decrypt(odooConn.password)
  const client = new OdooClient({
    url: odooConn.url,
    db: odooConn.db_name || '',
    username: odooConn.username,
    apiKey: decryptedPassword,
  })

  // ── 4. Fetch field metadata (ttype + relation) for all mapped fields ─────────
  const erpFieldNames = mappingItems.map(m => m.erpField)
  const fieldMeta = await fetchFieldMeta(client, odooModel, erpFieldNames)

  // ── 5. Build Odoo values (resolves Many2one/Many2many to IDs) ────────────────
  const platform = getPlatformFromEvent(event)
  const odooValues = await buildOdooValues(client, mappingItems, zidData, fieldMeta, platform)

  if (Object.keys(odooValues).length === 0 && odooOperation !== 'delete') {
    console.warn(`[SyncEngine] No values extracted from Zid data for mapping "${mapping.name}"`)
    await logSync({ id: logId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: 'All mapped Zid fields were empty or missing', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: 'All mapped Zid fields were empty or missing' }
  }

  console.info(`[SyncEngine] Values to send to Odoo:`, JSON.stringify(odooValues, null, 2))

  // ── 6. Execute the configured generic Odoo operation ────────────────────────
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
      triggerType,
      existingLogId: logId,
    })
  } catch (err: any) {
    const errMsg = err?.message ?? String(err)
    console.error(`[SyncEngine] ❌ Failed to ${odooOperation} ${odooModel} in Odoo:`, errMsg)
    await logSync({ id: logId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'failed', error_message: errMsg, payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'failed', message: errMsg }
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
    odooModel,
    odooOperation,
    odooValues,
    triggerType,
    existingLogId,
  } = params

  if (odooOperation === 'create') {
    const duplicateId = await findExistingOdooRecord(client, odooModel, zidData, odooValues, mapping)
    if (duplicateId !== null) {
      const msg = `Matching ${odooModel} #${duplicateId} already exists in Odoo; create skipped`
      console.info(`[SyncEngine] ${msg}`)
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: duplicateId, status: 'skipped', error_message: msg, payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', odooRecordId: duplicateId, message: msg }
    }

    const newId = await client.create(odooModel, odooValues)
    console.info(`[SyncEngine] ✅ Created ${odooModel} #${newId} in Odoo (zid_id="${zidEntityId}")`)
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: newId, status: 'success', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: newId }
  }

  const existingId = await findExistingOdooRecord(client, odooModel, zidData, odooValues, mapping)
  if (existingId === null) {
    const msg = `No matching ${odooModel} record found in Odoo for ${odooOperation}`
    console.warn(`[SyncEngine] ${msg}`)
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: msg, payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: msg }
  }

  if (odooOperation === 'update') {
    const ok = await client.write(odooModel, [existingId], odooValues)
    if (!ok) throw new Error(`Odoo write returned false for ${odooModel} #${existingId}`)
    console.info(`[SyncEngine] ✅ Updated ${odooModel} #${existingId} in Odoo (zid_id="${zidEntityId}")`)
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: existingId }
  }

  const ok = await client.unlink(odooModel, [existingId])
  if (!ok) throw new Error(`Odoo unlink returned false for ${odooModel} #${existingId}`)
  console.info(`[SyncEngine] ✅ Deleted ${odooModel} #${existingId} from Odoo (zid_id="${zidEntityId}")`)
  await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType })
  return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'success', odooRecordId: existingId }
}

export async function findExistingOdooRecord(
  client: OdooClient,
  model: string,
  zidData: Record<string, unknown>,
  odooValues: Record<string, unknown>,
  mapping?: { odoo_match_field?: string | null; zid_match_field?: string | null }
): Promise<number | null> {
  const sku = toNameString(zidData.sku || odooValues.default_code)
  const barcode = toNameString(zidData.barcode || odooValues.barcode)
  const zidId = toNameString(zidData.id || odooValues.x_zid_id || odooValues.zid_id)
  const numericId = Number(odooValues.id || zidData.odoo_id || zidData.odoo_record_id)

  const candidates: unknown[][] = []
  if (mapping?.odoo_match_field && mapping?.zid_match_field) {
    const matchValue = resolvePath(zidData, mapping.zid_match_field)
    if (matchValue !== undefined && matchValue !== null && matchValue !== '') {
      const value = mapping.odoo_match_field === 'id'
        ? Number(matchValue)
        : toNameString(matchValue)
      if (mapping.odoo_match_field !== 'id' || (Number.isInteger(value) && Number(value) > 0)) {
        console.info(
          `[SyncEngine] Using configured match key: ${model}.${mapping.odoo_match_field} = ${JSON.stringify(value)}`
        )
        candidates.push([mapping.odoo_match_field, '=', value])
      }
    } else {
      console.warn(
        `[SyncEngine] Match field "${mapping.zid_match_field}" was empty in Zid payload; falling back to default lookup keys`
      )
    }
  }
  if (Number.isInteger(numericId) && numericId > 0) candidates.push(['id', '=', numericId])
  if (zidId) {
    if (odooValues.x_zid_id !== undefined) candidates.push(['x_zid_id', '=', zidId])
    if (odooValues.zid_id !== undefined) candidates.push(['zid_id', '=', zidId])
  }
  if (sku) candidates.push(['default_code', '=', sku])
  if (barcode) candidates.push(['barcode', '=', barcode])

  for (const domain of candidates) {
    try {
      const ids = await client.search(model, [domain], 1)
      if (ids.length > 0) return ids[0]
    } catch (err) {
      console.warn(`[SyncEngine] Duplicate check failed for ${model}:`, err)
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

// ─── ERPNext Rest Client & Sync Helper Functions ──────────────────────────────

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

    // ─── Case 1: Search by Platform ID ───────────────────────────────────────
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
          console.info(`[SyncEngine] Resolved ERPNext relation ${relation} by platform ID "${platformId}" → "${names[0]}"`)
          return names[0]
        }
      }
    }

    // ─── Case 2: Search by Name inside ERPNext ────────────────────────────────
    if (nameVal && nameVal !== '[object Object]' && nameVal !== 'undefined') {
      const names = await client.search(relation, [['name', '=', nameVal]])
      if (names && names.length > 0) {
        console.info(`[SyncEngine] Resolved ERPNext relation ${relation} by name="${nameVal}" → "${names[0]}"`)
        return names[0]
      }

      if (relationFields.has('item_code')) {
        const itemNames = await client.search(relation, [['item_code', '=', nameVal]])
        if (itemNames && itemNames.length > 0) return itemNames[0]
      }
    }

    // ─── Case 3: Create it if not found ──────────────────────────────────────
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
          console.info(`[SyncEngine] Successfully created ERPNext relation "${relation}" → "${newName}"`)
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
        console.warn(`[SyncEngine] Skipping ERPNext "${item.erpField}" — could not resolve "${nameStr}" in ${relation}`)
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
    console.info(`[SyncEngine] ✅ Created ${docType} "${newName}" in ERPNext (zid_id="${zidEntityId}")`)
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
    console.info(`[SyncEngine] ✅ Updated ${docType} "${existingId}" in ERPNext (zid_id="${zidEntityId}")`)
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: docType, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: docType, status: 'success', message: `Updated record: ${existingId}` }
  }

  const ok = await client.delete(docType, existingId)
  if (!ok) throw new Error(`ERPNext delete returned false for ${docType} "${existingId}"`)
  console.info(`[SyncEngine] ✅ Deleted ${docType} "${existingId}" from ERPNext (zid_id="${zidEntityId}")`)
  await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: docType, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType })
  return { mappingId: mapping.id, mappingName: mapping.name, model: docType, status: 'success', message: `Deleted record: ${existingId}` }
}
