import { supabase } from '@/lib/supabase'

/**
 * Ensures that a new user has a default workspace named "Default".
 *
 * Rules:
 * 1. If user already has an active workspace in `users.active_workspace_id` that exists, return it.
 * 2. If user already owns or belongs to a workspace, activate that workspace and return it.
 * 3. If user has 0 workspaces:
 *    - Check if they have ever deleted a workspace (via `audit_logs` with action 'workspace.delete').
 *    - If they have deleted workspaces before, do NOT recreate (respect their choice).
 *    - If they have never deleted a workspace (brand new user or unprovisioned user),
 *      create a workspace named "Default", activate it as `active_workspace_id`, and return its ID.
 */
export async function ensureDefaultWorkspace(userId: string): Promise<string | null> {
  if (!userId) return null

  try {
    // 1. Check if user already has an active workspace in users table
    const { data: user } = await supabase
      .from('users')
      .select('active_workspace_id')
      .eq('id', userId)
      .maybeSingle()

    if (user?.active_workspace_id) {
      const { data: wsExists } = await supabase
        .from('workspaces')
        .select('id')
        .eq('id', user.active_workspace_id)
        .maybeSingle()

      if (wsExists?.id) {
        return wsExists.id
      }
    }

    // 2. Check if user owns any workspace
    const { data: ownedWorkspaces } = await supabase
      .from('workspaces')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (ownedWorkspaces && ownedWorkspaces.length > 0) {
      const existingId = ownedWorkspaces[0].id
      await supabase
        .from('users')
        .update({ active_workspace_id: existingId })
        .eq('id', userId)
      return existingId
    }

    // 3. Check if user is a member of any workspace
    const { data: memberWorkspaces } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)
      .limit(1)

    if (memberWorkspaces && memberWorkspaces.length > 0) {
      const memberWsId = memberWorkspaces[0].workspace_id
      await supabase
        .from('users')
        .update({ active_workspace_id: memberWsId })
        .eq('id', userId)
      return memberWsId
    }

    // 4. Check if user intentionally deleted workspaces in the past
    const { count: deleteCount } = await supabase
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('actor_id', userId)
      .eq('action', 'workspace.delete')

    if ((deleteCount ?? 0) > 0) {
      // User has explicitly deleted workspaces; respect their action
      return null
    }

    // 5. User has 0 workspaces and never deleted one: create "Default" workspace
    const { data: workspace, error: createError } = await supabase
      .from('workspaces')
      .insert([{ name: 'Default', user_id: userId }])
      .select('id')
      .single()

    if (createError || !workspace) {
      console.error('[workspace-defaults] Failed to insert default workspace:', createError?.message)
      return null
    }

    // 6. Activate the default workspace
    const { error: activateError } = await supabase
      .from('users')
      .update({ active_workspace_id: workspace.id })
      .eq('id', userId)

    if (activateError) {
      console.error('[workspace-defaults] Failed to activate default workspace:', activateError.message)
    }

    return workspace.id
  } catch (err: any) {
    console.error('[workspace-defaults] Unexpected error ensuring default workspace:', err?.message)
    return null
  }
}
