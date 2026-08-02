'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getActiveUserId, isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { recordAudit } from '@/lib/audit-logs'

/**
 * Claim a workspace after the client has accepted the invitation.
 * The client signs up, then calls this with their token to link their
 * new workspace to the partner.
 */
const ClaimSchema = z.object({
  token: z.string().min(10),
  workspaceName: z.string().trim().min(1).max(120),
})

export async function claimPartnerWorkspace(input: { token: string; workspaceName: string }) {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')

    const parsed = ClaimSchema.parse(input)

    // 1. Find the invitation by token (must be 'accepted')
    const { data: invitations } = await supabase
      .from('partner_onboarding_invitations')
      .select('id, partner_id, status, workspace_id')
      .eq('token', parsed.token)
      .limit(1)

    if (!invitations || invitations.length === 0) {
      return { success: false, error: 'invitation_not_found' }
    }

    const inv = invitations[0]
    if (inv.status !== 'accepted') {
      return { success: false, error: 'invitation_not_accepted' }
    }
    if (inv.workspace_id) {
      return { success: false, error: 'workspace_already_linked' }
    }

    // 2. Create a workspace for the client
    const { data: workspace, error: wsErr } = await supabase
      .from('workspaces')
      .insert([
        {
          user_id: userId,
          name: parsed.workspaceName,
          zid_store_name: null,
          odoo_db_name: null,
          status: 'active',
        },
      ])
      .select('id, name')
      .single()

    if (wsErr) {
      return { success: false, error: wsErr.message }
    }

    // 3. Update invitation with workspace_id
    const { error: invErr } = await supabase
      .from('partner_onboarding_invitations')
      .update({
        workspace_id: workspace.id,
        status: 'linked',
        created_user_id: userId,
      })
      .eq('id', inv.id)

    if (invErr) {
      return { success: false, error: invErr.message }
    }

    // 4. Set workspace partner_id + partner_status = 'pending' (needs admin approval)
    const { error: wsLinkErr } = await supabase
      .from('workspaces')
      .update({
        partner_id: inv.partner_id,
        partner_status: 'pending',
        partner_link_requested_by: userId,
      })
      .eq('id', workspace.id)

    if (wsLinkErr) {
      return { success: false, error: wsLinkErr.message }
    }

    await recordAudit({
      actorId: userId,
      actorRole: 'user',
      action: 'partner.claim_workspace',
      entityType: 'PartnerOnboardingInvitation',
      entityId: inv.id,
      metadata: { workspace_id: workspace.id, partner_id: inv.partner_id },
    })

    revalidatePath('/dashboard')
    return { success: true, workspace }
  } catch (err: any) {
    return { success: false, error: err.message ?? 'unexpected' }
  }
}

// ──────────────────────── Admin: approve workspace link ────────────────────────

const ApproveLinkSchema = z.object({
  workspaceId: z.string().uuid(),
  action: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(1000).optional().nullable(),
})

export async function reviewPartnerWorkspace(input: {
  workspaceId: string
  action: 'approve' | 'reject'
  reason?: string | null
}) {
  try {
    const adminId = await getActiveUserId()
    if (!adminId || !isAdmin(adminId)) {
      return { success: false, error: 'Unauthorized' }
    }

    const parsed = ApproveLinkSchema.parse(input)

    if (parsed.action === 'approve') {
      const { error } = await supabase
        .from('workspaces')
        .update({
          partner_status: 'active',
          partner_approved_by_admin: adminId,
          partner_approved_admin_at: new Date().toISOString(),
        })
        .eq('id', parsed.workspaceId)

      if (error) return { success: false, error: error.message }
    } else {
      const { error } = await supabase
        .from('workspaces')
        .update({
          partner_status: 'rejected',
          partner_approved_by_admin: adminId,
          partner_approved_admin_at: new Date().toISOString(),
        })
        .eq('id', parsed.workspaceId)

      if (error) return { success: false, error: error.message }
    }

    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: `partner.link_${parsed.action}`,
      entityType: 'workspace',
      entityId: parsed.workspaceId,
      metadata: { reason: parsed.reason },
    })

    revalidatePath('/admin/workspace-links')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message ?? 'unexpected' }
  }
}

