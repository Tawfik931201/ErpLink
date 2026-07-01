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
// would be blocked by Row Level Security on field_mappings / odoo_connections.
// We use the service role key here which has full read access.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FieldMappingRow {
  id: string
  workspace_id: string
  odoo_connection_id: string | null
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
    odooRecordId?: number
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

// ─── Helper: resolve a Many2one value (name string → Odoo ID) ─────────────────

async function resolveMany2oneId(
  client: OdooClient,
  relation: string,
  nameValue: string
): Promise<number | null> {
  if (!nameValue) return null
  try {
    const ids = await client.search(relation, [['name', '=', nameValue]])
    if (ids.length > 0) {
      console.info(`[SyncEngine] Resolved Many2one "${nameValue}" → ${relation}#${ids[0]}`)
      return ids[0]
    }
    console.warn(`[SyncEngine] No record found in "${relation}" with name="${nameValue}"`)
    return null
  } catch (err) {
    console.warn(`[SyncEngine] Failed to resolve Many2one in "${relation}" name="${nameValue}":`, err)
    return null
  }
}

// ─── Helper: build the Odoo values dict from Zid data + field meta ────────────

export async function buildOdooValues(
  client: OdooClient,
  mappingItems: FieldMappingItem[],
  zidData: Record<string, unknown>,
  fieldMeta: Map<string, OdooFieldMeta>
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

      // If it's an array, take the first item's name
      const nameStr = Array.isArray(rawValue)
        ? toNameString(rawValue[0])
        : toNameString(rawValue)

      const resolvedId = await resolveMany2oneId(client, relation, nameStr)
      if (resolvedId !== null) {
        values[item.erpField] = resolvedId
      } else {
        console.warn(`[SyncEngine] Skipping "${item.erpField}" — could not resolve "${nameStr}" in ${relation}`)
      }
      continue
    }

    // ── Many2many: needs [(6, 0, [ids])] syntax ────────────────────────────────
    if (ttype === 'many2many' && relation) {
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

        const nameStr = toNameString(v)
        const id = await resolveMany2oneId(client, relation, nameStr)
        if (id !== null) ids.push(id)
      }
      if (ids.length > 0) {
        values[item.erpField] = [[6, 0, ids]]
      } else {
        console.warn(`[SyncEngine] Skipping Many2many "${item.erpField}" — no IDs resolved`)
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
  odoo_record_id?: number
  status: 'success' | 'failed' | 'skipped'
  error_message?: string
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
  data: Record<string, unknown>
): Promise<SyncEngineResult> {
  const storeIdStr = String(storeId)
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
    .eq('store_id', storeIdStr)
    .eq('action', normalizedEvent)

  console.info(`[SyncEngine] field_mappings query: rows=${mappingRows?.length ?? 0} error=${mappingErr?.message ?? 'none'}`)

  if (mappingErr) {
    console.error('[SyncEngine] Failed to fetch field_mappings:', JSON.stringify(mappingErr))
    return result
  }

  if (!mappingRows || mappingRows.length === 0) {
    console.warn(`[SyncEngine] No field_mappings for event="${normalizedEvent}" storeId="${storeIdStr}"`)
    return result
  }

  console.info(`[SyncEngine] Found ${mappingRows.length} field_mapping(s) to process`)

  for (const row of mappingRows as FieldMappingRow[]) {
    const record = await processSingleMapping(row, event, storeIdStr, data)
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
  existingLogId?: string
): Promise<SyncEngineResult['records'][number]> {
  const zidEntityId = String(zidData.id ?? '')
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

  if (mapping.odoo_connection_id) {
    const { data: conn, error: connErr } = await supabaseAdmin
      .from('odoo_connections')
      .select('id, url, db_name, username, password')
      .eq('id', mapping.odoo_connection_id)
      .maybeSingle()
    console.info(`[SyncEngine] odoo_connection by id: found=${!!conn} error=${connErr?.message ?? 'none'}`)
    odooConn = conn
  }

  if (!odooConn && mapping.workspace_id) {
    const { data: conn, error: connErr } = await supabaseAdmin
      .from('odoo_connections')
      .select('id, url, db_name, username, password')
      .eq('workspace_id', mapping.workspace_id)
      .maybeSingle()
    console.info(`[SyncEngine] odoo_connection fallback: found=${!!conn} error=${connErr?.message ?? 'none'}`)
    odooConn = conn
  }

  if (!odooConn) {
    const errMsg = `No Odoo connection found for mapping "${mapping.name}"`
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
  const odooValues = await buildOdooValues(client, mappingItems, zidData, fieldMeta)

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
  mapping?: Pick<any, 'odoo_match_field' | 'zid_match_field'>
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
