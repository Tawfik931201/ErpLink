/**
 * بوابة الويب هوك الموحدة — تقرر ما إذا كان حدث المتجر يجب أن يزامن إلى ERP.
 * مصدر الحقيقة = standard_mapping_settings (صفحة Mapping Center)، وليس
 * merchant_tokens.sync_settings القديم أو fixed_mapping_settings.active.
 * لا صف محفوظ في الصفحة → افتراضي: الحدث مسموح (افتراضي المحرك).
 * "disabled" صريح أو enabled_actions محدد → يُحترم.
 */

import { resolveEventOperation, type SyncOperation } from '@/lib/event-operation'
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
 * rows (merchant_id for zid/salla, shop_domain for shopify). Zid deliveries
 * carry the numeric store_id, which is mapped through the token row; the
 * other platforms already arrive keyed by merchant.
 */
async function resolveSettingsStoreKey(
  workspaceId: string,
  storeType: string,
  storeKey: string
): Promise<string> {
  if (!storeKey) return ''
  if (storeType !== 'zid') return storeKey
  if (!/^\d+$/.test(storeKey)) return storeKey
  const merchant = await ttlCache.get<string | null>(
    `webhook-gate:merchant:zid:${storeKey}`,
    TTL_MS,
    async () => {
      const { data } = await supabase
        .from('merchant_tokens')
        .select('merchant_id')
        .or(`store_id.eq.${storeKey},merchant_id.eq.${storeKey}`)
        .maybeSingle()
      return ((data as { merchant_id?: unknown } | null)?.merchant_id ?? null) as string | null
    }
  )
  return merchant ? String(merchant) : storeKey
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
  const merchant = await resolveSettingsStoreKey(workspaceId, storeType, storeKey)
  const cacheKey = getCacheKey(workspaceId, storeType, entityType, merchant)

  const settings = await ttlCache.get<StandardMappingSettings | null>(
    cacheKey,
    TTL_MS,
    async () => {
      // Per-store row first, platform default ('') as fallback.
      const { data, error } = await supabase
        .from('standard_mapping_settings')
        .select('store_id, settings')
        .eq('workspace_id', workspaceId)
        .eq('store_type', storeType)
        .eq('entity_type', entityType)
        .in('store_id', merchant ? [merchant, ''] : [''])

      if (error) throw error
      const rows = (data ?? []) as Array<{ store_id: string; settings: unknown }>
      const hit = rows.find(r => r.store_id === merchant) ?? rows.find(r => r.store_id === '')
      return (hit?.settings as StandardMappingSettings) || null
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