import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  Database,
  Store,
  GitCompare,
  Send,
  RefreshCw,
  ArrowLeft,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { getDashboardStats, getEventDistribution, getDailyActivity, getRecentLogs, getRecentTransfers } from '@/app/actions/dashboard'
import { getActiveWorkspaceErpConnection } from '@/app/actions/odoo'
import { getActiveWorkspaceZidToken, getActiveWorkspaceSallaToken, getActiveWorkspaceShopifyToken } from '@/app/actions/workspaces'
import SubscriptionStatusCard from '@/components/subscription/SubscriptionStatusCard'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { resolveLanguage, translations, type Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

import { SyncAreaChart, EventPieChart } from './dashboard-client'


function t(key: string, dict: Record<string, string>): string {
  return dict[key] || key
}

function timeAgo(dateStr: string | null, dict: Record<string, string>, _lang: string): string {
  if (!dateStr) return t('db.never', dict)
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (mins < 1) return t('db.momentsAgo', dict)
  if (mins < 60) return t('db.minutesAgo', dict).replace('{m}', String(mins))
  if (hrs < 24) return t('db.hoursAgo', dict).replace('{h}', String(hrs))
  return t('db.daysAgo', dict).replace('{d}', String(days))
}

function statusBadgeVariant(status: string): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (status === 'success' || status === 'completed') return 'success'
  if (status === 'failed') return 'destructive'
  if (status === 'running' || status === 'processing') return 'warning'
  return 'secondary'
}

function statusLabel(status: string, dict: Record<string, string>): string {
  const key = `db.transferStatus_${status}`
  return dict[key] || status
}

