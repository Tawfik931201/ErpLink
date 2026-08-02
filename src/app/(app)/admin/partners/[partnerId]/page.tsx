import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  Handshake,
  Users,
  DollarSign,
  TrendingUp,
  CreditCard,
  Percent,
  Calendar,
  ArrowLeft,
  Shield,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react'

import { getActiveUserId, isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'
import { PARTNER_TIERS, tierLabel } from '@/lib/partner-tiers'

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

  // 1. Partner profile
  const { data: profile } = await supabase
    .from('partner_profiles')
    .select('*')
    .eq('id', params.partnerId)
    .single()

  if (!profile) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        {lang === 'ar' ? 'الشريك غير موجود' : 'Partner not found'}
      </div>
    )
  }

  // 2. Stats
  const { count: totalClients } = await supabase
    .from('partner_onboarding_invitations')
    .select('*', { count: 'exact', head: true })
    .eq('partner_id', params.partnerId)
    .in('status', ['accepted', 'linked'])

  const { count: pendingClients } = await supabase
    .from('partner_onboarding_invitations')
    .select('*', { count: 'exact', head: true })
    .eq('partner_id', params.partnerId)
    .eq('status', 'pending')

  const { data: commissions } = await supabase
    .from('partner_commissions')
    .select('commission_amount')
    .eq('partner_id', params.partnerId)

  const totalCommissions = commissions?.reduce((s, c) => s + Number(c.commission_amount), 0) ?? 0

  const { data: payouts } = await supabase
    .from('payout_requests')
    .select('amount, status')
    .eq('partner_id', params.partnerId)

  const totalPaid = payouts?.filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0) ?? 0
  const pendingPayouts = payouts?.filter((p) => p.status === 'pending').length ?? 0

  // 3. Clients
  const { data: clients } = await supabase
    .from('partner_onboarding_invitations')
    .select('id, email, client_name, status, workspace_id, created_at, accepted_at')
    .eq('partner_id', params.partnerId)
    .order('created_at', { ascending: false })
    .limit(20)

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

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-6" dir={dir}>
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
            {lang === 'ar' ? 'لوحة الشريك' : 'Partner Dashboard'}
          </Link>
        </div>
      </div>

      {/* Header */}
      <div className="rounded-2xl border border-border bg-card shadow-sm p-6 space-y-4">
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
        <div className="rounded-2xl border border-border bg-card shadow-sm p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'العملاء' : 'Clients'}
            </span>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-black">{totalClients ?? 0}</p>
          {maxClients !== null && (
            <p className="text-[10px] text-muted-foreground">
              {lang === 'ar' ? `الحد: ${maxClients}` : `Max: ${maxClients}`}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'العمولات' : 'Commissions'}
            </span>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-black">${totalCommissions.toLocaleString()}</p>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'المدفوع' : 'Paid'}
            </span>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-black">${totalPaid.toLocaleString()}</p>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'طلبات الصرف' : 'Payouts'}
            </span>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-black">{pendingPayouts}</p>
          <p className="text-[10px] text-muted-foreground">
            {lang === 'ar' ? 'قيد المراجعة' : 'Pending review'}
          </p>
        </div>
      </div>

      {/* Clients table */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-bold text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            {lang === 'ar' ? 'العملاء' : 'Clients'}
            <span className="text-muted-foreground font-normal text-xs">
              ({clients?.length ?? 0})
            </span>
          </h2>
          <Link
            href={`/admin/partners`}
            className="text-xs text-primary font-bold hover:underline"
          >
            {lang === 'ar' ? 'إدارة' : 'Manage'}
          </Link>
        </div>
        {!clients || clients.length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-muted-foreground">
            {lang === 'ar' ? 'لا يوجد عملاء لهذا الشريك' : 'No clients for this partner'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-muted-foreground bg-secondary/30">
              <tr>
                <th className="px-6 py-3 text-start">{lang === 'ar' ? 'الاسم' : 'Name'}</th>
                <th className="px-6 py-3 text-start">Email</th>
                <th className="px-6 py-3 text-start">{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                <th className="px-6 py-3 text-start">{lang === 'ar' ? 'ربط' : 'Linked'}</th>
                <th className="px-6 py-3 text-start">{lang === 'ar' ? 'التاريخ' : 'Date'}</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-t border-border/40">
                  <td className="px-6 py-3 font-semibold">{c.client_name}</td>
                  <td className="px-6 py-3 text-xs text-muted-foreground">{c.email}</td>
                  <td className="px-6 py-3">
                    <span className={statusBadge(c.status)}>
                      {c.status === 'linked' ? <CheckCircle2 className="h-3 w-3" /> : c.status === 'accepted' ? <Clock className="h-3 w-3" /> : null}
                      {c.status}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-[10px] font-mono text-muted-foreground">
                    {c.workspace_id ? `${c.workspace_id.slice(0, 8)}...` : '—'}
                  </td>
                  <td className="px-6 py-3 text-[10px] text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString(
                      lang === 'ar' ? 'ar-SA' : 'en-US',
                      { year: 'numeric', month: 'short', day: 'numeric' },
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href={`/admin/commissions`}
          className="rounded-2xl border border-border bg-card shadow-sm p-4 text-center hover:bg-secondary/40 transition-colors"
        >
          <DollarSign className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
          <span className="text-xs font-bold">{lang === 'ar' ? 'إدارة العمولات' : 'Manage Commissions'}</span>
        </Link>
        <Link
          href={`/admin/payouts`}
          className="rounded-2xl border border-border bg-card shadow-sm p-4 text-center hover:bg-secondary/40 transition-colors"
        >
          <CreditCard className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
          <span className="text-xs font-bold">{lang === 'ar' ? 'إدارة الصرف' : 'Manage Payouts'}</span>
        </Link>
        <Link
          href={`/admin/workspace-links`}
          className="rounded-2xl border border-border bg-card shadow-sm p-4 text-center hover:bg-secondary/40 transition-colors"
        >
          <Users className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
          <span className="text-xs font-bold">{lang === 'ar' ? 'روابط العملاء' : 'Client Links'}</span>
        </Link>
      </div>
    </div>
  )
}
