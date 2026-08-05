'use server'

import { getActiveUserId } from '@/lib/auth'
import { calculateRelease } from '@/lib/commission-calculator'
import { daysUntilExpiry, isSubscriptionExpired } from '@/lib/subscription-utils'
import { supabase } from '@/lib/supabase'

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
      .select('id, user_id, tier, commission_rate, status')
      .eq('id', partnerId)
      .single()

    if (!profile || profile.user_id !== userId) {
      return { success: false as const, error: 'partner_not_found', stats: null }
    }
    if (profile.status !== 'active') {
      return { success: false as const, error: 'partner_not_found', stats: null }
    }

    // Client workspaces registered by this affiliate
    const { data: workspaces } = await supabase
      .from('workspaces')
      .select('id')
      .eq('partner_id', partnerId)

    // Workspaces attributed via subscriptions (manual/admin linking)
    const { data: subWorkspaces } = await supabase
      .from('subscriptions')
      .select('workspace_id')
      .eq('affiliate_id', partnerId)

    const wsIds = Array.from(
      new Set([
        ...(workspaces ?? []).map((w) => w.id),
        ...(subWorkspaces ?? []).map((s) => s.workspace_id),
      ]),
    )
    let activeSubWorkspaceIds = new Set<string>()

    if (wsIds.length > 0) {
      const { data: subRows } = await supabase
        .from('subscriptions')
        .select('workspace_id, end_date')
        .in('workspace_id', wsIds)
        .eq('status', 'active')

      activeSubWorkspaceIds = new Set(
        (subRows ?? []).filter((s) => !isSubscriptionExpired(s)).map((s) => s.workspace_id),
      )
    }

    // Commissions (approved only — voided commissions are excluded)
    const { data: commissions } = await supabase
      .from('partner_commissions')
      .select('commission_amount')
      .eq('partner_id', partnerId)
      .eq('status', 'approved')

    const totalCommissions =
      commissions?.reduce((sum, c) => sum + Number(c.commission_amount), 0) ?? 0

    // Payouts (all statuses — derive paid + under-review amounts below)
    const { data: payouts } = await supabase
      .from('payout_requests')
      .select('amount, status')
      .eq('partner_id', partnerId)

    // Paid out (status = paid)
    const totalPaid =
      payouts?.filter((p) => p.status === 'paid').reduce((sum, p) => sum + Number(p.amount), 0) ?? 0

    // Amount of payout requests still under review (pending / under_review / approved)
    const pendingPayouts =
      payouts
        ?.filter((p) => ['pending', 'under_review', 'approved'].includes(p.status))
        .reduce((sum, p) => sum + Number(p.amount), 0) ?? 0

    return {
      success: true as const,
      stats: {
        clientCount: wsIds.length,
        pendingClientCount: wsIds.filter((id) => !activeSubWorkspaceIds.has(id)).length,
        totalCommissions,
        totalPaid,
        pendingPayouts: pendingPayouts ?? 0,
        tier: profile.tier,
        commissionRate: profile.commission_rate,
      } satisfies PartnerDashboardStats,
    }
    } catch (err) {
      return { success: false as const, error: err instanceof Error ? err.message : 'unexpected', stats: null }
  }
}

// ──────────────────────── List Clients (workspaces) ────────────────────────

export interface ClientRow {
  id: string
  workspace_id: string
  workspace_name: string
  email: string | null
  client_name: string | null
  created_at: string
  commission_total: number
  commission_released: number
  subscription: {
    start_date: string
    end_date: string
    months_paid: number
    amount_paid: number | string
    status: string
    isExpired: boolean
    daysRemaining: number
  } | null
}

