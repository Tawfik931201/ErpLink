'use server'

import { auth } from '@clerk/nextjs/server'

import {
  listSallaBranches,
  listSallaPaymentMethods,
  type SallaBranch,
  type SallaPaymentMethod,
} from '@/lib/salla-client'
import { supabase } from '@/lib/supabase'
import { ttlCache } from '@/lib/ttl-cache'
import { getOrCreateDbUser } from '@/lib/users'

export interface SallaLocation extends SallaBranch {}

const LOCATIONS_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Lists the Salla store locations (branches) for the active workspace.
 * Used by the mapping-center Products tab to pair سلة branches ↔ أودو locations
 * for the Odoo→Salla inventory sync.
 *
 * When the merchant's token lacks the `branches.read` scope (Salla answers
 * 401/403), `listSallaBranches` returns the synthetic default branch — the UI
 * then lets the user pair Odoo locations to Salla's default branch.
 *
 * Pass `force = true` to bypass the 5-minute TTL memo (manual refresh button).
 */
export async function getSallaLocations(force = false, merchantId?: string): Promise<{ success: boolean; locations?: SallaLocation[]; error?: string }> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const cacheKey = `salla:locations:${user.active_workspace_id}:${merchantId || 'newest'}`
    if (force) ttlCache.delete(cacheKey)
    const locations = await ttlCache.get<SallaLocation[] | null>(
      cacheKey,
      LOCATIONS_TTL_MS,
      async () => {
        const { data: sallaToks } = await supabase
          .from('salla_tokens')
          .select('merchant_id')
          .eq('workspace_id', user.active_workspace_id)
          .order('updated_at', { ascending: false, nullsFirst: false })
        // Multi-store: explicit merchant wins, else newest store.
        const sallaTok: any = merchantId
          ? (sallaToks ?? []).find(t => String((t as any).merchant_id) === String(merchantId)) ?? null
          : (sallaToks ?? [])[0] ?? null
        if (!sallaTok?.merchant_id) throw new Error('Salla not connected')

        return listSallaBranches(sallaTok.merchant_id)
      }
    )

    return { success: true, locations: locations || [] }
  } catch (error: any) {
    console.error('[SallaActions] getSallaLocations failed:', error)
    return { success: false, error: error.message || 'Failed to load Salla locations' }
  }
}

/**
 * Payment methods enabled on the merchant's Salla store, for the analytic
 * rules in the Standard Mapping orders tab. A token without `payments.read`
 * yields [] (see `listSallaPaymentMethods`).
 */
export async function getSallaPaymentMethods(force = false, merchantId?: string): Promise<{ success: boolean; methods?: SallaPaymentMethod[]; error?: string }> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const cacheKey = `salla:payment-methods:${user.active_workspace_id}:${merchantId || 'newest'}`
    if (force) ttlCache.delete(cacheKey)
    const methods = await ttlCache.get<SallaPaymentMethod[] | null>(
      cacheKey,
      LOCATIONS_TTL_MS,
      async () => {
        const { data: sallaToks } = await supabase
          .from('salla_tokens')
          .select('merchant_id')
          .eq('workspace_id', user.active_workspace_id)
          .order('updated_at', { ascending: false, nullsFirst: false })
        const sallaTok: any = merchantId
          ? (sallaToks ?? []).find(t => String((t as any).merchant_id) === String(merchantId)) ?? null
          : (sallaToks ?? [])[0] ?? null
        if (!sallaTok?.merchant_id) throw new Error('Salla not connected')

        return listSallaPaymentMethods(sallaTok.merchant_id)
      }
    )

    return { success: true, methods: methods || [] }
  } catch (error: any) {
    console.error('[SallaActions] getSallaPaymentMethods failed:', error)
    return { success: false, error: error.message || 'Failed to load Salla payment methods' }
  }
}