// ──────────────────────── Admin: Commissions ────────────────────────

const AddCommissionSchema = z.object({
  partnerId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  clientUserId: z.string().min(1),
  grossAmount: z.number().positive().max(9999999),
  description: z.string().trim().max(500).optional().nullable(),
})

export async function addCommission(input: {
  partnerId: string
  workspaceId: string
  clientUserId: string
  grossAmount: number
  description?: string | null
}) {
  try {
    const adminId = await getActiveUserId()
    if (!adminId || !isAdmin(adminId)) {
      return { success: false, error: 'Unauthorized' }
    }

    const parsed = AddCommissionSchema.parse(input)

    // Get partner's current commission rate
    const { data: profile } = await supabase
      .from('partner_profiles')
      .select('commission_rate')
      .eq('id', parsed.partnerId)
      .single()

    if (!profile) return { success: false, error: 'partner_not_found' }

    const rate = Number(profile.commission_rate)
    const commissionAmount = Math.round(parsed.grossAmount * rate * 100) / 100

    const { data, error } = await supabase
      .from('partner_commissions')
      .insert([
        {
          partner_id: parsed.partnerId,
          workspace_id: parsed.workspaceId,
          client_user_id: parsed.clientUserId,
          gross_amount: parsed.grossAmount,
          commission_rate: rate,
          commission_amount: commissionAmount,
          status: 'approved',
          source: 'manual',
          period_start: new Date(0).toISOString(),     // epoch = open period
          period_end: new Date().toISOString(),
          note: parsed.description ?? null,
          created_by: adminId,
        },
      ])
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: 'commission.add',
      entityType: 'PartnerCommission',
      entityId: data.id,
      metadata: { partner_id: parsed.partnerId, amount: commissionAmount },
    })

    revalidatePath('/admin/commissions')
    revalidatePath(`/partner/${parsed.partnerId}/commissions`)
    return { success: true, commission: data }
  } catch (err: any) {
    return { success: false, error: err.message ?? 'unexpected' }
  }
}

// ──────────────────────── Admin: Payouts ────────────────────────

const ReviewPayoutSchema = z.object({
  payoutId: z.string().uuid(),
  action: z.enum(['approve', 'pay', 'reject']),
  paymentReference: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
})

export async function reviewPayoutRequest(input: {
  payoutId: string
  action: 'approve' | 'pay' | 'reject'
  paymentReference?: string | null
  note?: string | null
}) {
  try {
    const adminId = await getActiveUserId()
    if (!adminId || !isAdmin(adminId)) {
      return { success: false, error: 'Unauthorized' }
    }

    const parsed = ReviewPayoutSchema.parse(input)
    const now = new Date().toISOString()

    const updateData: Record<string, any> = { reviewed_by: adminId, reviewed_at: now }

    if (parsed.action === 'approve') {
      updateData.status = 'approved'
      updateData.approved_by = adminId
      updateData.approved_at = now
    } else if (parsed.action === 'pay') {
      updateData.status = 'paid'
      updateData.paid_by = adminId
      updateData.paid_at = now
      updateData.payment_reference = parsed.paymentReference ?? null
    } else {
      updateData.status = 'rejected'
      updateData.rejection_reason = parsed.note ?? null
    }

    if (parsed.note) updateData.review_note = parsed.note

    const { error } = await supabase
      .from('payout_requests')
      .update(updateData)
      .eq('id', parsed.payoutId)

    if (error) return { success: false, error: error.message }

    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: `payout.${parsed.action}`,
      entityType: 'PayoutRequest',
      entityId: parsed.payoutId,
      metadata: { payment_reference: parsed.paymentReference, note: parsed.note },
    })

    revalidatePath('/admin/payouts')
    revalidatePath(`/partner/*/payouts`)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message ?? 'unexpected' }
  }
}
