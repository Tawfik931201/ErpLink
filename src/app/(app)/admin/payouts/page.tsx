import { cookies } from 'next/headers'
import { CreditCard, DollarSign } from 'lucide-react'

import { getActiveUserId, isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'
import PayoutsReviewClient from './PayoutsReviewClient'

export default async function AdminPayoutsPage() {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) return <div>Unauthorized</div>

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language

  const { data: payouts } = await supabase
    .from('payout_requests')
    .select('*')
    .order('requested_at', { ascending: false })

  return (
    <div className="p-6 md:p-10" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-black text-foreground">
            {lang === 'ar' ? 'طلبات الصرف' : 'Payout Requests'}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {lang === 'ar'
              ? `مراجعة واعتماد طلبات صرف الشركاء`
              : `Review and approve partner payout requests`}
          </p>
        </div>

        <PayoutsReviewClient payouts={payouts ?? []} lang={lang} />
      </div>
    </div>
  )
}
