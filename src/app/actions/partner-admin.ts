'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { recordAudit } from '@/lib/audit-logs'
import { getActiveUserId, isAdmin } from '@/lib/auth'
import { sendEmail } from '@/lib/email'
import { payoutStatusEmail } from '@/lib/email-templates'
import { supabase } from '@/lib/supabase'

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
      .select('commission_rate, status')
      .eq('id', parsed.partnerId)
      .single()

    if (!profile) return { success: false, error: 'partner_not_found' }
    if (profile.status !== 'active') {
      return { success: false, error: 'partner_not_active' }
    }

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
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unexpected' }
  }
}

// ──────────────────────── Admin: Commissions history ────────────────────────

export interface CommissionHistoryRow {
  id: string
  partner_id: string | null
  partner_name: string | null
  workspace_name: string | null
  client_email: string | null
  gross_amount: number | string
  commission_rate: number | string
  commission_amount: number | string
  currency: string
  status: string
  source: string
  note: string | null
  created_at: string
  period_start: string | null
  period_end: string | null
  paid_in_payout_id: string | null
  payout_status: string | null
}

/** Admin: recent commissions with partner / client / workspace names. */
export async function getCommissionsHistory(limit = 100) {
  try {
    const adminId = await getActiveUserId()
    if (!adminId || !isAdmin(adminId)) {
      return { success: false as const, error: 'Unauthorized', rows: [] }
    }

    const { data: rows, error } = await supabase
      .from('partner_commissions')
      .select('id, partner_id, workspace_id, client_user_id, gross_amount, commission_rate, commission_amount, currency, status, source, note, created_at, period_start, period_end, paid_in_payout_id')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) return { success: false as const, error: error.message, rows: [] }

    const partnerIds = Array.from(new Set((rows ?? []).map((r) => r.partner_id).filter(Boolean) as string[]))
    const wsIds = Array.from(new Set((rows ?? []).map((r) => r.workspace_id).filter(Boolean) as string[]))
    const clientIds = Array.from(new Set((rows ?? []).map((r) => r.client_user_id).filter(Boolean) as string[]))
    const payoutIds = Array.from(new Set((rows ?? []).map((r) => r.paid_in_payout_id).filter(Boolean) as string[]))

    const [partnersRes, workspacesRes, usersRes, payoutsRes] = await Promise.all([
      partnerIds.length
        ? supabase.from('partner_profiles').select('id, display_name').in('id', partnerIds)
        : { data: [] as { id: string; display_name: string }[] },
      wsIds.length
        ? supabase.from('workspaces').select('id, name').in('id', wsIds)
        : { data: [] as { id: string; name: string }[] },
      clientIds.length
        ? supabase.from('users').select('id, email').in('id', clientIds)
        : { data: [] as { id: string; email: string }[] },
      payoutIds.length
        ? supabase.from('payout_requests').select('id, status').in('id', payoutIds)
        : { data: [] as { id: string; status: string }[] },
    ])

    const partnerMap = new Map((partnersRes.data ?? []).map((p) => [p.id, p.display_name]))
    const wsMap = new Map((workspacesRes.data ?? []).map((w) => [w.id, w.name]))
    const userMap = new Map((usersRes.data ?? []).map((u) => [u.id, u.email]))
    const payoutMap = new Map((payoutsRes.data ?? []).map((p) => [p.id, p.status]))

    const history: CommissionHistoryRow[] = (rows ?? []).map((r) => ({
      id: r.id,
      partner_id: r.partner_id ?? null,
      partner_name: r.partner_id ? (partnerMap.get(r.partner_id) ?? null) : null,
      workspace_name: r.workspace_id ? (wsMap.get(r.workspace_id) ?? null) : null,
      client_email: r.client_user_id ? (userMap.get(r.client_user_id) ?? null) : null,
      gross_amount: r.gross_amount,
      commission_rate: r.commission_rate,
      commission_amount: r.commission_amount,
      currency: r.currency,
      status: r.status,
      source: r.source,
      note: r.note ?? null,
      created_at: r.created_at,
      period_start: r.period_start ?? null,
      period_end: r.period_end ?? null,
      paid_in_payout_id: r.paid_in_payout_id ?? null,
      payout_status: r.paid_in_payout_id ? (payoutMap.get(r.paid_in_payout_id) ?? null) : null,
    }))

    return { success: true as const, rows: history }
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : 'unexpected', rows: [] }
  }
}

