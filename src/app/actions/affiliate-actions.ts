'use server'

import { clerkClient } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { recordAudit } from '@/lib/audit-logs'
import { getActiveUserId } from '@/lib/auth'
import { sendEmail } from '@/lib/email'
import { clientActivationEmail } from '@/lib/email-templates'
import { isPartnerTier, PARTNER_TIERS } from '@/lib/partner-tiers'
import { daysUntilExpiry, isSubscriptionExpired } from '@/lib/subscription-utils'
import { supabase } from '@/lib/supabase'

// ──────────────────────── Register a client workspace ────────────────────────

const RegisterClientSchema = z.object({
  clientEmail: z.string().email().max(255),
  workspaceName: z.string().trim().min(1).max(120),
  clientPhone: z.string().trim().max(30).optional().nullable(),
})

/**
 * When the client has no account yet, send them a Clerk invitation to sign up.
 * Once they accept, the `user.created` webhook auto-creates the workspace the
 * affiliate registered (owner = client, partner_id = the affiliate).
 */
async function inviteNewClient(input: {
  partnerId: string
  partnerUserId: string
  clientEmail: string
  workspaceName: string
}) {
  const { partnerId, partnerUserId, clientEmail, workspaceName } = input

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  let clerkInviteId: string | null = null
  try {
    const clerk = await clerkClient()
    const invitation = await clerk.invitations.createInvitation({
      emailAddress: clientEmail,
      redirectUrl: `${appUrl}/dashboard`,
      publicMetadata: {
        affiliateWorkspace: {
          partnerId,
          workspaceName,
        },
      },
    })
    clerkInviteId = invitation.id
  } catch (clerkErr: unknown) {
    console.error('[affiliate] Clerk invitation failed:', clerkErr)

    // Check if it failed because it's a duplicate invitation or the email is already invited
    const errBody = clerkErr as { errors?: Array<{ code?: string }> }
    const isDuplicate = errBody.errors?.some(
      (e) => e.code === 'duplicate_record' || e.code === 'form_identifier_exists',
    )
    if (isDuplicate) {
      try {
        const clerk = await clerkClient()
        // Fetch all pending invitations to see if we can find the matching one
        const invitations = await clerk.invitations.getInvitationList({ status: 'pending' })
        const existingInvite = invitations.data.find(
          (inv: { emailAddress: string; id: string }) => inv.emailAddress.toLowerCase() === clientEmail.toLowerCase(),
        )
        if (existingInvite) {
          clerkInviteId = existingInvite.id
        } else {
          // If we couldn't find it in pending (maybe it was accepted or in another state),
          // check all invitations
          const allInvitations = await clerk.invitations.getInvitationList()
          const anyInvite = allInvitations.data.find(
            (inv: { emailAddress: string; id: string }) => inv.emailAddress.toLowerCase() === clientEmail.toLowerCase(),
          )
          if (anyInvite) {
            clerkInviteId = anyInvite.id
          }
        }

        // Send fallback email manually using SendGrid because Clerk won't send one
        const { data: partnerProfile } = await supabase
          .from('partner_profiles')
          .select('display_name')
          .eq('id', partnerId)
          .maybeSingle()

        const partnerName = partnerProfile?.display_name || 'Affiliate Partner'
        const signupUrl = `${appUrl}/sign-up`

        const emailTemplate = clientActivationEmail({
          clientName: 'Client',
          email: clientEmail,
          partnerName: partnerName,
          activationUrl: signupUrl,
          workspaceName: workspaceName,
        }, 'ar')

        await sendEmail({
          to: clientEmail,
          subject: emailTemplate.subject,
          html: emailTemplate.html,
          text: emailTemplate.text,
        })
      } catch (findErr) {
        console.error('[affiliate] Failed to handle duplicate fallback email:', findErr)
      }
    }
  }

  // Persist the pending invite so the webhook can match by email as a fallback
  const { error: invErr } = await supabase.from('affiliate_client_invites').insert([
    {
      partner_id: partnerId,
      email: clientEmail.toLowerCase(),
      workspace_name: workspaceName,
      status: 'pending',
      clerk_invite_id: clerkInviteId,
      created_by: partnerUserId,
    },
  ])
  if (invErr) {
    console.error('[affiliate] Failed to store client invite:', invErr)
  }

  // We proceed successfully even if clerkInviteId is null (e.g. because of duplicate invitation)
  // as long as we have saved the pending invite in our database. The signup webhook
  // fallback will match by email when they create their account anyway.
  await recordAudit({
    actorId: partnerUserId,
    actorRole: 'partner',
    action: 'affiliate.invite_client',
    entityType: 'affiliate_client_invite',
    entityId: clerkInviteId || 'manual_fallback',
    metadata: { client_email: clientEmail, partner_id: partnerId, workspace_name: workspaceName },
  })

  return {
    success: true as const,
    invited: true as const,
    message: 'invite_sent' as const,
    workspace: null,
  }
}

