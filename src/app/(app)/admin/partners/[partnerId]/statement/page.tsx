import {
  ArrowLeft,
  Clock,
  CreditCard,
  DollarSign,
  FileText,
  Handshake,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getActiveUserId, isAdmin } from '@/lib/auth'
import { calculateRelease } from '@/lib/commission-calculator'
import { tierLabel } from '@/lib/partner-tiers'
import { supabase } from '@/lib/supabase'
import type { Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Statement — Admin' }

export default async function AdminPartnerStatementPage({
  params,
}: {
  params: { partnerId: string }
}) {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/dashboard')

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  // 1. Fetch Partner Profile
  const { data: profile } = await supabase
    .from('partner_profiles')
    .select('*')
    .eq('id', params.partnerId)
    .single()

  if (!profile) {
    return (
      <div className="p-6 text-center text-muted-foreground" dir={dir}>
        {lang === 'ar' ? 'الأفلييت غير موجود' : 'Affiliate not found'}
      </div>
    )
  }

  // 2. Fetch Commissions
  const { data: commissions } = await supabase
    .from('partner_commissions')
    .select('*')
    .eq('partner_id', params.partnerId)
    .order('created_at', { ascending: false })

  // Fetch unique workspaces for these commissions
  const wsIds = Array.from(new Set((commissions ?? []).map((c) => c.workspace_id).filter(Boolean)))
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name, subscription_number')
    .in('id', wsIds.length ? wsIds : ['__none__'])

  const wsMap = new Map((workspaces ?? []).map((w) => [w.id, w]))

  // 3. Fetch Payouts
  const { data: payouts } = await supabase
    .from('payout_requests')
    .select('*')
    .eq('partner_id', params.partnerId)
    .order('requested_at', { ascending: false })

  // Financial calculations
  const now = new Date()
  let totalEarnings = 0
  let totalReleased = 0
  let totalFuture = 0

  const commissionsWithRelease = (commissions ?? []).map((c) => {
    const { totalMonths, elapsedMonths, releasedAmount, futureAmount } = calculateRelease(
      c.commission_amount,
      c.period_start,
      c.period_end,
      now
    )

    if (c.status === 'approved') {
      totalEarnings += Number(c.commission_amount)
      totalReleased += releasedAmount
      totalFuture += futureAmount
    }

    const ws = wsMap.get(c.workspace_id)

    return {
      ...c,
      workspaceName: ws?.name ?? '—',
      subscriptionNumber: ws?.subscription_number ?? '—',
      releaseStats: {
        totalMonths,
        elapsedMonths,
        releasedAmount,
        futureAmount,
      },
    }
  })

  const totalPaid = (payouts ?? [])
    .filter((p) => p.status === 'paid')
    .reduce((sum, p) => sum + Number(p.amount), 0)

  const totalPending = (payouts ?? [])
    .filter((p) => ['pending', 'under_review', 'approved'].includes(p.status))
    .reduce((sum, p) => sum + Number(p.amount), 0)

  const eligibleToWithdraw = Math.max(0, Math.round((totalReleased - totalPaid - totalPending) * 100) / 100)

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return dateStr
    }
  }

  const fmtMoney = (n: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const payoutStatusBadge = (status: string) => {
    const m: Record<string, string> = {
      pending: 'bg-amber-50 border-amber-200 text-amber-700',
      under_review: 'bg-blue-50 border-blue-200 text-blue-700',
      approved: 'bg-indigo-50 border-indigo-200 text-indigo-700',
      paid: 'bg-emerald-50 border-emerald-200 text-emerald-700',
      rejected: 'bg-red-50 border-red-200 text-red-700',
    }
    return cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border',
      m[status] || 'bg-muted border-border text-muted-foreground',
    )
  }

  const kpis = [
    {
      label: lang === 'ar' ? 'إجمالي الأرباح' : 'Total Profit',
      value: fmtMoney(totalEarnings),
      hint: lang === 'ar' ? 'العمولات الكلية المعتمدة' : 'Total approved commissions',
      color: 'text-emerald-600',
    },
    {
      label: lang === 'ar' ? 'المستحق حتى الآن' : 'Released to Date',
      value: fmtMoney(totalReleased),
      hint: lang === 'ar' ? 'المستحق عن الشهور المنقضية' : 'Earned up to current month',
      color: 'text-foreground',
    },
    {
      label: lang === 'ar' ? 'المتاح للسحب حالياً' : 'Available to Payout',
      value: fmtMoney(eligibleToWithdraw),
      hint: lang === 'ar' ? 'المستحق ناقص المسحوبات' : 'Released minus payout requests',
      color: 'text-primary',
    },
    {
      label: lang === 'ar' ? 'المعلق للصرف' : 'Pending Payouts',
      value: fmtMoney(totalPending),
      hint: lang === 'ar' ? 'طلبات سحب قيد الانتظار' : 'Payout requests in review',
      color: 'text-amber-600',
    },
    {
      label: lang === 'ar' ? 'المسحوبات المستلمة' : 'Paid Payouts',
      value: fmtMoney(totalPaid),
      hint: lang === 'ar' ? 'إجمالي المبالغ المحولة فعلياً' : 'Total payouts transferred',
      color: 'text-blue-600',
    },
    {
      label: lang === 'ar' ? 'الأرباح المستقبلية' : 'Future Earnings',
      value: fmtMoney(totalFuture),
      hint: lang === 'ar' ? 'مستحقات الشهور القادمة' : 'Releasing in future months',
      color: 'text-purple-600',
    },
  ]

  return (
    <div className="max-w-6xl mx-auto space-y-4" dir={dir}>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[11px]">
        <Link
          href="/admin/partners"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground font-medium transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {lang === 'ar' ? 'الأفلييت' : 'Affiliates'}
        </Link>
        <span className="text-muted-foreground/30">/</span>
        <Link
          href={`/admin/partners/${profile.id}`}
          className="text-muted-foreground hover:text-foreground font-medium transition-colors"
        >
          {profile.display_name}
        </Link>
        <span className="text-muted-foreground/30">/</span>
        <span className="text-foreground font-medium">{lang === 'ar' ? 'كشف الحساب' : 'Statement'}</span>
      </div>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-foreground">
              {lang === 'ar' ? 'كشف حساب الأفلييت' : 'Affiliate Account Statement'}
            </h1>
            <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
              {lang === 'ar'
                ? `العمولات المستحقة، المستقبلية، وطلبات السحب لـ ${profile.display_name}`
                : `Commissions, payouts, and monthly releases statement for ${profile.display_name}`}
            </p>
          </div>
          <div className="flex items-center gap-2.5 border border-border bg-card px-3 py-2 shrink-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Handshake className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-foreground leading-none">{profile.display_name}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">
                {tierLabel(profile.tier, lang)} · {Math.round(Number(profile.commission_rate) * 100)}%
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="border border-border bg-card p-4 space-y-1.5">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
            <p className={cn('text-xl font-bold font-mono tracking-tight', kpi.color)}>{kpi.value}</p>
            <p className="text-[9px] text-muted-foreground">{kpi.hint}</p>
          </div>
        ))}
      </div>

      {/* Commissions Ledger Section */}
      <div className="border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/30">
          <span className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
            <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
            {lang === 'ar' ? 'كشف تفاصيل العمولات' : 'Commissions Statement'}
          </span>
          <span className="text-[11px] text-muted-foreground">{commissionsWithRelease.length} {lang === 'ar' ? 'سجل' : 'records'}</span>
        </div>

        {commissionsWithRelease.length === 0 ? (
          <div className="px-6 py-16 text-center text-xs text-muted-foreground">
            <FileText className="h-5 w-5 mx-auto mb-2 opacity-40" />
            {lang === 'ar' ? 'لا توجد عمولات مسجلة لهذا الأفلييت.' : 'No commissions recorded for this affiliate.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">#</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'رقم الاشتراك' : 'Subscription #'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'مساحة العمل' : 'Workspace'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'قيمة الاشتراك' : 'Sub Amount'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'النسبة' : 'Rate'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'إجمالي العمولة' : 'Total Comm.'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'الفترة' : 'Period'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'الشهور (المنقضية/الكلية)' : 'Months (Elapsed/Total)'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'المتاح حالياً' : 'Released'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'المتبقي المستقبلي' : 'Future'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'تاريخ الاحتساب' : 'Calculated At'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'ملاحظات' : 'Notes'}</th>
                </tr>
              </thead>
              <tbody>
                {commissionsWithRelease.map((c, i) => (
                  <tr
                    key={c.id}
                    className={cn(
                      'border-b border-border/50 transition-colors hover:bg-muted/30',
                      c.status === 'void' && 'opacity-50 line-through bg-red-50/10',
                    )}
                  >
                    <td className="px-3 py-2.5 text-muted-foreground font-mono">{i + 1}</td>
                    <td className="px-3 py-2.5 font-mono text-muted-foreground">{c.subscriptionNumber}</td>
                    <td className="px-3 py-2.5 font-medium text-foreground">{c.workspaceName}</td>
                    <td className="px-3 py-2.5 font-mono font-medium text-foreground">
                      ${Number(c.gross_amount).toLocaleString('en-US')}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-muted-foreground">
                      {Math.round(Number(c.commission_rate) * 100)}%
                    </td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-emerald-600">
                      {fmtMoney(Number(c.commission_amount))}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground leading-relaxed whitespace-nowrap">
                      <div>{formatDate(c.period_start)}</div>
                      <div className="text-[10px] opacity-70">{formatDate(c.period_end)}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span>{c.releaseStats.elapsedMonths} / {c.releaseStats.totalMonths} {lang === 'ar' ? 'شهر' : 'mo'}</span>
                      </div>
                      <div className="w-20 bg-muted rounded-full h-1 mt-1 overflow-hidden">
                        <div
                          className="bg-primary h-1 rounded-full"
                          style={{ width: `${(c.releaseStats.elapsedMonths / c.releaseStats.totalMonths) * 100}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-blue-600">
                      {fmtMoney(c.releaseStats.releasedAmount)}
                    </td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-purple-600">
                      {fmtMoney(c.releaseStats.futureAmount)}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground font-mono">
                      {formatDate(c.created_at)}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground max-w-[200px] truncate" title={c.note || ''}>
                      {c.note || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payout History Section */}
      <div className="border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/30">
          <span className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
            <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
            {lang === 'ar' ? 'سجل طلبات صرف العمولات' : 'Payout Requests History'}
          </span>
          <span className="text-[11px] text-muted-foreground">{payouts?.length || 0} {lang === 'ar' ? 'طلب' : 'requests'}</span>
        </div>

        {!payouts || payouts.length === 0 ? (
          <div className="px-6 py-16 text-center text-xs text-muted-foreground">
            <CreditCard className="h-5 w-5 mx-auto mb-2 opacity-40" />
            {lang === 'ar' ? 'لا يوجد طلبات صرف مسجلة.' : 'No payout requests recorded.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">#</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'تاريخ الطلب' : 'Request Date'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'المبلغ' : 'Amount'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'رقم الحوالة / المرجع' : 'Payment Reference'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'تاريخ التحديث' : 'Processed Date'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'ملاحظات الإدارة' : 'Admin Note'}</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p, i) => (
                  <tr key={p.id} className="border-b border-border/50 transition-colors hover:bg-muted/30">
                    <td className="px-3 py-2.5 text-muted-foreground font-mono">{i + 1}</td>
                    <td className="px-3 py-2.5 text-muted-foreground font-mono">
                      {formatDate(p.requested_at)}
                    </td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-foreground">
                      {fmtMoney(Number(p.amount))}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={payoutStatusBadge(p.status)}>{p.status}</span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-muted-foreground font-medium">
                      {p.payment_reference || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {p.paid_at ? formatDate(p.paid_at) : p.reviewed_at ? formatDate(p.reviewed_at) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground max-w-[200px] truncate" title={p.review_note || p.rejection_reason || ''}>
                      {p.review_note || p.rejection_reason || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
