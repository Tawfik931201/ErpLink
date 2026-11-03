import { supabase } from '@/lib/supabase'

/** Revalidate persisted workspace selection against current ownership/membership. */
export async function accessibleWorkspaceId(userId: string, workspaceId: string | null | undefined): Promise<string | null> {
  if (!userId || !workspaceId) return null
  const { data: workspace, error } = await supabase.from('workspaces')
    .select('id,user_id').eq('id', workspaceId).maybeSingle()
  if (error || !workspace) return null
  if (workspace.user_id === userId) return workspaceId
  const { data: member, error: memberError } = await supabase.from('workspace_members')
    .select('workspace_id').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle()
  return !memberError && member ? workspaceId : null
}
