import { auth } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { cache } from 'react'

import { supabase } from './supabase'

/**
 * Checks if the given userId is an admin user.
 * It checks against the comma-separated list of admin user IDs defined in the ADMIN_USER_IDS environment variable.
 */
export function isAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false
  const adminIdsEnv = process.env.ADMIN_USER_IDS || ''
  const adminIds = adminIdsEnv
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  return adminIds.includes(userId)
}

/**
 * Returns the active user ID.
 * If the authenticated user is an admin and is currently impersonating a client,
 * it returns the impersonated user's ID. Otherwise, it returns the real logged-in user's ID.
 *
 * Replacing Clerk's `auth().userId` with this:
 * 1. Import `getActiveUserId` from `@/lib/auth` instead of importing `auth` from `@clerk/nextjs/server`.
 * 2. In your async server actions, routes, or Server Components, replace `const { userId } = await auth()`
 *    with `const userId = await getActiveUserId()`.
 */
const safeCache = typeof cache === 'function' ? cache : (<T extends (...args: any[]) => any>(fn: T): T => fn)

export const getActiveUserId = safeCache(async (): Promise<string | null> => {
  const { userId } = await auth()

  if (!userId) {
    return null
  }

  // If the user is an admin, check if they are impersonating another user
  if (isAdmin(userId)) {
    const cookieStore = await cookies()
    const impersonatedUserId = cookieStore.get('impersonated_user_id')?.value
    if (impersonatedUserId) {
      return impersonatedUserId
    }
  }

  return userId
})

/**
 * Resolves the active workspace id for the current user.
 * Reads the `users.active_workspace_id` column from Supabase.
 * Returns `null` if the user is not signed in or has no active workspace.
 */
export const getActiveWorkspaceId = safeCache(async (): Promise<string | null> => {
  const userId = await getActiveUserId()
  if (!userId) return null

  // Slightly elevated read access is required because users table is keyed by Clerk user id.
  const { data, error } = await supabase
    .from('users')
    .select('active_workspace_id')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.warn('[auth] Failed to read active_workspace_id:', error.message)
    return null
  }

  return (data?.active_workspace_id as string | null) ?? null
})

/**
 * Throws an error if user impersonation is active, preventing data modifications.
 * Works dynamically in server environments.
 */
export async function checkImpersonationWriteBlock(serviceName: string): Promise<void> {
  try {
    const { cookies } = await import('next/headers')
    const cookieStore = await cookies()
    const impersonated = cookieStore.get('impersonated_user_id')?.value
    if (impersonated) {
      throw new Error(`[Read-Only Mode] Modifications on ${serviceName} are disabled during user impersonation. | [وضع القراءة فقط] لا يمكن تعديل أو حذف البيانات في ${serviceName} أثناء محاكاة حساب العميل.`)
    }
  } catch (e: any) {
    if (e.message?.includes('Modifications on')) {
      throw e
    }
  }
}