/** List client workspaces registered by this affiliate, with subscription state. */
export async function getPartnerClients(partnerId: string) {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')

    // Verify ownership
    const { data: profile } = await supabase
      .from('partner_profiles')
      .select('id, user_id')
      .eq('id', partnerId)
      .single()

    if (!profile || profile.user_id !== userId) {
      return { success: false as const, error: 'partner_not_found', clients: [] }
    }

    const { data: workspaces, error } = await supabase
      .from('workspaces')
      .select('id, name, user_id, created_at, partner_linked_at')
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false })

    if (error) {
      return { success: false as const, error: error.message, clients: [] }
    }

    const userIds = [...new Set((workspaces ?? []).map((w) => w.user_id))]
    const { data: users } = await supabase
      .from('users')
      .select('id, email, name')
      .in('id', userIds.length ? userIds : ['__none__'])

    const userMap = new Map((users ?? []).map((u) => [u.id, u]))

    const wsIds = (workspaces ?? []).map((w) => w.id)

    // Approved commissions for these client workspaces
    const { data: commissionRows } = await supabase
      .from('partner_commissions')
      .select('workspace_id, commission_amount, period_start, period_end')
      .in('workspace_id', wsIds.length ? wsIds : ['__none__'])
      .eq('status', 'approved')

    const now = new Date()
    const commissionsByWs = new Map<string, { total: number; released: number }>()
    for (const cm of commissionRows ?? []) {
      const cur = commissionsByWs.get(cm.workspace_id) ?? { total: 0, released: 0 }
      const amount = Number(cm.commission_amount)
      const { releasedAmount } = calculateRelease(cm.commission_amount, cm.period_start, cm.period_end, now)
      cur.total += amount
      cur.released += releasedAmount
      commissionsByWs.set(cm.workspace_id, cur)
    }

    const clients: ClientRow[] = await Promise.all(
      (workspaces ?? []).map(async (ws) => {
        const { data: subs } = await supabase
          .from('subscriptions')
          .select('start_date, end_date, months_paid, amount_paid, status')
          .eq('workspace_id', ws.id)
          .eq('status', 'active')
          .order('end_date', { ascending: false })
          .limit(1)

        const sub = subs?.[0] ?? null
        const user = userMap.get(ws.user_id)
        const comm = commissionsByWs.get(ws.id) ?? { total: 0, released: 0 }

        return {
          id: ws.id,
          workspace_id: ws.id,
          workspace_name: ws.name,
          email: user?.email ?? null,
          client_name: user?.name ?? null,
          created_at: ws.partner_linked_at ?? ws.created_at,
          commission_total: comm.total,
          commission_released: comm.released,
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
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : 'unexpected', profile: null }
  }
}

export async function getMyEligibleBalance(partnerId: string) {
  try {
    const userId = await getActiveUserId()
    if (!userId) return { success: false as const, error: 'Unauthorized', eligibleBalance: 0 }

    // Verify partner profile ownership
    const { data: profile } = await supabase
      .from('partner_profiles')
      .select('id, user_id, status')
      .eq('id', partnerId)
      .single()

    if (!profile || profile.user_id !== userId || profile.status !== 'active') {
      return { success: false as const, error: 'Forbidden', eligibleBalance: 0 }
    }

    // Fetch approved commissions
    const { data: commissions } = await supabase
      .from('partner_commissions')
      .select('commission_amount, period_start, period_end')
      .eq('partner_id', partnerId)
      .eq('status', 'approved')

    // Fetch payouts
    const { data: payouts } = await supabase
      .from('payout_requests')
      .select('amount, status')
      .eq('partner_id', partnerId)

    const now = new Date()
    let totalReleased = 0
    for (const comm of commissions ?? []) {
      const { releasedAmount } = calculateRelease(
        comm.commission_amount,
        comm.period_start,
        comm.period_end,
        now
      )
      totalReleased += releasedAmount
    }

    const totalPaid = (payouts ?? [])
      .filter((p) => p.status === 'paid')
      .reduce((sum, p) => sum + Number(p.amount), 0)

    const totalPending = (payouts ?? [])
      .filter((p) => ['pending', 'under_review', 'approved'].includes(p.status))
      .reduce((sum, p) => sum + Number(p.amount), 0)

    const eligibleBalance = Math.max(0, Math.round((totalReleased - totalPaid - totalPending) * 100) / 100)

    return { success: true as const, eligibleBalance }
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : 'unexpected', eligibleBalance: 0 }
  }
}
