'use client'

import {
  Zap,
  Star,
  Gem,
  Check,
  ChevronDown,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function PricingPlans() {
  const { lang, t } = useLanguage()
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly')

  const plans = [
    {
      id: 'free',
      icon: Zap,
      name: t('pricing.free.name'),
      desc: t('pricing.free.desc'),
      price: t('pricing.free.price'),
      period: t('pricing.free.period'),
      btn: t('pricing.free.btn'),
      href: '/sign-up',
      featured: false,
      badge: t('pricing.freeBadge'),
    },
    {
      id: 'starter',
      icon: Star,
      name: t('pricing.starter.name'),
      desc: t('pricing.starter.desc'),
      price: billing === 'yearly' ? t('pricing.starter.priceYearly') : t('pricing.starter.price'),
      period: billing === 'yearly' ? t('pricing.starter.periodYearly') : t('pricing.starter.period'),
      btn: t('pricing.starter.btn'),
      href: '/sign-up',
      featured: true,
      badge: t('pricing.mostPopular'),
    },
    {
      id: 'business',
      icon: Gem,
      name: t('pricing.business.name'),
      desc: t('pricing.business.desc'),
      price: billing === 'yearly' ? t('pricing.business.priceYearly') : t('pricing.business.price'),
      period: billing === 'yearly' ? t('pricing.business.periodYearly') : t('pricing.business.period'),
      btn: t('pricing.business.btn'),
      href: '/sign-up',
      featured: false,
      badge: null,
    },
  ]

  const faqs = [
    { q: t('pricing.faqQ1'), a: t('pricing.faqA1') },
    { q: t('pricing.faqQ2'), a: t('pricing.faqA2') },
    { q: t('pricing.faqQ3'), a: t('pricing.faqA3') },
    { q: t('pricing.faqQ4'), a: t('pricing.faqA4') },
    { q: t('pricing.faqQ5'), a: t('pricing.faqA5') },
  ]

  return (
    <>
      {/* ── Billing Toggle ──────────────────────────── */}
      <div className="flex justify-center mb-10">
        <div className="inline-flex items-center rounded-full bg-secondary p-1 shadow-sm border border-border">
          <button
            onClick={() => setBilling('monthly')}
            className={cn(
              'px-5 py-2 rounded-full text-sm font-bold transition-all duration-200',
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
              'px-5 py-2 rounded-full text-sm font-bold transition-all duration-200',
              billing === 'yearly'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t('pricing.yearly')}
          </button>
        </div>
      </div>

      {/* ── Cards ───────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        {plans.map((plan) => {
          const Icon = plan.icon
          const showYearlyBadge = plan.id !== 'free' && billing === 'yearly'

          return (
            <div
              key={plan.id}
              className={cn(
                'relative rounded-2xl border bg-card p-7 flex flex-col gap-5 shadow-sm transition-all',
                plan.featured
                  ? 'border-primary/40 shadow-md scale-[1.02] md:scale-[1.05]'
                  : 'border-border hover:shadow-md',
                plan.featured && 'z-10'
              )}
            >
              <div className="flex items-start justify-between">
                {plan.featured ? (
                  <span className="px-3 py-1 rounded-full bg-foreground text-background text-[10px] font-black tracking-wider uppercase">
                    {t('pricing.mostPopular')}
                  </span>
                ) : plan.badge ? (
                  <span className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-[10px] font-black tracking-wider uppercase">
                    {plan.badge}
                  </span>
                ) : (
                  <span />
                )}
                {showYearlyBadge && (
                  <span className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground text-[10px] font-black">
                    {t('pricing.yearlySave')}
                  </span>
                )}
              </div>

              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-foreground/70">
                <Icon className="h-5 w-5" />
              </div>

              <div>
                <h3 className="text-xl font-black mb-1">{plan.name}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{plan.desc}</p>
              </div>

              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-black text-foreground">
                  {plan.id === 'free' ? (
                    <><span className="text-3xl font-black text-foreground">$</span>{plan.price}</>
                  ) : (
                    <><span className="text-2xl font-black text-foreground/60">$</span>{plan.price}</>
                  )}
                </span>
                <span className="text-sm text-muted-foreground font-medium">{plan.period}</span>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground font-semibold shrink-0">
                    {lang === 'ar' ? 'المتاجر:' : 'Stores:'}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-muted text-foreground/70 text-[10px] font-bold">Zid</span>
                  <span className="px-2 py-0.5 rounded-md bg-muted text-foreground/70 text-[10px] font-bold">Salla</span>
                  <span className="px-2 py-0.5 rounded-md bg-muted text-foreground/70 text-[10px] font-bold">Shopify</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground font-semibold shrink-0">
                    {lang === 'ar' ? 'ERP:' : 'ERP:'}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-muted text-foreground/70 text-[10px] font-bold">Odoo</span>
                  <span className="px-2 py-0.5 rounded-md bg-muted text-foreground/70 text-[10px] font-bold">ERPNext</span>
                  <span className="px-2 py-0.5 rounded-md bg-muted text-foreground/70 text-[10px] font-bold">Zoho</span>
                </div>
              </div>

              <div className="border-t border-border" />

              <ul className="space-y-2.5">
                {[
                  t('pricing.feature.ordersItems'),
                  t('pricing.feature.productsVariants'),
                  t('pricing.feature.customersCategories'),
                  t('pricing.feature.fieldMapping'),
                  t('pricing.feature.stockLive'),
                  t('pricing.feature.telegram'),
                  t('pricing.feature.initialTransfer'),
                  t('pricing.feature.detailedLogs'),
                  t('pricing.feature.dashboard'),
                  t('pricing.feature.addCustomField'),
                ].map((feat) => (
                  <li key={feat} className="flex items-start gap-2.5 text-sm">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-foreground shrink-0 mt-0.5">
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="text-foreground/80 leading-relaxed">{feat}</span>
                  </li>
                ))}
              </ul>

              <div className="rounded-xl bg-secondary/50 p-3 space-y-1.5">
                {['stores', 'team', 'support', 'duration', 'erp'].map((key) => (
                  <div key={key} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground font-medium">
                      {t(`pricing.feature.${key}`)}
                    </span>
                    <span className="font-bold text-foreground">
                      {t(`pricing.val.${key}.${plan.id}`)}
                    </span>
                  </div>
                ))}
              </div>

              <Button
                asChild
                variant={plan.featured ? 'default' : 'outline'}
                className={cn(
                  'rounded-xl font-bold mt-auto',
                  plan.featured && 'bg-foreground text-background shadow-sm'
                )}
              >
                <Link href={plan.href}>{plan.btn}</Link>
              </Button>
            </div>
          )
        })}
      </div>

      {/* ── FAQ ─────────────────────────────────────── */}
      <section className="py-24 px-6 md:px-12">
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
