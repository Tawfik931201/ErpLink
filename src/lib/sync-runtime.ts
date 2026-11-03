/**
 * Shared runtime for the two sync engines (Odoo + ERPNext).
 *
 * Extracted verbatim from `sync-engine.ts` (no logic change) so both engines
 * can reach the service-role client and the `sync_logs` writer without
 * importing each other. Keeping it here also avoids a circular import between
 * the two engines, which both need the same DB access.
 */

import { createClient } from '@supabase/supabase-js'

import { upsertEntityLink } from './entity-links'
import { getErpExecutionScope } from './erp-execution-target'

// ─── Supabase admin client (bypasses RLS) ─────────────────────────────────────
// Webhook requests have NO Clerk auth session, so the standard supabase client
// would be blocked by Row Level Security on field_mappings / erp_connections.
// We use the service role key here which has full read access.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function logSync(entry: {
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
  /**
   * Store platform for the durable entity link (`odoo_entity_links`).
   * When present with a successful numeric record id, the link
   * (workspace, platform, store, model, store-entity → Odoo id) is
   * refreshed best-effort so later update/delete events resolve without
   * depending on sync_logs (whose success rows are purged after 72h).
   * Omit it and no link is written — ERPNext callers do exactly that.
   */
  platform?: string
}) {
  console.info(`[SyncEngine] logSync status="${entry.status}" event="${entry.event}" model="${entry.odoo_model}" trigger_type="${entry.trigger_type || 'automatic'}" id="${entry.id || 'new'}"`)
  try {
    const executionScope = getErpExecutionScope()
    if (executionScope && executionScope.workspaceId !== entry.workspace_id) throw new Error('Sync log execution workspace mismatch')
    // field_mapping_id must be a valid UUID or null — non-UUID strings (e.g.
    // "fixed_zid_product_create") cause 22P02 errors in the UUID column.
    const rawId = entry.field_mapping_id
    const isUuid = typeof rawId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)
    const logData: Record<string, any> = {
      workspace_id: entry.workspace_id,
      ...(executionScope ? {
        erp_connection_id: executionScope.erpConnectionId,
        connection_generation: executionScope.connectionGeneration,
        platform: executionScope.platform,
      } : {}),
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
        .eq('workspace_id', entry.workspace_id)
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
          finalMappingId = currentLog.field_mapping_id
        } else if (currentLog.status === 'skipped' && ['skipped', 'processing'].includes(entry.status)) {
          finalStatus = 'skipped'
          finalMappingId = currentLog.field_mapping_id
        }

        logData.status = finalStatus
        logData.odoo_record_id = finalRecordId
        logData.error_message = finalError
        logData.field_mapping_id = finalMappingId
      }

      query = supabaseAdmin.from('sync_logs').update(logData).eq('id', entry.id).eq('workspace_id', entry.workspace_id)
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
          retryQuery = supabaseAdmin.from('sync_logs').update(safeLogData).eq('id', entry.id).eq('workspace_id', entry.workspace_id)
        } else {
          retryQuery = supabaseAdmin.from('sync_logs').insert([safeLogData])
        }

        const { error: retryErr } = await retryQuery
        if (retryErr) {
          console.error('[SyncEngine] Failed retry sync_log write:', retryErr)
        } else {
          console.info('[SyncEngine] sync_log written successfully via database fallback route ✓')
        }
      }
    } else {
      console.info(`[SyncEngine] sync_log ${entry.id ? 'updated' : 'written'} ✓`)
      // Durable entity link (best-effort, never fails the sync): a later
      // update/delete for the same store entity resolves the Odoo record
      // from odoo_entity_links instead of the purged/transient sync_logs.
      if (logData.status === 'success' && entry.platform && logData.odoo_record_id && entry.zid_entity_id) {
        void upsertEntityLink(
          {
            workspaceId: entry.workspace_id,
            platform: entry.platform as 'zid' | 'salla' | 'shopify',
            storeId: entry.store_id,
            odooModel: entry.odoo_model,
            storeEntityId: entry.zid_entity_id,
          },
          logData.odoo_record_id
        )
      }
    }
  } catch (err) {
    console.error('[SyncEngine] Failed to write sync_log (exception):', err)
  }
}
