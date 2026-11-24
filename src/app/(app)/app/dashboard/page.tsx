import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Database,
  GitCompare,
  ListChecks,
  RefreshCw,
  Send,
  Store,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { getDailyActivity, getDashboardStats, getRecentLogs, getRecentTransfers } from '@/app/actions/dashboard'
import { getActiveWorkspaceErpConnection } from '@/app/actions/odoo'
import { getActiveWorkspaceZidTokens, getActiveWorkspaceSallaTokens, getActiveWorkspaceShopifyTokens } from '@/app/actions/workspaces'
import SubscriptionStatusCard from '@/components/subscription/SubscriptionStatusCard'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { resolveLanguage } from '@/lib/translations'
import { cn } from '@/lib/utils'

import { SyncAreaChart } from './dashboard-client'

function timeAgo(dateStr: string | null, isAr: boolean): string {
  if (!dateStr) return isAr ? 'لم تتم بعد' : 'Not yet'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (mins < 1) return isAr ? 'قبل لحظات' : 'moments ago'
  if (mins < 60) return isAr ? `قبل ${mins} دقيقة` : `${mins}m ago`
  if (hrs < 24) return isAr ? `قبل ${hrs} ساعة` : `${hrs}h ago`
  return isAr ? `قبل ${days} يوم` : `${days}d ago`
}

/** Client-facing wording instead of raw webhook slugs (`order.created`). */
function friendlyEvent(event: string, isAr: boolean): string {
  const e = (event || '').toLowerCase()
  const entity = e.includes('order')
    ? isAr ? 'طلب' : 'Order'
    : e.includes('categor')
      ? isAr ? 'تصنيف' : 'Category'
      : e.includes('product')
        ? isAr ? 'منتج' : 'Product'
        : e.includes('customer')
          ? isAr ? 'عميل' : 'Customer'
          : e.includes('stock') || e.includes('inventory') || e.includes('quant')
            ? isAr ? 'مخزون' : 'Stock'
            : e.includes('invoice')
              ? isAr ? 'فاتورة' : 'Invoice'
              : ''

  if (!entity) return event

  const op = e.includes('delete') || e.includes('cancel') || e.includes('uninstall')
    ? isAr ? 'محذوف' : 'deleted'
    : e.includes('create') || e.includes('add')
      ? isAr ? 'جديد' : 'created'
      : isAr ? 'محدّث' : 'updated'

  return `${entity} ${op}`
}

function statusTone(status: string): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'destructive'
  if (status === 'running' || status === 'processing') return 'warning'
  return 'secondary'
}

function statusLabel(status: string, isAr: boolean): string {
  switch (status) {
    case 'success':
      return isAr ? 'ناجح' : 'Success'
    case 'failed':
      return isAr ? 'فشل' : 'Failed'
    case 'skipped':
      return isAr ? 'تم التخطي' : 'Skipped'
    case 'processing':
    case 'running':
      return isAr ? 'قيد التنفيذ' : 'Running'
    case 'pending':
      return isAr ? 'بالانتظار' : 'Pending'
    default:
      return status
  }
}

