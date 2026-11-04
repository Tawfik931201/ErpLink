'use server'

import { revalidatePath } from 'next/cache'

import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser } from '@/lib/users'

type MappingTable = 'payment_method_mappings' | 'shipping_method_mappings' | 'warehouse_mappings' | 'currency_mappings' | 'tax_mappings' | 'payment_term_mappings' | 'pricelist_mappings'

/**
 * Server-side allowlist — the real boundary.
 *
 * `MappingTable` is a TypeScript union, so it is erased at runtime, and a
 * server action's arguments arrive straight from the browser. Relying on the
 * type alone would let any signed-in user name a different table
 * (`subscriptions`, `workspace_members`, …) in `.from(table)` and write to it
 * through the service-role client, which bypasses every RLS policy.
 */
const ALLOWED_TABLES: readonly string[] = [
  'payment_method_mappings',
  'shipping_method_mappings',
  'warehouse_mappings',
  'currency_mappings',
  'tax_mappings',
  'payment_term_mappings',
  'pricelist_mappings',
]

function isAllowedTable(table: string): table is MappingTable {
  return ALLOWED_TABLES.includes(table)
}

export async function getStaticMappings(table: MappingTable, platform: string = 'zid') {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')
    if (!isAllowedTable(table)) throw new Error('Invalid table')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, mappings: [] }

    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .eq('platform', platform)
      .order('created_at', { ascending: false })

    if (error) throw error

    return { success: true, mappings: data || [] }
  } catch (error: any) {
    console.error(`[StaticMappings] Get ${table} failed:`, error)
    return { success: false, error: error?.message || 'Failed to fetch mappings', mappings: [] }
  }
}

export async function saveStaticMapping(table: MappingTable, row: Record<string, any>, platform: string = 'zid') {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')
    if (!isAllowedTable(table)) throw new Error('Invalid table')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const { id, ...data } = row

    // An `id` belonging to another workspace must not be updatable: the upsert
    // below would otherwise move that row into the caller's workspace.
    if (id) {
      const { data: existing, error: lookupError } = await supabase
        .from(table)
        .select('id')
        .eq('id', id)
        .eq('workspace_id', user.active_workspace_id)
        .eq('platform', platform)
        .maybeSingle()
      if (lookupError) throw lookupError
      if (!existing) throw new Error('Mapping not found in this workspace')
    }

    // Server-owned fields are assigned AFTER the spread, so client data can
    // never override the tenant scope.
    const payload: Record<string, any> = {
      ...data,
      workspace_id: user.active_workspace_id,
      platform,
      updated_at: new Date().toISOString(),
    }

    if (id) {
      payload.id = id
    }

    const { error } = await supabase
      .from(table)
      .upsert(payload, { onConflict: id ? 'id' : undefined })

    if (error) throw error

    revalidatePath('/app/mapping-center')
    return { success: true }
  } catch (error: any) {
    console.error(`[StaticMappings] Save ${table} failed:`, error)
    return { success: false, error: error?.message || 'Failed to save mapping' }
  }
}

export async function deleteStaticMapping(table: MappingTable, id: string) {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')
    if (!isAllowedTable(table)) throw new Error('Invalid table')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const { error } = await supabase
      .from(table)
      .delete()
      .eq('id', id)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw error

    revalidatePath('/app/mapping-center')
    return { success: true }
  } catch (error: any) {
    console.error(`[StaticMappings] Delete ${table} failed:`, error)
    return { success: false, error: error?.message || 'Failed to delete mapping' }
  }
}