/**
 * The affiliate registers a workspace on behalf of an existing client.
 * The workspace is immediately attributed to the affiliate (partner_id set,
 * partner_status='active') — no admin approval step required.
 */
export async function registerClientWorkspace(input: {
  clientEmail: string
  workspaceName: string
  clientPhone?: string | null
}) {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')

    const parsed = RegisterClientSchema.parse({
      clientEmail: input.clientEmail,
      workspaceName: input.workspaceName,
      clientPhone: input.clientPhone ?? null,
    })

    // 1. Verify the caller is an active affiliate
    const { data: profile } = await supabase
      .from('partner_profiles')
      .select('id, status, tier')
      .eq('user_id', userId)
      .maybeSingle()

    if (!profile) return { success: false as const, error: 'affiliate_not_found' as const }
    if (profile.status !== 'active') return { success: false as const, error: 'affiliate_not_active' as const }

    // Enforce the tier's max-clients cap (linked workspaces + pending invites)
    const tier = isPartnerTier(profile.tier) ? profile.tier : 'starter'
    const maxClients = PARTNER_TIERS[tier].maxClients
    if (maxClients !== null) {
      const { count: linkedCount } = await supabase
        .from('workspaces')
        .select('id', { count: 'exact', head: true })
        .eq('partner_id', profile.id)
      const { count: pendingCount } = await supabase
        .from('affiliate_client_invites')
        .select('id', { count: 'exact', head: true })
        .eq('partner_id', profile.id)
        .eq('status', 'pending')

      const totalClients = (linkedCount ?? 0) + (pendingCount ?? 0)
      if (totalClients >= maxClients) {
        return {
          success: false as const,
          error: 'tier_client_limit_reached' as const,
          message: `لقد وصلت للحد الأقصى لعدد العملاء في طبقتك الحالية (${maxClients} عميل). تواصل مع الإدارة لترقية الطبقة.`,
        }
      }
    }

    // Emails are stored lowercased — normalize before any lookup
    const clientEmail = parsed.clientEmail.toLowerCase()

    // 2. Find the client — first in Supabase users table
    const { data: client } = await supabase
      .from('users')
      .select('id, email, active_workspace_id')
      .eq('email', clientEmail)
      .maybeSingle()

    let dbClient = client

    // 2.1 If not found in Supabase users table, check if they exist in Clerk
    if (!dbClient) {
      try {
        const clerk = await clerkClient()
        const clerkUsers = await clerk.users.getUserList({ emailAddress: [clientEmail] })
        const clerkUser = clerkUsers.data?.[0]

        if (clerkUser) {
          // The user exists in Clerk but not in Supabase users table.
          // Let's create the user in Supabase users table.
          const name = `${clerkUser.firstName ?? ''} ${clerkUser.lastName ?? ''}`.trim() || 'Client'
          const { data: newUser, error: userErr } = await supabase
            .from('users')
            .insert([
              {
                id: clerkUser.id,
                email: clientEmail,
                name: name,
              },
            ])
            .select()
            .single()

          if (userErr) {
            console.error('[affiliate] Failed to create user from Clerk sync:', userErr.message)
            // If user insertion fails, we'll fall back to inviteNewClient
          } else {
            dbClient = newUser
          }
        }
      } catch (clerkUserErr) {
        console.error('[affiliate] Clerk user check failed:', clerkUserErr)
      }
    }

    if (!dbClient) {
      // Prevent duplicate pending invites for the same email + affiliate
      const { data: existingInvite } = await supabase
        .from('affiliate_client_invites')
        .select('id')
        .eq('partner_id', profile.id)
        .eq('email', clientEmail)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle()

      if (existingInvite) {
        return {
          success: false as const,
          error: 'invite_already_pending' as const,
          message: 'هناك دعوة معلقة لهذا البريد. سيُسجَّل العميل تلقائياً بمجرد إنشاء حسابه.',
        }
      }

      return await inviteNewClient({
        partnerId: profile.id,
        partnerUserId: userId,
        clientEmail,
        workspaceName: parsed.workspaceName.trim(),
      })
    }

    // Prevent duplicate workspaces: client already attributed to this affiliate
    const { data: existingWs } = await supabase
      .from('workspaces')
      .select('id')
      .eq('user_id', dbClient.id)
      .eq('partner_id', profile.id)
      .limit(1)
      .maybeSingle()

    if (existingWs) {
      return {
        success: false as const,
        error: 'client_already_linked' as const,
        message: 'هذا العميل مسجَّل مسبقاً ضمن عملائك.',
      }
    }

    // 3. Create the workspace attributed to this affiliate (direct, active)
    const { data: workspace, error: wsErr } = await supabase
      .from('workspaces')
      .insert([
        {
          user_id: dbClient.id,
          name: parsed.workspaceName.trim(),
          partner_id: profile.id,
          partner_status: 'active',
          partner_linked_at: new Date().toISOString(),
          partner_link_requested_by: userId,
        },
      ])
      .select()
      .single()

    if (wsErr) {
      console.error('[affiliate] register workspace failed:', wsErr.message)
      return { success: false as const, error: wsErr.message }
    }

    // 3b. Save the client's phone number (best-effort)
    if (parsed.clientPhone) {
      const { error: phoneErr } = await supabase
        .from('users')
        .update({ phone: parsed.clientPhone })
        .eq('id', dbClient.id)
      if (phoneErr) console.error('[affiliate] phone update error:', phoneErr.message)
    }

    // 4. Make it the client's active workspace if they don't have one yet
    if (!dbClient.active_workspace_id) {
      await supabase
        .from('users')
        .update({ active_workspace_id: workspace.id })
        .eq('id', dbClient.id)
    }

    await recordAudit({
      actorId: userId,
      actorRole: 'partner',
      action: 'affiliate.register_workspace',
      entityType: 'workspace',
      entityId: workspace.id,
      metadata: { client_user_id: dbClient.id, partner_id: profile.id },
    })

    revalidatePath(`/partner/${profile.id}`)
    revalidatePath(`/partner/${profile.id}/clients`)
    return { success: true as const, invited: false as const, workspace }
  } catch (err) {
    console.error('[affiliate] registerClientWorkspace error:', err)
    return { success: false as const, error: err instanceof Error ? err.message : 'unexpected' }
  }
}

