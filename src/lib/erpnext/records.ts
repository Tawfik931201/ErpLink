import { pickExistingIdField, type PlatformKey } from '@/lib/platform-fields'
import { resolvePath, toNameString } from '@/lib/sync-helpers'
import { logSync } from '@/lib/sync-runtime'
import type {
FieldMappingRow,
OdooOperation,
SyncEngineResult
} from '@/lib/sync-types'

import type { ErpNextClient } from './client'
import { applyErpNextItemDefaults } from './products'
import { fetchErpNextFieldMeta } from './values'

async function findExistingErpNextRecord(
  client: ErpNextClient,
  model: string,
  zidData: Record<string, unknown>,
  erpValues: Record<string, unknown>,
  mapping?: { odoo_match_field?: string | null; zid_match_field?: string | null },
  platform: PlatformKey = 'zid',
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
      // The same source ID may exist on another platform in this ERP.
      const idField = pickExistingIdField(relationFields, platform)
      if (idField) candidates.push([idField, '=', zidId])
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
    // A failed lookup is not evidence that the record does not exist.
    // Stop before a remote mutation instead of risking a duplicate or
    // matching a less-specific record after the preferred search fails.
    const records = await client.search(model, [filter])
    if (records.length > 0) return records[0]
  }

  return null
}

export async function executeErpNextOperation(params: {
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
  platform?: PlatformKey
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
    platform = 'zid',
  } = params

  if (operation === 'create') {
    const duplicateId = await findExistingErpNextRecord(client, docType, zidData, values, mapping, platform)
    if (duplicateId !== null) {
      const msg = `Matching ${docType} "${duplicateId}" already exists in ERPNext; create skipped`
      console.info(`[SyncEngine] ${msg}`)
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: docType, odoo_record_id: duplicateId, status: 'skipped', error_message: msg, payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: docType, status: 'skipped', message: msg }
    }

    if (docType.toLowerCase() === 'item') applyErpNextItemDefaults(values, zidData)

    const newName = await client.create(docType, values)
    console.info(`[SyncEngine] ✅ Created ${docType} "${newName}" in ERPNext (zid_id="${zidEntityId}")`)
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: docType, odoo_record_id: newName, status: 'success', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: docType, status: 'success', message: `Created record: ${newName}` }
  }

  const existingId = await findExistingErpNextRecord(client, docType, zidData, values, mapping, platform)
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
