/**
 * بوابة الويب هوك الموحدة — تقرر ما إذا كان حدث المتجر يجب أن يزامن إلى ERP.
 * مصدر الحقيقة = standard_mapping_settings (صفحة Mapping Center)، وليس
 * merchant_tokens.sync_settings القديم أو fixed_mapping_settings.active.
 * لا صف محفوظ في الصفحة → افتراضي: الحدث مسموح (افتراضي المحرك).
 * "disabled" صريح أو enabled_actions محدد → يُحترم.
 */

import { supabase } from '@/lib/supabase'
import { ttlCache } from '@/lib/ttl-cache'

const TTL_MS = 30_000

export type Operation = 'create' | 'update' | 'delete' | 'cancel' | 'deliver'

export type StandardMappingSettings = {
  disabled?: boolean
  enabled_actions?: Operation[]
  on_delete?: string
} & Record<string, any>

function getCacheKey(workspaceId: string, storeType: string, entityType: string): string {
  return `webhook-gate:${workspaceId}:${storeType}:${entityType}`
}

function mapEventToEntityAndOp(event: string): { entityType: string; operation: Operation } | null {
  const n = event.toLowerCase()

  if (n.includes('order')) {
    if (n.includes('cancel')) return { entityType: 'orders', operation: 'cancel' }
    if (n.includes('deliver') || n.includes('fulfil') || n.includes('shipped')) return { entityType: 'orders', operation: 'deliver' }
    if (n.includes('create') || n.includes('created')) return { entityType: 'orders', operation: 'create' }
    return { entityType: 'orders', operation: 'update' }
  }

  if (n.includes('product')) {
    if (n.includes('delete') || n.includes('deleted')) return { entityType: 'products', operation: 'delete' }
    if (n.includes('create') || n.includes('created')) return { entityType: 'products', operation: 'create' }
    if (n.includes('update') || n.includes('updated') || n.includes('publish') || n.includes('stock')) return { entityType: 'products', operation: 'update' }
    return { entityType: 'products', operation: 'update' }
  }

  if (n.includes('customer')) {
    if (n.includes('delete') || n.includes('deleted')) return { entityType: 'customers', operation: 'delete' }
    if (n.includes('create') || n.includes('created')) return { entityType: 'customers', operation: 'create' }
    if (n.includes('update') || n.includes('updated') || n.includes('login')) return { entityType: 'customers', operation: 'update' }
    return { entityType: 'customers', operation: 'update' }
  }

  if (n.includes('category')) {
    if (n.includes('delete') || n.includes('deleted')) return { entityType: 'categories', operation: 'delete' }
    if (n.includes('create') || n.includes('created')) return { entityType: 'categories', operation: 'create' }
    if (n.includes('update') || n.includes('updated')) return { entityType: 'categories', operation: 'update' }
    return { entityType: 'categories', operation: 'update' }
  }

  if (n.includes('abandoned') && n.includes('cart')) {
    return { entityType: 'orders', operation: 'create' }
  }

  return null
}

export async function isWebhookEventEnabled(
  workspaceId: string,
  storeType: 'zid' | 'salla' | 'shopify',
  event: string
): Promise<{ allowed: boolean; reason?: string }> {
  const mapped = mapEventToEntityAndOp(event)
  if (!mapped) {
    return { allowed: true }
  }

  const { entityType, operation } = mapped
  const cacheKey = getCacheKey(workspaceId, storeType, entityType)

  const settings = await ttlCache.get<StandardMappingSettings | null>(
    cacheKey,
    TTL_MS,
    async () => {
      const { data, error } = await supabase
        .from('standard_mapping_settings')
        .select('settings')
        .eq('workspace_id', workspaceId)
        .eq('store_type', storeType)
        .eq('entity_type', entityType)
        .maybeSingle()

      if (error) throw error
      return (data?.settings as StandardMappingSettings) || null
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