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
export async function getZidLocations(force = false): Promise<{ success: boolean; locations?: ZidLocation[]; error?: string }> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const cacheKey = `zid:locations:${user.active_workspace_id}`
    if (force) ttlCache.delete(cacheKey)
    const locations = await ttlCache.get<ZidLocation[] | null>(
      cacheKey,
      LOCATIONS_TTL_MS,
      async () => {
        const { data: merchantTok } = await supabase
          .from('merchant_tokens')
          .select('*')
          .eq('workspace_id', user.active_workspace_id)
          .maybeSingle()
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