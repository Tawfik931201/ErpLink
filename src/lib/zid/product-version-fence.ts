/**
 * Durable version fence for out-of-order Zid product deliveries.
 *
 * A delayed product.publish may have been queued before product.update yet
 * execute afterward. Zid's product GET can also be eventually consistent.
 * A previously successful version for the SAME workspace/store/ERP generation
 * must not be overwritten by an older delivery, even if the API is stale.
 */
import { getErpExecutionScope } from '@/lib/erp-execution-target'
import { supabaseAdmin } from '@/lib/sync-runtime'

export function zidProductVersion(payload: Record<string, unknown>): number | null {
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown> : {}
  const product = payload.product && typeof payload.product === 'object' && !Array.isArray(payload.product)
    ? payload.product as Record<string, unknown> : {}
  const raw = payload.updated_at ?? payload.updatedAt ?? data.updated_at ??
    product.updated_at ?? payload.created_at ?? data.created_at
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const millis = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : Date.parse(raw)
  return Number.isFinite(millis) ? millis : null
}

/** Strictly older is stale; equal timestamps may represent distinct updates. */
export function hasNewerSuccessfulProductVersion(
  incoming: Record<string, unknown>, successful: Array<{ payload?: unknown }>
): boolean {
  const incomingTime = zidProductVersion(incoming)
  if (incomingTime === null) return false
  return successful.some(row => {
    const value = row.payload
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const previousTime = zidProductVersion(value as Record<string, unknown>)
    return previousTime !== null && previousTime > incomingTime
  })
}

export async function isStaleZidProductEvent(
  workspaceId: string, storeId: string, entityId: string,
  incoming: Record<string, unknown>
): Promise<boolean> {
  if (zidProductVersion(incoming) === null) return false
  const scope = getErpExecutionScope()
  if (!scope || scope.workspaceId !== workspaceId || scope.storeId !== storeId ||
      scope.platform !== 'zid' || !scope.erpConnectionId || !scope.connectionGeneration) {
    throw new Error('Zid product version check requires a pinned ERP destination')
  }
  const { data, error } = await supabaseAdmin.from('sync_logs')
    .select('payload')
    .eq('workspace_id', workspaceId)
    .eq('platform', 'zid')
    .eq('store_id', storeId)
    .eq('zid_entity_id', entityId)
    .eq('erp_connection_id', scope.erpConnectionId)
    .eq('connection_generation', scope.connectionGeneration)
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(100)
  // Never allow an unchecked stale event to write if version history is unavailable.
  if (error) throw new Error('Zid product source version lookup unavailable')
  return hasNewerSuccessfulProductVersion(incoming, data ?? [])
}
