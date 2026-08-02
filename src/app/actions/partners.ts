'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getActiveUserId, isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'
import { recordAudit } from '@/lib/audit-logs'
import { sendEmail } from '@/lib/email'
import {
  PartnerTier,
  PARTNER_TIERS,
  DEFAULT_PARTNER_TIER,
  isPartnerTier,
} from '@/lib/partner-tiers'
import {
  partnerApprovedEmail,
  partnerRejectedEmail,
} from '@/lib/email-templates'

const PartnerStatus = ['pending', 'active', 'suspended', 'rejected'] as const
const UserAppRole = ['user', 'partner', 'admin'] as const

async function getOrCreateDbUser() {
  const userId = await getActiveUserId()
  if (!userId) throw new Error('Unauthorized')
  return ensureDbUser(userId)
}

/**
 * Apply to become a partner. Currently signed-in user becomes a `pending`
 * partner. Admin reviews and either approves (assigns final tier) or rejects.
 *
 * Idempotent: calling twice with no admin action yet returns the existing profile.
 */
const RequestSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  notes: z.string().trim().max(1500).optional().nullable(),
})

export async function requestPartnership(input: { displayName: string; notes?: string | null }) {
  try {
    const parsed = RequestSchema.parse({
      displayName: input.displayName,
      notes: input.notes ?? null,
    })

    const dbUser = await getOrCreateDbUser()

    // 1. Look for an existing profile.
    const { data: existing } = await supabase
      .from('partner_profiles')
      .select('*')
      .eq('user_id', dbUser.id)
      .maybeSingle()

    if (existing) {
      return {
        success: true,
        alreadyApplied: true,
        profile: {
          id: existing.id,
          status: existing.status,
          tier: existing.tier,
          display_name: existing.display_name,
        },
      }
    }

    const tier = DEFAULT_PARTNER_TIER
    const rate = PARTNER_TIERS[tier].commissionRate

    // 2. Insert partner profile in `pending` state.
    const { data: profile, error: insertErr } = await supabase
      .from('partner_profiles')
      .insert([
        {
          user_id: dbUser.id,
          display_name: parsed.displayName,
          status: 'pending',
          tier,
          commission_rate: rate,
          notes: parsed.notes ?? null,
        },
      ])
      .select()
      .single()

    if (insertErr) {
      console.error(
        '[partners] failed to insert profile:',
        insertErr.message,
        insertErr.code,
        insertErr.details,
        insertErr.hint,
      )
      return {
        success: false,
        error: `failed_to_create_profile: ${insertErr.message}`,
        code: insertErr.code,
        hint: insertErr.hint,
      }
    }

    // 3. Update users.app_role to 'partner' so the dashboard surfaces
    //    the partner CTA / sidebar. Keeps existing role state otherwise.
    await supabase
      .from('users')
      .update({ app_role: 'partner' })
      .eq('id', dbUser.id)

    // 4. Audit
    await recordAudit({
      actorId: dbUser.id,
      actorRole: 'partner',
      action: 'partner.request',
      entityType: 'PartnerProfile',
      entityId: profile.id,
      metadata: { display_name: parsed.displayName },
    })

    revalidatePath('/dashboard')
    revalidatePath('/onboarding/partner')

    return {
      success: true,
      alreadyApplied: false,
      profile: {
        id: profile.id,
        status: profile.status,
        tier: profile.tier,
        display_name: profile.display_name,
      },
    }
  } catch (err: any) {
    console.error('[partners] requestPartnership error:', err)
    return { success: false, error: err?.message ?? 'unexpected_error' }
  }
}

/**
 * Get the partner profile of the currently signed-in user (if any).
 */
