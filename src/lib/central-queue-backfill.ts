/**
 * Durable manual queue archive migration. This copies snapshots into central
 * Odoo, but NEVER requeues or deletes source rows.
 */
import {
  archiveDatetime, isOdooArchiveEnabled, readArchive, upsertArchive, updateArchiveBySource,
} from '@/lib/central-odoo-archive'
import { supabaseAdmin } from '@/lib/sync-runtime'
const SOURCE = 'erp-link:queue-archives:v1'
type Cursor = { x_last_queue_iso: string | false; x_last_queue_id: string | false }
type ArchiveRow = {
  id: string; source_id: string; source_table: string; source_kind: string
  workspace_id: string; store_id: string | null; platform: string | null
  event: string | null; archived_at: string; error_message: string | null
  payload: unknown; row_data: unknown
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[Depth limit]'
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redact(item, depth + 1))
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, 150)) {
      result[key] = /password|token|secret|authorization|api[_-]?key|cookie/i.test(key)
        ? '[REDACTED]' : redact(item, depth + 1)
    }
    return result
  }
  return value
}

export async function archiveQueueSnapshotsBatch(): Promise<{ archived: number; error?: string }> {
  if (!isOdooArchiveEnabled()) return { archived: 0 }
  try {
    const checkpoint = (await readArchive<Cursor>('context',
      [['x_integration_key', '=', SOURCE]],
      ['x_last_queue_iso', 'x_last_queue_id'], { limit: 1 }))[0]
    let query = supabaseAdmin.from('queue_archives')
      .select('id,source_id,source_table,source_kind,workspace_id,store_id,platform,event,archived_at,error_message,payload,row_data')
      .order('archived_at', { ascending: true }).order('id', { ascending: true }).limit(20)
    if (checkpoint?.x_last_queue_iso) {
      const iso = checkpoint.x_last_queue_iso
      query = checkpoint.x_last_queue_id
        ? query.or(`archived_at.gt.${iso},and(archived_at.eq.${iso},id.gt.${checkpoint.x_last_queue_id})`)
        : query.gt('archived_at', iso)
    }
    const { data, error } = await query
    if (error) throw new Error(error.message)
    let archived = 0
    for (const row of (data ?? []) as ArchiveRow[]) {
      const contextId = await upsertArchive('context',
        `queue-scope:${row.workspace_id}:${row.store_id || ''}`, {
          x_name: `Workspace ${row.workspace_id}`,
          x_integration_key: 'central-queue-scope',
          x_workspace_uuid: row.workspace_id,
          x_store_id: row.store_id || '',
          x_provider: row.platform || '',
        })
      await upsertArchive('event', `queue:${row.id}`, {
        x_name: row.event || 'Queue archive',
        x_source_table: 'queue_archives',
        x_source_event_id: row.source_id,
        x_event_type: row.source_kind,
        x_status: 'archived',
        x_details: JSON.stringify({
          original_table: row.source_table, original_id: row.source_id,
          error: row.error_message, payload: redact(row.payload),
          original_row: redact(row.row_data),
        }).slice(0, 64000),
        x_source_created_at: archiveDatetime(row.archived_at),
        x_workspace_uuid: row.workspace_id,
        x_store_id: row.store_id || '',
        x_platform: row.platform || '',
        x_context_id: contextId,
      })
      const next = {
        x_name: 'Queue snapshot archive checkpoint',
        x_integration_key: SOURCE,
        x_last_queue_iso: row.archived_at,
        x_last_queue_id: row.id,
      }
      if (!checkpoint && archived === 0) await upsertArchive('context', SOURCE, next)
      else await updateArchiveBySource('context', SOURCE, next)
      archived++
    }
    return { archived }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'queue_archive_failed'
    console.error('[archive] queue archive migration failed; source retained:', error)
    return { archived: 0, error }
  }
}
