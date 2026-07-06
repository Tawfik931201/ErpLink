'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'
import { syncWebhooksWithSettings } from '@/lib/zid/webhooks'

async function getOrCreateDbUser() {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')

  return ensureDbUser(userId)
}

export async function getWorkspaces() {
  try {
    const user = await getOrCreateDbUser()
    
    const { data: ownedWorkspaces, error: err1 } = await supabase
      .from('workspaces')
      .select('*, merchant_tokens(merchant_id, name), erp_connections(id)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const { data: membershipData, error: err2 } = await supabase
      .from('workspace_members')
      .select('*, workspaces(*, merchant_tokens(merchant_id, name), erp_connections(id))')
      .eq('user_id', user.id)

    if (err1 || err2) throw new Error('Failed to fetch workspaces from database')

    const memberWorkspaces = (membershipData || []).map(m => m.workspaces).filter(Boolean)
    
    // Combine and deduplicate
    const allWorkspacesMap = new Map()
    ownedWorkspaces?.forEach(w => allWorkspacesMap.set(w.id, w))
    memberWorkspaces.forEach(w => allWorkspacesMap.set(w.id, w))
    
    const workspaces = Array.from(allWorkspacesMap.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )

    return { success: true, workspaces, activeWorkspaceId: user.active_workspace_id }
  } catch (error: any) {
    console.error('Failed to get workspaces:', error)
    return { success: false, error: error.message || 'Failed to fetch workspaces' }
  }
}

/**
 * Lightweight existence check used by the dashboard layout on every navigation.
 * Uses head+count queries (no row data, no joins) so it is much faster than
 * getWorkspaces(), which loads merchant tokens and ERP connections.
 */
export async function hasAnyWorkspace() {
  try {
    const { userId } = await auth()
    if (!userId) return { success: false, hasWorkspace: false }

    const { count: ownedCount } = await supabase
      .from('workspaces')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    if ((ownedCount ?? 0) > 0) return { success: true, hasWorkspace: true }

    const { count: memberCount } = await supabase
      .from('workspace_members')
      .select('workspace_id', { count: 'exact', head: true })
      .eq('user_id', userId)

    return { success: true, hasWorkspace: (memberCount ?? 0) > 0 }
  } catch (error: any) {
    console.error('Failed to check workspaces:', error)
    // Fail open so the dashboard still renders if the check errors out
    return { success: false, hasWorkspace: true }
  }
}

export async function createWorkspace(name: string) {
  try {
    if (!name || name.trim() === '') throw new Error('Workspace name is required')

    const user = await getOrCreateDbUser()

    const { data: workspace, error: createError } = await supabase
      .from('workspaces')
      .insert([{ name: name.trim(), user_id: user.id }])
      .select()
      .single()

    if (createError) throw new Error('Failed to create workspace in database')

    // Automatically set the new workspace as active if the user doesn't have one
    if (!user.active_workspace_id) {
      await supabase
        .from('users')
        .update({ active_workspace_id: workspace.id })
        .eq('id', user.id)
    }

    revalidatePath('/dashboard/workspace')
    return { success: true, workspace }
  } catch (error: any) {
    console.error('Failed to create workspace:', error)
    return { success: false, error: error.message || 'Failed to create workspace' }
  }
}

export async function updateWorkspace(id: string, name: string) {
  try {
    if (!name || name.trim() === '') throw new Error('Workspace name is required')

    const user = await getOrCreateDbUser()

    // Ensure user owns or is member of the workspace
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('*, workspace_members(user_id)')
      .eq('id', id)
      .single()

    if (!workspace) throw new Error('Workspace not found')

    const isOwner = workspace.user_id === user.id
    const isMember = workspace.workspace_members?.some((m: any) => m.user_id === user.id)

    if (!isOwner && !isMember) throw new Error('Unauthorized')

    const { data: updated, error } = await supabase
      .from('workspaces')
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error('Failed to update workspace in database')

    revalidatePath('/dashboard/workspace')
    return { success: true, workspace: updated }
  } catch (error: any) {
    console.error('Failed to update workspace:', error)
    return { success: false, error: error.message || 'Failed to update workspace' }
  }
}

export async function deleteWorkspace(id: string) {
  try {
    const user = await getOrCreateDbUser()

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, user_id')
      .eq('id', id)
      .single()

    if (!workspace || workspace.user_id !== user.id) {
      throw new Error('Workspace not found or unauthorized (Only owners can delete)')
    }

    const { error } = await supabase
      .from('workspaces')
      .delete()
      .eq('id', id)

    if (error) throw new Error('Failed to delete workspace from database')

    // If deleted workspace was the active one, clear active workspace ID or pick another one
    if (user.active_workspace_id === id) {
      const { workspaces } = await getWorkspaces() as any
      const remaining = workspaces?.[0]

      await supabase
        .from('users')
        .update({ active_workspace_id: remaining?.id || null })
        .eq('id', user.id)
    }

    revalidatePath('/dashboard/workspace')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to delete workspace:', error)
    return { success: false, error: error.message || 'Failed to delete workspace' }
  }
}

export async function setActiveWorkspace(id: string) {
  try {
    const user = await getOrCreateDbUser()

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, user_id, workspace_members(user_id)')
      .eq('id', id)
      .single()

    if (!workspace) throw new Error('Workspace not found')

    const isOwner = workspace.user_id === user.id
    const isMember = workspace.workspace_members?.some((m: any) => m.user_id === user.id)

    if (!isOwner && !isMember) throw new Error('Unauthorized')

    const { error } = await supabase
      .from('users')
      .update({ active_workspace_id: id })
      .eq('id', user.id)

    if (error) throw new Error('Failed to update active workspace')

    revalidatePath('/dashboard')
    revalidatePath('/dashboard/workspace')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to set active workspace:', error)
    return { success: false, error: error.message || 'Failed to set active workspace' }
  }
}

export async function getActiveWorkspaceZidToken() {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, token: null }
    }

    const { data: token, error } = await supabase
      .from('merchant_tokens')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (error) throw new Error('Failed to query merchant token: ' + error.message)

    return { success: true, token }
  } catch (error: any) {
    console.error('Failed to get Zid token:', error)
    return { success: false, error: error.message || 'Failed to fetch Zid token' }
  }
}

