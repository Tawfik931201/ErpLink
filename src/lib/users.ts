import { currentUser } from '@clerk/nextjs/server'

import { supabase } from '@/lib/supabase'

export async function getOrCreateDbUser(userId: string) {
  const { data: dbUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  if (dbUser) return dbUser

  const clerkUser = await currentUser()
  const email = clerkUser?.emailAddresses[0]?.emailAddress ?? `${userId}@clerk.user`
  const name = clerkUser
    ? `${clerkUser.firstName ?? ''} ${clerkUser.lastName ?? ''}`.trim()
    : 'Zid Merchant'

  const { data: newUser, error: createError } = await supabase
    .from('users')
    .insert([
      {
        id: userId,
        email,
        name: name || 'Zid Merchant',
      },
    ])
    .select()
    .single()

  if (createError) {
    console.error('Failed to create user in Supabase:', createError)
    throw new Error('Could not create database user')
  }

  return newUser
}
