import { getEffectiveStandardMappingSettings } from '@/lib/mapping-settings'
import { supabaseAdmin } from '@/lib/sync-runtime'

// ─── Helper: cached standard mapping settings lookup ───
export async function getCachedStandardMappingSettings(
  workspaceId: string,
  storeType: string,
  entityType: string,
  storeId = ''
): Promise<Record<string, any> | null> {
  const key = String(storeId ?? '').trim()

  // Correctness boundary: background queue workers may run in a different
  // Hostinger process from the Mapping Center request that saved settings.
  // A process-local TTL cache therefore allows a worker to apply old pricing,
  // language, BoM, or operation-gating rules for up to 30 seconds after Save.
  // UI reads keep their own cache; ERP execution always reads the authoritative
  // row so the first webhook after Save uses the settings the merchant sees.
  return getEffectiveStandardMappingSettings(
    supabaseAdmin,
    workspaceId,
    storeType,
    entityType,
    key
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
