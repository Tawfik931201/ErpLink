import { logSync } from '@/lib/sync-runtime'
import type { FieldMappingRow, SyncEngineResult } from '@/lib/sync-types'

/**
 * لا توجد حقول مُهيّأة لهذا الموديل — تخطٍّ موحّد مع تسجيله في `sync_logs`.
 *
 * كان هذا الكتلة بحجم 14 حقلاً مكروراً في فرعي Odoo وERPNext من
 * `processSingleMapping`. استخراجه يمنع انحراف حمولة السجل بين المسارين.
 * `delete` لا يمرّ من هنا: الحذف لا يحتاج حقولاً.
 */
export async function skipNoFieldItems(args: {
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
