'use client'

import {
  Check,
  ChevronDown,
  Gem,
  Gift,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const HIGHLIGHT_FEATURES = [
  'ordersItems',
  'productsVariants',
  'customersCategories',
  'fieldMapping',
  'customMapping',
  'stockLive',
] as const

const ALL_FEATURES = [
  'ordersItems',
  'productsVariants',
  'customersCategories',
  'fieldMapping',
  'customMapping',
  'stockLive',
  'telegram',
  'initialTransfer',
  'detailedLogs',
  'dashboard',
  'addCustomField',
] as const

export function PricingPlans() {
  const { t } = useLanguage()
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly')

  const price = billing === 'yearly' ? t('pricing.business.priceYearly') : t('pricing.business.price')
  const period = billing === 'yearly' ? t('pricing.business.periodYearly') : t('pricing.business.period')

  const faqs = [
    { q: t('pricing.faqQ1'), a: t('pricing.faqA1') },
    { q: t('pricing.faqQ2'), a: t('pricing.faqA2') },
    { q: t('pricing.faqQ3'), a: t('pricing.faqA3') },
    { q: t('pricing.faqQ4'), a: t('pricing.faqA4') },
    { q: t('pricing.faqQ5'), a: t('pricing.faqA5') },
  ]

  return (
    <>
      {/* ── Plan Hero: text + tilted card ───────────── */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        {/* Text side */}
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
            <Sparkles className="h-3 w-3" />
            <span>{t('pricing.hero.badge')}</span>
          </div>

          <h2 className="text-3xl md:text-4xl font-black text-foreground tracking-tight leading-tight">
            {t('pricing.hero.title')}
          </h2>

          <p className="text-base md:text-lg text-muted-foreground leading-relaxed max-w-md">
            {t('pricing.hero.desc')}
          </p>

          <ul className="space-y-3">
            {HIGHLIGHT_FEATURES.map((key) => (
              <li key={key} className="flex items-start gap-2.5 text-sm">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-foreground shrink-0 mt-0.5">
                  <Check className="h-3 w-3" />
                </span>
                <span className="text-foreground/80 leading-relaxed">
                  {t(`pricing.feature.${key}`)}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] text-muted-foreground font-semibold shrink-0">
              {t('pricing.hero.storesLabel')}
            </span>
            {['Zid', 'Salla', 'Shopify'].map((store) => (
              <span key={store} className="px-2 py-0.5 rounded-md bg-muted text-foreground/70 text-[10px] font-bold">
                {store}
              </span>
            ))}
            <span className="text-[10px] text-muted-foreground font-semibold mx-1">+</span>
            {['Odoo', 'ERPNext'].map((erp) => (
              <span key={erp} className="px-2 py-0.5 rounded-md bg-muted text-foreground/70 text-[10px] font-bold">
                {erp}
              </span>
            ))}
          </div>
        </div>

        {/* Tilted card side */}
        <div className="flex justify-center lg:justify-end">
          <div className="relative w-full max-w-sm rotate-[-3deg] transition-transform duration-300 hover:rotate-0">
            <div className="absolute inset-0 translate-x-3 translate-y-3 rounded-3xl border border-border bg-secondary/60" />

            <div className="relative rounded-3xl border border-border bg-card p-8 shadow-xl">
              <div className="flex justify-center mb-8">
                <div className="inline-flex items-center rounded-full bg-secondary p-1 border border-border">
                  <button
                    onClick={() => setBilling('monthly')}
                    className={cn(
                      'px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-200',
                      billing === 'monthly'
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t('pricing.monthly')}
                  </button>
                  <button
                    onClick={() => setBilling('yearly')}
                    className={cn(
                      'px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-200',
                      billing === 'yearly'
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t('pricing.yearly')}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2.5 mb-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground/70">
                  <Gem className="h-4 w-4" />
                </span>
                <h3 className="text-lg font-black leading-tight">{t('pricing.business.name')}</h3>
              </div>

              <div className="flex items-baseline gap-1.5 mb-2">
                <span className="text-5xl font-black text-foreground">
                  <span className="text-2xl font-black text-foreground/60 align-top">$</span>
                  {price}
                </span>
                <span className="text-sm text-muted-foreground font-medium">{period}</span>
              </div>

              {billing === 'yearly' && (
                <span className="inline-block mb-2 px-2.5 py-1 rounded-full bg-muted text-muted-foreground text-[10px] font-black">
                  {t('pricing.yearlySave')}
                </span>
              )}

              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-primary mt-2 mb-7">
                <Gift className="h-3.5 w-3.5" />
                <span>{t('pricing.trialChip')}</span>
              </div>

              <Button
                asChild
                className="w-full rounded-xl font-bold bg-foreground text-background hover:opacity-90"
              >
                <Link href="/sign-up">{t('pricing.business.btn')}</Link>
              </Button>

              <p className="mt-3 text-center text-[11px] text-muted-foreground">
                {t('pricing.trialNote')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── All Features ─────────────────────────────── */}
      <section className="py-20 px-2 md:px-0">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12 space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
              <Sparkles className="h-3 w-3" />
              <span>{t('pricing.featuresTitle')}</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-black text-foreground tracking-tight">
              {t('pricing.featuresTitle')}
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              {t('pricing.featuresSubtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ALL_FEATURES.map((key) => (
              <div
                key={key}
                className="rounded-2xl border border-border bg-card p-5 shadow-sm"
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-foreground shrink-0">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <h3 className="text-sm font-bold text-foreground">
                    {t(`pricing.feature.${key}`)}
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t(`pricing.feature.${key}.desc`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Free Trial ───────────────────────────────── */}
      <section className="pb-4">
        <div className="max-w-4xl mx-auto rounded-3xl border border-border bg-secondary/40 p-8 md:p-12">
          <div className="flex flex-col md:flex-row md:items-center gap-8">
            <div className="flex-1 space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
                <ShieldCheck className="h-3 w-3" />
                <span>{t('pricing.trial.badge')}</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-black text-foreground tracking-tight">
                {t('pricing.trial.title')}
              </h2>
              <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                {t('pricing.trial.subtitle')}
              </p>
            </div>

            <ul className="space-y-2.5 md:w-64">
              {['trial.point1', 'trial.point2', 'trial.point3'].map((key) => (
                <li key={key} className="flex items-start gap-2.5 text-sm">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-card text-foreground shrink-0 mt-0.5">
                    <Check className="h-3 w-3" />
                  </span>
                  <span className="text-foreground/80">{t(`pricing.${key}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────── */}
      <section className="py-20 px-2 md:px-0">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12 space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
              <ChevronDown className="h-3 w-3" />
              <span>{t('pricing.faqTitle')}</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-black text-foreground tracking-tight">
              {t('pricing.faqTitle')}
            </h2>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, idx) => (
              <details
                key={idx}
                className="group rounded-2xl border border-border bg-card overflow-hidden shadow-sm"
              >
                <summary className="flex items-center justify-between gap-4 px-6 py-4 cursor-pointer list-none">
                  <span className="font-bold text-sm">{faq.q}</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180 shrink-0" />
                </summary>
                <div className="px-6 pb-5 text-sm text-muted-foreground leading-relaxed">
                  {faq.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
