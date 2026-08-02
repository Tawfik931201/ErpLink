import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { DollarSign, TrendingUp } from 'lucide-react'

import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'

export default async function PartnerCommissionsPage({
  params,
}: {
  params: { partnerId: string }
}) {
  const userId = await getActiveUserId()
  if (!userId) redirect('/sign-in')

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  const { data: commissions } = await supabase
    .from('partner_commissions')
    .select('id, client_name, amount, commission_rate, description, created_at, status')
    .eq('partner_id', params.partnerId)
    .order('created_at', { ascending: false })

  const total = commissions?.reduce((s, c) => s + Number(c.amount), 0) ?? 0

  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-foreground">
            {lang === 'ar' ? 'العمولات' : 'Commissions'}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {lang === 'ar'
              ? `إجمالي ${commissions?.length ?? 0} عمولة — $${total.toLocaleString()}`
              : `${commissions?.length ?? 0} commissions — $${total.toLocaleString()}`}
          </p>
        </div>
      </div>

      {(!commissions || commissions.length === 0) ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <TrendingUp className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {lang === 'ar' ? 'لا توجد عمولات مسجلة بعد' : 'No commissions recorded yet'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground bg-secondary/30">
              <tr>
                <th className="px-5 py-3 text-start">
                  {lang === 'ar' ? 'العميل' : 'Client'}
                </th>
                <th className="px-5 py-3 text-start">
                  {lang === 'ar' ? 'المبلغ' : 'Amount'}
                </th>
                <th className="px-5 py-3 text-start">
                  {lang === 'ar' ? 'النسبة' : 'Rate'}
                </th>
                <th className="px-5 py-3 text-start">
                  {lang === 'ar' ? 'الوصف' : 'Description'}
                </th>
                <th className="px-5 py-3 text-start">
                  {lang === 'ar' ? 'التاريخ' : 'Date'}
                </th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((c) => (
                <tr key={c.id} className="border-t border-border/40">
                  <td className="px-5 py-3 font-semibold">{c.client_name || '—'}</td>
                  <td className="px-5 py-3 font-mono font-bold">
                    ${Number(c.amount).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {Math.round(Number(c.commission_rate) * 100)}%
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
                    {c.description || '—'}
                  </td>
                  <td className="px-5 py-3 text-[10px] text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString(
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
