/** Existing entry points for ERPlink synchronization. Implementations live in sync/ and the destination ERP modules. */

export { extractGenericVariants } from '@/lib/products/variants'
export { resolvePath, toNameString } from '@/lib/sync-helpers'
export type {
FieldMappingItem,
FieldMappingRow,
OdooConnectionRow,
OdooFieldMeta,
OdooOperation,
SyncEngineResult
} from '@/lib/sync-types'
export type { CountryTaxRateRule } from '@/lib/zid/order-helpers'
export { fetchFieldMeta, getSaleOrderSelectionKeys } from './odoo/field-meta'
export { buildOrderLineItems } from './odoo/order-lines'
export { extractOrderLocationInfo } from './odoo/order-location'
export { applyOrderStatusAction, createDraftInvoiceForOrder, ensureSaleOrderTaxes, getOrderStatusRow } from './odoo/order-workflow'
export { syncProductStockQuantities, syncProductTemplateStock, updateOdooStock } from './odoo/product-stock'
export { buildVariantProductValues } from './odoo/product-variant-values'
export { findExistingOdooRecord, safeCreateOdooRecord } from './odoo/records'
export { applyFixedSettingsToValues, applyRulesToValues } from './odoo/value-settings'
export { derivePresetKey, getPlatformFromEvent, normalizeOdooOperation, presetEntityType, storeEntityIdFromPayload } from './sync/events'
export { SYNC_LOG_FAILURE_RETENTION_DAYS, SYNC_LOG_SUCCESS_RETENTION_HOURS, cleanupExpiredLogs } from './sync/log-retention'
export { buildOdooValues, executeOdooOperation, processSingleMapping, resolveSingleRelationId, syncProductBom } from './sync/mappings'
export { processWebhookEvent } from './sync/webhook'
