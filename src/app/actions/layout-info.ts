'use server'

import { cache } from 'react'

import { getActiveUserId, isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export interface LayoutUserInfo {
  appRole: string
  partnerId: string | null
  partnerStatus: string | null
  isAdmin: boolean
}

/**
 * Lightweight query for building the dashboard layout's navbar.
 * Returns role & partner status in a single call (no joins).
 */
export const getLayoutUserInfo = cache(async (): Promise<LayoutUserInfo> => {
  const userId = await getActiveUserId()
  if (!userId) {
    return { appRole: 'user', partnerId: null, partnerStatus: null, isAdmin: false }
  }

  const admin = isAdmin(userId)

  const { data: userRow } = await supabase
    .from('users')
    .select('app_role')
    .eq('id', userId)
    .maybeSingle()

  const appRole = (userRow?.app_role as string) || 'user'

  let partnerId: string | null = null
  let partnerStatus: string | null = null

  if (appRole === 'partner') {
    const { data: pp } = await supabase
      .from('partner_profiles')
      .select('id, status')
      .eq('user_id', userId)
      .maybeSingle()
    if (pp) {
      partnerId = pp.id
      partnerStatus = pp.status
    }
  }

  return { appRole: admin ? 'admin' : appRole, partnerId, partnerStatus, isAdmin: admin }
})
