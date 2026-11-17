import { STORED_ODOO_ID_FIELD } from '@/lib/entity-links'
import { getErpExecutionScope } from '@/lib/erp-execution-target'
import { getEffectiveStandardMappingSettings, type SettingsClient } from '@/lib/mapping-settings'
import type { OdooClient } from '@/lib/odoo-client'
import type { PlatformKey } from '@/lib/platform-fields'
import { resolveZidMatchValue, toNameString } from '@/lib/sync-helpers'

export interface RelatedMatchIdentity { workspaceId: string; platform: PlatformKey; storeId: string }
export interface RelatedMatchResult {
  configured: boolean
  recordId: number | null
  match?: { sourceField: string; targetField: string; value: unknown }
  /** Safe creation values: record IDs and readonly fields are never written. */
  matchValues?: Record<string, unknown>
}
type MatchClient = Pick<OdooClient, 'search' | 'execute'> & Partial<Pick<OdooClient, 'getMajorVersion'>>
type MatchField = { name: string; ttype: string; readonly?: boolean }
const fieldReads = new WeakMap<MatchClient, Map<string, Promise<MatchField>>>()

async function matchingField(client: MatchClient, model: string, field: string): Promise<MatchField> {
  let reads = fieldReads.get(client)
  if (!reads) { reads = new Map(); fieldReads.set(client, reads) }
  const key = `${model}:${field}`
  const cached = reads.get(key)
  if (cached) return cached
  const read = client.execute<MatchField[]>('ir.model.fields', 'search_read',
    [[['model', '=', model], ['name', '=', field]]], { fields: ['name', 'ttype', 'readonly'], limit: 1 })
    .then(async rows => {
      const hit = rows.find(row => row.name === field)
      if (hit) return hit
      // Odoo 19 removed mobile. Preserve the saved setting and the source
      // phone value, translating only this known versioned field replacement.
      if (model === 'res.partner' && field === 'mobile' && client.getMajorVersion && await client.getMajorVersion() >= 19) {
        const replacement = await client.execute<MatchField[]>('ir.model.fields', 'search_read',
          [[['model', '=', model], ['name', '=', 'phone']]], { fields: ['name', 'ttype', 'readonly'], limit: 1 })
        const phone = replacement.find(row => row.name === 'phone' && row.ttype === 'char')
        if (phone) return phone
      }
      throw new Error(`Configured related match field ${model}.${field} does not exist`)
    }).catch(error => { reads!.delete(key); throw error })
  reads.set(key, read)
  return read
}

function typedMatchValue(raw: unknown, field: MatchField, sourceField: string): string | number | boolean {
  if (raw === undefined || raw === null || raw === '' || (typeof raw === 'string' && !raw.trim())) {
    throw new Error(`Configured related match value ${sourceField} is missing`)
  }
  if (field.name === 'id' || ['integer', 'many2one', 'float', 'monetary'].includes(field.ttype)) {
    if (typeof raw !== 'string' && typeof raw !== 'number') throw new Error(`Invalid numeric related match value ${sourceField}`)
    const value = Number(raw)
    if (!Number.isFinite(value) || (['integer', 'many2one'].includes(field.ttype) && !Number.isSafeInteger(value)) || (field.name === 'id' && (!Number.isSafeInteger(value) || value <= 0))) {
      throw new Error(`Invalid numeric related match value ${sourceField}`)
    }
    return value
  }
  if (field.ttype === 'boolean') {
    if (raw === true || raw === 1 || raw === 'true') return true
    if (raw === false || raw === 0 || raw === 'false') return false
    throw new Error(`Invalid boolean related match value ${sourceField}`)
  }
  if (!['char', 'text', 'html', 'selection', 'date', 'datetime'].includes(field.ttype)) {
    throw new Error(`Unsupported related match field type ${field.ttype}`)
  }
  // Localized names are legitimate; an object in an email/SKU path is not a
  // matching key and must never degrade into "[object Object]" or a name.
  if (typeof raw === 'object' && !/(^|\.)(name|title|ar|en)$/.test(sourceField)) {
    throw new Error(`Invalid related match value ${sourceField}`)
  }
  const value = toNameString(raw)
  if (!value || value === '[object Object]') throw new Error(`Configured related match value ${sourceField} is missing`)
  return value
}

/**
 * Order references may read customer/product match fields even when syncing
 * that entity is disabled. This function never creates or updates anything.
 * Explicit keys are authoritative: missing/ambiguous keys never fall back to
 * email, SKU or an unrelated platform ID.
 */