export default async function DashboardPage() {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const isAr = lang === 'ar'
  const dir = isAr ? 'rtl' : 'ltr'

  const [
    statsRes,
    activityRes,
    logsRes,
    transfersRes,
    zidTokenRes,
    sallaTokenRes,
    shopifyTokenRes,
    odooConnRes,
  ] = await Promise.all([
    getDashboardStats(),
    getDailyActivity(7),
    getRecentLogs(8),
    getRecentTransfers(3),
    getActiveWorkspaceZidTokens(),
    getActiveWorkspaceSallaTokens(),
    getActiveWorkspaceShopifyTokens(),
    getActiveWorkspaceErpConnection(),
  ])

  const stats = statsRes.success && statsRes.stats ? statsRes.stats : null
  const activity = activityRes.success && activityRes.activity ? activityRes.activity : []
  const recentLogs = logsRes.success && logsRes.logs ? logsRes.logs : []
  const recentTransfers = transfersRes.success && transfersRes.transfers ? transfersRes.transfers : []

  const isZidConnected = !!zidTokenRes.success && (zidTokenRes.tokens?.length ?? 0) > 0
  const isSallaConnected = !!sallaTokenRes.success && (sallaTokenRes.tokens?.length ?? 0) > 0
  const isShopifyConnected = !!shopifyTokenRes.success && (shopifyTokenRes.tokens?.length ?? 0) > 0
  const isOdooConnected = !!odooConnRes.success && !!odooConnRes.connection
  const storeConnected = isZidConnected || isSallaConnected || isShopifyConnected
  const hasMappings = (stats?.activeMappings ?? 0) > 0
  const setupReady = storeConnected && isOdooConnected && hasMappings

  const connectedStores = [
    isZidConnected && 'Zid',
    isSallaConnected && 'Salla',
    isShopifyConnected && 'Shopify',
  ].filter(Boolean) as string[]

  const failedLogs = recentLogs.filter((log) => log.status === 'failed')
  const weekSuccess = activity.reduce((sum, day) => sum + day.success, 0)
  const weekFailed = activity.reduce((sum, day) => sum + day.failed, 0)

  const setupSteps = [
    {
      label: isAr ? 'ربط متجرك' : 'Connect your store',
      done: storeConnected,
      href: '/app/connect-store',
    },
    {
      label: isAr ? 'ربط نظام ERP' : 'Connect your ERP',
      done: isOdooConnected,
      href: '/app/connect-odoo',
    },
    {
      label: isAr ? 'تفعيل قواعد الربط' : 'Activate mapping rules',
      done: hasMappings,
      href: '/app/mapping-center',
    },
  ]
  const doneSteps = setupSteps.filter((step) => step.done).length

  const kpis = [
    {
      label: isAr ? 'مزامنات ناجحة (٧٢ ساعة)' : 'Successful syncs (72h)',
      value: stats ? String(stats.successfulSyncs) : '—',
      sub: timeAgo(stats?.lastSyncAt ?? null, isAr),
      icon: CheckCircle2,
      tone: 'text-primary bg-primary/10',
    },
    {
      label: isAr ? 'تحتاج مراجعة (٧ أيام)' : 'Needs review (7 days)',
      value: stats ? String(stats.failedSyncs) : '—',
      sub: isAr ? 'راجع سجل المزامنة' : 'Check the sync log',
      icon: AlertTriangle,
      tone: (stats?.failedSyncs ?? 0) > 0 ? 'text-rose-600 bg-rose-500/10' : 'text-muted-foreground bg-muted',
    },
    {
      label: isAr ? 'عناصر مُنقلة (٧ أيام)' : 'Records transferred (7d)',
      value: stats ? String(stats.totalRecordsCreated) : '—',
      sub: isAr ? `${stats?.totalTransfers ?? 0} عملية ترحيل` : `${stats?.totalTransfers ?? 0} transfers`,
      icon: RefreshCw,
      tone: 'text-primary bg-primary/10',
    },
    {
      label: isAr ? 'قواعد ربط نشطة' : 'Active mapping rules',
      value: stats ? String(stats.activeMappings) : '—',
      sub:
        (stats?.telegramBotsCount ?? 0) > 0
          ? isAr ? 'إشعارات التيليجرام مفعّلة' : 'Telegram alerts on'
          : isAr ? 'إشعارات التيليجرام غير مفعّلة' : 'Telegram alerts off',
      icon: GitCompare,
      tone: 'text-primary bg-primary/10',
    },
  ]

  const latestTransfer = recentTransfers[0]

  return (
    <div className="space-y-5" dir={dir}>
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-6 w-1 rounded-full bg-primary" />
            <h1 className="text-2xl font-bold tracking-tight">
              {isAr ? 'لوحة التحكم' : 'Dashboard'}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {isAr
              ? 'كل ما يهمك عن متجرك ومزامنته، في مكان واحد.'
              : 'Everything that matters about your store and its sync, in one place.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {isAr ? 'آخر مزامنة: ' : 'Last sync: '}
            <span className="text-foreground">{timeAgo(stats?.lastSyncAt ?? null, isAr)}</span>
          </span>
          {!setupReady && (
            <Link
              href="/app/connect-store"
              className={cn(buttonVariants({ variant: 'brand' }), 'h-7 gap-1.5 rounded-lg px-3 text-[11px] font-bold')}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {isAr ? 'إكمال الإعداد' : 'Finish setup'}
            </Link>
          )}
        </div>
      </div>

      {/* ── Setup checklist (only until everything is connected) ─ */}
      {!setupReady && (
        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-bold">
                {isAr ? 'خطوات التشغيل' : 'Setup steps'}
              </h2>
            </div>
            <span className="text-[11px] font-semibold text-muted-foreground">
              {doneSteps}/{setupSteps.length}
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {setupSteps.map((step) => (
              <Link
                key={step.label}
                href={step.href}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors',
                  step.done
                    ? 'border-primary/30 bg-primary/[0.05] text-foreground'
                    : 'bg-muted/40 text-foreground hover:bg-muted'
                )}
              >
                <span>{step.label}</span>
                {step.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <ArrowLeft className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground', !isAr && 'rotate-180')} />
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Subscription ─────────────────────────────────────── */}
      <SubscriptionStatusCard />

      {/* ── Connection status strip ──────────────────────────── */}
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {[
          {
            icon: Store,
            label: isAr ? 'المتجر' : 'Store',
            value: connectedStores.length ? connectedStores.join(' · ') : isAr ? 'غير متصل' : 'Not connected',
            ok: storeConnected,
          },
          {
            icon: Database,
            label: isAr ? 'نظام ERP' : 'ERP',
            value: isOdooConnected
              ? (odooConnRes.connection as { erp_type?: string } | null)?.erp_type === 'erpnext'
                ? 'ERPNext'
                : 'Odoo'
              : isAr ? 'غير متصل' : 'Not connected',
            ok: isOdooConnected,
          },
          {
            icon: GitCompare,
            label: isAr ? 'قواعد الربط' : 'Mapping rules',
            value: hasMappings
              ? isAr ? `${stats?.activeMappings} قاعدة` : `${stats?.activeMappings} rules`
              : isAr ? 'غير مفعّلة' : 'Not active',
            ok: hasMappings,
          },
          {
            icon: Send,
            label: isAr ? 'إشعارات التيليجرام' : 'Telegram alerts',
            value: (stats?.telegramBotsCount ?? 0) > 0
              ? isAr ? 'مفعّلة' : 'On'
              : isAr ? 'غير مفعّلة' : 'Off',
            ok: (stats?.telegramBotsCount ?? 0) > 0,
          },
        ].map(({ icon: Icon, label, value, ok }) => (
          <div key={label} className="flex items-center gap-3 rounded-xl border bg-card px-3.5 sm:px-4 py-2.5 sm:py-3">
            <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', ok ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
              <p className={cn('truncate text-xs font-bold', ok ? 'text-foreground' : 'text-muted-foreground')}>{value}</p>
            </div>
            <span className={cn('ms-auto h-1.5 w-1.5 shrink-0 rounded-full', ok ? 'bg-primary' : 'bg-border')} />
          </div>
        ))}
      </div>

      {/* ── KPIs ─────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(({ label, value, sub, icon: Icon, tone }) => (
          <div key={label} className="rounded-xl border bg-card p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                {label}
              </span>
              <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', tone)}>
                <Icon className="h-4 w-4" />
              </span>
            </div>
            <div className="text-2xl font-bold tracking-tight">{value}</div>
            <p className="text-[11px] text-muted-foreground truncate">{sub}</p>
          </div>
        ))}
      </div>

      {/* ── Activity + transfers ─────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-4 sm:p-5 lg:col-span-2 min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="text-sm font-bold">
              {isAr ? 'نشاط المزامنة — آخر ٧ أيام' : 'Sync activity — last 7 days'}
            </h2>
            <div className="flex items-center gap-3 text-[11px] font-semibold">
              <span className="flex items-center gap-1.5 text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {weekSuccess.toLocaleString(isAr ? 'ar-EG' : 'en-US')} {isAr ? 'ناجح' : 'success'}
              </span>
              <span className="flex items-center gap-1.5 text-rose-600">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                {weekFailed.toLocaleString(isAr ? 'ar-EG' : 'en-US')} {isAr ? 'فشل' : 'failed'}
              </span>
            </div>
          </div>
          <SyncAreaChart data={activity} />
        </div>

        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold">{isAr ? 'ترحيل البيانات' : 'Data transfer'}</h2>
            <Link
              href="/app/initial-transfer"
              className="flex items-center gap-1 text-[11px] font-semibold text-primary transition-colors hover:text-primary/80"
            >
              {isAr ? 'فتح' : 'Open'}
              <ArrowLeft className={cn('h-3 w-3', !isAr && 'rotate-180')} />
            </Link>
          </div>

          {latestTransfer ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold truncate">{latestTransfer.name}</span>
                <Badge variant={statusTone(latestTransfer.status)} className="text-[10px] px-1.5 py-0 shrink-0">
                  {statusLabel(latestTransfer.status, isAr)}
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {latestTransfer.data_type} · {timeAgo(latestTransfer.created_at, isAr)}
              </p>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2">
                <span>
                  {latestTransfer.records_created.toLocaleString(isAr ? 'ar-EG' : 'en-US')} /{' '}
                  {latestTransfer.records_fetched.toLocaleString(isAr ? 'ar-EG' : 'en-US')}
                </span>
                <span className="font-semibold text-foreground">
                  {latestTransfer.records_fetched > 0
                    ? Math.round((latestTransfer.records_created / latestTransfer.records_fetched) * 100)
                    : 0}
                  %
                </span>
              </div>
              <Progress
                value={latestTransfer.records_fetched > 0 ? (latestTransfer.records_created / latestTransfer.records_fetched) * 100 : 0}
                className="h-1.5"
              />
              {(stats?.activeTransfers ?? 0) > 0 && (
                <p className="pt-3 text-[11px] font-semibold text-amber-600">
                  {isAr
                    ? `${stats?.activeTransfers} عملية قيد التنفيذ الآن`
                    : `${stats?.activeTransfers} transfer(s) running now`}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <RefreshCw className="h-7 w-7 text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">
                {isAr ? 'لم تقم بترحيل بيانات سابقة بعد' : 'No data transferred yet'}
              </p>
              <Link href="/app/initial-transfer" className="mt-3 text-[11px] font-bold text-primary underline underline-offset-2">
                {isAr ? 'ابدأ الترحيل' : 'Start transfer'}
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ── Recent operations + attention ────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border bg-card overflow-hidden lg:col-span-2 min-w-0">
          <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b">
            <h2 className="text-sm font-bold">{isAr ? 'آخر العمليات' : 'Recent operations'}</h2>
            <Link
              href="/app/logs"
              className="flex items-center gap-1 text-[11px] font-semibold text-primary transition-colors hover:text-primary/80"
            >
              {isAr ? 'كل السجلات' : 'All logs'}
              <ArrowLeft className={cn('h-3 w-3', !isAr && 'rotate-180')} />
            </Link>
          </div>

          {recentLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Activity className="h-9 w-9 text-muted-foreground/35 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">
                {isAr ? 'لا توجد عمليات بعد' : 'No operations yet'}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {isAr
                  ? 'ستظهر هنا أول مزامنة بمجرد وصول طلب جديد.'
                  : 'Your first sync will appear here once an order arrives.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {recentLogs.map((log) => (
                <li key={log.id} className="flex items-center gap-3 px-4 sm:px-5 py-3">
                  <span
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      log.status === 'success'
                        ? 'bg-primary'
                        : log.status === 'failed'
                          ? 'bg-rose-500'
                          : log.status === 'processing'
                            ? 'bg-amber-500'
                            : 'bg-border'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{friendlyEvent(log.event, isAr)}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {log.mapping_name || (isAr ? 'بدون قاعدة ربط' : 'No mapping rule')}
                      <span className="sm:hidden"> · {timeAgo(log.created_at, isAr)}</span>
                    </p>
                  </div>
                  <Badge variant={statusTone(log.status)} className="text-[10px] px-1.5 py-0 shrink-0">
                    {statusLabel(log.status, isAr)}
                  </Badge>
                  <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:block">
                    {timeAgo(log.created_at, isAr)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={cn('rounded-xl border p-4 sm:p-5', failedLogs.length > 0 ? 'border-rose-500/30 bg-rose-500/[0.03]' : 'bg-card')}>
          <div className="flex items-center gap-2 mb-4">
            {failedLogs.length > 0 ? (
              <AlertTriangle className="h-4 w-4 text-rose-600" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-primary" />
            )}
            <h2 className="text-sm font-bold">
              {failedLogs.length > 0
                ? isAr ? 'يحتاج انتباهك' : 'Needs your attention'
                : isAr ? 'كل شيء يعمل' : 'All good'}
            </h2>
          </div>

          {failedLogs.length > 0 ? (
            <div className="space-y-2">
              {failedLogs.slice(0, 3).map((log) => (
                <div key={log.id} className="rounded-lg border border-rose-500/20 bg-card px-3 py-2">
                  <p className="text-[11px] font-semibold">{friendlyEvent(log.event, isAr)}</p>
                  <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
                    {log.error_message || (isAr ? 'فشلت العملية بدون تفاصيل' : 'Failed without details')}
                  </p>
                  <p className="mt-1 text-[9px] text-muted-foreground">{timeAgo(log.created_at, isAr)}</p>
                </div>
              ))}
              <Link
                href="/app/logs"
                className="inline-flex items-center gap-1 pt-1 text-[11px] font-bold text-rose-600 hover:underline"
              >
                {isAr ? 'راجع كل الأخطاء' : 'Review all errors'}
                <ArrowLeft className={cn('h-3 w-3', !isAr && 'rotate-180')} />
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {isAr
                  ? 'لا توجد أخطاء في آخر العمليات. المزامنة تعمل بشكل طبيعي.'
                  : 'No errors in the latest operations. Syncing is running normally.'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {isAr ? 'آخر مزامنة: ' : 'Last sync: '}
                <span className="font-semibold text-foreground">{timeAgo(stats?.lastSyncAt ?? null, isAr)}</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
