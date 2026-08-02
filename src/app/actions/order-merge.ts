'use server'

import { auth } from '@clerk/nextjs/server'

import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser } from '@/lib/users'

export type DuplicateGroup = {
  zidEntityId: string
  entries: { id: string; event: string; status: string; created_at: string; odoo_record_id?: number }[]
}

export async function findDuplicateOrders() {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, groups: [] }

    const { data, error } = await supabase
      .from('sync_logs')
      .select('id, event, status, created_at, zid_entity_id, odoo_record_id')
      .eq('workspace_id', user.active_workspace_id)
      .not('zid_entity_id', 'is', null)
      .order('created_at', { ascending: false })

    if (error) throw error

    const groups = new Map<string, DuplicateGroup['entries']>()
    for (const row of data || []) {
      if (!row.zid_entity_id) continue
      const key = row.zid_entity_id
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push({
        id: row.id,
        event: row.event,
        status: row.status,
        created_at: row.created_at,
        odoo_record_id: row.odoo_record_id,
      })
    }

    const duplicates: DuplicateGroup[] = []
    for (const [zidEntityId, entries] of groups) {
      if (entries.length > 1) {
        duplicates.push({ zidEntityId, entries })
      }
    }

    duplicates.sort((a, b) => b.entries.length - a.entries.length)

    return { success: true, groups: duplicates }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function dedupOrderGroup(zidEntityId: string) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const { data, error } = await supabase
      .from('sync_logs')
      .select('id, event, status, created_at')
      .eq('workspace_id', user.active_workspace_id)
      .eq('zid_entity_id', zidEntityId)
      .order('created_at', { ascending: false })

    if (error) throw error
    if (!data || data.length <= 1) return { success: true, removed: 0 }

    // Group by event, keep only the latest per event
    const byEvent = new Map<string, typeof data>()
    for (const row of data) {
      if (!byEvent.has(row.event)) byEvent.set(row.event, [])
      byEvent.get(row.event)!.push(row)
    }

    const toDelete: string[] = []
    for (const [, entries] of byEvent) {
      if (entries.length > 1) {
        const [, ...rest] = entries
        toDelete.push(...rest.map(r => r.id))
      }
    }

    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from('sync_logs')
        .delete()
        .in('id', toDelete)
      if (delErr) throw delErr
    }

    return { success: true, removed: toDelete.length }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
