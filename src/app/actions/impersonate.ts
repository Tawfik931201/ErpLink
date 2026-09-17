'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { isAdmin } from '@/lib/auth'

/**
 * Starts impersonating a target client user.
 * Restricted to admin users.
 */
export async function startImpersonation(targetUserId: string): Promise<void> {
  const { userId } = await auth()
  
  if (!userId || !isAdmin(userId)) {
    throw new Error('Unauthorized')
  }

  const cookieStore = cookies()
  cookieStore.set({
    name: 'impersonated_user_id',
    value: targetUserId,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 3600, // 1 hour
    path: '/',
  })

  revalidatePath('/')
  redirect('/dashboard')
}

/**
 * Stops the current user impersonation by deleting the cookie.
 */
export async function stopImpersonation(): Promise<void> {
  const cookieStore = cookies()
  cookieStore.delete('impersonated_user_id')
  revalidatePath('/')
}
