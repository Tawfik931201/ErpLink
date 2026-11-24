import {
  BarChart3,
  Shield,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { PricingPlans } from '@/components/pricing-plans'
import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { Button } from '@/components/ui/button'
import { publicPageMetadata } from '@/lib/public-seo'
import { resolveLanguage, translations, type Language } from '@/lib/translations'

export const generateMetadata = () => publicPageMetadata('/pricing')

function t(lang: Language, key: string): string {
  const dict = translations[lang] as Record<string, string>
  if (dict && dict[key]) return dict[key]
  const fallbackDict = translations['ar'] as Record<string, string>
  if (fallbackDict && fallbackDict[key]) return fallbackDict[key]
  return key
}

export default async function PricingPage() {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div
      className="flex min-h-screen flex-col overflow-x-clip bg-background text-foreground font-sans"
      dir={dir}
    >
      <PublicSiteHeader lang={lang} />

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="pt-12 pb-16 sm:pt-20 sm:pb-24 px-4 sm:px-6 md:px-12 relative overflow-hidden bg-secondary/20">
          <div className="absolute top-[-80px] right-[-80px] w-[400px] h-[400px] rounded-full bg-foreground/[0.03] blur-3xl pointer-events-none" />
          <div className="absolute bottom-[-80px] left-[-80px] w-[350px] h-[350px] rounded-full bg-foreground/[0.02] blur-3xl pointer-events-none" />

          <div className="max-w-5xl mx-auto flex flex-col items-center text-center gap-6 sm:gap-8 relative">
            <div className="rise-in inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs sm:text-sm font-semibold">
              <BarChart3 className="h-3.5 w-3.5" />
              <span>{t(lang, 'pricing.badge')}</span>
            </div>

            <h1
              className="rise-in text-3xl sm:text-4xl md:text-6xl font-black text-foreground leading-[1.15] tracking-tight max-w-4xl"
              style={{ animationDelay: '80ms' }}
            >
              {t(lang, 'pricing.pageTitle')}
            </h1>

            <p
              className="rise-in text-sm sm:text-lg md:text-xl text-muted-foreground leading-relaxed max-w-3xl"
              style={{ animationDelay: '160ms' }}
            >
              {t(lang, 'pricing.pageSubtitle')}
            </p>
          </div>
        </section>

        {/* ── Single Plan + Features ──────────────────────────── */}
        <section className="-mt-8 sm:-mt-12 px-4 sm:px-6 md:px-12 relative z-10">
          <div className="max-w-7xl mx-auto">
            <PricingPlans />
          </div>
        </section>

        {/* ── CTA Banner ───────────────────────────────────────── */}
        <section className="py-14 sm:py-20 px-4 sm:px-6 md:px-12">
          <div className="max-w-4xl mx-auto text-center">
            <div className="reveal relative overflow-hidden rounded-2xl sm:rounded-3xl border border-border bg-card p-6 sm:p-12 md:p-16 shadow-sm">
              <div className="absolute inset-0 bg-muted/20" />

              <div className="relative space-y-5 sm:space-y-6">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-muted text-muted-foreground text-xs sm:text-sm font-semibold">
                  <Shield className="h-3.5 w-3.5" />
                  <span>{t(lang, 'landing.badge')}</span>
                </div>
                <h2 className="text-2xl sm:text-4xl md:text-5xl font-black text-foreground leading-tight">
                  {t(lang, 'pricing.cta.title')}
                </h2>
                <p className="text-muted-foreground text-sm sm:text-base md:text-lg max-w-lg mx-auto">
                  {t(lang, 'pricing.cta.subtitle')}
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 pt-2">
                  <Button
                    asChild
                    size="lg"
                    className="bg-foreground text-background hover:opacity-90 rounded-xl px-8 py-5 sm:py-6 text-sm sm:text-base font-bold shadow-sm transition-all duration-200 w-full sm:w-auto"
                  >
                    <Link href="/sign-up">{t(lang, 'pricing.cta.btn')}</Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="rounded-xl px-6 py-5 sm:py-6 text-sm sm:text-base font-semibold w-full sm:w-auto"
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
