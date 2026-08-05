import {
  UserPlus,
  Link2,
  CalendarRange,
  CalendarClock,
  CalendarX,
  CircleDollarSign,
  Wallet,
  Users,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getPartnerClients } from '@/app/actions/partner-actions'
import RegisterClientForm from '@/components/partner/RegisterClientForm'
import { Badge } from '@/components/ui/badge'
import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import type { Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

export default async function PartnerClientsPage({
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

  // Verify ownership
  const { data: profile } = await supabase
    .from('partner_profiles')
    .select('id, user_id')
    .eq('id', params.partnerId)
    .single()

  if (!profile || profile.user_id !== userId) redirect('/dashboard')

  const { clients } = await getPartnerClients(params.partnerId)

  const activeCount = clients.filter((c) => c.subscription && !c.subscription.isExpired).length
  const endingSoonCount = clients.filter(
    (c) => c.subscription && !c.subscription.isExpired && c.subscription.daysRemaining <= 7,
  ).length
  const expiredCount = clients.filter((c) => c.subscription && c.subscription.isExpired).length
  const noSubCount = clients.filter((c) => !c.subscription).length

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString(isAr ? 'ar-SA' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return d
    }
  }

  const fmtMoney = (n: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const subBadge = (c: (typeof clients)[number]) => {
    if (!c.subscription) {
      return (
        <Badge variant="secondary" className="text-[10px] px-2 py-0">
          {isAr ? 'بلا اشتراك' : 'No subscription'}
        </Badge>
      )
    }
    if (c.subscription.isExpired) {
      return (
        <Badge variant="destructive" className="text-[10px] px-2 py-0">
          <XCircle className="h-3 w-3" />
          {isAr ? 'منتهٍ' : 'Expired'}
        </Badge>
      )
    }
    if (c.subscription.daysRemaining <= 7) {
      return (
        <Badge variant="warning" className="text-[10px] px-2 py-0">
          <AlertTriangle className="h-3 w-3" />
          {isAr ? `ينتهي بعد ${c.subscription.daysRemaining} يوم` : `Ends in ${c.subscription.daysRemaining}d`}
        </Badge>
      )
    }
    return (
      <Badge variant="success" className="text-[10px] px-2 py-0">
        <CheckCircle2 className="h-3 w-3" />
        {isAr ? 'نشط' : 'Active'}
      </Badge>
    )
  }

  const kpiCards = [
    {
      label: isAr ? 'إجمالي العملاء' : 'Total Clients',
      value: String(clients.length),
      sub: isAr ? 'مساحات عمل مسجلة' : 'registered workspaces',
      icon: Users,
      accent: 'text-blue-500 bg-blue-500/10',
      bar: 'bg-blue-500',
    },
    {
      label: isAr ? 'اشتراكات نشطة' : 'Active Subscriptions',
      value: String(activeCount),
      sub: isAr ? 'حالية وغير منتهية' : 'current & not expired',
      icon: CheckCircle2,
      accent: 'text-emerald-500 bg-emerald-500/10',
      bar: 'bg-emerald-500',
    },
    {
      label: isAr ? 'تنتهي قريباً' : 'Ending Soon',
      value: String(endingSoonCount),
      sub: isAr ? 'خلال 7 أيام أو أقل' : 'within 7 days or less',
      icon: AlertTriangle,
      accent: 'text-amber-500 bg-amber-500/10',
      bar: 'bg-amber-500',
    },
    {
      label: isAr ? 'بدون اشتراك' : 'Without Subscription',
      value: String(noSubCount),
      sub: isAr ? `منها ${expiredCount} منتهية` : `${expiredCount} of them expired`,
      icon: XCircle,
      accent: 'text-slate-500 bg-slate-500/10',
      bar: 'bg-slate-500',
    },
  ]

  return (
    <div className="space-y-6" dir={dir}>
      {/* ── Page Header ──────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-6 w-1 rounded-full bg-foreground" />
            <h1 className="text-2xl font-bold tracking-tight">{isAr ? 'العملاء' : 'Clients'}</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {isAr ? `إجمالي ${clients.length} عميل مسجل` : `${clients.length} registered client(s)`}
          </p>
        </div>
        <RegisterClientForm lang={lang} />
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

      {/* ── Info note ────────────────────────────────────────── */}
      <div className="flex items-start gap-3 border border-info/20 bg-info/5 p-4 rounded-xl">
        <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />
        <p className="text-[11px] text-foreground leading-relaxed">
          {isAr ? (
            <>
              المتاح للسحب بجانب كل عميل هو المستحق حتى الآن من عمولته، وقد يكون سُحب جزء منه مسبقاً.{' '}
              <Link
                href={`/partner/${params.partnerId}/commissions`}
                className="text-primary underline hover:text-primary/80 transition-colors font-medium"
              >
                راجع صفحة العمولات
              </Link>{' '}
              لمعرفة المبالغ المسحوبة والتفاصيل الكاملة
            </>
          ) : (
            <>
              The available amount next to each client is what has been earned so far from their
              commission, and part of it may have already been withdrawn.{' '}
              <Link
                href={`/partner/${params.partnerId}/commissions`}
                className="text-primary underline hover:text-primary/80 transition-colors font-medium"
              >
                check the commissions page
              </Link>{' '}
              for full withdrawal details
            </>
          )}
        </p>
      </div>

      {/* ── Clients table ────────────────────────────────────── */}
      {clients.length === 0 ? (
        <div className="bg-card border p-12 text-center">
          <UserPlus className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {isAr ? 'لم تسجل أي عميل بعد' : "You haven't registered any clients yet"}
          </p>
          <div className="mt-4 flex justify-center">
            <RegisterClientForm lang={lang} />
          </div>
        </div>
      ) : (
        <div className="bg-card border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-blue-500" />
              <h3 className="text-sm font-bold">{isAr ? 'قائمة العملاء' : 'Client List'}</h3>
            </div>
            <span className="text-[11px] text-muted-foreground">{clients.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground bg-muted/30">
                <tr>
                  <th className="px-5 py-3 text-start">{isAr ? 'مساحة العمل' : 'Workspace'}</th>
                  <th className="px-5 py-3 text-start">Email</th>
                  <th className="px-5 py-3 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                  <th className="px-5 py-3 text-start">{isAr ? 'مدة الاشتراك' : 'Duration'}</th>
                  <th className="px-5 py-3 text-start hidden md:table-cell">{isAr ? 'بداية الاشتراك' : 'Start Date'}</th>
                  <th className="px-5 py-3 text-start hidden lg:table-cell">{isAr ? 'نهاية الاشتراك' : 'End Date'}</th>
                  <th className="px-5 py-3 text-start">{isAr ? 'العمولة الكاملة' : 'Total Comm.'}</th>
                  <th className="px-5 py-3 text-start">{isAr ? 'المتاح للسحب' : 'Available'}</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.workspace_id} className="border-t border-border/40 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3 font-semibold">
                      <span className="flex items-center gap-1.5">
                        <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />
                        {c.workspace_name}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {c.email ?? c.client_name ?? '—'}
                    </td>
                    <td className="px-5 py-3">{subBadge(c)}</td>
                    <td className="px-5 py-3">
                      {c.subscription ? (
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <CalendarRange className="h-3 w-3" />
                          {c.subscription.months_paid} {isAr ? 'شهر' : 'months'}
                          {Number(c.subscription.amount_paid) > 0 && (
                            <span className="text-muted-foreground/70">
                              · {fmtMoney(Number(c.subscription.amount_paid))}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell">
                      {c.subscription ? (
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <CalendarClock className="h-3 w-3 shrink-0" />
                          {formatDate(c.subscription.start_date)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 hidden lg:table-cell">
                      {c.subscription ? (
                        <span
                          className={cn(
                            'text-[11px] flex items-center gap-1',
                            c.subscription.isExpired ? 'text-red-600 font-semibold' : 'text-muted-foreground',
                          )}
                        >
                          <CalendarX className="h-3 w-3 shrink-0" />
                          {formatDate(c.subscription.end_date)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-mono font-bold text-emerald-600 flex items-center gap-1">
                        <CircleDollarSign className="h-3.5 w-3.5 shrink-0" />
                        {fmtMoney(c.commission_total)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-mono font-bold text-blue-600 flex items-center gap-1">
                        <Wallet className="h-3.5 w-3.5 shrink-0" />
                        {fmtMoney(c.commission_released)}
                      </span>
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
