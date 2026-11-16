import { decrypt } from '@/lib/crypto'
import { buildErpNextValues, ErpNextClient, executeErpNextOperation, fetchErpNextFieldMeta } from '@/lib/erpnext-engine'
import { getPlatformFromEvent } from '@/lib/sync/events'
import { skipNoFieldItems } from '@/lib/sync/mapping-results'
import { logSync } from '@/lib/sync-runtime'
import type { FieldMappingItem, FieldMappingRow, OdooConnectionRow, OdooOperation, SyncEngineResult } from '@/lib/sync-types'

export async function processErpNextMapping({
  connection: odooConn, mapping, event, storeId, zidEntityId, zidData, odooModel, odooOperation, platformHint, triggerType, logId,
}: {
  connection: OdooConnectionRow
  mapping: FieldMappingRow
  event: string
  storeId: string
  zidEntityId: string
  zidData: Record<string, unknown>
  odooModel: string
  odooOperation: OdooOperation
  platformHint?: 'zid' | 'salla' | 'shopify'
  triggerType: 'automatic' | 'manual'
  logId?: string
}): Promise<SyncEngineResult['records'][number]> {
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

  const platform = (platformHint && platformHint !== 'shopify' ? platformHint : getPlatformFromEvent(event)) as 'zid' | 'salla' | 'shopify'
  const erpValues = await buildErpNextValues(client, mappingItems, zidData, fieldMeta, platform as 'zid' | 'salla')

  if (Object.keys(erpValues).length === 0 && odooOperation !== 'delete') {
    console.warn(`[SyncEngine] No values extracted from Zid data for mapping "${mapping.name}"`)
    await logSync({ id: logId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: odooModel, status: 'skipped', error_message: 'All mapped Zid fields were empty or missing', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: odooModel, status: 'skipped', message: 'All mapped Zid fields were empty or missing' }
  }

  console.info('[SyncEngine] ERPNext values prepared', {
    mappingId: mapping.id, platform, model: odooModel, fieldCount: Object.keys(erpValues).length,
  })

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
      platform,
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
