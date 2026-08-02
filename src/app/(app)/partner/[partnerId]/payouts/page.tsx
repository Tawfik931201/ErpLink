import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { DollarSign, CreditCard, Plus } from 'lucide-react'

import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'
import { Button } from '@/components/ui/button'

export default async function PartnerPayoutsPage({
  params,
}: {
  params: { partnerId: string }
}) {
  const userId = await getActiveUserId()
  if (!userId) redirect('/sign-in')

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  const { data: payouts } = await supabase
    .from('payout_requests')
    .select('id, amount, status, payment_reference, notes, created_at, reviewed_at')
    .eq('partner_id', params.partnerId)
    .order('created_at', { ascending: false })

  const totalPending =
    payouts?.filter((p) => p.status === 'pending').reduce((s, p) => s + Number(p.amount), 0) ?? 0
  const totalPaid =
    payouts?.filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0) ?? 0

  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-foreground">
            {lang === 'ar' ? 'طلبات الصرف' : 'Payout Requests'}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {lang === 'ar'
              ? `قيد المراجعة: $${totalPending.toLocaleString()} | تم الصرف: $${totalPaid.toLocaleString()}`
              : `Pending: $${totalPending.toLocaleString()} | Paid: $${totalPaid.toLocaleString()}`}
          </p>
        </div>
        <a
          href={`/partner/${params.partnerId}/payouts/new`}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          {lang === 'ar' ? 'طلب صرف' : 'Request Payout'}
        </a>
      </div>

      {(!payouts || payouts.length === 0) ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <CreditCard className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {lang === 'ar' ? 'لا توجد طلبات صرف بعد' : 'No payout requests yet'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground bg-secondary/30">
              <tr>
                <th className="px-5 py-3 text-start">
                  {lang === 'ar' ? 'المبلغ' : 'Amount'}
                </th>
                <th className="px-5 py-3 text-start">
                  {lang === 'ar' ? 'الحالة' : 'Status'}
                </th>
                <th className="px-5 py-3 text-start">
                  {lang === 'ar' ? 'مرجع الصرف' : 'Reference'}
                </th>
                <th className="px-5 py-3 text-start">
                  {lang === 'ar' ? 'ملاحظات' : 'Notes'}
                </th>
                <th className="px-5 py-3 text-start">
                  {lang === 'ar' ? 'التاريخ' : 'Date'}
                </th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id} className="border-t border-border/40">
                  <td className="px-5 py-3 font-mono font-bold">
                    ${Number(p.amount).toLocaleString()}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        p.status === 'paid'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          : p.status === 'pending'
                          ? 'bg-amber-50 border-amber-200 text-amber-700'
                          : p.status === 'rejected'
                          ? 'bg-red-50 border-red-200 text-red-700'
                          : 'bg-muted border-border text-muted-foreground'
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground font-mono">
                    {p.payment_reference || '—'}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
                    {p.notes || '—'}
                  </td>
                  <td className="px-5 py-3 text-[10px] text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString(
                      lang === 'ar' ? 'ar-SA' : 'en-US',
                      { year: 'numeric', month: 'short', day: 'numeric' },
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
