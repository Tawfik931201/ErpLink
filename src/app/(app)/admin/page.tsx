import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getAdminStats } from '@/app/actions/subscription-actions'
import { getActiveUserId, isAdmin } from '@/lib/auth'

const fmtMoney = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default async function AdminStatsPage() {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/dashboard')

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as 'ar' | 'en'
  const isAr = lang === 'ar'

  const { success, stats, error } = await getAdminStats()

  if (!success || !stats) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="border border-border bg-card p-4 text-sm text-red-600">
          {isAr ? 'تعذر تحميل الإحصائيات: ' : 'Failed to load stats: '}
          {error || 'unknown'}
        </div>
      </div>
    )
  }

  const cards: { labelAr: string; labelEn: string; value: string; hintAr?: string; hintEn?: string; color?: string }[] = [
    {
      labelAr: 'الإيراد الشهري المتكرر (MRR)',
      labelEn: 'Monthly Recurring Revenue (MRR)',
      value: fmtMoney(stats.mrr),
      hintAr: 'مجموع (المبلغ ÷ الشهور) للاشتراكات النشطة',
      hintEn: 'Sum of (amount ÷ months) for active subscriptions',
      color: 'text-emerald-600',
    },
    {
      labelAr: 'اشتراكات نشطة',
      labelEn: 'Active subscriptions',
      value: String(stats.activeSubscriptions),
      hintAr: 'غير منتهية',
      hintEn: 'not expired',
    },
    {
      labelAr: 'إيرادات هذا الشهر',
      labelEn: 'Revenue this month',
      value: fmtMoney(stats.monthRevenue),
    },
    {
      labelAr: 'إجمالي الإيرادات',
      labelEn: 'Total revenue',
      value: fmtMoney(stats.totalRevenue),
    },
    {
      labelAr: 'التزام العمولات',
      labelEn: 'Commission liability',
      value: fmtMoney(stats.commissionLiability),
      hintAr: 'عمولات معتمدة لم تُدفع بعد',
      hintEn: 'approved commissions not yet paid',
    },
    {
      labelAr: 'طلبات صرف معلقة',
      labelEn: 'Pending payouts',
      value: fmtMoney(stats.pendingPayouts),
    },
    {
      labelAr: 'تنتهي خلال 30 يوم',
      labelEn: 'Expiring within 30 days',
      value: String(stats.expiringSoon),
      color: 'text-amber-600',
    },
    {
      labelAr: 'اشتراكات منتهية',
      labelEn: 'Expired subscriptions',
      value: String(stats.expiredSubscriptions),
      color: 'text-red-600',
    },
  ]

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-base font-semibold tracking-tight text-foreground">
          {isAr ? 'الإحصائيات المالية' : 'Financial Stats'}
        </h1>
        <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
          {isAr
            ? 'نظرة عامة على الإيرادات والاشتراكات والتزامات العمولات.'
            : 'An overview of revenue, subscriptions and commission liabilities.'}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.labelEn} className="border border-border bg-card p-4 space-y-1.5">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {isAr ? c.labelAr : c.labelEn}
            </p>
            <p className={`text-xl font-bold font-mono tracking-tight ${c.color ?? 'text-foreground'}`}>{c.value}</p>
            {c.hintAr && (
              <p className="text-[10px] text-muted-foreground leading-relaxed">{isAr ? c.hintAr : c.hintEn}</p>
            )}
          </div>
        ))}
      </div>

      <div className="border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/30">
          <span className="text-[11px] font-medium text-foreground">
            {isAr ? 'أعلى الأفلييت عمولات' : 'Top affiliates by commission'}
          </span>
          <span className="text-[11px] text-muted-foreground">{stats.topAffiliates.length}</span>
        </div>
        {stats.topAffiliates.length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-muted-foreground">
            {isAr ? 'لا توجد عمولات معتمدة بعد.' : 'No approved commissions yet.'}
          </div>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="px-3 py-2 text-start font-medium">{isAr ? 'الأفلييت' : 'Affiliate'}</th>
                <th className="px-3 py-2 text-end font-medium">{isAr ? 'إجمالي العمولات' : 'Total commission'}</th>
                <th className="px-3 py-2 text-end font-medium" />
              </tr>
            </thead>
            <tbody>
              {stats.topAffiliates.map((a) => (
                <tr key={a.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-foreground">{a.display_name}</span>
                  </td>
                  <td className="px-3 py-2.5 font-mono font-semibold text-foreground text-end">
                    {fmtMoney(a.total_commission)}
                  </td>
                  <td className="px-3 py-2.5 text-end">
                    <Link
                      href={`/admin/partners/${a.id}`}
                      className="inline-flex items-center rounded border border-border bg-background px-2 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                    >
                      {isAr ? 'التفاصيل' : 'Details'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