// ──────────────────────── Affiliate client list ────────────────────────

export interface AffiliateClientSubscription {
  start_date: string
  end_date: string
  months_paid: number
  amount_paid: number | string
  status: string
  isExpired: boolean
  daysRemaining: number
}

export interface AffiliateClientRow {
  workspace_id: string
  workspace_name: string
  client_email: string | null
  client_name: string | null
  linked_at: string
  subscription: AffiliateClientSubscription | null
}

/** List the affiliate's registered client workspaces + their subscription state. */
export async function getAffiliateClients(partnerId: string) {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')

    // Verify ownership
    const { data: profile } = await supabase
      .from('partner_profiles')
      .select('id, user_id')
      .eq('id', partnerId)
      .maybeSingle()

    if (!profile || profile.user_id !== userId) {
      return { success: false as const, error: 'affiliate_not_found', clients: [] }
    }

    const { data: workspaces, error: wsErr } = await supabase
      .from('workspaces')
      .select('id, name, user_id, partner_linked_at, created_at')
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false })

    if (wsErr) {
      return { success: false as const, error: wsErr.message, clients: [] }
    }

    // Resolve client names/emails
    const userIds = [...new Set((workspaces ?? []).map((w) => w.user_id))]
    const { data: users } = await supabase
      .from('users')
      .select('id, email, name')
      .in('id', userIds.length ? userIds : ['__none__'])

    const userMap = new Map((users ?? []).map((u) => [u.id, u]))

    const clients: AffiliateClientRow[] = await Promise.all(
      (workspaces ?? []).map(async (ws) => {
        const { data: subs } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('workspace_id', ws.id)
          .eq('status', 'active')
          .order('end_date', { ascending: false })
          .limit(1)

        const sub = subs?.[0] ?? null
        const user = userMap.get(ws.user_id)

        return {
          workspace_id: ws.id,
          workspace_name: ws.name,
          client_email: user?.email ?? null,
          client_name: user?.name ?? null,
          linked_at: ws.partner_linked_at ?? ws.created_at,
          subscription: sub
            ? {
                start_date: sub.start_date,
                end_date: sub.end_date,
                months_paid: sub.months_paid,
                amount_paid: sub.amount_paid,
                status: sub.status,
                isExpired: isSubscriptionExpired(sub),
                daysRemaining: daysUntilExpiry(sub.end_date),
              }
            : null,
        }
      }),
    )

    return { success: true as const, clients }
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : 'unexpected', clients: [] }
  }
}

