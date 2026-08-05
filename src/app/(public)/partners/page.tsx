import {
  Check,
  Sparkles,
  Briefcase,
  TrendingUp,
  DollarSign,
  Users,
  ArrowLeft,
  Handshake,
  ChevronDown,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { PartnerCtaButtons, PartnerCardButton } from '@/components/partner-auth-buttons'
import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { Button } from '@/components/ui/button'
import { PARTNER_TIERS } from '@/lib/partner-tiers'
import { type Language, translations } from '@/lib/translations'
import { cn } from '@/lib/utils'



function t(lang: Language, key: string): string {
  const dict = translations[lang] as Record<string, string>
  if (dict && dict[key]) return dict[key]
  const fallbackDict = translations['ar'] as Record<string, string>
  if (fallbackDict && fallbackDict[key]) return fallbackDict[key]
  return key
}

export default function PartnersLandingPage() {
  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const isSignedIn = !!cookieStore.get('__session')?.value

  const benefits = [
    {
      icon: TrendingUp,
      title: t(lang, 'partners.benefit1Title'),
      desc: t(lang, 'partners.benefit1Desc'),
    },
    {
      icon: Briefcase,
      title: t(lang, 'partners.benefit2Title'),
      desc: t(lang, 'partners.benefit2Desc'),
    },
    {
      icon: Sparkles,
      title: t(lang, 'partners.benefit3Title'),
      desc: t(lang, 'partners.benefit3Desc'),
    },
    {
      icon: DollarSign,
      title: t(lang, 'partners.benefit4Title'),
      desc: t(lang, 'partners.benefit4Desc'),
    },
  ]

  const tiers = [
    {
      key: 'starter' as const,
      name: t(lang, 'partners.tierStarterName'),
      clients: t(lang, 'partners.tierStarterClients'),
      rate: t(lang, 'partners.tierStarterRate'),
    },
    {
      key: 'growth' as const,
      name: t(lang, 'partners.tierGrowthName'),
      clients: t(lang, 'partners.tierGrowthClients'),
      rate: t(lang, 'partners.tierGrowthRate'),
      recommended: true,
    },
    {
      key: 'gold' as const,
      name: t(lang, 'partners.tierGoldName'),
      clients: t(lang, 'partners.tierGoldClients'),
      rate: t(lang, 'partners.tierGoldRate'),
    },
  ]

  const steps = [
    {
      num: lang === 'ar' ? '١' : '1',
      title: t(lang, 'partners.howStep1Title'),
      desc: t(lang, 'partners.howStep1Desc'),
    },
    {
      num: lang === 'ar' ? '٢' : '2',
      title: t(lang, 'partners.howStep2Title'),
      desc: t(lang, 'partners.howStep2Desc'),
    },
    {
      num: lang === 'ar' ? '٣' : '3',
      title: t(lang, 'partners.howStep3Title'),
      desc: t(lang, 'partners.howStep3Desc'),
    },
    {
      num: lang === 'ar' ? '٤' : '4',
      title: t(lang, 'partners.howStep4Title'),
      desc: t(lang, 'partners.howStep4Desc'),
    },
  ]

  const faqs = [
    { q: t(lang, 'partners.faq1Q'), a: t(lang, 'partners.faq1A') },
    { q: t(lang, 'partners.faq2Q'), a: t(lang, 'partners.faq2A') },
    { q: t(lang, 'partners.faq3Q'), a: t(lang, 'partners.faq3A') },
    { q: t(lang, 'partners.faq4Q'), a: t(lang, 'partners.faq4A') },
  ]

  return (
    <div
      className="flex min-h-screen flex-col bg-background text-foreground font-sans overflow-x-hidden"
      dir={dir}
    >
      <PublicSiteHeader lang={lang} isPartnersPage />

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="pt-20 pb-24 px-6 md:px-12 relative">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col items-center text-center gap-6 max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted border border-border">
                <Handshake className="h-3 w-3 text-muted-foreground" />
                <span className="text-[11px] font-semibold text-muted-foreground">
                  {t(lang, 'partners.badge')}
                </span>
              </div>

              <h1 className="text-4xl md:text-5xl font-black text-foreground leading-[1.15] tracking-tight">
                {lang === 'ar' ? (
                  <>انضم لـ <span className="text-foreground">برنامج الأفلييت</span> وابني <span className="text-foreground">دخلاً متكرراً</span></>
                ) : (
                  <>Join the <span className="text-foreground">Affiliate Program</span> and Build <span className="text-foreground">Recurring Revenue</span></>
                )}
              </h1>

              <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
                {t(lang, 'partners.heroSubtitle')}
              </p>

              <div className="flex flex-row items-center gap-3 pt-2">
                <PartnerCtaButtons lang={lang} isSignedIn={isSignedIn} />
                <Button
                  asChild
                  variant="outline"
                  className="border-border text-foreground hover:bg-muted h-10 text-xs font-semibold px-4"
                >
                  <Link href="#how" className="flex items-center gap-1.5">
                    {t(lang, 'partners.ctaLearn')}
                    <ArrowLeft
                      className={cn('h-3.5 w-3.5', lang === 'ar' ? '' : 'rotate-180')}
                    />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* ── Why / Benefits ──────────────────────────────────── */}
        <section id="why" className="py-16 px-6 md:px-12 bg-muted/30">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted border border-border text-[11px] font-semibold text-muted-foreground mb-3">
                <Sparkles className="h-3 w-3" />
                <span>{t(lang, 'partners.whyBadge')}</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                {t(lang, 'partners.whyTitle')}
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {benefits.map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="bg-card border border-border p-4"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded bg-muted text-muted-foreground mb-3">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <h3 className="text-xs font-semibold text-foreground mb-1">
                    {title}
                  </h3>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Tiers ───────────────────────────────────────────── */}
        <section id="tiers" className="py-16 px-6 md:px-12">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted border border-border text-[11px] font-semibold text-muted-foreground mb-3">
                <TrendingUp className="h-3 w-3" />
                <span>{t(lang, 'partners.tiersBadge')}</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                {t(lang, 'partners.tiersTitle')}
              </h2>
              <p className="text-sm text-muted-foreground max-w-2xl mx-auto mt-2">
                {t(lang, 'partners.tiersDesc')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {tiers.map((tier) => {
                const config = PARTNER_TIERS[tier.key]
                return (
                  <div
                    key={tier.key}
                    className={cn(
                      'relative bg-card border p-5 flex flex-col gap-4',
                      tier.recommended
                        ? 'border-foreground/40'
                        : 'border-border'
                    )}
                  >
                    {tier.recommended && (
                      <span className="px-2.5 py-1 rounded bg-foreground text-background text-[10px] font-black tracking-wider uppercase self-start">
                        {lang === 'ar' ? 'الأكثر شعبية' : 'Most Popular'}
                      </span>
                    )}

                    <div className="flex h-8 w-8 items-center justify-center rounded bg-muted text-muted-foreground">
                      <Users className="h-4 w-4" />
                    </div>

                    <div>
                      <h3 className="text-xs font-semibold text-foreground mb-0.5">
                        {tier.name}
                      </h3>
                      <p className="text-[11px] text-muted-foreground">
                        {tier.clients}
                      </p>
                    </div>

                    <div className="inline-flex w-fit items-center gap-1.5 px-2.5 py-1 rounded bg-muted text-foreground text-[11px] font-bold">
                      <DollarSign className="h-3 w-3" />
                      <span>{Math.round(config.commissionRate * 100)}%</span>
                    </div>

                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {tier.rate}
                    </p>

                    <PartnerCardButton
                      lang={lang}
                      isSignedIn={isSignedIn}
                      recommended={tier.recommended}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────── */}
        <section id="how" className="py-16 px-6 md:px-12 bg-muted/30">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted border border-border text-[11px] font-semibold text-muted-foreground mb-3">
                <Check className="h-3 w-3" />
                <span>{t(lang, 'partners.howBadge')}</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                {t(lang, 'partners.howTitle')}
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {steps.map((step) => (
                <div
                  key={step.num}
                  className="bg-card border border-border p-5 text-center"
                >
                  <div className="flex items-center justify-center mb-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded bg-foreground text-background text-sm font-bold">
                      {step.num}
                    </div>
                  </div>
                  <h3 className="text-xs font-semibold text-foreground mb-1">
                    {step.title}
                  </h3>
                  <p className="text-[11px] text-muted-foreground leading-relaxed max-w-xs mx-auto">
                    {step.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────── */}
        <section id="faq" className="py-16 px-6 md:px-12">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted border border-border text-[11px] font-semibold text-muted-foreground mb-3">
                <ChevronDown className="h-3 w-3" />
                <span>{t(lang, 'partners.faqBadge')}</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                {t(lang, 'partners.faqTitle')}
              </h2>
            </div>

            <div className="space-y-2">
              {faqs.map((faq, idx) => (
                <details
                  key={idx}
                  className="group bg-card border border-border overflow-hidden"
                >
                  <summary className="flex items-center justify-between gap-4 px-4 py-3 cursor-pointer list-none">
                    <span className="text-xs font-semibold text-foreground">
                      {faq.q}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180 shrink-0" />
                  </summary>
                  <div className="px-4 pb-3 text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3">
                    {faq.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ──────────────────────────────────────── */}
        <section className="py-16 px-6 md:px-12">
          <div className="max-w-3xl mx-auto">
            <div className="bg-card border border-border p-8 md:p-10 text-center relative">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted border border-border text-[11px] font-semibold text-muted-foreground">
                  <Handshake className="h-3 w-3" />
                  <span>{t(lang, 'partners.badge')}</span>
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground">
                  {t(lang, 'partners.finalTitle')}
                </h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  {t(lang, 'partners.finalSubtitle')}
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
                  <PartnerCtaButtons lang={lang} isSignedIn={isSignedIn} />
                  <Button
                    asChild
                    variant="outline"
                    className="border-border text-foreground hover:bg-muted h-10 text-xs font-semibold px-4"
                  >
                    <Link href="/sign-in">{t(lang, 'landing.signIn')}</Link>
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


