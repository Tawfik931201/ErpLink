'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import crypto from 'crypto'

import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'

const t = (key: keyof typeof translations['ar'], lang: Language) =>
  translations[lang][key] || translations['ar'][key]

function getLangCookie() {
  // Cookies are read from the request context via `next/headers`
  const { cookies } = require('next/headers')
  const c = cookies()
  return (c.get('lang')?.value || 'ar') as Language
}

// ──────────────────────────── Dashboard Stats ────────────────────────────

export interface PartnerDashboardStats {
  clientCount: number
  pendingClientCount: number
  totalCommissions: number
  totalPaid: number
  pendingPayouts: number
  tier: string
  commissionRate: number
}

export async function getPartnerStats(partnerId: string) {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')

    // Verify ownership
    const { data: profile } = await supabase
      .from('partner_profiles')
      .select('id, tier, commission_rate, status')
      .eq('id', partnerId)
      .single()

    if (!profile || profile.status !== 'active') {
      return { success: false as const, error: 'partner_not_found', stats: null }
    }

    // Client counts
    const { count: clientCount } = await supabase
      .from('partner_onboarding_invitations')
      .select('*', { count: 'exact', head: true })
      .eq('partner_id', partnerId)
      .in('status', ['accepted', 'linked'])

    const { count: pendingClientCount } = await supabase
      .from('partner_onboarding_invitations')
      .select('*', { count: 'exact', head: true })
      .eq('partner_id', partnerId)
      .eq('status', 'pending')

    // Commissions
    const { data: commissions } = await supabase
      .from('partner_commissions')
      .select('amount')
      .eq('partner_id', partnerId)

    const totalCommissions =
      commissions?.reduce((sum, c) => sum + Number(c.amount), 0) ?? 0

    // Paid commissions (via payouts)
    const { data: payouts } = await supabase
      .from('payout_requests')
      .select('amount')
      .eq('partner_id', partnerId)
      .eq('status', 'paid')

    const totalPaid = payouts?.reduce((sum, p) => sum + Number(p.amount), 0) ?? 0

    // Pending payout requests
    const { count: pendingPayouts } = await supabase
      .from('payout_requests')
      .select('*', { count: 'exact', head: true })
      .eq('partner_id', partnerId)
      .eq('status', 'pending')

    return {
      success: true as const,
      stats: {
        clientCount: clientCount ?? 0,
        pendingClientCount: pendingClientCount ?? 0,
        totalCommissions,
        totalPaid,
        pendingPayouts: pendingPayouts ?? 0,
        tier: profile.tier,
        commissionRate: profile.commission_rate,
      } satisfies PartnerDashboardStats,
    }
  } catch (err: any) {
    return { success: false as const, error: err.message ?? 'unexpected', stats: null }
  }
}

// ──────────────────────── Create Client Invitation ────────────────────────

const CreateClientSchema = z.object({
  partnerId: z.string().uuid(),
  clientEmail: z.string().email().max(255),
  clientName: z.string().trim().min(1).max(120),
})

