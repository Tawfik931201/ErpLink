'use server'

import { clerkClient, currentUser } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { getActiveUserId, getActiveWorkspaceId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'
import { ALL_PAGES, DEFAULT_PERMISSIONS } from '@/lib/workspace-members-constants'

async function getOrCreateDbUser() {
  const userId = await getActiveUserId()
  if (!userId) throw new Error('Unauthorized')
  return ensureDbUser(userId)
}

interface MemberUser {
  user_id: string
  email: string
  name: string
  role: string
  permissions: string[]
  created_at: string
}

interface PendingInvitation {
  id: string
  name: string
  email: string
  invited_by: string
  permissions: string[]
  status: string
  created_at: string
}

export async function getWorkspaceMembers(workspaceId: string) {
  try {
    const user = await getOrCreateDbUser()

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('user_id')
      .eq('id', workspaceId)
      .single()

    if (!workspace) return { success: false, error: 'Workspace not found' }

    const isOwner = workspace.user_id === user.id
    const isMember = await checkIsMember(workspaceId, user.id)

    if (!isOwner && !isMember) return { success: false, error: 'Unauthorized' }

    const { data: members, error } = await supabase
      .from('workspace_members')
      .select('user_id, role, permissions, created_at')
      .eq('workspace_id', workspaceId)

    if (error) return { success: false, error: error.message }

    const userIds = members.map((m: any) => m.user_id)

    const { data: users } = await supabase
      .from('users')
      .select('id, email, name')
      .in('id', userIds)

    const userMap = new Map((users || []).map((u: any) => [u.id, u]))

    const enrichedMembers: MemberUser[] = members.map((m: any) => {
      const u = userMap.get(m.user_id) || {}
      return {
        user_id: m.user_id,
        email: u.email || '',
        name: u.name || '',
        role: m.role || 'member',
        permissions: m.permissions || DEFAULT_PERMISSIONS,
        created_at: m.created_at,
      }
    })

    // Fetch pending invitations
    const { data: invitations, error: invErr } = await supabase
      .from('workspace_invitations')
      .select('id, name, email, invited_by, permissions, status, created_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (invErr) console.error('Failed to fetch pending invitations:', invErr)

    const pendingInvitations: PendingInvitation[] = (invitations || []).map((inv: any) => ({
      id: inv.id,
      name: inv.name || '',
      email: inv.email,
      invited_by: inv.invited_by,
      permissions: inv.permissions || DEFAULT_PERMISSIONS,
      status: inv.status,
      created_at: inv.created_at,
    }))

    // Add owner info
    const { data: ownerUser } = await supabase
      .from('users')
      .select('email, name')
      .eq('id', workspace.user_id)
      .single()

    return {
      success: true,
      members: enrichedMembers,
      pendingInvitations,
      ownerId: workspace.user_id,
      ownerEmail: ownerUser?.email || '',
      ownerName: ownerUser?.name || '',
    }
  } catch (error: any) {
    console.error('Failed to get workspace members:', error)
    return { success: false, error: error.message || 'Failed to get members' }
  }
}

export async function inviteMember(
  workspaceId: string,
  email: string,
  permissions: string[],
  name?: string,
) {
  try {
    if (!email || !email.trim()) return { success: false, error: 'Email is required' }
    const memberName = name?.trim() || ''

    const user = await getOrCreateDbUser()

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('user_id, name')
      .eq('id', workspaceId)
      .single()

    if (!workspace) return { success: false, error: 'Workspace not found' }
    if (workspace.user_id !== user.id) return { success: false, error: 'Only the workspace owner can invite members' }

    // Normalize email
    const normalizedEmail = email.trim().toLowerCase()

    // Look up user in our DB by email
    const { data: existingUsers } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('email', normalizedEmail)
      .limit(1)

    const existingUser = existingUsers?.[0]

    if (existingUser) {
      // User already has an account → check if already a member
      const { count: memberCount } = await supabase
        .from('workspace_members')
        .select('workspace_id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('user_id', existingUser.id)

      if ((memberCount ?? 0) > 0) {
        return { success: false, error: 'User is already a member of this workspace' }
      }

      // Add directly
      const { error: insertError } = await supabase
        .from('workspace_members')
        .insert({
          workspace_id: workspaceId,
          user_id: existingUser.id,
          role: 'member',
          permissions: permissions,
        })

      if (insertError) {
        if (insertError.code === '23505') {
          return { success: false, error: 'User is already a member of this workspace' }
        }
        return { success: false, error: insertError.message }
      }

      revalidatePath('/app/settings/team')
      return { success: true, message: `User added as member successfully` }
    }

    // User doesn't exist → send Clerk invitation
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    let clerkInviteId: string | null = null
    try {
      const clerk = await clerkClient()
      const invitation = await clerk.invitations.createInvitation({
        emailAddress: normalizedEmail,
        redirectUrl: `${appUrl}/dashboard`,
        publicMetadata: {},
      })
      clerkInviteId = invitation.id
    } catch (clerkErr: any) {
      console.error('Clerk invitation failed:', clerkErr)
      // Continue even if Clerk invite fails — we'll still store the pending invitation
    }

    // Store pending invitation in our DB
    const { error: inviteError } = await supabase
      .from('workspace_invitations')
      .insert({
        name: memberName,
        email: normalizedEmail,
        workspace_id: workspaceId,
        invited_by: user.id,
        permissions: permissions,
        status: 'pending',
        clerk_invite_id: clerkInviteId,
      })

    if (inviteError) {
      console.error('Failed to store invitation:', inviteError)
      return { success: false, error: inviteError.message }
    }

    revalidatePath('/app/settings/team')
    return {
      success: true,
      message: `Invitation sent to ${normalizedEmail}`,
    }
  } catch (error: any) {
    console.error('Failed to invite member:', error)
    return { success: false, error: error.message || 'Failed to invite member' }
  }
}

export async function removeMember(workspaceId: string, memberUserId: string) {
  try {
    const user = await getOrCreateDbUser()

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('user_id')
      .eq('id', workspaceId)
      .single()

    if (!workspace) return { success: false, error: 'Workspace not found' }
    if (workspace.user_id !== user.id) return { success: false, error: 'Only the workspace owner can remove members' }

    const { error } = await supabase
      .from('workspace_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', memberUserId)

    if (error) return { success: false, error: error.message }

    revalidatePath('/app/settings/team')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to remove member:', error)
    return { success: false, error: error.message || 'Failed to remove member' }
  }
}

export async function revokeInvitation(invitationId: string) {
  try {
    const user = await getOrCreateDbUser()

    const { data: invitation } = await supabase
      .from('workspace_invitations')
      .select('workspace_id')
      .eq('id', invitationId)
      .single()

    if (!invitation) return { success: false, error: 'Invitation not found' }

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('user_id')
      .eq('id', invitation.workspace_id)
      .single()

    if (!workspace || workspace.user_id !== user.id) {
      return { success: false, error: 'Only the workspace owner can revoke invitations' }
    }

    const { error } = await supabase
      .from('workspace_invitations')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('id', invitationId)

    if (error) return { success: false, error: error.message }

    revalidatePath('/app/settings/team')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to revoke invitation:', error)
    return { success: false, error: error.message || 'Failed to revoke invitation' }
  }
}

export async function updateMemberPermissions(
  workspaceId: string,
  memberUserId: string,
  permissions: string[],
) {
  try {
    const user = await getOrCreateDbUser()

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('user_id')
      .eq('id', workspaceId)
      .single()

    if (!workspace) return { success: false, error: 'Workspace not found' }
    if (workspace.user_id !== user.id) return { success: false, error: 'Only the workspace owner can change permissions' }

    const { error } = await supabase
      .from('workspace_members')
      .update({ permissions })
      .eq('workspace_id', workspaceId)
      .eq('user_id', memberUserId)

    if (error) return { success: false, error: error.message }

    revalidatePath('/app/settings/team')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to update permissions:', error)
    return { success: false, error: error.message || 'Failed to update permissions' }
  }
}

/**
 * يقبل دعوات الانضمام المعلّقة على بريد صاحب الجلسة ويضيفه كعضو.
 *
 * المعاملتان `userId` و`email` كان يُستخدمان كمدخلات موثوقة: أي متصل كان
 * بإمكانه تمرير (معرّف مستخدم، بريد عميل لديه دعوة معلّقة) فينضم ذلك
 * المستخدم إلى مساحة عمل ذلك العميل — بلا جلسة ولا تحقق من الملكية.
 * لذلك صارت القيم تُقرأ من الجلسة دائماً وتُهمَل المدخلات الخارجية.
 */
export async function checkPendingInvitations() {
  try {
    const clerkUser = await currentUser()
    if (!clerkUser) return { success: true, invitations: [] }

    const activeUserId = clerkUser.id
    const activeEmail = clerkUser.emailAddresses[0]?.emailAddress
    if (!activeEmail) return { success: true, invitations: [] }

    // Ensure the user exists in the local users table first, so the
    // workspace_members FK constraint is satisfied.
    try {
      await ensureDbUser(activeUserId)
    } catch {
      console.error('[checkPendingInvitations] Failed to ensure DB user exists')
    }

    const { data: pendingInvites, error } = await supabase
      .from('workspace_invitations')
      .select('*, workspaces(name)')
      .eq('email', activeEmail.toLowerCase())
      .eq('status', 'pending')

    if (error) {
      console.error('Failed to check pending invitations:', error)
      return { success: false, error: error.message, invitations: [] }
    }

    const accepted: Array<{ workspaceName: string }> = []

    for (const invite of pendingInvites || []) {
      const { error: insertError } = await supabase
        .from('workspace_members')
        .insert({
          workspace_id: invite.workspace_id,
          user_id: activeUserId,
          role: 'member',
          permissions: invite.permissions,
        })

      if (!insertError) {
        await supabase
          .from('workspace_invitations')
          .update({ status: 'accepted', updated_at: new Date().toISOString() })
          .eq('id', invite.id)

        accepted.push({ workspaceName: (invite as any).workspaces?.name || '' })
      }
    }

    return { success: true, invitations: accepted }
  } catch (error: any) {
    console.error('Failed to check invitations:', error)
    return { success: false, error: error.message || 'Failed to check invitations', invitations: [] }
  }
}

export async function getCurrentUserPermissions() {
  try {
    const userId = await getActiveUserId()
    if (!userId) return { isOwner: false, permissions: [] as string[] }

    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return { isOwner: false, permissions: [] as string[] }

    // Check if user is owner
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('user_id')
      .eq('id', workspaceId)
      .single()

    if (!workspace) return { isOwner: false, permissions: [] as string[] }

    if (workspace.user_id === userId) {
      return { isOwner: true, permissions: ALL_PAGES.map(p => p.id) }
    }

    // Check member permissions
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('permissions')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle()

    return {
      isOwner: false,
      permissions: (membership?.permissions as string[]) || [],
    }
  } catch (error: any) {
    console.error('Failed to get permissions:', error)
    return { isOwner: false, permissions: [] as string[] }
  }
}

async function checkIsMember(workspaceId: string, userId: string): Promise<boolean> {
  const { count } = await supabase
    .from('workspace_members')
    .select('workspace_id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)

  return (count ?? 0) > 0
}