/**
 * Check if the user has a pending affiliate invite. If so, automatically
 * create their workspace and set it as active, marking the invite completed.
 * This is a self-healing fallback in case Clerk webhooks fail to deliver.
 */
export async function checkAndCreateAffiliateWorkspace(userId: string, email: string) {
  try {
    if (!userId || !email) return { success: false as const, error: 'invalid_params' as const }

    // 1. Check if user already has any workspaces
    const { data: workspaces, error: wsFetchErr } = await supabase
      .from('workspaces')
      .select('id')
      .eq('user_id', userId)
      .limit(1)

    if (wsFetchErr) {
      console.error('[sync-invite] Failed to check existing workspaces:', wsFetchErr.message)
      return { success: false as const, error: wsFetchErr.message }
    }

    if (workspaces && workspaces.length > 0) {
      return { success: true as const, alreadyHasWorkspace: true as const }
    }

    // 2. Query pending invite by email
    const { data: invite } = await supabase
      .from('affiliate_client_invites')
      .select('id, partner_id, workspace_name')
      .eq('email', email.toLowerCase())
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!invite) {
      return { success: true as const, noInvite: true as const }
    }

    // 2.1 Update status to 'completed' first to avoid concurrent request race conditions (duplicate workspaces)
    const { data: updatedInvites, error: updateErr } = await supabase
      .from('affiliate_client_invites')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', invite.id)
      .eq('status', 'pending')
      .select('id')

    if (updateErr || !updatedInvites || updatedInvites.length === 0) {
      // A concurrent request has already completed the invite and is creating the workspace.
      return { success: true as const, alreadyCompleted: true as const }
    }

    // 3. Verify the partner still exists and is active
    const { data: partner } = await supabase
      .from('partner_profiles')
      .select('id')
      .eq('id', invite.partner_id)
      .eq('status', 'active')
      .maybeSingle()

    if (!partner) {
      console.warn(`[sync-invite] Partner ${invite.partner_id} not active — skipping`)
      // Revert the invite back to pending so it can be retried later
      await supabase
        .from('affiliate_client_invites')
        .update({ status: 'pending', completed_at: null })
        .eq('id', invite.id)
      return { success: false as const, error: 'partner_not_active' as const }
    }

    // 4. Create the workspace attributed to this affiliate
    const { data: workspace, error: wsErr } = await supabase
      .from('workspaces')
      .insert([
        {
          user_id: userId,
          name: invite.workspace_name,
          partner_id: invite.partner_id,
          partner_status: 'active',
          partner_linked_at: new Date().toISOString(),
          partner_link_requested_by: userId,
        },
      ])
      .select()
      .single()

    if (wsErr) {
      console.error('[sync-invite] Failed to create workspace:', wsErr.message)
      // Revert the invite status so we can try again
      await supabase
        .from('affiliate_client_invites')
        .update({ status: 'pending', completed_at: null })
        .eq('id', invite.id)
      return { success: false as const, error: wsErr.message }
    }

    // 5. Make it the client's active workspace
    await supabase
      .from('users')
      .update({ active_workspace_id: workspace.id })
      .eq('id', userId)

    return { success: true as const, created: true as const, workspace }
  } catch (err) {
    console.error('[sync-invite] Error checking/creating affiliate workspace:', err)
    return { success: false as const, error: err instanceof Error ? err.message : 'unexpected' }
  }
}
