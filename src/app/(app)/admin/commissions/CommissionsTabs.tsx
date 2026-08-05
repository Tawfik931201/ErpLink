'use client'

import { useState } from 'react'

import type { CommissionHistoryRow } from '@/app/actions/partner-admin'
import { cn } from '@/lib/utils'

import CommissionsHistoryClient from './CommissionsHistoryClient'
import PayoutsReviewClient from './PayoutsReviewClient'

interface PayoutRow {
  id: string
  partner_id: string
  amount: number
  status: string
  payment_reference: string | null
  review_note: string | null
  requested_at: string
  requested_by: string
}

interface Props {
  payouts: PayoutRow[]
  commissions: CommissionHistoryRow[]
  commissionsError: string | null
  lang: string
}

export default function CommissionsTabs({ payouts, commissions, commissionsError, lang }: Props) {
  const isAr = lang === 'ar'
  const [tab, setTab] = useState<'payouts' | 'history'>('payouts')

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 bg-muted/40 rounded border border-border/50 w-fit">
        <button
          onClick={() => setTab('payouts')}
          className={cn(
            'px-3 py-1.5 rounded text-[11px] font-medium transition-colors',
            tab === 'payouts' ? 'bg-card text-foreground border border-border' : 'text-muted-foreground',
          )}
        >
          {isAr ? 'طلبات الصرف' : 'Payouts'} ({payouts.length})
        </button>
        <button
          onClick={() => setTab('history')}
          className={cn(
            'px-3 py-1.5 rounded text-[11px] font-medium transition-colors',
            tab === 'history' ? 'bg-card text-foreground border border-border' : 'text-muted-foreground',
          )}
        >
          {isAr ? 'سجل العمولات' : 'Commissions'} ({commissions.length})
        </button>
      </div>

      {tab === 'payouts' ? (
        <PayoutsReviewClient payouts={payouts} lang={lang} />
      ) : (
        <CommissionsHistoryClient rows={commissions} error={commissionsError} lang={lang} />
      )}
    </div>
  )
}
