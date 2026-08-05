import {
  Handshake,
  Users,
  DollarSign,
  TrendingUp,
  CreditCard,
  Calendar,
  ArrowLeft,
  Shield,
  CalendarCheck,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getActiveUserId, isAdmin } from '@/lib/auth'
import { PARTNER_TIERS, tierLabel } from '@/lib/partner-tiers'
import { isSubscriptionExpired } from '@/lib/subscription-utils'
import { supabase } from '@/lib/supabase'
import type { Language } from '@/lib/translations'

export default async function AdminPartnerDetailPage({
  params,
}: {
  params: { partnerId: string }
}) {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/dashboard')

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  // 1. Affiliate profile
  const { data: profile } = await supabase
    .from('partner_profiles')
    .select('*')
    .eq('id', params.partnerId)
    .single()

  if (!profile) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        {lang === 'ar' ? 'الأفلييت غير موجود' : 'Affiliate not found'}
      </div>
    )
  }

  // 2. Workspaces registered by this affiliate
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name, user_id, created_at')
    .eq('partner_id', params.partnerId)
    .order('created_at', { ascending: false })
    .limit(50)

  const wsIds = (workspaces ?? []).map((w) => w.id)
  let activeCount = 0
  const subsByWorkspace: Record<
    string,
    { id: string; workspace_id: string; user_id: string; end_date: string; status: string }
  > = {}

  if (wsIds.length > 0) {
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('*')
      .in('workspace_id', wsIds)
      .eq('status', 'active')
      .order('end_date', { ascending: true })

    // Keep the latest active subscription per workspace (highest end_date)
    for (const s of subs ?? []) {
      const prev = subsByWorkspace[s.workspace_id]
      if (!prev || s.end_date > prev.end_date) subsByWorkspace[s.workspace_id] = s
    }
    activeCount = Object.values(subsByWorkspace).filter((s) => !isSubscriptionExpired(s)).length
  }

  // Resolve client emails/names
  const clientIds = [...new Set((workspaces ?? []).map((w) => w.user_id))]
  const { data: users } = await supabase
    .from('users')
    .select('id, email, name')
    .in('id', clientIds.length ? clientIds : ['__none__'])

  const userMap = new Map((users ?? []).map((u) => [u.id, u]))

  // 3. Financial stats
  const { data: commissions } = await supabase
    .from('partner_commissions')
    .select('commission_amount')
    .eq('partner_id', params.partnerId)
    .eq('status', 'approved')

  const totalCommissions = commissions?.reduce((s, c) => s + Number(c.commission_amount), 0) ?? 0

  const { data: payouts } = await supabase
    .from('payout_requests')
    .select('amount, status')
    .eq('partner_id', params.partnerId)

  const totalPaid = payouts?.filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0) ?? 0
  const pendingPayouts =
    payouts
      ?.filter((p) => ['pending', 'under_review', 'approved'].includes(p.status))
      .reduce((s, p) => s + Number(p.amount), 0) ?? 0

  const commissionPercent = Math.round(Number(profile.commission_rate) * 100)
  const maxClients = PARTNER_TIERS[profile.tier as keyof typeof PARTNER_TIERS]?.maxClients

  const statusBadge = (status: string) => {
    const m: Record<string, string> = {
      pending: 'bg-amber-50 border-amber-200 text-amber-700',
      active: 'bg-emerald-50 border-emerald-200 text-emerald-700',
      suspended: 'bg-muted border-border text-secondary-foreground',
      rejected: 'bg-red-50 border-red-200 text-red-700',
    }
    return `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${m[status] || ''}`
  }

  const subBadge = (sub: {
    id: string
    workspace_id: string
    user_id: string
    end_date: string
    status: string
  }) => {
    if (!sub) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-muted border-border text-muted-foreground">
          {lang === 'ar' ? 'بلا اشتراك' : 'No subscription'}
        </span>
      )
    }
    const expired = isSubscriptionExpired(sub)
    if (expired) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-red-50 border-red-200 text-red-700">
          {lang === 'ar' ? 'منتهٍ' : 'Expired'}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-emerald-50 border-emerald-200 text-emerald-700">
        {lang === 'ar' ? 'نشط' : 'Active'}
      </span>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6" dir={dir}>
      {/* Back + Actions */}
      <div className="flex items-center justify-between">
        <Link
          href="/admin/partners"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {lang === 'ar' ? 'العودة للقائمة' : 'Back to list'}
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/partner/${profile.id}`}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs font-bold hover:bg-secondary transition-colors"
          >
            <Handshake className="h-3.5 w-3.5" />
            {lang === 'ar' ? 'لوحة الأفلييت' : 'Affiliate Dashboard'}
          </Link>
        </div>
      </div>

      {/* Header */}
      <div className="border border-border bg-card p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Handshake className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-foreground">{profile.display_name}</h1>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">{profile.id}</p>
            </div>
          </div>
          <span className={statusBadge(profile.status)}>
            <Shield className="h-3 w-3" />
            {profile.status}
          </span>
        </div>

        {profile.rejection_reason && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {lang === 'ar' ? 'سبب الرفض: ' : 'Rejection reason: '}{profile.rejection_reason}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
              {lang === 'ar' ? 'الطبقة' : 'Tier'}
            </p>
            <p className="text-sm font-bold">{tierLabel(profile.tier, lang)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
              {lang === 'ar' ? 'العمولة' : 'Commission'}
            </p>
            <p className="text-sm font-bold">{commissionPercent}%</p>
          </div>
          {profile.approved_at && (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                {lang === 'ar' ? 'تاريخ الموافقة' : 'Approved'}
              </p>
              <p className="text-sm font-bold flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                {new Date(profile.approved_at).toLocaleDateString(
                  lang === 'ar' ? 'ar-SA' : 'en-US',
                  { year: 'numeric', month: 'short', day: 'numeric' },
                )}
              </p>
            </div>
          )}
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
              {lang === 'ar' ? 'تاريخ التسجيل' : 'Joined'}
            </p>
            <p className="text-sm font-bold flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              {new Date(profile.created_at).toLocaleDateString(
                lang === 'ar' ? 'ar-SA' : 'en-US',
                { year: 'numeric', month: 'short', day: 'numeric' },
              )}
            </p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="border border-border bg-card p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'العملاء' : 'Clients'}
            </span>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-black">{workspaces?.length ?? 0}</p>
          {maxClients !== null && (
            <p className="text-[10px] text-muted-foreground">
              {lang === 'ar' ? `الحد: ${maxClients}` : `Max: ${maxClients}`}
            </p>
          )}
          <p className="text-[10px] text-emerald-600 font-medium">
            {lang === 'ar' ? `${activeCount} باشتراك نشط` : `${activeCount} with active subscription`}
          </p>
        </div>

        <div className="border border-border bg-card p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'العمولات' : 'Commissions'}
            </span>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-black">${totalCommissions.toLocaleString('en-US')}</p>
        </div>

        <div className="border border-border bg-card p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'المدفوع' : 'Paid'}
            </span>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-black">${totalPaid.toLocaleString('en-US')}</p>
        </div>

        <div className="border border-border bg-card p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'قيد المراجعة (صرف)' : 'Pending Payouts'}
            </span>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-black">${pendingPayouts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p className="text-[10px] text-muted-foreground">
            {lang === 'ar' ? 'طلبات لم تُدفع بعد' : 'Requests not yet paid'}
          </p>
        </div>
      </div>

      {/* Clients table */}
      <div className="border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-bold text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            {lang === 'ar' ? 'العملاء' : 'Clients'}
            <span className="text-muted-foreground font-normal text-xs">
              ({workspaces?.length ?? 0})
            </span>
          </h2>
        </div>
        {!workspaces || workspaces.length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-muted-foreground">
            {lang === 'ar' ? 'لا يوجد عملاء لهذا الأفلييت' : 'No clients for this affiliate'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-muted-foreground bg-secondary/30">
              <tr>
                <th className="px-6 py-3 text-start">{lang === 'ar' ? 'المساحة' : 'Workspace'}</th>
                <th className="px-6 py-3 text-start">Email</th>
                <th className="px-6 py-3 text-start">{lang === 'ar' ? 'الاشتراك' : 'Subscription'}</th>
                <th className="px-6 py-3 text-start">{lang === 'ar' ? 'التاريخ' : 'Date'}</th>
              </tr>
            </thead>
            <tbody>
              {(workspaces ?? []).map((ws) => {
                const user = userMap.get(ws.user_id)
                const sub = subsByWorkspace[ws.id] ?? null
                return (
                  <tr key={ws.id} className="border-t border-border/40">
                    <td className="px-6 py-3 font-semibold">{ws.name}</td>
                    <td className="px-6 py-3 text-xs text-muted-foreground">{user?.email ?? '—'}</td>
                    <td className="px-6 py-3">{subBadge(sub)}</td>
                    <td className="px-6 py-3 text-[10px] text-muted-foreground">
                      {new Date(ws.created_at).toLocaleDateString(
                        lang === 'ar' ? 'ar-SA' : 'en-US',
                        { year: 'numeric', month: 'short', day: 'numeric' },
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href={`/admin/subscriptions`}
          className="border border-border bg-card p-4 text-center hover:bg-secondary/40 transition-colors"
        >
          <CalendarCheck className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
          <span className="text-xs font-bold">{lang === 'ar' ? 'إدارة الاشتراكات' : 'Manage Subscriptions'}</span>
        </Link>
        <Link
          href={`/admin/commissions`}
          className="border border-border bg-card p-4 text-center hover:bg-secondary/40 transition-colors"
        >
          <DollarSign className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
          <span className="text-xs font-bold">{lang === 'ar' ? 'إدارة العمولات' : 'Manage Commissions'}</span>
        </Link>
      </div>
    </div>
  )
}
