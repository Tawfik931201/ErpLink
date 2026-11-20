/**
 * Incremental, resumable migration of sync logs into the dedicated Odoo archive.
 * Invoked by the queue maintenance cycle only when archive credentials are set.
 * No source rows are deleted, and an archive failure never advances the cursor.
 */
import { supabaseAdmin } from '@/lib/sync-runtime'
import {
  archiveDatetime,
  isOdooArchiveEnabled,
  readArchive,
  upsertArchive,
  updateArchiveBySource,
} from '@/lib/central-odoo-archive'

const SOURCE = 'erp-link:sync-logs:v1'
const LIMIT = 30

type Cursor = { x_last_archived_created_at: string | false; x_last_archived_id: string | false }
type SyncRow = {
  id: string
  workspace_id: string | null
  erp_connection_id: string | null
  store_id: string | null
  event: string | null
  status: string | null
  error_message: string | null
  created_at: string
  odoo_model: string | null
  odoo_record_id: number | null
  platform: string | null
}

export async function archiveSyncLogsBatch(): Promise<{ archived: number; error?: string }> {
  if (!isOdooArchiveEnabled()) return { archived: 0 }
  try {
    const checkpoints = await readArchive<Cursor>('context',
      [['x_integration_key', '=', SOURCE]],
      ['x_last_archived_created_at', 'x_last_archived_id'], { limit: 1 })
    const last = checkpoints[0]
    const timestamp = last?.x_last_archived_created_at
    const lastId = last?.x_last_archived_id
    let query = supabaseAdmin
      .from('sync_logs')
      .select('id,workspace_id,erp_connection_id,store_id,event,status,error_message,created_at,odoo_model,odoo_record_id,platform')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(LIMIT)
    if (timestamp) {
      // Supabase/PostgREST uses ISO datetime; Odoo stores naive UTC datetime.
      const iso = new Date(timestamp.replace(' ', 'T') + 'Z').toISOString()
      if (lastId) {
        query = query.or(`created_at.gt.${iso},and(created_at.eq.${iso},id.gt.${lastId})`)
      } else {
        query = query.gt('created_at', iso)
      }
    }
    const { data, error } = await query
    if (error) throw new Error(error.message)
    let archived = 0
    for (const row of (data ?? []) as SyncRow[]) {
      const description = JSON.stringify({
        event: row.event,
        status: row.status,
        error: row.error_message?.slice(0, 16000) ?? null,
        odoo_model: row.odoo_model,
        odoo_record_id: row.odoo_record_id,
      })
      // Each item carries tenant IDs; no cross-tenant reads exposed to clients.
      await upsertArchive('event', row.id, {
        x_name: row.event || 'Sync event',
        x_source_table: 'sync_logs',
        x_source_event_id: row.id,
        x_event_type: row.event || 'sync',
        x_status: row.status || '',
        x_details: description,
        x_workspace_uuid: row.workspace_id || '',
        x_store_id: row.store_id || '',
        x_odoo_connection_id: row.erp_connection_id || '',
        x_platform: row.platform || '',
        x_source_created_at: archiveDatetime(row.created_at),
      })
      // Persist cursor only AFTER archive commit; safe to retry on crash.
      const checkpointFields = {
        x_name: 'Sync log archive checkpoint',
        x_integration_key: SOURCE,
        x_last_archived_created_at: archiveDatetime(row.created_at),
        x_last_archived_id: row.id,
      }
      if (!last && archived === 0) {
        await upsertArchive('context', SOURCE, checkpointFields)
      } else {
        await updateArchiveBySource('context', SOURCE, checkpointFields)
      }
      archived++
    }
    return { archived }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'archive_failed'
    console.error('[archive] sync log batch failed; source rows retained:', error)
    return { archived: 0, error }
  }
}