export async function createClientInvitation(input: {
  partnerId: string
  clientEmail: string
  clientName: string
}) {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')

    const parsed = CreateClientSchema.parse({
      partnerId: input.partnerId,
      clientEmail: input.clientEmail,
      clientName: input.clientName,
    })

    // Verify partner profile ownership + active
    const { data: profile } = await supabase
      .from('partner_profiles')
      .select('id, tier, status')
      .eq('id', parsed.partnerId)
      .single()

    if (!profile) return { success: false, error: 'partner_not_found' }
    if (profile.status !== 'active') return { success: false, error: 'partner_not_active' }

    // Check tier limit
    const { PARTNER_TIERS } = await import('@/lib/partner-tiers')
    const tierCfg = PARTNER_TIERS[profile.tier as keyof typeof PARTNER_TIERS]
    const maxClients = tierCfg?.maxClients

    if (maxClients !== null) {
      const { count } = await supabase
        .from('partner_onboarding_invitations')
        .select('*', { count: 'exact', head: true })
        .eq('partner_id', parsed.partnerId)
        .in('status', ['accepted', 'linked'])

      if (count != null && count >= maxClients) {
        return { success: false, error: 'tier_client_limit_reached' }
      }
    }

    // Check if client exists in Supabase users table
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', parsed.clientEmail)
      .maybeSingle()

    if (!existingUser) {
      return { 
        success: false, 
        error: 'client_not_found',
        message: 'العميل غير موجود في النظام. يرجى إنشاء حساب أولاً قبل إضافته في مساحة العمل.'
      }
    }

    // Generate a secure token
    const token = crypto.randomBytes(32).toString('hex')
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.zidlink.app'
    const inviteUrl = `${baseUrl}/onboarding/accept?token=${token}`

    const { data: invitation, error } = await supabase
      .from('partner_onboarding_invitations')
      .insert([
        {
          partner_id: parsed.partnerId,
          email: parsed.clientEmail,
          client_name: parsed.clientName,
          status: 'pending',
          token,
        },
      ])
      .select()
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    // Send invitation email to client
    const lang = getLangCookie()
    const { sendEmail } = await import('@/lib/email')
    await sendEmail({
      to: parsed.clientEmail,
      subject: 'You have been invited to ZidLink — Partner Program',
      html: `<p>Hello <strong>${parsed.clientName}</strong>,</p>
<p>You have been invited by a ZidLink partner to join the platform.</p>
<p>Click below to activate your account:</p>
<p><a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#10b981;color:white;border-radius:8px;text-decoration:none;font-weight:bold;">Accept Invitation</a></p>
<p>Or copy and paste this URL: ${inviteUrl}</p>
<p>This link expires once used.</p>`,
      text: `Hello ${parsed.clientName},\n\nYou have been invited by a ZidLink partner.\n\nActivate your account: ${inviteUrl}`,
    })

    revalidatePath(`/partner/${parsed.partnerId}`)
    revalidatePath(`/partner/${parsed.partnerId}/clients`)

    return { success: true, invitation }
  } catch (err: any) {
    return { success: false, error: err.message ?? 'unexpected' }
  }
}

// ────────────────────── Accept Client Invitation ──────────────────────

export async function acceptClientInvitation(token: string) {
  try {
    const { data: invitations, error: lookupErr } = await supabase
      .from('partner_onboarding_invitations')
      .select('*')
      .eq('token', token)

    if (lookupErr) {
      return { success: false, error: lookupErr.message }
    }

    if (!invitations || invitations.length === 0) {
      return { success: false, error: 'invitation_not_found' }
    }

    const invitation = invitations[0]
    if (invitation.status !== 'pending') {
      return { success: false, error: 'invitation_already_used' }
    }

    const { error: updateErr } = await supabase
      .from('partner_onboarding_invitations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', invitation.id)

    if (updateErr) {
      return { success: false, error: updateErr.message }
    }

    const { data: partner } = await supabase
      .from('partner_profiles')
      .select('display_name')
      .eq('id', invitation.partner_id)
      .single()

    return {
      success: true,
      invitation: {
        ...invitation,
        status: 'accepted',
      },
      partnerName: partner?.display_name ?? '',
    }
  } catch (err: any) {
    return { success: false, error: err.message ?? 'unexpected' }
  }
}

// ──────────────────────── List Clients ────────────────────────

export interface ClientRow {
  id: string
  email: string
  client_name: string
  status: string
  workspace_id: string | null
  created_at: string
  accepted_at: string | null
}

export async function getPartnerClients(partnerId: string) {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')

    const { data, error } = await supabase
      .from('partner_onboarding_invitations')
      .select('id, email, client_name, status, workspace_id, created_at, accepted_at')
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false })

    if (error) {
      return { success: false as const, error: error.message, clients: [] }
    }

    return { success: true as const, clients: (data ?? []) as ClientRow[] }
  } catch (err: any) {
    return { success: false as const, error: err.message ?? 'unexpected', clients: [] }
  }
}

// ──────────────────────── Partner Details ────────────────────────

export interface PartnerDetail {
  id: string
  display_name: string
  tier: string
  commission_rate: number
  status: string
  approved_at: string | null
  created_at: string
}

export async function getPartnerDetail(partnerId: string) {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')

    const { data, error } = await supabase
      .from('partner_profiles')
      .select('id, display_name, tier, commission_rate, status, approved_at, created_at')
      .eq('id', partnerId)
      .single()

    if (error || !data) {
      return { success: false as const, error: error?.message ?? 'not_found', profile: null }
    }

    return { success: true as const, profile: data as PartnerDetail }
  } catch (err: any) {
    return { success: false as const, error: err.message ?? 'unexpected', profile: null }
  }
}
