/**
 * بوابة الويب هوك الموحدة — تقرر ما إذا كان حدث المتجر يجب أن يزامن إلى ERP.
 * مصدر الحقيقة = standard_mapping_settings (صفحة Mapping Center)، وليس
 * merchant_tokens.sync_settings القديم أو fixed_mapping_settings.active.
 * لا صف محفوظ في الصفحة → افتراضي: الحدث مسموح (افتراضي المحرك).
 * "disabled" صريح أو enabled_actions محدد → يُحترم.
 */

import { resolveEventOperation, type SyncOperation } from '@/lib/event-operation'
import { getEffectiveStandardMappingSettings, resolveSettingsStoreKey } from '@/lib/mapping-settings'
import { supabase } from '@/lib/supabase'
import { ttlCache } from '@/lib/ttl-cache'

const TTL_MS = 30_000

export type Operation = SyncOperation

export type StandardMappingSettings = {
  disabled?: boolean
  enabled_actions?: Operation[]
  on_delete?: string
} & Record<string, any>

function getCacheKey(workspaceId: string, storeType: string, entityType: string, storeId = ''): string {
  return `webhook-gate:${workspaceId}:${storeType}:${storeId}:${entityType}`
}

/**
 * Resolve a webhook's store key to the merchant key used by the settings
 * rows (merchant_id for zid/salla, shop_domain for shopify). The translation
 * itself lives in `@/lib/mapping-settings` so every reader agrees on it; this
 * wrapper only caches it for the hot ingress path.
 */
async function resolveSettingsStoreKeyCached(
  workspaceId: string,
  storeType: string,
  storeKey: string
): Promise<string> {
  if (!storeKey) return ''
  if (storeType !== 'zid') return storeKey
  if (!/^\d+$/.test(storeKey)) return storeKey
  return ttlCache.get<string>(
    `webhook-gate:merchant:${workspaceId}:zid:${storeKey}`,
    TTL_MS,
    async () => resolveSettingsStoreKey(supabase, storeType, storeKey, workspaceId)
  )
}

export async function isWebhookEventEnabled(
  workspaceId: string,
  storeType: 'zid' | 'salla' | 'shopify',
  event: string,
  storeKey = ''
): Promise<{ allowed: boolean; reason?: string }> {
  // The classifier lives in @/lib/event-operation so the gate and the sync
  // engine cannot disagree about what an event means — see that module's header.
  const mapped = resolveEventOperation(event, storeType)
  if (!mapped) {
    return { allowed: true }
  }

  const { entityType, operation } = mapped
  const merchant = await resolveSettingsStoreKeyCached(workspaceId, storeType, storeKey)
  const cacheKey = getCacheKey(workspaceId, storeType, entityType, merchant)

  const settings = await ttlCache.get<StandardMappingSettings | null>(
    cacheKey,
    TTL_MS,
    async () => {
      // Per-store row first, platform default ('') as fallback — the shared
      // reader is what guarantees that; it must not be re-implemented here.
      return (await getEffectiveStandardMappingSettings(
        supabase,
        workspaceId,
        storeType,
        entityType,
        merchant
      )) as StandardMappingSettings | null
    }
  )

  if (!settings) {
    return { allowed: true }
  }

  if (settings.disabled === true) {
    return { allowed: false, reason: `${entityType} sync is disabled via Standard Mapping settings` }
  }

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
