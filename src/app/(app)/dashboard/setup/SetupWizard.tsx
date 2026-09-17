'use client'

import {
  AlertCircle,
  Check,
  CheckCircle2,
  Database,
  ExternalLink,
  RefreshCw,
  Rocket,
  Store,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { translations } from '@/lib/translations'
import type { Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

const ZidLogo = () => (
  <svg className="h-4 w-4" viewBox="0 0 100 100" fill="currentColor">
    <path d="M20,35 L80,35 L70,85 L30,85 Z" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M35,35 Q50,10 65,35" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
    <circle cx="50" cy="55" r="8" fill="currentColor" />
  </svg>
)

const SallaLogo = () => (
  <svg className="h-4 w-4" viewBox="0 0 100 100" fill="currentColor">
    <path d="M15,40 L85,40 Q90,65 80,85 L20,85 Q10,65 15,40 Z" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M30,40 L30,20 Q50,5 70,20 L70,40" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="50" y1="40" x2="50" y2="85" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
  </svg>
)

const ShopifyLogo = () => (
  <svg className="h-4 w-4" viewBox="0 0 100 100" fill="currentColor">
    <path d="M25,30 L75,30 L85,90 L15,90 Z" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M40,30 C40,15 60,15 60,30" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
    <path d="M40,50 C40,45 60,45 60,55 C60,65 40,65 40,60" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
  </svg>
)

interface ConnectedStore {
  id: 'zid' | 'salla' | 'shopify'
  name: string
}

interface SetupWizardProps {
  lang: Language
  dir: 'rtl' | 'ltr'
  connectedStores: ConnectedStore[]
  odooConnected: boolean
  odooConnectionName: string | null
  installUrl: string
  sallaInstallUrl: string
}

const STORE_LOGOS: Record<string, () => React.JSX.Element> = {
  zid: ZidLogo,
  salla: SallaLogo,
  shopify: ShopifyLogo,
}

function StepBadge({ step, done, active }: { step: number; done: boolean; active: boolean }) {
  if (done) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
        <Check className="h-4 w-4" strokeWidth={3} />
      </div>
    )
  }
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
        active ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
      )}
    >
      {step}
    </div>
  )
}