export async function getMyPartnerProfile() {
  try {
    const dbUser = await getOrCreateDbUser()
    const { data, error } = await supabase
      .from('partner_profiles')
      .select('id, user_id, display_name, status, tier, commission_rate, approved_at, rejection_reason, suspended_at')
      .eq('user_id', dbUser.id)
      .maybeSingle()

    if (error) {
      console.warn('[partners] getMyPartnerProfile warn:', error.message)
      return { success: false, error: error.message, profile: null }
    }

    return { success: true, profile: data ?? null }
  } catch (err: any) {
    if (err?.message === 'Unauthorized') return { success: true, profile: null }
    console.error('[partners] getMyPartnerProfile error:', err)
    return { success: false, error: err.message ?? 'unexpected', profile: null }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin actions
// ─────────────────────────────────────────────────────────────────────────────

async function requireAdmin() {
  const adminId = await getActiveUserId()
  if (!adminId || !isAdmin(adminId)) {
    throw new Error('Unauthorized: admin only')
  }
  return adminId
}

const ApproveSchema = z.object({
  partnerId: z.string().uuid(),
  tier: z.enum(['starter', 'growth', 'gold']),
  notes: z.string().trim().max(1000).optional().nullable(),
})

/**
 * Approve a pending partner. Sets status='active', assigns tier + commission
 * rate, sends approval email. Admin only.
 */
export async function approvePartner(input: { partnerId: string; tier: string; notes?: string | null }) {
  try {
    const adminId = await requireAdmin()
    const parsed = ApproveSchema.parse({
      partnerId: input.partnerId,
      tier: input.tier,
      notes: input.notes ?? null,
    })

    const rate = PARTNER_TIERS[parsed.tier].commissionRate

    const { data: profile, error } = await supabase
      .from('partner_profiles')
      .update({
        status: 'active',
        tier: parsed.tier,
        commission_rate: rate,
        approved_by: adminId,
        approved_at: new Date().toISOString(),
        notes: parsed.notes ?? null,
        rejection_reason: null,
        suspended_at: null,
        suspended_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.partnerId)
      .select('id, user_id, display_name, status, tier, commission_rate')
      .single()

    if (error) {
      console.error('[partners] approve update failed:', error.message)
      return { success: false, error: error.message }
    }

    // Also ensure app_role='partner' (defensive — keep DB consistent)
    await supabase
      .from('users')
      .update({ app_role: 'partner' })
      .eq('id', profile.user_id)

    // Tier history
    await supabase.from('partner_tier_history').insert([
      {
        partner_id: profile.id,
        old_tier: null,
        new_tier: parsed.tier,
        old_rate: null,
        new_rate: rate,
        changed_by: adminId,
        reason: 'initial_approval',
      },
    ])

    // Audit log
    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: 'partner.approve',
      entityType: 'PartnerProfile',
      entityId: profile.id,
      metadata: { tier: parsed.tier, rate, targetUserId: profile.user_id },
    })

    // Send approval email (look up email)
    const { data: userRow } = await supabase
      .from('users')
      .select('email, name')
      .eq('id', profile.user_id)
      .maybeSingle()

    if (userRow?.email) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.zidlink.app'
      const tpl = partnerApprovedEmail(
        {
          partnerName: userRow.name || profile.display_name,
          displayName: profile.display_name,
          tier: parsed.tier,
          commissionRate: rate,
          dashboardUrl: `${baseUrl}/partner/${profile.id}`,
        },
        'ar',
      )
      await sendEmail({ to: userRow.email, subject: tpl.subject, html: tpl.html, text: tpl.text })
    }

    revalidatePath('/admin/partners')
    revalidatePath(`/admin/partners/${profile.id}`)
    revalidatePath('/dashboard')
    return { success: true, profile }
  } catch (err: any) {
    console.error('[partners] approvePartner error:', err)
    return { success: false, error: err?.message ?? 'unexpected_error' }
  }
}

const RejectSchema = z.object({
  partnerId: z.string().uuid(),
  reason: z.string().trim().min(2).max(1000),
})

/**
 * Reject a partner application. Admin only.
 */
export async function rejectPartner(input: { partnerId: string; reason: string }) {
  try {
    const adminId = await requireAdmin()
    const parsed = RejectSchema.parse(input)

    const { data: profile, error } = await supabase
      .from('partner_profiles')
      .update({
        status: 'rejected',
        rejection_reason: parsed.reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.partnerId)
      .select('id, user_id, display_name')
      .single()

    if (error) {
      console.error('[partners] reject update failed:', error.message)
      return { success: false, error: error.message }
    }

    // Drop app_role back to 'user'
    await supabase
      .from('users')
      .update({ app_role: 'user' })
      .eq('id', profile.user_id)

    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: 'partner.reject',
      entityType: 'PartnerProfile',
      entityId: profile.id,
      metadata: { reason: parsed.reason, targetUserId: profile.user_id },
    })

    const { data: userRow } = await supabase
      .from('users')
      .select('email, name')
      .eq('id', profile.user_id)
      .maybeSingle()

    if (userRow?.email) {
      const tpl = partnerRejectedEmail(
        { partnerName: userRow.name || profile.display_name, reason: parsed.reason },
        'ar',
      )
      await sendEmail({ to: userRow.email, subject: tpl.subject, html: tpl.html, text: tpl.text })
    }

    revalidatePath('/admin/partners')
    return { success: true, profile }
  } catch (err: any) {
    console.error('[partners] rejectPartner error:', err)
    return { success: false, error: err?.message ?? 'unexpected_error' }
  }
}