export default async function DashboardPage() {
  const cookieStore = cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const dict = translations[lang] as Record<string, string>

  const [
    statsRes,
    eventRes,
    activityRes,
    logsRes,
    transfersRes,
    zidTokenRes,
    sallaTokenRes,
    shopifyTokenRes,
    odooConnRes,
  ] = await Promise.all([
    getDashboardStats(),
    getEventDistribution(),
    getDailyActivity(7),
    getRecentLogs(10),
    getRecentTransfers(5),
    getActiveWorkspaceZidToken(),
    getActiveWorkspaceSallaToken(),
    getActiveWorkspaceShopifyToken(),
    getActiveWorkspaceErpConnection(),
  ])

  const stats = statsRes.success && statsRes.stats ? statsRes.stats : null
  const distribution = eventRes.success && eventRes.distribution ? eventRes.distribution : []
  const activity = activityRes.success && activityRes.activity ? activityRes.activity : []
  const recentLogs = logsRes.success && logsRes.logs ? logsRes.logs : []
  const recentTransfers = transfersRes.success && transfersRes.transfers ? transfersRes.transfers : []

  const isZidConnected = !!zidTokenRes.success && !!zidTokenRes.token
  const isSallaConnected = !!sallaTokenRes.success && !!sallaTokenRes.token
  const isShopifyConnected = !!shopifyTokenRes.success && !!shopifyTokenRes.token
  const isOdooConnected = !!odooConnRes.success && !!odooConnRes.connection
  const storeConnected = isZidConnected || isSallaConnected || isShopifyConnected

  const kpiCards = [
    {
      label: t('db.totalSyncs', dict),
      value: stats ? String(stats.totalSyncs) : '—',
      sub:
        stats && stats.totalSyncs > 0
          ? `${stats.successfulSyncs} ${t('db.connected', dict)} · ${stats.failedSyncs} ${t('db.failed', dict)}`
          : t('db.noData', dict),
      icon: Activity,
      accent: 'text-blue-500 bg-blue-500/10',
      bar: 'bg-blue-500',
      dot: 'bg-blue-500',
    },
    {
      label: t('db.successRate', dict),
      value: stats ? `${Math.round(stats.successRate)}%` : '—',
      sub:
        stats && stats.lastSyncAt
          ? `${t('db.lastSync', dict)}: ${timeAgo(stats.lastSyncAt, dict, lang)}`
          : t('db.noData', dict),
      icon: CheckCircle2,
      accent: 'text-emerald-500 bg-emerald-500/10',
      bar: 'bg-emerald-500',
      dot: 'bg-emerald-500',
    },
    {
      label: t('nav.initialTransfer', dict),
      value: stats ? String(stats.activeTransfers) : '—',
      sub:
        stats && stats.totalTransfers > 0
          ? `${stats.totalRecordsCreated} ${t('db.created', dict)} · ${stats.totalRecordsFailed} ${t('db.failed', dict)}`
          : t('db.noTransfers', dict),
      icon: RefreshCw,
      accent: 'text-violet-500 bg-violet-500/10',
      bar: 'bg-violet-500',
      dot: 'bg-violet-500',
    },
    {
      label: t('nav.fieldMapping', dict),
      value: stats ? String(stats.activeMappings) : '—',
      sub: stats ? `${stats.telegramBotsCount} ${t('db.telegramChats', dict)}` : t('db.noData', dict),
      icon: GitCompare,
      accent: 'text-amber-500 bg-amber-500/10',
      bar: 'bg-amber-500',
      dot: 'bg-amber-500',
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
              {t('db.welcome', dict)}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-lg">
            {t('db.subtitle', dict)}
          </p>
        </div>

        {(!storeConnected || !isOdooConnected) && (
          <Link
            href="/app/setup"
            className="flex items-center gap-2 text-xs font-semibold bg-muted text-foreground border px-4 py-2.5 rounded-lg shrink-0 hover:bg-muted/70 transition-colors"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{t('db.completeSteps', dict)}</span>
          </Link>
        )}
      </div>

      {/* ── Subscription status ─────────────────────────────── */}
      <SubscriptionStatusCard />

      {/* ── Row 1: KPI Cards ─────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map(({ label, value, sub, icon: Icon, accent, bar }) => (
          <div
            key={label}
            className="bg-card border p-5 relative overflow-hidden"
          >
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

      {/* ── Row 2: Charts ────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-card border p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-blue-500" />
              <h3 className="text-sm font-bold">{t('db.syncActivity', dict)}</h3>
            </div>
            <span className="text-[10px] text-muted-foreground">7 {lang === 'ar' ? 'أيام' : 'days'}</span>
          </div>
          <SyncAreaChart data={activity} />
        </div>

        <div className="bg-card border p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-emerald-500" />
              <h3 className="text-sm font-bold">{t('db.eventDistribution', dict)}</h3>
            </div>
            <span className="text-[10px] text-muted-foreground">{t('db.lastSync', dict)} 72h</span>
          </div>
          <EventPieChart data={distribution} />
        </div>
      </div>

      {/* ── Row 3: Integration Health + Recent Transfers ─────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-card border p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-violet-500" />
              <h3 className="text-sm font-bold">{t('db.integrationHealth', dict)}</h3>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={cn("p-1.5 rounded-lg", isZidConnected ? 'text-blue-500 bg-blue-500/10' : 'bg-muted text-muted-foreground')}>
                  <Store className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-semibold">Zid</span>
              </div>
              <div className="flex items-center gap-2">
                {isZidConnected ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-blue-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                    {t('db.connected', dict)}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-border" />
                    {t('db.storeNotConnected', dict)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={cn("p-1.5 rounded-lg", isSallaConnected ? 'text-emerald-500 bg-emerald-500/10' : 'bg-muted text-muted-foreground')}>
                  <Store className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-semibold">Salla</span>
              </div>
              <div className="flex items-center gap-2">
                {isSallaConnected ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-emerald-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {t('db.connected', dict)}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-border" />
                    {t('db.storeNotConnected', dict)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={cn("p-1.5 rounded-lg", isShopifyConnected ? 'text-violet-500 bg-violet-500/10' : 'bg-muted text-muted-foreground')}>
                  <Store className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-semibold">Shopify</span>
              </div>
              <div className="flex items-center gap-2">
                {isShopifyConnected ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-violet-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                    {t('db.connected', dict)}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-border" />
                    {t('db.storeNotConnected', dict)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={cn("p-1.5 rounded-lg", isOdooConnected ? 'text-amber-500 bg-amber-500/10' : 'bg-muted text-muted-foreground')}>
                  <Database className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-semibold">ERP</span>
              </div>
              <div className="flex items-center gap-2">
                {isOdooConnected ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-amber-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    {t('db.connected', dict)}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-border" />
                    {t('db.erpNotConnected', dict)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={cn("p-1.5 rounded-lg", (stats?.telegramBotsCount ?? 0) > 0 ? 'text-cyan-500 bg-cyan-500/10' : 'bg-muted text-muted-foreground')}>
                  <Send className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-semibold">{t('db.telegramStatus', dict)}</span>
              </div>
              <div className="flex items-center gap-2">
                {(stats?.telegramBotsCount ?? 0) > 0 ? (
                  <Badge variant="success" className="text-[10px] px-2 py-0">
                    {stats?.telegramBotsCount} {lang === 'ar' ? 'بوت' : 'chat'}{(stats?.telegramBotsCount ?? 0) > 1 ? 's' : ''}
                  </Badge>
                ) : (
                  <span className="text-xs font-medium text-muted-foreground">
                    {lang === 'ar' ? 'غير مفعل' : 'Inactive'}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={cn("p-1.5 rounded-lg", (stats?.activeMappings ?? 0) > 0 ? 'text-orange-500 bg-orange-500/10' : 'bg-muted text-muted-foreground')}>
                  <GitCompare className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-semibold">{t('db.mappings', dict)}</span>
              </div>
              <Badge variant={(stats?.activeMappings ?? 0) > 0 ? 'info' : 'secondary'} className="text-[10px] px-2 py-0">
                {stats?.activeMappings ?? 0}
              </Badge>
            </div>
          </div>
        </div>

        <div className="bg-card border p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-amber-500" />
              <h3 className="text-sm font-bold">{t('db.recentTransfers', dict)}</h3>
            </div>
            <Link
              href="/app/initial-transfer"
              className="text-[11px] font-semibold text-foreground hover:text-muted-foreground transition-colors flex items-center gap-1"
            >
              {t('db.viewAll', dict)}
              <ArrowLeft className={cn("h-3 w-3", dir === 'rtl' ? '' : 'rotate-180')} />
            </Link>
          </div>
          <div className="space-y-3">
            {recentTransfers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <RefreshCw className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">{t('db.noTransfers', dict)}</p>
              </div>
            ) : (
              recentTransfers.map((tr) => (
                <div key={tr.id} className="p-3 rounded-lg bg-muted border">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-semibold truncate">{tr.name}</span>
                      <Badge variant={statusBadgeVariant(tr.status)} className="text-[10px] px-1.5 py-0">
                        {statusLabel(tr.status, dict)}
                      </Badge>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {timeAgo(tr.created_at, dict, lang)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
                    <span>{tr.data_type}</span>
                    <span>
                      {tr.records_created}/{tr.records_fetched} {t('db.created', dict)}
                    </span>
                  </div>
                  <Progress
                    value={tr.records_fetched > 0 ? (tr.records_created / tr.records_fetched) * 100 : 0}
                    className="h-1.5"
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Row 4: Recent Logs Table ─────────────────────────── */}
      <div className="bg-card border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-cyan-500" />
            <h3 className="text-sm font-bold">{t('db.recentLogs', dict)}</h3>
            <span className="text-[10px] text-muted-foreground">{t('db.lastSync', dict)} 72h</span>
          </div>
          <Link
            href="/app/mapping-center"
            className="text-[11px] font-semibold text-foreground hover:text-muted-foreground transition-colors flex items-center gap-1"
          >
            {t('db.viewAll', dict)}
            <ArrowLeft className={cn("h-3 w-3", dir === 'rtl' ? '' : 'rotate-180')} />
          </Link>
        </div>

        {recentLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Activity className="h-10 w-10 text-muted-foreground/20 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">{t('db.noLogs', dict)}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">
                    {lang === 'ar' ? 'الحدث' : 'Event'}
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">
                    {lang === 'ar' ? 'الحالة' : 'Status'}
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground hidden md:table-cell">
                    {lang === 'ar' ? 'الربط' : 'Mapping'}
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground hidden sm:table-cell">
                    {lang === 'ar' ? 'الوقت' : 'Time'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-border/20 hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium">{log.event}</span>
                      {log.trigger_type === 'manual' && (
                        <span className="text-[9px] text-muted-foreground mr-1.5">
                          ({lang === 'ar' ? 'يدوي' : 'manual'})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusBadgeVariant(log.status)} className="text-[10px] px-2 py-0">
                        {log.status === 'success'
                          ? lang === 'ar' ? 'ناجح' : 'Success'
                          : log.status === 'failed'
                            ? lang === 'ar' ? 'فاشل' : 'Failed'
                            : log.status === 'skipped'
                              ? lang === 'ar' ? 'تم التخطي' : 'Skipped'
                              : log.status === 'processing'
                                ? lang === 'ar' ? 'قيد المعالجة' : 'Processing'
                                : log.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground max-w-[160px] truncate">
                      {log.mapping_name || '—'}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground whitespace-nowrap">
                      {timeAgo(log.created_at, dict, lang)}
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