export default function SetupWizard({
  lang,
  dir,
  connectedStores,
  odooConnected,
  odooConnectionName,
  installUrl,
  sallaInstallUrl,
}: SetupWizardProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const success = searchParams.get('success')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('description')

  // P0 live check: re-runs the server component (fresh connection statuses)
  // without touching any API route.
  const [checking, setChecking] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const handleLiveCheck = () => {
    if (checking) return
    setChecking(true)
    router.refresh()
    window.setTimeout(() => {
      setChecking(false)
      setLastChecked(new Date())
    }, 800)
  }

  const t = (key: string) =>
    (translations[lang] as Record<string, string>)[key] ||
    (translations['ar'] as Record<string, string>)[key] ||
    key

  const totalSteps = 3
  const completedSteps = (connectedStores.length > 0 ? 1 : 0) + (odooConnected ? 1 : 0)
  const allDone = connectedStores.length > 0 && odooConnected
  const activeStep = allDone ? 3 : completedSteps + 1

  const getSuccessMessage = (s: string) => {
    const name =
      s === 'salla_connected'
        ? lang === 'ar' ? 'سلة' : 'Salla'
        : s === 'shopify_connected'
          ? lang === 'ar' ? 'شوبيفاي' : 'Shopify'
          : lang === 'ar' ? 'زد' : 'Zid'
    return lang === 'ar' ? `تم ربط متجر ${name} بنجاح!` : `${name} store connected successfully!`
  }

  return (
    <div className="space-y-5" dir={dir}>
      {error && (
        <div className="flex items-start gap-3 border border-border bg-card p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-xs text-foreground">{t('setup.errorConnecting')}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {errorDescription || error}
            </p>
          </div>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-3 border border-emerald-200 bg-emerald-50 p-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
          <div>
            <p className="font-medium text-xs text-emerald-800">{getSuccessMessage(success)}</p>
          </div>
        </div>
      )}

      {/* ── Progress header ───────────────────────────────────── */}
      <div className="border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background">
              <Rocket className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">{t('setup.title')}</h2>
              <p className="text-[10px] text-muted-foreground">
                {t('setup.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* P0 health badge: green when store + ERP are connected */}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                allDone
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-amber-500/10 text-amber-600"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", allDone ? "bg-emerald-500" : "bg-amber-500")} />
              {allDone ? t('setup.healthOk') : t('setup.healthPending')}
            </span>
            <span className="text-[11px] font-semibold text-muted-foreground">
              {t('setup.stepsDone').replace('{n}', String(completedSteps))}
            </span>
          </div>
        </div>
        <Progress value={(completedSteps / totalSteps) * 100} className="mt-3 h-1.5" />
        {/* P0 live actions: refresh status + jump straight to sync */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleLiveCheck}
            disabled={checking}
            className="rounded-lg h-8 text-[11px] gap-1.5"
          >
            <RefreshCw className={cn("h-3 w-3", checking && "animate-spin")} />
            {checking ? t('setup.checking') : t('setup.liveCheck')}
          </Button>
          {allDone && (
            <Button asChild size="sm" className="rounded-lg h-8 text-[11px] gap-1.5">
              <Link href="/dashboard/initial-transfer">
                <Zap className="h-3 w-3" />
                {t('setup.syncNow')}
              </Link>
            </Button>
          )}
          {lastChecked && (
            <span className="text-[10px] text-muted-foreground">
              {t('setup.lastChecked')}: {lastChecked.toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* ── Step 1: Store ─────────────────────────────────────── */}
      <div className="border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <StepBadge step={1} done={connectedStores.length > 0} active={activeStep === 1} />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-foreground">{t('setup.step1Title')}</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{t('setup.step1Desc')}</p>
          </div>
          {connectedStores.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 shrink-0">
              <Check className="h-3 w-3" strokeWidth={3} />
              {t('setup.done')}
            </span>
          )}
        </div>

        <div className="p-4 space-y-3">
          {connectedStores.length > 0 ? (
            <>
              <div className="text-[11px] font-semibold text-foreground mb-1">{t('setup.connectedStores')}</div>
              <div className="space-y-2">
                {connectedStores.map((store) => {
                  const Logo = STORE_LOGOS[store.id]
                  return (
                    <div key={store.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
                      <div className="p-1.5 rounded-lg bg-muted text-foreground shrink-0">
                        {Logo && <Logo />}
                      </div>
                      <span className="text-xs font-semibold">{store.name}</span>
                      <span className="text-[9px] text-muted-foreground">{t('db.connected')}</span>
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">{t('setup.addStoreLater')}</p>
              <Button asChild variant="outline" size="sm" className="rounded-lg h-8 text-[11px] gap-1.5">
                <Link href="/dashboard/connect-store">
                  <Store className="h-3.5 w-3.5" />
                  {t('setup.manageStores')}
                </Link>
              </Button>
            </>
          ) : (
            <div className="space-y-2 pt-1">
              {[
                {
                  id: 'zid',
                  name: lang === 'ar' ? 'زد' : 'Zid',
                  logo: ZidLogo,
                  label: t('setup.connectZid'),
                  href: installUrl,
                },
                {
                  id: 'salla',
                  name: lang === 'ar' ? 'سلة' : 'Salla',
                  logo: SallaLogo,
                  label: t('setup.connectSalla'),
                  href: sallaInstallUrl,
                },
              ].map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-1.5 rounded-lg bg-muted text-muted-foreground shrink-0">
                      <row.logo />
                    </div>
                    <span className="text-xs font-semibold">{row.name}</span>
                  </div>
                  <a
                    href={row.href}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-foreground/20 bg-background px-3 h-8 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
                    )}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {row.label}
                  </a>
                </div>
              ))}

              {/* Shopify row: inline shop-domain form */}
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1.5 rounded-lg bg-muted text-muted-foreground shrink-0">
                    <ShopifyLogo />
                  </div>
                  <span className="text-xs font-semibold">{lang === 'ar' ? 'شوبيفاي' : 'Shopify'}</span>
                </div>
                <form action="/api/shopify/connect" method="GET" className="flex gap-2 shrink-0">
                  <input
                    type="text"
                    name="shop"
                    placeholder="my-store.myshopify.com"
                    required
                    className="h-8 w-40 rounded-lg border border-border bg-background px-2.5 text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button type="submit" variant="outline" size="sm" className="h-8 text-[11px] gap-1.5">
                    <ExternalLink className="h-3 w-3" />
                    {t('setup.connectShopify')}
                  </Button>
                </form>
              </div>

              <Button asChild variant="ghost" size="sm" className="rounded-lg h-8 text-[11px] gap-1.5 text-muted-foreground">
                <Link href="/dashboard/connect-store">
                  <Store className="h-3.5 w-3.5" />
                  {t('setup.manageStores')}
                </Link>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Step 2: ERP ───────────────────────────────────────── */}
      <div className="border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <StepBadge step={2} done={odooConnected} active={activeStep === 2} />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-foreground">{t('setup.step2Title')}</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{t('setup.step2Desc')}</p>
          </div>
          {odooConnected && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 shrink-0">
              <Check className="h-3 w-3" strokeWidth={3} />
              {t('setup.done')}
            </span>
          )}
        </div>

        <div className="p-4">
          {odooConnected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <div className="p-1.5 rounded-lg bg-muted text-amber-500 shrink-0">
                  <Database className="h-4 w-4" />
                </div>
                <span className="text-xs font-semibold flex-1 truncate">
                  {odooConnectionName || t('setup.connectedErp')}
                </span>
                <span className="text-[9px] text-muted-foreground shrink-0">{t('db.connected')}</span>
              </div>
              <Button asChild variant="outline" size="sm" className="rounded-lg h-8 text-[11px] gap-1.5">
                <Link href="/dashboard/connect-odoo">
                  <Database className="h-3.5 w-3.5" />
                  {t('setup.manageErp')}
                </Link>
              </Button>
            </div>
          ) : (
            <Button asChild size="lg" className="rounded-xl gap-2 bg-foreground text-background hover:opacity-90">
              <Link href="/dashboard/connect-odoo">
                <Database className="h-4 w-4" />
                {t('setup.connectErp')}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* ── Step 3: Start sync ────────────────────────────────── */}
      <div className="border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <StepBadge step={3} done={allDone} active={activeStep === 3} />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-foreground">{t('setup.step3Title')}</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{t('setup.step3Desc')}</p>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {allDone ? (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{t('setup.startSyncDesc')}</p>
              <Button asChild size="lg" className="rounded-xl gap-2 bg-foreground text-background hover:opacity-90">
                <Link href="/dashboard/initial-transfer">
                  <Rocket className="h-4 w-4" />
                  {t('setup.startSync')}
                </Link>
              </Button>
            </>
          ) : (
            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {!connectedStores.length && !odooConnected
                  ? t('setup.missingBoth')
                  : !connectedStores.length
                    ? t('setup.missingStore')
                    : t('setup.missingErp')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Completion banner ─────────────────────────────────── */}
      {allDone && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2.5 flex-1">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" />
            <div>
              <p className="text-xs font-bold text-emerald-800">{t('setup.complete')}</p>
              <p className="text-[10px] text-emerald-700 mt-0.5 leading-relaxed">{t('setup.completeDesc')}</p>
            </div>
          </div>
          <Button asChild size="sm" className="rounded-lg gap-1.5 bg-emerald-700 text-white hover:bg-emerald-800 h-9 shrink-0">
            <Link href="/dashboard">{t('setup.goDashboard')}</Link>
          </Button>
        </div>
      )}
    </div>
  )
}