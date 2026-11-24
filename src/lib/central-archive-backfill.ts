/**
 * Incremental, resumable migration of sync logs into the dedicated Odoo archive.
 * Invoked by the queue maintenance cycle only when archive credentials are set.
 * No source rows are deleted, and an archive failure never advances the cursor.
 */
import {
  archiveDatetime,
  isOdooArchiveEnabled,
  readArchive,
  upsertArchive,
  updateArchiveBySource,
} from '@/lib/central-odoo-archive'
import { supabaseAdmin } from '@/lib/sync-runtime'

const SOURCE = 'erp-link:sync-logs:v1'
const LIMIT = 30

type Cursor = { x_last_archived_iso: string | false; x_last_archived_id: string | false }
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
  payload: Record<string, unknown> | null
}

function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[Depth limit]'
  if (Array.isArray(value)) return value.slice(0, 150).map(item => redactPayload(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value).slice(0, 150)) {
    if (/password|secret|token|authorization|api[_-]?key|client[_-]?secret|cookie/i.test(key)) {
      result[key] = '[REDACTED]'
    } else {
      result[key] = redactPayload(item, depth + 1)
    }
  }
  return result
}

export async function archiveSyncLogsBatch(): Promise<{ archived: number; error?: string }> {
  if (!isOdooArchiveEnabled()) return { archived: 0 }
  try {
    const checkpoints = await readArchive<Cursor>('context',
      [['x_integration_key', '=', SOURCE]],
      ['x_last_archived_iso', 'x_last_archived_id'], { limit: 1 })
    const last = checkpoints[0]
    const timestamp = last?.x_last_archived_iso
    const lastId = last?.x_last_archived_id
    let query = supabaseAdmin
      .from('sync_logs')
      .select('id,workspace_id,erp_connection_id,store_id,event,status,error_message,created_at,odoo_model,odoo_record_id,platform,payload')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(LIMIT)
    if (timestamp) {
      // Supabase/PostgREST uses ISO datetime; Odoo stores naive UTC datetime.
      const iso = timestamp
      if (lastId) {
        query = query.or(`created_at.gt.${iso},and(created_at.eq.${iso},id.gt.${lastId})`)
      } else {
        query = query.gt('created_at', iso)
      }
    }
    const { data, error } = await query
    if (error) throw new Error(error.message)
    let archived = 0
    const contextCache = new Map<string, number>()
    const workspaceOwners = new Map<string, string>()
    const connectionDatabases = new Map<string, string>()
    for (const row of (data ?? []) as SyncRow[]) {
      const description = JSON.stringify({
        event: row.event,
        status: row.status,
        error: row.error_message?.slice(0, 16000) ?? null,
        odoo_model: row.odoo_model,
        odoo_record_id: row.odoo_record_id,
        payload: redactPayload(row.payload),
      }).slice(0, 64000)
      // Replicate stable cross-database IDs, not merchant credentials.
      const workspaceId = row.workspace_id || ''
      const storeId = row.store_id || ''
      const connectionId = row.erp_connection_id || ''
      const contextKey = [workspaceId, storeId, connectionId].join(':')
      let contextId = contextCache.get(contextKey)
      if (!contextId) {
        if (workspaceId && !workspaceOwners.has(workspaceId)) {
          const { data: ws } = await supabaseAdmin.from('workspaces')
            .select('user_id').eq('id', workspaceId).maybeSingle()
          workspaceOwners.set(workspaceId, ws?.user_id || '')
        }
        if (connectionId && !connectionDatabases.has(connectionId)) {
          const { data: connection } = await supabaseAdmin.from('erp_connections')
            .select('db_name').eq('id', connectionId).eq('workspace_id', workspaceId).maybeSingle()
          connectionDatabases.set(connectionId, connection?.db_name || '')
        }
        contextId = await upsertArchive('context', `scope:${contextKey}`, {
          x_name: `Workspace ${workspaceId || 'unknown'}`,
          x_integration_key: 'central-archive-scope',
          x_workspace_uuid: workspaceId,
          x_user_id: workspaceOwners.get(workspaceId) || '',
          x_store_id: storeId,
          x_odoo_connection_id: connectionId,
          x_odoo_database: connectionDatabases.get(connectionId) || '',
          x_provider: row.platform || '',
        })
        contextCache.set(contextKey, contextId)
      }
      // Each item carries its scope reference; never derive tenant ownership from the browser.
      await upsertArchive('event', row.id, {
        x_context_id: contextId,
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
        x_last_archived_iso: row.created_at,
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
