'use server'

import { auth } from '@clerk/nextjs/server'

import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser } from '@/lib/users'
import { getAccessToken } from '@/lib/zid/token'
import { ZidAPI } from '@/lib/zid-client'

export interface ZidLocation {
  id: string
  name: string
  type: string
}

/**
 * Lists the store locations from Zid for the active workspace (connection).
 * Used by the mapping-center Products tab to pair زد locations ↔ أودو locations
 * for the Odoo→Zid inventory sync.
 */
export async function getZidLocations(): Promise<{ success: boolean; locations?: ZidLocation[]; error?: string }> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

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

    const locations: ZidLocation[] = (Array.isArray(list) ? list : []).map((l: any) => ({
      id: String(l.id ?? l.uuid ?? ''),
      name: typeof l.name === 'object' ? l.name?.en || l.name?.ar || '' : String(l.name || ''),
      type: String(l.type || ''),
    }))

    return { success: true, locations }
  } catch (err: any) {
    console.error('[getZidLocations] Failed:', err)
    return { success: false, error: err.message || 'Failed to load Zid locations' }
  }
}