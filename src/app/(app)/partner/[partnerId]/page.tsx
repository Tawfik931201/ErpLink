import {
  Users,
  TrendingUp,
  Wallet,
  CreditCard,
  Clock,
  UserPlus,
  Percent,
  Crown,
  ArrowLeft,
  CheckCircle2,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getMyEligibleBalance, getPartnerStats } from '@/app/actions/partner-actions'
import AffiliateRecentClients from '@/components/partner/AffiliateRecentClients'
import RegisterClientForm from '@/components/partner/RegisterClientForm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { getActiveUserId } from '@/lib/auth'
import { PARTNER_TIERS, type PartnerTier, tierLabel } from '@/lib/partner-tiers'
import { supabase } from '@/lib/supabase'
import type { Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

const TIER_ORDER: PartnerTier[] = ['starter', 'growth', 'gold']

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
  const isAr = lang === 'ar'

  // Verify partner profile ownership
  const { data: profile } = await supabase
    .from('partner_profiles')
    .select('id, user_id, display_name, tier, commission_rate, status')
    .eq('id', params.partnerId)
    .single()

  if (!profile || profile.user_id !== userId) redirect('/dashboard')

  // Get stats + eligible balance in parallel
  const [{ stats }, { eligibleBalance }] = await Promise.all([
    getPartnerStats(params.partnerId),
    getMyEligibleBalance(params.partnerId),
  ])

  const commissionPercent = Math.round(Number(profile.commission_rate) * 100)
  const tierKey = (profile.tier in PARTNER_TIERS ? profile.tier : 'starter') as PartnerTier
  const tierCfg = PARTNER_TIERS[tierKey]
  const maxClients = tierCfg.maxClients
  const clientCount = stats?.clientCount ?? 0
  const clientsPct = maxClients ? Math.min(100, Math.round((clientCount / maxClients) * 100)) : 100
  const nextTier = TIER_ORDER[TIER_ORDER.indexOf(tierKey) + 1]

  const fmt = (n: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const kpiCards = [
    {
      label: isAr ? 'العملاء' : 'Clients',
      value: String(clientCount),
      sub:
        maxClients !== null
          ? isAr ? `الحد الأقصى: ${maxClients}` : `Max: ${maxClients}`
          : isAr ? 'بدون حد أقصى' : 'Unlimited',
      warn:
        (stats?.pendingClientCount ?? 0) > 0
          ? isAr
            ? `${stats?.pendingClientCount} بدون اشتراك نشط`
            : `${stats?.pendingClientCount} without active subscription`
          : null,
      icon: Users,
      accent: 'text-blue-500 bg-blue-500/10',
      bar: 'bg-blue-500',
    },
    {
      label: isAr ? 'إجمالي العمولات' : 'Total Commissions',
      value: fmt(stats?.totalCommissions ?? 0),
      sub: isAr ? 'جميع العمولات المعتمدة' : 'All approved commissions',
      warn: null,
      icon: TrendingUp,
      accent: 'text-emerald-500 bg-emerald-500/10',
      bar: 'bg-emerald-500',
    },
    {
      label: isAr ? 'المتاح للسحب' : 'Available Balance',
      value: fmt(eligibleBalance),
      sub:
        (stats?.pendingPayouts ?? 0) > 0
          ? isAr ? `بعد خصم ${fmt(stats?.pendingPayouts ?? 0)} قيد المراجعة` : `after ${fmt(stats?.pendingPayouts ?? 0)} under review`
          : isAr ? 'جاهز للصرف الآن' : 'Ready to withdraw now',
      warn: null,
      icon: Wallet,
      accent: 'text-violet-500 bg-violet-500/10',
      bar: 'bg-violet-500',
      cta: true,
    },
    {
      label: isAr ? 'المدفوع' : 'Paid Out',
      value: fmt(stats?.totalPaid ?? 0),
      sub: isAr ? 'إجمالي المبالغ المصروفة لك' : 'Total payouts received',
      warn: null,
      icon: CreditCard,
      accent: 'text-amber-500 bg-amber-500/10',
      bar: 'bg-amber-500',
    },
  ]

  return (
    <div className="space-y-6" dir={dir}>
      {/* ── Page Header ──────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-6 w-1 rounded-full bg-foreground" />
            <h1 className="text-2xl font-bold tracking-tight">
              {isAr ? 'لوحة الأفلييت' : 'Affiliate Dashboard'}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-lg">
            {isAr ? `مرحباً، ${profile.display_name} 👋` : `Welcome back, ${profile.display_name} 👋`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="info" className="text-[11px] px-3 py-1">
            <Crown className="h-3 w-3" />
            {tierLabel(tierKey, lang)}
          </Badge>
          <Badge variant="success" className="text-[11px] px-3 py-1">
            <Percent className="h-3 w-3" />
            {commissionPercent}%
          </Badge>
        </div>
      </div>

      {/* ── Row 1: KPI Cards ─────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map(({ label, value, sub, warn, icon: Icon, accent, bar, cta }) => (
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
            {warn && (
              <p className="mt-1.5 text-[11px] font-medium text-amber-600 flex items-center gap-1">
                <Clock className="h-3 w-3 shrink-0" />
                <span className="truncate">{warn}</span>
              </p>
            )}
            {cta && (
              <div className="mt-3 pt-3 border-t border-border">
                {eligibleBalance > 0 ? (
                  <Button asChild size="sm" className="w-full rounded-xl font-bold">
                    <Link href={`/partner/${params.partnerId}/payouts/new`}>
                      <Wallet className="h-3.5 w-3.5" />
                      {isAr ? 'طلب صرف' : 'Request Payout'}
                    </Link>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled
                    className="w-full rounded-xl font-bold cursor-not-allowed"
                  >
                    <Wallet className="h-3.5 w-3.5" />
                    {isAr ? 'لا يوجد رصيد متاح' : 'No balance yet'}
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Row 2: Register Client + Tier Progress ───────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Register a new client workspace */}
        <div className="lg:col-span-2 bg-card border p-5">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-2 w-2 rounded-full bg-blue-500" />
            <h3 className="text-sm font-bold">{isAr ? 'تسجيل عميل جديد' : 'Register a New Client'}</h3>
          </div>
          <p className="text-[11px] text-muted-foreground mb-4">
            {isAr
              ? 'أدخل البريد الإلكتروني للعميل واسم مساحة العمل ليتم تسجيلها وإسنادها إليك مباشرة.'
              : 'Enter the client email and workspace name to register it and attribute it to you directly.'}
          </p>
          <RegisterClientForm lang={lang} />
        </div>

        {/* Tier progress + affiliate info */}
        <div className="bg-card border p-5">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-2 w-2 rounded-full bg-violet-500" />
            <h3 className="text-sm font-bold">{isAr ? 'طبقتك' : 'Your Tier'}</h3>
          </div>
          <div className="mt-3 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Crown className="h-3.5 w-3.5 text-violet-500" />
                {tierLabel(tierKey, lang)}
              </span>
              <span className="font-mono text-sm font-bold text-violet-600">{commissionPercent}%</span>
            </div>

            {maxClients !== null ? (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {isAr ? 'عدد العملاء' : 'Clients used'}
                    </span>
                    <span className="font-mono font-semibold">
                      {clientCount}/{maxClients}
                    </span>
                  </div>
                  <Progress value={clientsPct} className="h-2" />
                </div>
                {nextTier && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    {clientCount >= maxClients
                      ? isAr
                        ? `وصلت للحد الأقصى — تواصل مع الإدارة للترقية إلى ${tierLabel(nextTier, lang)}`
                        : `You reached the cap — contact admin to upgrade to ${tierLabel(nextTier, lang)}`
                      : isAr
                        ? `${maxClients - clientCount} عميل متبقي للترقية إلى ${tierLabel(nextTier, lang)} (${PARTNER_TIERS[nextTier].commissionRate * 100}%)`
                        : `${maxClients - clientCount} clients left to reach ${tierLabel(nextTier, lang)} (${PARTNER_TIERS[nextTier].commissionRate * 100}%)`}
                  </p>
                )}
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {isAr ? 'عدد غير محدود من العملاء — أعلى طبقة متاحة.' : 'Unlimited clients — top tier reached.'}
              </p>
            )}

            <div className="pt-3 border-t border-border">
              <p className="text-[10px] text-muted-foreground font-medium mb-1.5">
                {isAr ? 'روابط سريعة' : 'Quick links'}
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Link
                  href={`/partner/${params.partnerId}/clients`}
                  className="flex flex-col items-center gap-1 rounded-lg border border-border bg-secondary/40 px-2 py-2.5 text-[10px] font-semibold text-foreground hover:bg-secondary transition-colors"
                >
                  <Users className="h-4 w-4 text-blue-500" />
                  {isAr ? 'العملاء' : 'Clients'}
                </Link>
                <Link
                  href={`/partner/${params.partnerId}/commissions`}
                  className="flex flex-col items-center gap-1 rounded-lg border border-border bg-secondary/40 px-2 py-2.5 text-[10px] font-semibold text-foreground hover:bg-secondary transition-colors"
                >
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  {isAr ? 'العمولات' : 'Commissions'}
                </Link>
                <Link
                  href={`/partner/${params.partnerId}/payouts`}
                  className="flex flex-col items-center gap-1 rounded-lg border border-border bg-secondary/40 px-2 py-2.5 text-[10px] font-semibold text-foreground hover:bg-secondary transition-colors"
                >
                  <CreditCard className="h-4 w-4 text-amber-500" />
                  {isAr ? 'المستحقات' : 'Payouts'}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 3: Recent Clients ────────────────────────────── */}
      <div className="bg-card border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <h3 className="text-sm font-bold">{isAr ? 'آخر العملاء' : 'Recent Clients'}</h3>
            <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <Link
            href={`/partner/${params.partnerId}/clients`}
            className="text-[11px] font-semibold text-foreground hover:text-muted-foreground transition-colors flex items-center gap-1"
          >
            {isAr ? 'عرض الكل' : 'View all'}
            <ArrowLeft className={cn('h-3 w-3', dir === 'rtl' ? '' : 'rotate-180')} />
          </Link>
        </div>
        <div className="p-5">
          <AffiliateRecentClients partnerId={params.partnerId} lang={lang} />
        </div>
      </div>
    </div>
  )
}