const SuspendSchema = z.object({
  partnerId: z.string().uuid(),
  reason: z.string().trim().min(2).max(1000),
})

/**
 * Suspend an active partner. Admin only.
 */
export async function suspendPartner(input: { partnerId: string; reason: string }) {
  try {
    const adminId = await requireAdmin()
    const parsed = SuspendSchema.parse(input)

    const { data: profile, error } = await supabase
      .from('partner_profiles')
      .update({
        status: 'suspended',
        suspended_at: new Date().toISOString(),
        suspended_by: adminId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.partnerId)
      .select('id, user_id, display_name')
      .single()

    if (error || !profile) {
      return { success: false, error: error?.message ?? 'not_found' }
    }

    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: 'partner.suspend',
      entityType: 'PartnerProfile',
      entityId: profile.id,
      metadata: { reason: parsed.reason, targetUserId: profile.user_id },
    })

    revalidatePath('/admin/partners')
    return { success: true, profile }
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'unexpected_error' }
  }
}

const ReactivateSchema = z.object({
  partnerId: z.string().uuid(),
})

/** Reactivate a previously suspended partner. Admin only. */
export async function reactivatePartner(input: { partnerId: string }) {
  try {
    const adminId = await requireAdmin()
    const parsed = ReactivateSchema.parse(input)

    const { data: profile, error } = await supabase
      .from('partner_profiles')
      .update({
        status: 'active',
        suspended_at: null,
        suspended_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.partnerId)
      .select('id, user_id, display_name')
      .single()

    if (error || !profile) {
      return { success: false, error: error?.message ?? 'not_found' }
    }

    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: 'partner.reactivate',
      entityType: 'PartnerProfile',
      entityId: profile.id,
      metadata: { targetUserId: profile.user_id },
    })

    revalidatePath('/admin/partners')
    return { success: true, profile }
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'unexpected_error' }
  }
}

const SetTierSchema = z.object({
  partnerId: z.string().uuid(),
  tier: z.enum(['starter', 'growth', 'gold']),
  reason: z.string().trim().max(1000).optional().nullable(),
})

/**
 * Change a partner's tier (and therefore commission rate). Records the change
 * in `partner_tier_history`. Existing commission rows are NOT affected
 * because each row snapshots its rate. New commissions use the new rate.
 * Admin only.
 */
export async function setPartnerTier(input: {
  partnerId: string
  tier: string
  reason?: string | null
}) {
  try {
    const adminId = await requireAdmin()
    const parsed = SetTierSchema.parse({
      partnerId: input.partnerId,
      tier: input.tier,
      reason: input.reason ?? null,
    })

    const newRate = PARTNER_TIERS[parsed.tier].commissionRate

    const { data: existing, error: readErr } = await supabase
      .from('partner_profiles')
      .select('id, tier, commission_rate')
      .eq('id', parsed.partnerId)
      .single()

    if (readErr || !existing) {
      return { success: false, error: readErr?.message ?? 'not_found' }
    }

    const { error: writeErr } = await supabase
      .from('partner_profiles')
      .update({
        tier: parsed.tier,
        commission_rate: newRate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.partnerId)

    if (writeErr) {
      return { success: false, error: writeErr.message }
    }

    await supabase.from('partner_tier_history').insert([
      {
        partner_id: parsed.partnerId,
        old_tier: existing.tier,
        new_tier: parsed.tier,
        old_rate: existing.commission_rate,
        new_rate: newRate,
        changed_by: adminId,
        reason: parsed.reason ?? null,
      },
    ])

    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: 'partner.set_tier',
      entityType: 'PartnerProfile',
      entityId: parsed.partnerId,
      metadata: { from: existing.tier, to: parsed.tier, reason: parsed.reason },
    })

    revalidatePath('/admin/partners')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'unexpected_error' }
  }
}
