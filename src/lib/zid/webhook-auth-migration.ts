/**
 * One-time, crash-safe migration of the Zid manager-webhook subscriptions
 * registered before each merchant had a distinct Basic credential.
 *
 * A Supabase row claim prevents multiple Hostinger/Next workers from
 * re-registering the same merchant concurrently. The version marker makes
 * subsequent restarts a no-op. The app-market (Partner Portal) hooks are NOT
 * touched: unregisterAllZidWebhooks is restricted to this merchant's URL.
 */
import { supabase } from '@/lib/supabase'

import {
  ZID_CORE_EVENTS,
  ZID_EVENT_MAP,
  syncWebhooksWithSettings,
  unregisterAllZidWebhooks,
} from './webhooks'

type SyncSettings = Record<string, { odoo2zid: boolean; zid2odoo: boolean }>

export function resolveZidWebhookMigrationSettings(raw: unknown): SyncSettings {
  const settings: SyncSettings = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (!(key in ZID_EVENT_MAP) || !value || typeof value !== 'object') continue
      const v = value as Record<string, unknown>
      settings[key] = { odoo2zid: v.odoo2zid === true, zid2odoo: v.zid2odoo === true }
    }
  }
  if (Object.keys(settings).length === 0) {
    for (const key of ZID_CORE_EVENTS) {
      settings[key] = { odoo2zid: false, zid2odoo: true }
    }
  }
  return settings
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export async function migrateLinkedZidWebhookCredentials(): Promise<{
  migrated: number
  failed: number
  skipped: number
}> {
  const totals = { migrated: 0, failed: 0, skipped: 0 }
  if (process.env.NODE_ENV !== 'production' ||
    process.env.ZID_AUTO_REKEY_WEBHOOKS === 'false') return totals

  // New merchant_tokens rows default to version 2; existing rows were marked
  // version 1 by the SQL migration. Query only legacy subscriptions.
  const { data: legacyRows, error: listError } = await supabase
    .from('merchant_tokens')
    .select('merchant_id')
    .lt('zid_webhook_auth_version', 2)
    .order('updated_at', { ascending: true })
    .limit(50)

  if (listError) {
    console.error('[Zid Auth Migration] Cannot list legacy stores:', listError.message)
    return { ...totals, failed: 1 }
  }

  const cutoff = new Date(Date.now() - 60 * 60_000).toISOString()
  for (const row of legacyRows ?? []) {
    const merchantId = String(row.merchant_id ?? '')
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(merchantId)) {
      console.error('[Zid Auth Migration] Invalid merchant identifier; skipping')
      totals.skipped++
      continue
    }

    // PostgreSQL applies this UPDATE atomically. A second process observing
    // the same version-1 row cannot acquire the same unexpired claim.
    const { data: claimed, error: claimError } = await supabase
      .from('merchant_tokens')
      .update({
        zid_webhook_auth_claimed_at: new Date().toISOString(),
        zid_webhook_auth_last_error: null,
      })
      .eq('merchant_id', merchantId)
      .lt('zid_webhook_auth_version', 2)
      .or(`zid_webhook_auth_claimed_at.is.null,zid_webhook_auth_claimed_at.lt.${cutoff}`)
      .select('merchant_id, store_id, sync_settings')
      .maybeSingle()

    if (claimError) {
      console.error('[Zid Auth Migration] Failed to acquire row claim:', claimError.message)
      totals.failed++
      continue
    }
    if (!claimed) {
      totals.skipped++
      continue
    }

    let failure: string | null = null
    try {
      const settings = resolveZidWebhookMigrationSettings(claimed.sync_settings)
      const desired = Object.entries(settings).filter(([key, value]) =>
        key in ZID_EVENT_MAP && value.zid2odoo
      ).length

      const cleanup = await unregisterAllZidWebhooks(merchantId)
      // Give Zid a moment to reflect deletions before listing the desired set.
      await sleep(1_000)
      const registered = await syncWebhooksWithSettings(merchantId, settings)

      if (cleanup.listFailed || registered.failed > 0 ||
        (desired > 0 && registered.registered < desired)) {
        failure = `cleanup_list_failed=${cleanup.listFailed}, registered=${registered.registered}, failed=${registered.failed}`
      }
    } catch (error: unknown) {
      failure = error instanceof Error ? error.message.slice(0, 280) : 'Unknown webhook migration error'
    }

    if (failure) {
      totals.failed++
      console.error('[Zid Auth Migration] Re-registration failed:', {
        merchantId,
        reason: failure,
      })
      await supabase.from('merchant_tokens')
        .update({ zid_webhook_auth_last_error: failure })
        .eq('merchant_id', merchantId)
        .lt('zid_webhook_auth_version', 2)
    } else {
      const { error: completeError } = await supabase.from('merchant_tokens')
        .update({
          zid_webhook_auth_version: 2,
          zid_webhook_auth_claimed_at: null,
          zid_webhook_auth_last_error: null,
        })
        .eq('merchant_id', merchantId)
        .lt('zid_webhook_auth_version', 2)
      if (completeError) {
        totals.failed++
        console.error('[Zid Auth Migration] Could not commit completion:', completeError.message)
      } else {
        totals.migrated++
        console.info('[Zid Auth Migration] Merchant Basic credential refreshed', { merchantId })
      }
    }

    // One store may require 15-30 Zid API calls; stagger to stay well under
    // the provider's request budget instead of hitting 429 with 3 stores.
    await sleep(35_000)
  }
  console.info('[Zid Auth Migration] One-time refresh summary', totals)
  return totals
}
