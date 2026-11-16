import { getErpExecutionScope } from '@/lib/erp-execution-target'
import { getEffectiveStandardMappingSettings } from '@/lib/mapping-settings'
import { supabaseAdmin } from '@/lib/sync-runtime'
import { ttlCache } from '@/lib/ttl-cache'

// ─── Helper: cached standard mapping settings lookup ───
export async function getCachedStandardMappingSettings(
  workspaceId: string,
  storeType: string,
  entityType: string,
  storeId = ''
): Promise<Record<string, any> | null> {
  const key = String(storeId ?? '').trim()
  const generation = getErpExecutionScope()?.connectionGeneration ?? ''
  return ttlCache.get(
    `eng:stdsets:${workspaceId}:${storeType}:${key}:${entityType}:${generation}`,
    30_000,
    // Delegated to the shared reader: per-store row first, platform default
    // ('') as fallback, with store_id compared as TEXT on both sides. The
    // previous inline copy did `r.store_id === storeId`, which never matched a
    // numeric caller and quietly fell back to store #1's row.
    () =>
      getEffectiveStandardMappingSettings(
        supabaseAdmin,
        workspaceId,
        storeType,
        entityType,
        key
      )
  )
}

// ─── Helper: check if category sync operation is allowed via Standard Mapping settings ───
export async function isEntityOperationAllowed(
  workspaceId: string,
  storeType: string,
  operation: 'create' | 'update' | 'delete' | 'cancel' | 'deliver',
  entityType: string = 'categories',
  storeId = ''
): Promise<{ allowed: boolean; reason?: string }> {
  const settings = await getCachedStandardMappingSettings(workspaceId, storeType, entityType, storeId)

  if (!settings) return { allowed: true }

  if (settings.disabled === true) {
    return { allowed: false, reason: `${entityType} sync is disabled via Standard Mapping settings` }
  }

  // If the user explicitly configured an "on_delete" strategy (not 'nothing'), that
  // implicitly allows the delete operation, even if 'delete' is not in enabled_actions.
  if (operation === 'delete' && settings.on_delete && settings.on_delete !== 'nothing') {
    return { allowed: true }
  }

  if (Array.isArray(settings.enabled_actions) && settings.enabled_actions.length > 0) {
    if (!settings.enabled_actions.includes(operation)) {
      return { allowed: false, reason: `${entityType} "${operation}" operation is not enabled in Standard Mapping settings` }
    }
  }

  return { allowed: true }
}
