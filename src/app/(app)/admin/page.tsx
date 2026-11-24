import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getAdminStats } from '@/app/actions/subscription-actions'
import { getActiveUserId, isAdmin } from '@/lib/auth'

import { OdooWebhooksRefresh } from './OdooWebhooksRefresh'
import { PipelineSelfTest } from './PipelineSelfTest'
import { SallaWebhooksRefresh } from './SallaWebhooksRefresh'
import { WebhookOps } from './WebhookOps'
import { ZidWebhooksRefresh } from './ZidWebhooksRefresh'

const fmtMoney = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default async function AdminStatsPage() {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/app/dashboard')

  const cookieStore = await cookies()
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
            ? 'نظرة عامة على الإيرادات والاشتراكات.'
            : 'An overview of revenue and subscriptions.'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
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

      <div className="grid gap-3 md:grid-cols-2">
        <OdooWebhooksRefresh isAr={isAr} />
        <ZidWebhooksRefresh isAr={isAr} />
        <SallaWebhooksRefresh isAr={isAr} />
        <WebhookOps isAr={isAr} />
        <PipelineSelfTest isAr={isAr} />
      </div>
    </div>
  )
}
