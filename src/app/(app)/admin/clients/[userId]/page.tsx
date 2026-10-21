import {
  ArrowLeft,
  CalendarCheck,
  CircleDollarSign,
  Layers,
  User,
  Wallet,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import {
  getClientStatement,
} from '@/app/actions/subscription-actions'
import { getActiveUserId, isAdmin } from '@/lib/auth'
import { resolveLanguage } from '@/lib/translations'

import ClientStatementClient from './ClientStatementClient'

export const metadata = { title: 'Client Statement — Admin' }

export default async function AdminClientStatementPage(
  props: {
    params: Promise<{ userId: string }>
  }
) {
  const params = await props.params
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/app/dashboard')

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  const statementRes = await getClientStatement(params.userId)

  if (!statementRes.success || !statementRes.data) {
    return (
      <div className="max-w-6xl mx-auto p-10 text-center text-sm text-muted-foreground" dir={dir}>
        {lang === 'ar' ? 'العميل غير موجود' : 'Client not found'}
      </div>
    )
  }

  const { user, workspaces, subscriptions, payments, total_paid, total_months, active_sub_count } = statementRes.data

  const fmtMoney = (n: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return d
    }
  }

  const kpis = [
    {
      label: lang === 'ar' ? 'إجمالي المدفوع' : 'Total Paid',
      value: fmtMoney(total_paid),
      icon: Wallet,
      color: 'text-emerald-600',
    },
    {
      label: lang === 'ar' ? 'إجمالي الشهور' : 'Total Months',
      value: `${total_months}`,
      icon: CalendarCheck,
      color: 'text-foreground',
    },
    {
      label: lang === 'ar' ? 'اشتراكات نشطة' : 'Active Subs.',
      value: `${active_sub_count}`,
      icon: CircleDollarSign,
      color: 'text-primary',
    },
    {
      label: lang === 'ar' ? 'إجمالي الاشتراكات' : 'All Subs.',
      value: `${subscriptions.length}`,
      icon: Layers,
      color: 'text-muted-foreground',
    },
  ]

  return (
    <div className="max-w-6xl mx-auto space-y-4" dir={dir}>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[11px]">
        <Link
          href="/admin/clients"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground font-medium transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {lang === 'ar' ? 'العملاء' : 'Clients'}
        </Link>
        <span className="text-muted-foreground/30">/</span>
        <span className="text-foreground font-medium">{user.name || user.email}</span>
      </div>

      {/* Header */}
      <div className="border border-border bg-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <User className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-foreground">
                {user.name || (lang === 'ar' ? 'عميل بدون اسم' : 'Unnamed client')}
              </h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">{user.email}</p>
            </div>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {lang === 'ar' ? 'مسجل منذ' : 'Registered'}: {formatDate(user.created_at)}
          </span>
        </div>

        {workspaces.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {workspaces.map((ws) => (
              <span
                key={ws.id}
                className="inline-flex items-center gap-1.5 rounded border border-border bg-muted/30 px-2 py-1 text-[11px] text-foreground"
              >
                <Layers className="h-3 w-3 text-muted-foreground" />
                {ws.name}
                {ws.subscription_number && (
                  <span className="font-mono text-muted-foreground">{ws.subscription_number}</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((kpi) => {
          return (
            <div key={kpi.label} className="border border-border bg-card p-4 space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
              <p className={`text-xl font-bold font-mono tracking-tight ${kpi.color}`}>{kpi.value}</p>
            </div>
          )
        })}
      </div>

      <ClientStatementClient
        lang={lang}
        userId={user.id}
        clientEmail={user.email}
        workspaces={workspaces}
        subscriptions={subscriptions}
        payments={payments}
      />
    </div>
  )
}
