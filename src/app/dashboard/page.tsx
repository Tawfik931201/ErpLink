import { getActiveWorkspaceZidToken } from '@/app/actions/workspaces'
import { getActiveWorkspaceOdooConnection } from '@/app/actions/odoo'
import { getFieldMappings } from '@/app/actions/field-mappings'
import {
  Store,
  Database,
  GitCompare,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Zap,
  ArrowLeft,
  TrendingUp,
} from 'lucide-react'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { Button } from '@/components/ui/button'
import { Language, translations } from '@/lib/translations'
import { cn } from '@/lib/utils'

export default async function DashboardHome() {
  const zidTokenRes = await getActiveWorkspaceZidToken()
  const odooConnRes = await getActiveWorkspaceOdooConnection()
  const mappingsRes = await getFieldMappings()

  const isZidConnected = !!zidTokenRes.success && !!zidTokenRes.token
  const isOdooConnected = !!odooConnRes.success && !!odooConnRes.connection
  const mappingsCount = mappingsRes.success ? mappingsRes.mappings?.length ?? 0 : 0
  const zidMerchantName = isZidConnected ? zidTokenRes.token.name : null
  const odooConnectionName = isOdooConnected ? odooConnRes.connection.connection_name : null

  const isAllConnected = isZidConnected && isOdooConnected

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) => translations[lang][key] || translations['ar'][key]

  const kpis = [
    {
      label: t('db.storeZid'),
      value: isZidConnected ? t('db.connected') : t('db.disconnected'),
      sub: isZidConnected ? `${t('db.storeZid')}: ${zidMerchantName}` : t('db.pressToConnectZid'),
      icon: Store,
      connected: isZidConnected,
      href: '/dashboard/connect-zid',
      accent: 'blue',
    },
    {
      label: t('db.storeOdoo'),
      value: isOdooConnected ? t('db.connected') : t('db.disconnected'),
      sub: isOdooConnected ? `${t('db.storeOdoo')}: ${odooConnectionName}` : t('db.pressToConnectOdoo'),
      icon: Database,
      connected: isOdooConnected,
      href: '/dashboard/connect-odoo',
      accent: 'violet',
    },
    {
      label: t('nav.fieldMapping'),
      value: String(mappingsCount),
      sub: t('db.activeMappings'),
      icon: GitCompare,
      connected: mappingsCount > 0,
      href: '/dashboard/field-mapping',
      accent: 'emerald',
    },
    {
      label: t('db.instantSync'),
      value: isAllConnected ? t('db.autoSync') : t('db.stoppedSync'),
      sub: isAllConnected ? t('db.flowSyncing') : t('db.incompleteIntegration'),
      icon: Activity,
      connected: isAllConnected,
      href: '#',
      accent: 'blue',
    },
  ]

  const accentMap = {
    blue:    { bg: 'bg-kpi-blue-bg',    text: 'text-kpi-blue-text',    bar: 'from-blue-500 to-blue-400' },
    violet:  { bg: 'bg-kpi-violet-bg',  text: 'text-kpi-violet-text',  bar: 'from-violet-500 to-violet-400' },
    emerald: { bg: 'bg-kpi-emerald-bg', text: 'text-kpi-emerald-text', bar: 'from-emerald-500 to-emerald-400' },
  }

  const steps = [
    {
      num: lang === 'ar' ? '١' : '1',
      title: t('db.step1'),
      desc: t('db.step1Desc'),
      done: isZidConnected,
      href: '/dashboard/connect-zid',
    },
    {
      num: lang === 'ar' ? '٢' : '2',
      title: t('db.step2'),
      desc: t('db.step2Desc'),
      done: isOdooConnected,
      href: '/dashboard/connect-odoo',
    },
    {
      num: lang === 'ar' ? '٣' : '3',
      title: t('db.step3'),
      desc: t('db.step3Desc'),
      done: mappingsCount > 0,
      href: '/dashboard/field-mapping',
    },
  ]

  return (
    <div className="space-y-8 animate-fade-in" dir={dir}>

      {/* ── Page Header ──────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold text-primary uppercase tracking-wider">{t('db.monitoringPanel')}</span>
          </div>
          <h1 className="text-3xl font-black text-foreground tracking-tight">
            {t('db.welcome')}
          </h1>
          <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed max-w-lg">
            {t('db.subtitle')}
          </p>
        </div>

        {!isAllConnected && (
          <div className="flex items-center gap-2 text-xs font-semibold bg-warning/15 text-warning border border-warning/20 px-4 py-2.5 rounded-2xl shrink-0">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{t('db.completeSteps')}</span>
          </div>
        )}
      </div>

      {/* ── KPI Cards ────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(({ label, value, sub, icon: Icon, connected, href, accent }) => {
          const a = accentMap[accent as keyof typeof accentMap] ?? accentMap.blue
          return (
            <Link
              key={label}
              href={href}
              className="group relative bg-card rounded-2xl border border-border p-5 shadow-card card-hover overflow-hidden block"
            >
              {/* Gradient top bar */}
              <div className={`absolute top-0 right-0 h-[3px] w-full bg-gradient-to-l ${a.bar} opacity-60`} />

              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{label}</span>
                <div className={`p-2 rounded-xl ${a.bg} ${a.text}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>

              <div className="text-2xl font-black text-foreground mb-1">{value}</div>
              <p className="text-xs text-muted-foreground truncate">{sub}</p>

              {/* Status dot */}
              <div className={cn("absolute bottom-4 h-2 w-2 rounded-full", connected ? 'bg-emerald-400 animate-pulse' : 'bg-border', lang === 'ar' ? 'left-4' : 'right-4')} />
            </Link>
          )
        })}
      </div>

      {/* ── Live Connection Visualization ────────────────────── */}
      <div className="bg-card rounded-2xl border border-border shadow-card overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold text-foreground">{t('db.liveSyncStatus')}</h2>
          {isAllConnected && (
            <span className="badge-success flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
              {t('db.activeSync')}
            </span>
          )}
        </div>

        <div className="flex flex-col md:flex-row items-center justify-around gap-8 px-8 py-10 relative">
          {/* Zid Node */}
          <div className="flex flex-col items-center text-center gap-3 z-10">
            <div className={`h-20 w-20 rounded-2xl flex items-center justify-center border-2 shadow-card transition-all duration-300 ${
              isZidConnected
                ? 'bg-kpi-blue-bg border-border text-kpi-blue-text'
                : 'bg-muted border-border text-muted-foreground'
            }`}>
              <Store className="h-9 w-9" />
            </div>
            <div>
              <p className="font-bold text-foreground text-sm">{t('db.storeZid')}</p>
              {isZidConnected ? (
                <span className="badge-success mt-1 inline-block">
                  <CheckCircle2 className={cn("h-3 w-3 inline", lang === 'ar' ? "ml-1" : "mr-1")} />
                  {zidMerchantName}
                </span>
              ) : (
                <Button asChild variant="outline" size="sm" className="mt-2 text-xs border-border hover:bg-secondary text-primary rounded-xl">
                  <Link href="/dashboard/connect-zid">{t('nav.connectZid')}</Link>
                </Button>
              )}
            </div>
          </div>

          {/* Center sync indicator */}
          <div className="flex-1 flex flex-col items-center gap-3 z-10 min-w-[140px] relative">
            {isAllConnected ? (
              <div className="gradient-brand text-white px-6 py-2.5 rounded-2xl flex items-center gap-2 text-sm font-bold shadow-primary animate-pulse-ring">
                <Zap className="h-4 w-4" />
                {t('db.instantSync')}
              </div>
            ) : (
              <div className="bg-muted border border-border text-muted-foreground px-6 py-2.5 rounded-2xl flex items-center gap-2 text-sm font-semibold">
                <span>{t('db.inactiveSync')}</span>
              </div>
            )}
            {isAllConnected && (
              <div className="flex gap-1.5">
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Odoo Node */}
          <div className="flex flex-col items-center text-center gap-3 z-10">
            <div className={`h-20 w-20 rounded-2xl flex items-center justify-center border-2 shadow-card transition-all duration-300 ${
              isOdooConnected
                ? 'bg-kpi-violet-bg border-border text-kpi-violet-text'
                : 'bg-muted border-border text-muted-foreground'
            }`}>
              <Database className="h-9 w-9" />
            </div>
            <div>
              <p className="font-bold text-foreground text-sm">{t('db.storeOdoo')}</p>
              {isOdooConnected ? (
                <span className="badge-success mt-1 inline-block">
                  <CheckCircle2 className={cn("h-3 w-3 inline", lang === 'ar' ? "ml-1" : "mr-1")} />
                  {odooConnectionName}
                </span>
              ) : (
                <Button asChild variant="outline" size="sm" className="mt-2 text-xs border-border hover:bg-secondary text-primary rounded-xl">
                  <Link href="/dashboard/connect-odoo">{t('db.pressToConnectOdoo')}</Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Setup Steps ──────────────────────────────────────── */}
      <div className="bg-card rounded-2xl border border-border shadow-card">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold text-foreground">{t('db.setupSteps')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('db.setupSubtitle')}</p>
        </div>
        <div className="grid gap-0 md:grid-cols-3">
          {steps.map(({ num, title, desc, done, href }, i) => (
            <Link
              key={title}
              href={href}
              className={cn(
                "group flex flex-col gap-3 p-6 transition-colors hover:bg-secondary/40",
                i < steps.length - 1 ? (lang === 'ar' ? 'md:border-l' : 'md:border-r') + ' border-border border-b md:border-b-0' : ''
              )}
            >
              <div className="flex items-center gap-3">
                <span className={`flex h-8 w-8 items-center justify-center rounded-xl text-sm font-black shrink-0 transition-colors ${
                  done
                    ? 'bg-success/20 text-success'
                    : 'bg-primary/20 text-primary group-hover:bg-primary group-hover:text-white'
                }`}>
                  {done ? <CheckCircle2 className="h-4 w-4" /> : num}
                </span>
                <h3 className="font-bold text-foreground text-sm">{title}</h3>
              </div>
              <p className={cn("text-xs text-muted-foreground leading-relaxed", lang === 'ar' ? "pr-11" : "pl-11")}>{desc}</p>
              {!done && (
                <div className={cn("flex items-center gap-1 text-xs font-semibold text-primary", lang === 'ar' ? "pr-11" : "pl-11")}>
                  <span>{t('db.startNow')}</span>
                  <ArrowLeft className={cn("h-3 w-3 transition-transform", lang === 'ar' ? "group-hover:-translate-x-0.5" : "group-hover:translate-x-0.5 rotate-180")} />
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>

    </div>
  )
}
