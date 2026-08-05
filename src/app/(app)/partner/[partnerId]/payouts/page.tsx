import { CreditCard, Plus, Clock, CheckCircle2, XCircle, Receipt } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import type { Language } from '@/lib/translations'

interface PayoutRow {
  id: string
  amount: number | string
  status: string
  payment_reference: string | null
  payment_note: string | null
  review_note: string | null
  created_at: string
  reviewed_at: string | null
}

const UNDER_REVIEW_STATUSES = ['pending', 'under_review', 'approved']

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
  const isAr = lang === 'ar'

  const { data: profile } = await supabase
    .from('partner_profiles')
    .select('id, user_id')
    .eq('id', params.partnerId)
    .single()

  if (!profile || profile.user_id !== userId) redirect('/dashboard')

  const { data: payouts, error: payoutsErr } = await supabase
    .from('payout_requests')
    .select('id, amount, status, payment_reference, payment_note, review_note, created_at, reviewed_at')
    .eq('partner_id', params.partnerId)
    .order('created_at', { ascending: false })

  const rows = (payouts ?? []) as PayoutRow[]

  const totalUnderReview =
    rows.filter((p) => UNDER_REVIEW_STATUSES.includes(p.status)).reduce((s, p) => s + Number(p.amount), 0) ?? 0
  const totalPaid =
    rows.filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0) ?? 0
  const totalRejected =
    rows.filter((p) => p.status === 'rejected').reduce((s, p) => s + Number(p.amount), 0) ?? 0

  const fmt = (n: number | string) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'destructive' | 'info' | 'secondary'; label: string }> = {
      paid: { variant: 'success', label: isAr ? 'مدفوع' : 'Paid' },
      rejected: { variant: 'destructive', label: isAr ? 'مرفوض' : 'Rejected' },
      approved: { variant: 'info', label: isAr ? 'معتمد' : 'Approved' },
      pending: { variant: 'warning', label: isAr ? 'قيد الانتظار' : 'Pending' },
      under_review: { variant: 'warning', label: isAr ? 'قيد المراجعة' : 'Under review' },
    }
    const s = map[status] ?? { variant: 'secondary' as const, label: status }
    return (
      <Badge variant={s.variant} className="text-[10px] px-2 py-0">
        {s.label}
      </Badge>
    )
  }

  const kpiCards = [
    {
      label: isAr ? 'إجمالي الطلبات' : 'Total Requests',
      value: String(rows.length),
      sub: isAr ? 'طلبات صرف مقدمة' : 'payout requests submitted',
      icon: Receipt,
      accent: 'text-blue-500 bg-blue-500/10',
      bar: 'bg-blue-500',
    },
    {
      label: isAr ? 'قيد المراجعة' : 'Under Review',
      value: `$${fmt(totalUnderReview)}`,
      sub: isAr ? 'لم تُدفع بعد' : 'not yet paid',
      icon: Clock,
      accent: 'text-amber-500 bg-amber-500/10',
      bar: 'bg-amber-500',
    },
    {
      label: isAr ? 'تم الصرف' : 'Paid Out',
      value: `$${fmt(totalPaid)}`,
      sub: isAr ? 'إجمالي المبالغ المستلمة' : 'total amounts received',
      icon: CheckCircle2,
      accent: 'text-emerald-500 bg-emerald-500/10',
      bar: 'bg-emerald-500',
    },
    {
      label: isAr ? 'مرفوضة' : 'Rejected',
      value: `$${fmt(totalRejected)}`,
      sub: isAr ? 'طلبات تم رفضها' : 'requests that were rejected',
      icon: XCircle,
      accent: 'text-red-500 bg-red-500/10',
      bar: 'bg-red-500',
    },
  ]

  return (
    <div className="space-y-6" dir={dir}>
      {/* ── Page Header ──────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-6 w-1 rounded-full bg-foreground" />
            <h1 className="text-2xl font-bold tracking-tight">{isAr ? 'طلبات الصرف' : 'Payout Requests'}</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {isAr
              ? 'تابع حالة طلبات الصرف والمبالغ المستلمة'
              : 'Track your payout requests and received amounts'}
          </p>
        </div>
        <Button asChild className="rounded-xl font-bold shrink-0">
          <Link href={`/partner/${params.partnerId}/payouts/new`}>
            <Plus className="h-4 w-4" />
            {isAr ? 'طلب صرف' : 'Request Payout'}
          </Link>
        </Button>
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

      {/* ── Payouts table ────────────────────────────────────── */}
      {payoutsErr ? (
        <div className="bg-card border border-red-200 p-12 text-center">
          <p className="text-sm text-red-600">
            {isAr
              ? 'حدث خطأ أثناء تحميل طلبات الصرف. حاول مرة أخرى لاحقاً.'
              : 'Failed to load payout requests. Please try again later.'}
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card border p-12 text-center">
          <CreditCard className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {isAr ? 'لا توجد طلبات صرف بعد' : 'No payout requests yet'}
          </p>
        </div>
      ) : (
        <div className="bg-card border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-amber-500" />
              <h3 className="text-sm font-bold">{isAr ? 'سجل طلبات الصرف' : 'Payout History'}</h3>
            </div>
            <span className="text-[11px] text-muted-foreground">{rows.length}</span>
          </div>
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
                {rows.map((p) => (
                  <tr key={p.id} className="border-t border-border/40 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3 text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(p.reviewed_at || p.created_at).toLocaleDateString(isAr ? 'ar-SA' : 'en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="px-5 py-3 font-mono font-bold whitespace-nowrap">
                      ${fmt(p.amount)}
                    </td>
                    <td className="px-5 py-3">{statusBadge(p.status)}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground font-mono">
                      {p.payment_reference || '—'}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
                      {p.payment_note || p.review_note || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
