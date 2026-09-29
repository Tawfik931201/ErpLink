'use server'

import { cache } from 'react'

import { getActiveUserId, isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export interface LayoutUserInfo {
  appRole: string
  isAdmin: boolean
  name: string | null
  email: string | null
}

/**
 * Lightweight query for building the dashboard layout's navbar.
 * Returns role, name, and email in a single call (no joins).
 */
export const getLayoutUserInfo = cache(async (): Promise<LayoutUserInfo> => {
  const userId = await getActiveUserId()
  if (!userId) {
    return { appRole: 'user', isAdmin: false, name: null, email: null }
  }

  const admin = isAdmin(userId)

  const { data: userRow } = await supabase
    .from('users')
    .select('name, email, app_role')
    .eq('id', userId)
    .maybeSingle()

  const appRole = (userRow?.app_role as string) || 'user'

  return {
    appRole: admin ? 'admin' : appRole,
    isAdmin: admin,
    name: userRow?.name || null,
    email: userRow?.email || null,
  }
})
