import {
  TrendingUp,
  CreditCard,
  Clock,
  ShieldCheck,
  XCircle,
  Wallet,
  CheckCircle2,
} from 'lucide-react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { getActiveUserId } from '@/lib/auth'
import { calculateRelease } from '@/lib/commission-calculator'
import { supabase } from '@/lib/supabase'
import type { Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

interface CommissionRow {
  id: string
  gross_amount: number | string
  commission_rate: number | string
  commission_amount: number | string
  currency: string
  status: string
  source: string
  note: string | null
  period_start: string
  period_end: string
  created_at: string
  client_user_id: string
  workspace_id: string
  paid_in_payout_id: string | null
}

interface PayoutRow {
  id: string
  amount: number | string
  currency: string
  status: string
  payment_reference: string | null
  payment_note: string | null
  created_at: string
  paid_at: string | null
}

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
  const isAr = lang === 'ar'

  // Verify partner profile ownership
  const { data: profile } = await supabase
    .from('partner_profiles')
    .select('id, user_id')
    .eq('id', params.partnerId)
    .single()

  if (!profile || profile.user_id !== userId) redirect('/dashboard')

  const { data: commissions } = await supabase
    .from('partner_commissions')
    .select(
      'id, gross_amount, commission_rate, commission_amount, currency, status, source, note, period_start, period_end, created_at, client_user_id, workspace_id, paid_in_payout_id',
    )
    .eq('partner_id', params.partnerId)
    .order('created_at', { ascending: false })

  const { data: payouts, error: payoutsErr } = await supabase
    .from('payout_requests')
    .select(
      'id, amount, currency, status, payment_reference, payment_note, created_at, paid_at',
    )
    .eq('partner_id', params.partnerId)
    .order('created_at', { ascending: false })

  const rows = (commissions ?? []) as CommissionRow[]
  const payoutRows = (payouts ?? []) as PayoutRow[]

  // Resolve client users
  const clientIds = [...new Set(rows.map((c) => c.client_user_id).filter(Boolean))]
  const { data: users } = await supabase
    .from('users')
    .select('id, email, name')
    .in('id', clientIds.length ? clientIds : ['__none__'])
  const userMap = new Map((users ?? []).map((u) => [u.id, u]))

  // Resolve workspace names
  const wsIds = [...new Set(rows.map((c) => c.workspace_id).filter(Boolean))]
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name')
    .in('id', wsIds.length ? wsIds : ['__none__'])
  const wsMap = new Map((workspaces ?? []).map((w) => [w.id, w.name]))

  // Resolve payout references for paid commissions
  const payoutRefMap = new Map<string, string>()
  for (const p of payoutRows) {
    payoutRefMap.set(p.id, p.payment_reference || p.status)
  }

  const totalCommissions =
    rows.filter((c) => c.status !== 'void').reduce((s, c) => s + Number(c.commission_amount), 0) ?? 0
  const totalReceived =
    payoutRows.filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0) ?? 0
  const pendingReview =
    payoutRows
      .filter((p) => ['pending', 'under_review', 'approved'].includes(p.status))
      .reduce((s, p) => s + Number(p.amount), 0) ?? 0

  // Eligible to withdraw = released portion of approved commissions − already paid − under review
  const now = new Date()
  let totalReleased = 0
  for (const c of rows) {
    if (c.status === 'void') continue
    const { releasedAmount } = calculateRelease(c.commission_amount, c.period_start, c.period_end, now)
    totalReleased += releasedAmount
  }
  const eligibleBalance = Math.max(0, Math.round((totalReleased - totalReceived - pendingReview) * 100) / 100)

  const fmt = (n: number | string) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtOrDash = (n: number | string) => (payoutsErr ? '—' : fmt(n))

  const formatDate = (d: string) => {
    try {
      if (!d) return '—'
      return new Date(d).toLocaleDateString(isAr ? 'ar-SA' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return d
    }
  }

  const kpiCards = [
    {
      label: isAr ? 'إجمالي العمولات' : 'Total Commissions',
      value: `$${fmt(totalCommissions)}`,
      sub: `${rows.filter((c) => c.status !== 'void').length} ${isAr ? 'عمولة معتمدة' : 'approved commissions'}`,
      icon: TrendingUp,
      accent: 'text-emerald-500 bg-emerald-500/10',
      bar: 'bg-emerald-500',
    },
    {
      label: isAr ? 'المتاح للسحب' : 'Available Balance',
      value: `$${fmtOrDash(eligibleBalance)}`,
      sub: isAr ? 'بعد خصم المدفوع والقيد المراجعة' : 'after paid & under review',
      icon: Wallet,
      accent: 'text-blue-500 bg-blue-500/10',
      bar: 'bg-blue-500',
    },
    {
      label: isAr ? 'المبالغ المستلمة' : 'Received',
      value: `$${fmtOrDash(totalReceived)}`,
      sub: isAr ? 'إجمالي المبالغ المصروفة لك' : 'Total amounts paid out to you',
      icon: CheckCircle2,
      accent: 'text-violet-500 bg-violet-500/10',
      bar: 'bg-violet-500',
    },
    {
      label: isAr ? 'قيد المراجعة' : 'Under Review',
      value: `$${fmtOrDash(pendingReview)}`,
      sub: isAr ? 'طلبات صرف لم تُدفع بعد' : 'Payout requests not yet paid',
      icon: Clock,
      accent: 'text-amber-500 bg-amber-500/10',
      bar: 'bg-amber-500',
    },
  ]

  return (
    <div className="space-y-6" dir={dir}>
      {/* ── Page Header ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="h-6 w-1 rounded-full bg-foreground" />
          <h1 className="text-2xl font-bold tracking-tight">{isAr ? 'كشف حساب العمولات' : 'Commission Statement'}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {isAr
            ? 'تفاصيل كل عمولة محسوبة لك والمبالغ التي تم استلامها'
            : 'Detailed breakdown of every commission earned and amounts received'}
        </p>
      </div>

      {/* ── Row 1: KPI Cards ─────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map(({ label, value, sub, icon: Icon, accent, bar }) => (
          <div key={label} className="bg-card border p-5 relative overflow-hidden">
            <div className={`absolute top-0 left-0 right-0 h-0.5 ${bar}`} />
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                {label}
              </span>
              <div className={`p-2 rounded-lg ${accent}`}>
                <Icon className="h-4 w-4" />
              </div>
            </div>
            <div className="text-2xl font-bold tracking-tight mb-0.5">{value}</div>
            <p className="text-[11px] text-muted-foreground truncate">{sub}</p>
          </div>
        ))}
      </div>

      {/* ── Commissions detail ───────────────────────────────── */}
      <div className="bg-card border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <h3 className="text-sm font-bold">{isAr ? 'تفاصيل العمولات' : 'Commission Details'}</h3>
            <span className="text-[10px] text-muted-foreground">({rows.length})</span>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-40" />
            {isAr ? 'لا توجد عمولات مسجلة بعد' : 'No commissions recorded yet'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground bg-muted/30">
                <tr>
                  <th className="px-5 py-3 text-start">{isAr ? 'التاريخ' : 'Date'}</th>
                  <th className="px-5 py-3 text-start">{isAr ? 'العميل / المساحة' : 'Client / Workspace'}</th>
                  <th className="px-5 py-3 text-start">{isAr ? 'المبلغ الإجمالي' : 'Gross'}</th>
                  <th className="px-5 py-3 text-start">{isAr ? 'النسبة' : 'Rate'}</th>
                  <th className="px-5 py-3 text-start">{isAr ? 'العمولة' : 'Commission'}</th>
                  <th className="px-5 py-3 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                  <th className="px-5 py-3 text-start">{isAr ? 'الصرف' : 'Payout'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const user = userMap.get(c.client_user_id)
                  const ref = c.paid_in_payout_id ? payoutRefMap.get(c.paid_in_payout_id) : null
                  return (
                    <tr key={c.id} className="border-t border-border/40 hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-3 text-[10px] text-muted-foreground whitespace-nowrap">
                        {formatDate(c.created_at)}
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-semibold">{user?.name || user?.email || '—'}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {wsMap.get(c.workspace_id) || '—'}
                        </p>
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        ${fmt(c.gross_amount)}
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {Math.round(Number(c.commission_rate) * 100)}%
                      </td>
                      <td
                        className={cn(
                          'px-5 py-3 font-mono font-bold whitespace-nowrap',
                          c.status === 'void' ? 'text-muted-foreground line-through' : 'text-emerald-700',
                        )}
                      >
                        ${fmt(c.commission_amount)}
                      </td>
                      <td className="px-5 py-3">
                        {c.status === 'void' ? (
                          <Badge variant="destructive" className="text-[10px] px-2 py-0">
                            <XCircle className="h-3 w-3" />
                            {isAr ? 'ملغاة' : 'Void'}
                          </Badge>
                        ) : (
                          <Badge variant="success" className="text-[10px] px-2 py-0">
                            <ShieldCheck className="h-3 w-3" />
                            {isAr ? 'نشطة' : 'Approved'}
                          </Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-[10px] text-muted-foreground">
                        {ref ? (
                          <span className="inline-flex items-center gap-1 font-mono text-emerald-700">
                            <CreditCard className="h-3 w-3" />
                            {ref === 'paid' ? (isAr ? 'مدفوع' : 'Paid') : ref}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Payouts / received amounts ───────────────────────── */}
      {payoutsErr && (
        <div className="bg-card border border-red-200 p-8 text-center">
          <p className="text-sm text-red-600">
            {isAr
              ? 'حدث خطأ أثناء تحميل طلبات الصرف. حاول مرة أخرى لاحقاً.'
              : 'Failed to load payout requests. Please try again later.'}
          </p>
        </div>
      )}
      <div className="bg-card border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-violet-500" />
            <h3 className="text-sm font-bold">{isAr ? 'طلبات الصرف والمدفوعات' : 'Payouts & Payments'}</h3>
            <span className="text-[10px] text-muted-foreground">({payoutRows.length})</span>
          </div>
        </div>
        {payoutRows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            <CreditCard className="h-8 w-8 mx-auto mb-2 opacity-40" />
            {isAr ? 'لا توجد طلبات صرف بعد' : 'No payout requests yet'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground bg-muted/30">
                <tr>
                  <th className="px-5 py-3 text-start">{isAr ? 'التاريخ' : 'Date'}</th>
                  <th className="px-5 py-3 text-start">{isAr ? 'المبلغ' : 'Amount'}</th>
                  <th className="px-5 py-3 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                  <th className="px-5 py-3 text-start">{isAr ? 'مرجع الصرف' : 'Reference'}</th>
                  <th className="px-5 py-3 text-start">{isAr ? 'ملاحظات' : 'Notes'}</th>
                </tr>
              </thead>
              <tbody>
                {payoutRows.map((p) => (
                  <tr key={p.id} className="border-t border-border/40 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3 text-[10px] text-muted-foreground whitespace-nowrap">
                      {formatDate(p.paid_at || p.created_at)}
                    </td>
                    <td className="px-5 py-3 font-mono font-bold whitespace-nowrap">
                      ${fmt(p.amount)}
                    </td>
                    <td className="px-5 py-3">
                      {p.status === 'paid' ? (
                        <Badge variant="success" className="text-[10px] px-2 py-0">
                          {isAr ? 'مدفوع' : 'Paid'}
                        </Badge>
                      ) : p.status === 'rejected' ? (
                        <Badge variant="destructive" className="text-[10px] px-2 py-0">
                          {isAr ? 'مرفوض' : 'Rejected'}
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="text-[10px] px-2 py-0">
                          {isAr ? 'قيد المراجعة' : 'Pending'}
                        </Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground font-mono">
                      {p.payment_reference || '—'}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
                      {p.payment_note || '—'}
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
