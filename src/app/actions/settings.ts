'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'

async function getOrCreateDbUser() {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')
  return ensureDbUser(userId)
}

export async function getUserSettings() {
  try {
    const user = await getOrCreateDbUser()
    
    // Fetch user settings
    const { data: settings, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
      throw error
    }

    if (!settings) {
      // Return defaults if not set in DB yet
      return { success: true, settings: { lang: 'ar', theme: 'light' } }
    }

    return { success: true, settings }
  } catch (error: any) {
    console.error('Failed to get user settings:', error)
    return { success: false, error: error.message || 'Failed to fetch settings' }
  }
}

export async function updateUserSettings(lang: 'ar' | 'en', theme: string) {
  try {
    const user = await getOrCreateDbUser()

    const { data, error } = await supabase
      .from('user_settings')
      .upsert({
        user_id: user.id,
        lang,
        theme,
        updated_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) throw error

    revalidatePath('/app/settings')
    return { success: true, settings: data }
  } catch (error: any) {
    console.error('Failed to update user settings:', error)
    return { success: false, error: error.message || 'Failed to update settings' }
  }
}
