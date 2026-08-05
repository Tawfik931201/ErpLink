import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { recordAudit } from '@/lib/audit-logs'
import { getActiveUserId } from '@/lib/auth'
import { calculateRelease } from '@/lib/commission-calculator'
import { supabase } from '@/lib/supabase'

const PayoutSchema = z.object({
  partnerId: z.string().uuid(),
  amount: z.number().positive().max(9999999),
  notes: z.string().trim().max(1000).optional().nullable(),
})

/** Greedily allocate fully-released approved commissions to a payout request. */
async function linkCommissionsToPayout(
  payoutId: string,
  partnerId: string,
  amount: number,
  now: Date,
) {
  try {
    const { data: commRows } = await supabase
      .from('partner_commissions')
      .select('id, commission_amount, period_start, period_end')
      .eq('partner_id', partnerId)
      .eq('status', 'approved')

    const { data: openPayouts } = await supabase
      .from('payout_requests')
      .select('commission_ids')
      .eq('partner_id', partnerId)
      .not('status', 'eq', 'rejected')
      .neq('id', payoutId)

    const committed = new Set<string>()
    for (const p of openPayouts ?? []) {
      for (const id of (p.commission_ids ?? []) as string[]) {
        if (typeof id === 'string') committed.add(id)
      }
    }

    const sorted = (commRows ?? []).sort(
      (a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime(),
    )

    let remaining = Number(amount)
    const ids: string[] = []
    for (const c of sorted) {
      if (remaining <= 0) break
      if (committed.has(c.id)) continue
      const amt = Number(c.commission_amount)
      if (amt <= 0 || amt > remaining) continue
      const { releasedAmount } = calculateRelease(c.commission_amount, c.period_start, c.period_end, now)
      if (releasedAmount < amt) continue
      ids.push(c.id)
      remaining -= amt
    }

    if (ids.length > 0) {
      await supabase.from('payout_requests').update({ commission_ids: ids }).eq('id', payoutId)
    }
  } catch (err) {
    console.error('[payout] linkCommissionsToPayout failed:', err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getActiveUserId()
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const parsed = PayoutSchema.parse(body)

    // Verify partner ownership + active
    const { data: profile } = await supabase
      .from('partner_profiles')
      .select('id, user_id, status')
      .eq('id', parsed.partnerId)
      .single()

    if (!profile) {
      return NextResponse.json({ success: false, error: 'partner_not_found' }, { status: 404 })
    }
    if (profile.user_id !== userId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }
    if (profile.status !== 'active') {
      return NextResponse.json({ success: false, error: 'partner_not_active' }, { status: 400 })
    }

    // Fetch approved commissions
    const { data: commissions, error: commErr } = await supabase
      .from('partner_commissions')
      .select('commission_amount, period_start, period_end')
      .eq('partner_id', parsed.partnerId)
      .eq('status', 'approved')

    if (commErr) {
      return NextResponse.json({ success: false, error: commErr.message }, { status: 500 })
    }

    // Fetch payouts
    const { data: payouts, error: payErr } = await supabase
      .from('payout_requests')
      .select('amount, status')
      .eq('partner_id', parsed.partnerId)

    if (payErr) {
      return NextResponse.json({ success: false, error: payErr.message }, { status: 500 })
    }

    const nowCheck = new Date()
    let totalReleased = 0
    for (const comm of commissions ?? []) {
      const { releasedAmount } = calculateRelease(
        comm.commission_amount,
        comm.period_start,
        comm.period_end,
        nowCheck
      )
      totalReleased += releasedAmount
    }

    const totalPaid = (payouts ?? [])
      .filter((p) => p.status === 'paid')
      .reduce((sum, p) => sum + Number(p.amount), 0)

    const totalPending = (payouts ?? [])
      .filter((p) => ['pending', 'under_review', 'approved'].includes(p.status))
      .reduce((sum, p) => sum + Number(p.amount), 0)

    const eligibleToWithdraw = Math.max(0, Math.round((totalReleased - totalPaid - totalPending) * 100) / 100)

    if (parsed.amount > eligibleToWithdraw) {
      return NextResponse.json({
        success: false,
        error: 'insufficient_funds',
        message: `المبلغ المطلوب يتجاوز الرصيد المتاح للسحب وهو $${eligibleToWithdraw.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      }, { status: 400 })
    }

    // Create payout request
    const now = new Date().toISOString()
    const { data: payout, error } = await supabase
      .from('payout_requests')
      .insert([
        {
          partner_id: parsed.partnerId,
          amount: parsed.amount,
          period_start: now,
          period_end: now,
          requested_by: userId,
          payment_note: parsed.notes ?? null,
          status: 'pending',
        },
      ])
      .select()
      .single()

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // Record which fully-released approved commissions cover this request
    // (informational ledger; the balance check above remains the source of truth).
    await linkCommissionsToPayout(payout.id, parsed.partnerId, parsed.amount, nowCheck)

    await recordAudit({
      actorId: userId,
      actorRole: 'partner',
      action: 'payout.request',
      entityType: 'PayoutRequest',
      entityId: payout.id,
      metadata: { amount: parsed.amount },
    })

    return NextResponse.json({ success: true, payout })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: err.errors[0]?.message || 'validation' }, { status: 400 })
    }
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'unexpected' },
      { status: 500 },
    )
  }
}