// ──────────────────────── Admin: Payouts ────────────────────────

const ReviewPayoutSchema = z.object({
  payoutId: z.string().uuid(),
  action: z.enum(['approve', 'pay', 'reject']),
  paymentReference: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
})

/** Allowed status transitions for payout review actions. */
const PAYOUT_TRANSITIONS: Record<string, string[]> = {
  approve: ['pending', 'under_review'],
  pay: ['pending', 'under_review', 'approved'],
  reject: ['pending', 'under_review', 'approved'],
}

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

    // Load the current payout to enforce the status machine
    const { data: existing, error: readErr } = await supabase
      .from('payout_requests')
      .select('id, status')
      .eq('id', parsed.payoutId)
      .maybeSingle()

    if (readErr || !existing) {
      return { success: false, error: readErr?.message ?? 'payout_not_found' }
    }

    if (!PAYOUT_TRANSITIONS[parsed.action].includes(existing.status)) {
      return {
        success: false,
        error: 'invalid_transition',
        message: `لا يمكن ${parsed.action === 'approve' ? 'اعتماد' : parsed.action === 'pay' ? 'دفع' : 'رفض'} طلب صرف بحالة ${existing.status}`,
      }
    }

    if (parsed.action === 'pay' && !parsed.paymentReference?.trim()) {
      return {
        success: false,
        error: 'payment_reference_required',
        message: 'يجب إدخال مرجع الدفع قبل تعليم الطلب كمدفوع.',
      }
    }

    interface PayoutUpdate {
      reviewed_by: string
      reviewed_at: string
      status?: string
      approved_by?: string
      approved_at?: string
      paid_by?: string
      paid_at?: string
      payment_reference?: string | null
      rejection_reason?: string | null
      review_note?: string | null
    }

    const updateData: PayoutUpdate = { reviewed_by: adminId, reviewed_at: now }

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

    // When paying, mark the linked commissions as paid (ledger back-reference)
    if (parsed.action === 'pay') {
      const { data: payout } = await supabase
        .from('payout_requests')
        .select('commission_ids')
        .eq('id', parsed.payoutId)
        .maybeSingle()

      const ids = (payout?.commission_ids ?? []) as string[]
      if (ids.length > 0) {
        await supabase
          .from('partner_commissions')
          .update({ paid_in_payout_id: parsed.payoutId })
          .in('id', ids)
          .is('paid_in_payout_id', null)
      }
    }

    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: `payout.${parsed.action}`,
      entityType: 'PayoutRequest',
      entityId: parsed.payoutId,
      metadata: { payment_reference: parsed.paymentReference, note: parsed.note },
    })

    // Notify the partner about the review outcome
    await notifyPartnerPayoutStatus(parsed.payoutId, parsed.action, parsed.paymentReference ?? null, parsed.note ?? null)

    revalidatePath('/admin/commissions')
    revalidatePath('/admin/payouts')
    revalidatePath(`/partner/*/payouts`)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unexpected' }
  }
}

/** Send the partner an email when their payout request is approved / paid / rejected. */
async function notifyPartnerPayoutStatus(
  payoutId: string,
  action: 'approve' | 'pay' | 'reject',
  paymentReference: string | null,
  note: string | null,
) {
  try {
    const { data: payout } = await supabase
      .from('payout_requests')
      .select('partner_id, amount, payment_reference')
      .eq('id', payoutId)
      .maybeSingle()
    if (!payout) return

    const { data: profile } = await supabase
      .from('partner_profiles')
      .select('display_name, user_id')
      .eq('id', payout.partner_id)
      .maybeSingle()
    if (!profile) return

    const { data: userRow } = await supabase
      .from('users')
      .select('email, name')
      .eq('id', profile.user_id)
      .maybeSingle()
    if (!userRow?.email) return

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const tpl = payoutStatusEmail(
      {
        partnerName: userRow.name || profile.display_name,
        action: action === 'approve' ? 'approved' : action === 'pay' ? 'paid' : 'rejected',
        amount: Number(payout.amount),
        currency: 'USD',
        paymentReference: paymentReference ?? payout.payment_reference ?? null,
        note,
        payoutsUrl: `${baseUrl}/partner/${payout.partner_id}/payouts`,
      },
      'ar',
    )
    await sendEmail({ to: userRow.email, subject: tpl.subject, html: tpl.html, text: tpl.text })
  } catch (err) {
    console.error('[payout] partner notification email failed:', err)
  }
}
