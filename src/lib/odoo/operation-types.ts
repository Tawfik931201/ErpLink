import type { OdooClient } from '@/lib/odoo-client'
import type { FieldMappingRow, OdooOperation, SyncEngineResult } from '@/lib/sync-types'

export type OdooSyncRecord = SyncEngineResult['records'][number]

export interface ExecuteOdooParams {
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
}

export type OdooValuesPreparation = ExecuteOdooParams & { mergedSettings: Record<string, any> }
export type OdooConfiguredMatch = { odoo_field: string; zid_field: string }
