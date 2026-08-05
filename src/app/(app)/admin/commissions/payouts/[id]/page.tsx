import {
  ArrowLeft,
  Banknote,
  Calendar,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Hash,
  Info,
  ShieldAlert,
  User,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getActiveUserId, isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import type { Language } from '@/lib/translations'

import PrintPayoutButton from './PrintPayoutButton'

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-50 border-amber-200 text-amber-700',
  under_review: 'bg-blue-50 border-blue-200 text-blue-700',
  approved: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  paid: 'bg-emerald-600 border-emerald-700 text-white',
  rejected: 'bg-red-50 border-red-200 text-red-700',
}

const statusLabel = (status: string, lang: Language) => {
  const m: Record<string, [string, string]> = {
    pending: ['قيد المراجعة', 'Pending'],
    under_review: ['قيد الدراسة', 'Under review'],
    approved: ['معتمد', 'Approved'],
    paid: ['تم التحويل', 'Paid'],
    rejected: ['مرفوض', 'Rejected'],
  }
  const pair = m[status] ?? [status, status]
  return lang === 'ar' ? pair[0] : pair[1]
}

export default async function PayoutDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/dashboard')

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  const { data: payout } = await supabase
    .from('payout_requests')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!payout) {
    return (
      <div className="max-w-3xl mx-auto p-10 text-center text-sm text-muted-foreground">
        {lang === 'ar' ? 'لم يتم العثور على طلب الصرف' : 'Payout request not found'}
      </div>
    )
  }

  const { data: profile } = await supabase
    .from('partner_profiles')
    .select('display_name')
    .eq('id', payout.partner_id)
    .single()

  const actorIds = [payout.requested_by, payout.reviewed_by, payout.approved_by, payout.paid_by].filter(
    Boolean,
  )
  const { data: actorUsers } = await supabase
    .from('users')
    .select('id, name, email')
    .in('id', actorIds.length ? actorIds : ['__none__'])
  const actorMap = new Map((actorUsers ?? []).map((u) => [u.id, u]))

  const actorName = (id: string | null) => {
    if (!id) return '—'
    const u = actorMap.get(id)
    return u?.name || u?.email || id
  }

  const fmtDate = (ts: string | null) =>
    ts
      ? new Date(ts).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '—'

  const fmtDateTime = (ts: string | null) =>
    ts
      ? new Date(ts).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—'

  const fmtAmount = (n: number) =>
    `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const rows: { icon: React.ReactNode; label: string; value: string }[] = [
    {
      icon: <User className="h-3.5 w-3.5" />,
      label: lang === 'ar' ? 'الأفلييت' : 'Affiliate',
      value: profile?.display_name || payout.partner_id,
    },
    {
      icon: <Hash className="h-3.5 w-3.5" />,
      label: lang === 'ar' ? 'معرّف الطلب' : 'Request ID',
      value: payout.id,
    },
    {
      icon: <Banknote className="h-3.5 w-3.5" />,
      label: lang === 'ar' ? 'المبلغ' : 'Amount',
      value: `${fmtAmount(payout.amount)} ${payout.currency}`,
    },
    {
      icon: <Calendar className="h-3.5 w-3.5" />,
      label: lang === 'ar' ? 'الفترة' : 'Period',
      value: `${fmtDate(payout.period_start)} → ${fmtDate(payout.period_end)}`,
    },
    {
      icon: <User className="h-3.5 w-3.5" />,
      label: lang === 'ar' ? 'مقدم الطلب' : 'Requested by',
      value: `${actorName(payout.requested_by)} — ${fmtDateTime(payout.requested_at)}`,
    },
    {
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      label: lang === 'ar' ? 'تمت المراجعة بواسطة' : 'Reviewed by',
      value: payout.reviewed_by
        ? `${actorName(payout.reviewed_by)} — ${fmtDateTime(payout.reviewed_at)}`
        : '—',
    },
    {
      icon: <ShieldAlert className="h-3.5 w-3.5" />,
      label: lang === 'ar' ? 'تم الاعتماد بواسطة' : 'Approved by',
      value: payout.approved_by
        ? `${actorName(payout.approved_by)} — ${fmtDateTime(payout.approved_at)}`
        : '—',
    },
    {
      icon: <CircleDollarSign className="h-3.5 w-3.5" />,
      label: lang === 'ar' ? 'تم التحويل بواسطة' : 'Paid by',
      value: payout.paid_by
        ? `${actorName(payout.paid_by)} — ${fmtDateTime(payout.paid_at)}`
        : '—',
    },
    {
      icon: <Hash className="h-3.5 w-3.5" />,
      label: lang === 'ar' ? 'مرجع الصرف' : 'Payment reference',
      value: payout.payment_reference || '—',
    },
  ]

  return (
    <div className="max-w-3xl mx-auto space-y-5" dir={dir}>
      <Link
        href="/admin/commissions"
        className="no-print inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {lang === 'ar' ? 'العودة للطلبات' : 'Back to requests'}
      </Link>

      <div className="no-print flex items-center justify-end">
        <PrintPayoutButton lang={lang} />
      </div>

      <div className="border border-border bg-card p-6 space-y-4">
        <div className="hidden print:flex items-center justify-between border-b border-border pb-4">
          <span className="text-2xl font-black tracking-tight text-foreground">ErpLink</span>
        </div>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-black text-foreground">
              {lang === 'ar' ? 'تفاصيل طلب الصرف' : 'Payout Request Details'}
            </h1>
            <p className="text-[11px] text-muted-foreground mt-1 font-mono break-all">{payout.id}</p>
          </div>
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border ${statusStyles[payout.status] || ''}`}
          >
            {statusLabel(payout.status, lang)}
          </span>
        </div>

        <div className="border border-border bg-muted/30 rounded-lg p-4">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
            {lang === 'ar' ? 'المبلغ الإجمالي' : 'Total amount'}
          </p>
          <p className="text-3xl font-black text-foreground mt-1 font-mono">
            {fmtAmount(payout.amount)}
            <span className="text-base font-bold text-muted-foreground"> {payout.currency}</span>
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 payout-grid">
          {rows.map((r, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="text-muted-foreground mt-0.5 shrink-0">{r.icon}</span>
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground font-medium">{r.label}</p>
                <p className="text-foreground font-medium break-all">{r.value}</p>
              </div>
            </div>
          ))}
        </div>

        {(payout.review_note || payout.payment_note || payout.rejection_reason) && (
          <div className="space-y-2 pt-1">
            {payout.rejection_reason && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                <p className="font-bold mb-0.5">{lang === 'ar' ? 'سبب الرفض' : 'Rejection reason'}</p>
                <p>{payout.rejection_reason}</p>
              </div>
            )}
            {payout.review_note && (
              <div className="no-print rounded-lg border border-border bg-background px-3 py-2 text-[11px] text-muted-foreground">
                <p className="font-bold text-foreground mb-0.5">{lang === 'ar' ? 'ملاحظة المراجعة' : 'Review note'}</p>
                <p>{payout.review_note}</p>
              </div>
            )}
            {payout.payment_note && (
              <div className="no-print rounded-lg border border-border bg-background px-3 py-2 text-[11px] text-muted-foreground">
                <p className="font-bold text-foreground mb-0.5">{lang === 'ar' ? 'ملاحظة الصرف' : 'Payment note'}</p>
                <p>{payout.payment_note}</p>
              </div>
            )}
          </div>
        )}

        <div className="no-print flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          <FileText className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <p>
            {lang === 'ar'
              ? 'تشمل هذه الدفعة العمولات المسجلة في الفترة أعلاه. للاستفسار عن العمولات الفردية راجع صفحة العمولات.'
              : 'This payout covers the commissions recorded in the period above. For individual commissions, see the commissions page.'}
          </p>
        </div>

        <div className="no-print flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <p>
            {lang === 'ar' ? 'معرّفات العمولات المشمولة:' : 'Included commission IDs:'}{' '}
            {Array.isArray(payout.commission_ids) && payout.commission_ids.length > 0
              ? payout.commission_ids.join(', ')
              : '—'}
          </p>
        </div>
      </div>
    </div>
  )
}
