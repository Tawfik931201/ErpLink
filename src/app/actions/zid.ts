'use server'

import { auth } from '@clerk/nextjs/server'

import { supabase } from '@/lib/supabase'
import { ttlCache } from '@/lib/ttl-cache'
import { getOrCreateDbUser } from '@/lib/users'
import { getAccessToken } from '@/lib/zid/token'
import { ZidAPI } from '@/lib/zid-client'

export interface ZidLocation {
  id: string
  name: string
  type: string
}

const LOCATIONS_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Lists the store locations from Zid for the active workspace (connection).
 * Used by the mapping-center Products tab to pair زد locations ↔ أودو locations
 * for the Odoo→Zid inventory sync.
 *
 * Pass `force = true` to bypass the 5-minute TTL memo (manual refresh button).
 */
export async function getZidLocations(force = false, merchantId?: string): Promise<{ success: boolean; locations?: ZidLocation[]; error?: string }> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const cacheKey = `zid:locations:${user.active_workspace_id}:${merchantId || 'newest'}`
    if (force) ttlCache.delete(cacheKey)
    const locations = await ttlCache.get<ZidLocation[] | null>(
      cacheKey,
      LOCATIONS_TTL_MS,
      async () => {
        const { data: merchantToks } = await supabase
          .from('merchant_tokens')
          .select('*')
          .eq('workspace_id', user.active_workspace_id)
          .order('updated_at', { ascending: false, nullsFirst: false })
        // Multi-store: explicit merchant wins, else newest store.
        const merchantTok: any = merchantId
          ? (merchantToks ?? []).find(t => String((t as any).merchant_id) === String(merchantId)) ?? null
          : (merchantToks ?? [])[0] ?? null
        if (!merchantTok) throw new Error('Zid not connected')

        const tokenData = await getAccessToken(merchantTok.merchant_id)
        const zidCreds = {
          authorization: tokenData.authorization || '',
          managerToken: tokenData.accessToken,
          storeId: merchantTok.store_id || undefined,
        }

        const res = await ZidAPI.locations.list(zidCreds)
        const raw = (res.data as any) || {}
        const list = raw.results || raw.data || raw.locations || (Array.isArray(raw) ? raw : [])

        const mapped: ZidLocation[] = (Array.isArray(list) ? list : []).map((l: any) => ({
          id: String(l.id ?? l.uuid ?? ''),
          name: typeof l.name === 'object' ? l.name?.en || l.name?.ar || '' : String(l.name || ''),
          type: String(l.type || ''),
        }))

        return mapped
      }
    )

    return { success: true, locations: locations || [] }
  } catch (err: any) {
    console.error('[getZidLocations] Failed:', err)
    return { success: false, error: err.message || 'Failed to load Zid locations' }
  }
}

export interface ZidPaymentMethod {
  value: string
  label: string
}

function zidPaymentLabel(method: any): string {
  for (const field of [method?.title, method?.name, method?.code, method?.slug]) {
    if (typeof field === 'string' && field.trim()) return field.trim()
    if (field && typeof field === 'object') {
      const translated = field.ar || field.en || field.name
      if (typeof translated === 'string' && translated.trim()) return translated.trim()
    }
  }
  return ''
}

/**
 * Payment methods configured on the merchant's Zid store, for the analytic
 * rules in the Standard Mapping orders tab. `ZidAPI.storeMeta.paymentMethods`
 * already returns [] on failure, so a broken store degrades to an empty list.
 */
export async function getZidPaymentMethods(force = false, merchantId?: string): Promise<{ success: boolean; methods?: ZidPaymentMethod[]; error?: string }> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const cacheKey = `zid:payment-methods:${user.active_workspace_id}:${merchantId || 'newest'}`
    if (force) ttlCache.delete(cacheKey)
    const methods = await ttlCache.get<ZidPaymentMethod[] | null>(
      cacheKey,
      LOCATIONS_TTL_MS,
      async () => {
        const { data: merchantToks } = await supabase
          .from('merchant_tokens')
          .select('*')
          .eq('workspace_id', user.active_workspace_id)
          .order('updated_at', { ascending: false, nullsFirst: false })
        const merchantTok: any = merchantId
          ? (merchantToks ?? []).find(t => String((t as any).merchant_id) === String(merchantId)) ?? null
          : (merchantToks ?? [])[0] ?? null
        if (!merchantTok) throw new Error('Zid not connected')

        const tokenData = await getAccessToken(merchantTok.merchant_id)
        const zidCreds = {
          authorization: tokenData.authorization || '',
          managerToken: tokenData.accessToken,
          storeId: merchantTok.store_id || undefined,
        }

        const list = await ZidAPI.storeMeta.paymentMethods(zidCreds)
        const seen = new Set<string>()
        const mapped: ZidPaymentMethod[] = []
        for (const method of Array.isArray(list) ? list : []) {
          const value = String(method?.code || method?.slug || method?.id || '').trim()
          if (!value || seen.has(value)) continue
          seen.add(value)
          mapped.push({ value, label: zidPaymentLabel(method) || value })
        }
        return mapped
      }
    )

    return { success: true, methods: methods || [] }
  } catch (err: any) {
    console.error('[getZidPaymentMethods] Failed:', err)
    return { success: false, error: err.message || 'Failed to load Zid payment methods' }
  }
}