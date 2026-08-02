import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  Users,
  DollarSign,
  Clock,
  CreditCard,
  TrendingUp,
  Handshake,
  Link2,
  UserPlus,
  Percent,
} from 'lucide-react'

import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'
import { PARTNER_TIERS, tierLabel } from '@/lib/partner-tiers'
import { Button } from '@/components/ui/button'

import { getPartnerStats } from '@/app/actions/partner-actions'
import InviteClientButton from '@/components/partner/InviteClientButton'
import ClientInvitationCard from '@/components/partner/ClientInvitationCard'

export default async function PartnerDashboardPage({
  params,
}: {
  params: { partnerId: string }
}) {
  const userId = await getActiveUserId()
  if (!userId) redirect('/sign-in')

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) =>
    translations[lang][key] || translations['ar'][key]

  // Verify partner profile ownership
  const { data: profile } = await supabase
    .from('partner_profiles')
    .select('id, user_id, display_name, tier, commission_rate, status')
    .eq('id', params.partnerId)
    .single()

  if (!profile || profile.user_id !== userId) redirect('/dashboard')

  // Get stats
  const { stats } = await getPartnerStats(params.partnerId)

  const commissionPercent = Math.round(Number(profile.commission_rate) * 100)
  const tierCfg = PARTNER_TIERS[profile.tier as keyof typeof PARTNER_TIERS]
  const maxClients = tierCfg?.maxClients
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.zidlink.app'

  return (
    <div className="space-y-8" dir={dir}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-foreground">
            {lang === 'ar' ? 'لوحة الشريك' : 'Partner Dashboard'}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {lang === 'ar' ? `مرحباً، ${profile.display_name}` : `Welcome, ${profile.display_name}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground bg-secondary px-3 py-1 rounded-full font-medium">
            {tierLabel(profile.tier, lang)} · {commissionPercent}%
          </span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-border bg-card shadow-sm p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'العملاء' : 'Clients'}
            </span>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-black text-foreground">{stats?.clientCount ?? 0}</p>
          {maxClients !== null && (
            <p className="text-[10px] text-muted-foreground">
              {lang === 'ar' ? `الحد الأقصى: ${maxClients}` : `Max: ${maxClients}`}
            </p>
          )}
          {stats && stats.pendingClientCount > 0 && (
            <p className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {lang === 'ar'
                ? `${stats.pendingClientCount} في انتظار التفعيل`
                : `${stats.pendingClientCount} pending activation`}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'إجمالي العمولات' : 'Total Commissions'}
            </span>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-black text-foreground">
            ${(stats?.totalCommissions ?? 0).toLocaleString()}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {lang === 'ar' ? 'جميع العمولات المسجلة' : 'All recorded commissions'}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'المدفوع' : 'Paid Out'}
            </span>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-black text-foreground">
            ${(stats?.totalPaid ?? 0).toLocaleString()}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {lang === 'ar' ? 'إجمالي المبالغ المصروفة' : 'Total payouts received'}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'المستحقات' : 'Pending Payout'}
            </span>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-black text-foreground">{stats?.pendingPayouts ?? 0}</p>
          <p className="text-[10px] text-muted-foreground">
            {lang === 'ar' ? 'طلبات صرف قيد المراجعة' : 'Payout requests under review'}
          </p>
        </div>
      </div>

      {/* Quick Actions + Invite Link */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Invite a new client */}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-base font-bold text-foreground">
              {lang === 'ar' ? 'دعوة عميل جديد' : 'Invite a New Client'}
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            {lang === 'ar'
              ? 'أدخل اسم وعنوان البريد الإلكتروني للعميل لإرسال دعوة تفعيل. الرابط سيكون صالحًا لاستخدام واحد فقط.'
              : 'Enter the name and email of your client to send an activation invitation. The link is valid for one-time use.'}
          </p>
          <InviteClientButton partnerId={params.partnerId} lang={lang} />
        </div>

        {/* Quick Stats */}
        <div className="rounded-2xl border border-border bg-card shadow-sm p-6 space-y-4">
          <h2 className="text-base font-bold text-foreground">
            {lang === 'ar' ? 'معلومات الشريك' : 'Partner Info'}
          </h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Handshake className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground font-medium">
                  {lang === 'ar' ? 'الاسم المعروض' : 'Display Name'}
                </p>
                <p className="text-sm font-bold truncate">{profile.display_name}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Percent className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground font-medium">
                  {lang === 'ar' ? 'نسبة العمولة' : 'Commission Rate'}
                </p>
                <p className="text-sm font-bold">{commissionPercent}%</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground font-medium">ID</p>
                <p className="text-sm font-mono text-muted-foreground break-all">{profile.id}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Clients Section */}
      <div className="rounded-2xl border border-border bg-card shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-foreground">
            {lang === 'ar' ? 'آخر العملاء' : 'Recent Clients'}
          </h2>
          <a
            href={`/partner/${params.partnerId}/clients`}
            className="text-xs text-primary font-bold hover:underline"
          >
            {lang === 'ar' ? 'عرض الكل' : 'View all'} →
          </a>
        </div>
        <ClientInvitationCard partnerId={params.partnerId} lang={lang} />
      </div>
    </div>
  )
}