export async function resolveOrderRelatedRecord(
  client: MatchClient,
  db: SettingsClient,
  identity: RelatedMatchIdentity,
  entity: 'products' | 'customers',
  source: Record<string, unknown>,
  settings?: Record<string, unknown> | null,
  readMissing?: () => Promise<Record<string, unknown>>,
): Promise<RelatedMatchResult> {
  if (!identity.workspaceId || !identity.storeId || !['zid', 'salla', 'shopify'].includes(identity.platform)) throw new Error('Related matching requires a workspace, platform and store')
  const scope = getErpExecutionScope()
  if (scope && (scope.workspaceId !== identity.workspaceId || scope.platform !== identity.platform || scope.storeId !== identity.storeId)) throw new Error('Related matching is outside the ERP execution scope')
  const config = settings === undefined
    ? await getEffectiveStandardMappingSettings(db, identity.workspaceId, identity.platform, entity, identity.storeId)
    : settings
  const sourceField = typeof config?.match_zid_field === 'string' ? config.match_zid_field.trim() : ''
  const targetField = typeof config?.match_odoo_field === 'string' ? config.match_odoo_field.trim() : ''
  if (!sourceField && !targetField) return { configured: false, recordId: null }
  if (!sourceField || !targetField) throw new Error('Select both related match fields')
  const model = entity === 'products' ? 'product.product' : 'res.partner'

  // Zid customer webhooks/profile payloads use `mobile` as the canonical phone,
  // while the legacy Customer Mapping catalog also exposes `telephone`. Orders
  // often contain only mobile/phone, so preserve the configured key while filling
  // the equivalent Zid phone aliases before resolving it.
  if (identity.platform === 'zid' && entity === 'customers') {
    const phone = source.telephone ?? source.phone ?? source.mobile
    if (phone !== undefined && phone !== null && phone !== '') {
      source = {
        ...source,
        telephone: source.telephone ?? phone,
        phone: source.phone ?? phone,
        mobile: source.mobile ?? phone,
      }
    }
  }

  if (sourceField === STORED_ODOO_ID_FIELD) {
    if (targetField !== 'id' || !scope) throw new Error('Saved related record matching requires the scoped Odoo ID')
    const entityId = resolveZidMatchValue(source, 'id')
    if (entityId === undefined || entityId === null || entityId === '') throw new Error('Configured related match value id is missing')
    const { data, error } = await db.from('odoo_entity_links').select('odoo_record_id')
      .eq('workspace_id', identity.workspaceId).eq('erp_connection_id', scope.erpConnectionId)
      .eq('connection_generation', scope.connectionGeneration).eq('platform', identity.platform)
      .eq('store_id', identity.storeId).eq('odoo_model', model).eq('store_entity_id', String(entityId)).limit(2)
    if (error) throw new Error('Saved related record matching lookup failed')
    const rows = (data || []) as Array<{ odoo_record_id: unknown }>
    if (rows.length > 1) throw new Error(`Ambiguous saved related ${entity} match`)
    if (!rows.length) return { configured: true, recordId: null, matchValues: {} }
    const id = Number(rows[0].odoo_record_id)
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid saved related Odoo record ID')
    const ids = await client.search(model, [['id', '=', id]], 2)
    if (ids.length > 1) throw new Error(`Ambiguous Odoo related ${entity} match`)
    return { configured: true, recordId: ids[0] ?? null, matchValues: {} }
  }

  const field = targetField === 'id' ? { name: 'id', ttype: 'integer', readonly: true } : await matchingField(client, model, targetField)
  let raw = resolveZidMatchValue(source, sourceField)
  if ((raw === undefined || raw === null || raw === '') && readMissing) {
    try {
      source = await readMissing()
      raw = resolveZidMatchValue(source, sourceField)
    } catch (error) {
      throw new Error(`Configured related match value ${sourceField} is missing: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const value = typedMatchValue(raw, field, sourceField)
  const effectiveTarget = field.name
  const ids = await client.search(model, [[effectiveTarget, '=', value]], 2)
  if (ids.length > 1) throw new Error(`Ambiguous Odoo related ${entity} match for ${effectiveTarget}`)
  return {
    configured: true, recordId: ids[0] ?? null,
    match: { sourceField, targetField: effectiveTarget, value }, matchValues: field.readonly ? {} : { [effectiveTarget]: value },
  }
}
