import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getCommissionsHistory } from '@/app/actions/partner-admin'
import { getActiveUserId, isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import type { Language } from '@/lib/translations'

import CommissionsTabs from './CommissionsTabs'

export const metadata = { title: 'Commissions — Admin' }

export default async function AdminCommissionsPage() {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/dashboard')

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language

  const { data: payouts } = await supabase
    .from('payout_requests')
    .select('*')
    .order('requested_at', { ascending: false })

  const historyRes = await getCommissionsHistory(200)

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="max-w-6xl mx-auto space-y-4">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            {lang === 'ar' ? 'العمولات' : 'Commissions'}
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
            {lang === 'ar'
              ? 'مراجعة طلبات صرف العمولات وسجل العمولات المولدة تلقائياً من الاشتراكات.'
              : 'Review payout requests and the commission history generated from subscriptions.'}
          </p>
        </div>

        <CommissionsTabs
          payouts={payouts ?? []}
          commissions={historyRes.success ? historyRes.rows : []}
          commissionsError={historyRes.success ? null : historyRes.error}
          lang={lang}
        />
      </div>
    </div>
  )
}
