import {
  Check,
  X,
  Shield,
  BarChart3,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { PricingPlans } from '@/components/pricing-plans'
import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { Button } from '@/components/ui/button'
import { resolveLanguage, translations, type Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

function t(lang: Language, key: string): string {
  const dict = translations[lang] as Record<string, string>
  if (dict && dict[key]) return dict[key]
  const fallbackDict = translations['ar'] as Record<string, string>
  if (fallbackDict && fallbackDict[key]) return fallbackDict[key]
  return key
}

export default function PricingPage() {
  const cookieStore = cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  const featureRows = [
    { key: 'pricing.feature.ordersItems', free: true, starter: true, business: true },
    { key: 'pricing.feature.productsVariants', free: true, starter: true, business: true },
    { key: 'pricing.feature.customersCategories', free: true, starter: true, business: true },
    { key: 'pricing.feature.fieldMapping', free: true, starter: true, business: true },
    { key: 'pricing.feature.stockLive', free: true, starter: true, business: true },
    { key: 'pricing.feature.telegram', free: true, starter: true, business: true },
    { key: 'pricing.feature.initialTransfer', free: true, starter: true, business: true },
    { key: 'pricing.feature.detailedLogs', free: true, starter: true, business: true },
    { key: 'pricing.feature.dashboard', free: true, starter: true, business: true },
    { key: 'pricing.feature.addCustomField', free: true, starter: true, business: true },
    {
      key: 'pricing.feature.stores',
      type: 'value' as const,
      free: 'pricing.val.stores.free',
      starter: 'pricing.val.stores.starter',
      business: 'pricing.val.stores.business',
    },
    {
      key: 'pricing.feature.team',
      type: 'value' as const,
      free: 'pricing.val.team.free',
      starter: 'pricing.val.team.starter',
      business: 'pricing.val.team.business',
    },
    {
      key: 'pricing.feature.support',
      type: 'value' as const,
      free: 'pricing.val.support.free',
      starter: 'pricing.val.support.starter',
      business: 'pricing.val.support.business',
    },
    {
      key: 'pricing.feature.duration',
      type: 'value' as const,
      free: 'pricing.val.duration.free',
      starter: 'pricing.val.duration.starter',
      business: 'pricing.val.duration.business',
    },
    {
      key: 'pricing.feature.erp',
      type: 'value' as const,
      free: 'pricing.val.erp.free',
      starter: 'pricing.val.erp.starter',
      business: 'pricing.val.erp.business',
    },
    {
      key: 'pricing.platforms.stores',
      type: 'value' as const,
      free: 'pricing.val.platforms.stores',
      starter: 'pricing.val.platforms.stores',
      business: 'pricing.val.platforms.stores',
    },
    {
      key: 'pricing.platforms.erp',
      type: 'value' as const,
      free: 'pricing.val.platforms.erp',
      starter: 'pricing.val.platforms.erp',
      business: 'pricing.val.platforms.erp',
    },
  ]

  const planIds = ['free', 'starter', 'business'] as const
  const planNames = ['pricing.free.name', 'pricing.starter.name', 'pricing.business.name'] as const

  return (
    <div
      className="flex min-h-screen flex-col bg-background text-foreground font-sans overflow-x-hidden"
      dir={dir}
    >
      <PublicSiteHeader lang={lang} />

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="pt-20 pb-28 px-6 md:px-12 relative overflow-hidden bg-secondary/20">
          <div className="absolute top-[-80px] right-[-80px] w-[400px] h-[400px] rounded-full bg-foreground/[0.03] blur-3xl pointer-events-none" />
          <div className="absolute bottom-[-80px] left-[-80px] w-[350px] h-[350px] rounded-full bg-foreground/[0.02] blur-3xl pointer-events-none" />

          <div className="max-w-5xl mx-auto flex flex-col items-center text-center gap-8 relative">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold">
              <BarChart3 className="h-3.5 w-3.5" />
              <span>{t(lang, 'pricing.badge')}</span>
            </div>

            <h1 className="text-4xl md:text-6xl font-black text-foreground leading-[1.15] tracking-tight max-w-4xl">
              {t(lang, 'pricing.pageTitle')}
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-3xl">
              {t(lang, 'pricing.pageSubtitle')}
            </p>
          </div>
        </section>

        {/* ── Billing Toggle + Cards ──────────────────────────── */}
        <section className="-mt-16 px-6 md:px-12 relative z-10">
          <div className="max-w-7xl mx-auto">
            <PricingPlans />
          </div>
        </section>

        {/* ── Comparison Table ─────────────────────────────────── */}
        <section className="py-24 px-6 md:px-12 bg-secondary/20 mt-20">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-14 space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
                <BarChart3 className="h-3 w-3" />
                <span>{t(lang, 'pricing.compareTitle')}</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-black text-foreground tracking-tight">
                {t(lang, 'pricing.compareTitle')}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                {t(lang, 'pricing.compareSubtitle')}
              </p>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-border shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-card border-b border-border">
                    <th className={cn('px-6 py-4 font-bold text-foreground', lang === 'ar' ? 'text-right' : 'text-left')}>
                      {lang === 'ar' ? 'الميزة' : 'Feature'}
                    </th>
                    {planNames.map((name) => (
                      <th key={name} className="text-center px-4 py-4 font-bold text-foreground bg-muted/30">
                        {t(lang, name)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {featureRows.map((row, idx) => (
                    <tr
                      key={row.key}
                      className={cn('border-b border-border/50', idx % 2 === 0 ? 'bg-card' : 'bg-secondary/30')}
                    >
                      <td className={cn('px-6 py-4 font-semibold text-foreground', lang === 'ar' ? 'text-right' : 'text-left')}>
                        {t(lang, row.key)}
                      </td>
                      {planIds.map((plan) => (
                        <td key={plan} className="px-4 py-4 text-center">
                          {row.type === 'value' ? (
                            <span className="text-sm font-semibold text-foreground/80">
                              {t(lang, (row as any)[plan])}
                            </span>
                          ) : (
                            <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full', (row as any)[plan] ? 'bg-muted text-foreground' : 'bg-muted text-muted-foreground')}>
                              {(row as any)[plan] ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── CTA Banner ───────────────────────────────────────── */}
        <section className="py-20 px-6 md:px-12">
          <div className="max-w-4xl mx-auto text-center">
            <div className="rounded-3xl bg-card border border-border p-12 md:p-16 relative overflow-hidden shadow-sm">
              <div className="absolute inset-0 bg-muted/20" />

              <div className="relative space-y-6">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-muted text-muted-foreground text-sm font-semibold">
                  <Shield className="h-3.5 w-3.5" />
                  <span>{t(lang, 'landing.badge')}</span>
                </div>
                <h2 className="text-4xl md:text-5xl font-black text-foreground leading-tight">
                  {t(lang, 'pricing.cta.title')}
                </h2>
                <p className="text-muted-foreground text-lg max-w-lg mx-auto">
                  {t(lang, 'pricing.cta.subtitle')}
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
                  <Button
                    asChild
                    size="lg"
                    className="bg-foreground text-background hover:opacity-90 rounded-xl px-8 py-6 text-base font-bold shadow-sm transition-all duration-200"
                  >
                    <Link href="/sign-up">{t(lang, 'pricing.cta.btn')}</Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="rounded-xl px-6 py-6 text-base font-semibold"
                  >
                    <Link href="/sign-in">{t(lang, 'pricing.cta.signIn')}</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicSiteFooter lang={lang} />
    </div>
  )
}
