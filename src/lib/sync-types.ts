/**
 * Shared sync types.
 *
 * Extracted verbatim from `sync-engine.ts` so the ERPNext engine
 * (`erpnext-engine.ts`) can use them without importing the 7,000-line
 * Odoo file — and without a circular import back into it.
 *
 * No behaviour: types only.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FieldMappingRow {
  erp_destination_retired_at?: string | null
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

export type OdooOperation = 'create' | 'update' | 'delete' | 'cancel' | 'deliver'

export interface FieldMappingItem {
  id: string
  erpField: string  // Odoo field name  e.g. 'categ_id'
  zidField?: string  // Zid data path    e.g. 'categories' or 'name.ar'
  staticValue?: unknown
}

export interface OdooConnectionRow {
  id: string
  url: string
  db_name: string
  username: string
  password: string  // API key stored here
  erp_type?: string
}

export interface OdooFieldMeta {
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
