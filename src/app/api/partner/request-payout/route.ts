import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { recordAudit } from '@/lib/audit-logs'

const PayoutSchema = z.object({
  partnerId: z.string().uuid(),
  amount: z.number().positive().max(9999999),
  notes: z.string().trim().max(1000).optional().nullable(),
})

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

    await recordAudit({
      actorId: userId,
      actorRole: 'partner',
      action: 'payout.request',
      entityType: 'PayoutRequest',
      entityId: payout.id,
      metadata: { amount: parsed.amount },
    })

    return NextResponse.json({ success: true, payout })
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: err.errors[0]?.message || 'validation' }, { status: 400 })
    }
    return NextResponse.json({ success: false, error: err.message ?? 'unexpected' }, { status: 500 })
  }
}