export async function disconnectZidStore(merchantId: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    const { error } = await supabase
      .from('merchant_tokens')
      .delete()
      .eq('merchant_id', merchantId)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw new Error('Failed to disconnect Zid store: ' + error.message)

    revalidatePath('/dashboard/connect-zid')
    revalidatePath('/dashboard/workspace')
    revalidatePath('/dashboard/integrations')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to disconnect Zid store:', error)
    return { success: false, error: error.message || 'Failed to disconnect Zid store' }
  }
}

export async function updateZidSyncSettings(merchantId: string, settings: any) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    // Save new settings to DB
    const { error } = await supabase
      .from('merchant_tokens')
      .update({ sync_settings: settings })
      .eq('merchant_id', merchantId)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw new Error('Failed to update sync settings: ' + error.message)

    // Sync webhooks with Zid (clear old and register currently enabled)
    // We do NOT await this to keep the save action fast; errors are logged server-side
    syncWebhooksWithSettings(merchantId, settings).catch((err) =>
      console.error('[Zid Webhook] syncWebhooksWithSettings failed:', err)
    )

    revalidatePath('/dashboard/connect-zid')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to update sync settings:', error)
    return { success: false, error: error.message || 'Failed to update sync settings' }
  }
}

export async function getActiveWorkspaceSallaToken() {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, token: null }
    }

    const { data: token, error } = await supabase
      .from('salla_tokens')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (error) throw new Error('Failed to query Salla token: ' + error.message)

    return { success: true, token }
  } catch (error: any) {
    console.error('Failed to get Salla token:', error)
    return { success: false, error: error.message || 'Failed to fetch Salla token' }
  }
}

export async function disconnectSallaStore(merchantId: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    const { error } = await supabase
      .from('salla_tokens')
      .delete()
      .eq('merchant_id', merchantId)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw new Error('Failed to disconnect Salla store: ' + error.message)

    revalidatePath('/dashboard/connect-zid')
    revalidatePath('/dashboard/workspace')
    revalidatePath('/dashboard/integrations')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to disconnect Salla store:', error)
    return { success: false, error: error.message || 'Failed to disconnect Salla store' }
  }
}

export async function updateSallaSyncSettings(merchantId: string, settings: any) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    // Save new settings to DB
    const { error } = await supabase
      .from('salla_tokens')
      .update({ sync_settings: settings })
      .eq('merchant_id', merchantId)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw new Error('Failed to update Salla sync settings: ' + error.message)

    revalidatePath('/dashboard/connect-zid')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to update Salla sync settings:', error)
    return { success: false, error: error.message || 'Failed to update Salla sync settings' }
  }
}



