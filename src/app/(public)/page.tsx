import { homepageStructuredData, publicPageMetadata } from '@/lib/public-seo'
import {
  Activity,
  ArrowLeft,
  Box,
  Check,
  ChevronDown,
  ExternalLink,
  Link as LinkIcon,
  RefreshCw,
  Settings,
  Shield,
  ShoppingBag,
  Tag,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { Button } from '@/components/ui/button'
import { resolveLanguage, translations } from '@/lib/translations'
import { cn } from '@/lib/utils'

export const generateMetadata = () => publicPageMetadata('/')

const EYEBROW = 'font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground'

export default async function HomePage() {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) =>
    translations[lang][key] || translations['ar'][key]

  const isAr = lang === 'ar'

  const features = [
    { icon: ShoppingBag, title: t('feature.orders.title'), desc: t('feature.orders.desc') },
    { icon: Tag, title: t('feature.products.title'), desc: t('feature.products.desc') },
    { icon: Box, title: t('feature.stock.title'), desc: t('feature.stock.desc') },
    { icon: Users, title: t('feature.customers.title'), desc: t('feature.customers.desc') },
    { icon: Activity, title: t('feature.accounting.title'), desc: t('feature.accounting.desc') },
    { icon: RefreshCw, title: t('feature.multiStore.title'), desc: t('feature.multiStore.desc') },
  ]

  const flowLog = [
    { time: '00:00.4', from: 'order.created', to: 'sale.order' },
    { time: '00:01.1', from: 'stock.updated', to: 'stock.quant' },
    { time: '00:01.8', from: 'product.updated', to: 'product.template' },
    { time: '00:02.2', from: 'customer.created', to: 'res.partner' },
  ]

  const routes = [
    { event: 'order.created', model: 'sale.order', custom: false },
    { event: 'product.updated', model: 'product.template', custom: false },
    { event: 'customer.created', model: 'res.partner', custom: false },
    { event: 'x_custom.event', model: 'x_projects', custom: true },
  ]

  const before = [
    isAr ? 'إدخال كل طلب يدوياً في الـ ERP' : 'Every order typed into the ERP by hand',
    isAr ? 'بيع منتجات غير متوفرة بسبب مخزون قديم' : 'Selling out-of-stock items from stale inventory',
    isAr ? 'طلبات تفوت بصمت دون أي تنبيه' : 'Orders lost silently with no alert',
    isAr ? 'لا تعرف أين توقفت المزامنة' : 'No idea where the sync stopped',
  ]

  const after = [
    isAr ? 'الطلبات تصل تلقائياً خلال ثوانٍ' : 'Orders arrive automatically in seconds',
    isAr ? 'المخزون محدّث لحظياً في الاتجاهين' : 'Stock updated live in both directions',
    isAr ? 'إعادة محاولة تلقائية وسجل لكل عملية' : 'Automatic retries and a log for every operation',
    isAr ? 'تنبيه فوري على تيليجرام عند أي مشكلة' : 'Instant Telegram alert on any issue',
  ]

  const steps = [
    { icon: LinkIcon, title: t('how.step1'), desc: t('how.step1Desc') },
    { icon: Settings, title: t('how.step2'), desc: t('how.step2Desc') },
    { icon: RefreshCw, title: t('how.step3'), desc: t('how.step3Desc') },
  ]

  const faqs = [
    { q: t('landing.faq1Q'), a: t('landing.faq1A') },
    { q: t('landing.faq2Q'), a: t('landing.faq2A') },
    { q: t('landing.faq3Q'), a: t('landing.faq3A') },
    { q: t('landing.faq4Q'), a: t('landing.faq4A') },
  ]

  const platforms = ['Zid', 'Salla', 'Shopify', 'Odoo', 'ERPNext']

  return (
    <div
      className="flex min-h-screen flex-col overflow-x-clip bg-background font-sans text-foreground"
      dir={dir}
    >
      {/* Public schema, not app data */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homepageStructuredData).replace(/</g, '\\u003c') }} />
      <PublicSiteHeader lang={lang} />

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-b border-border">
          <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden />

          <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-6 pb-20 pt-14 md:px-12 md:pb-28 md:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
            {/* Copy */}
            <div>
              <div className="rise-in mb-8 flex flex-wrap items-center gap-3">
                <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                  <Zap className="h-3 w-3" />
                  {isAr ? '٧ أيام تجربة مجانية' : '7-day free trial'}
                </span>
                <span className={EYEBROW}>erp-link / sync-layer</span>
              </div>

              <h1
                className="rise-in text-[2.5rem] font-black leading-[1.1] tracking-tight md:text-6xl md:leading-[1.02]"
                style={{ animationDelay: '70ms' }}
              >
                {isAr ? (
                  <>
                    اربط متجرك بالـ ERP
                    <br />
                    <span className="text-primary">بخطٍّ واحد لا ينقطع</span>
                  </>
                ) : (
                  <>
                    Connect your store to your ERP
                    <br />
                    <span className="text-primary">over one unbroken line</span>
                  </>
                )}
              </h1>

              <p
                className="rise-in mt-6 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg"
                style={{ animationDelay: '140ms' }}
              >
                {t('landing.heroSubtitle')}
              </p>

              <div
                className="rise-in mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center"
                style={{ animationDelay: '210ms' }}
              >
                <Button asChild size="lg" variant="brand" className="h-12 rounded-xl px-7 text-sm font-bold">
                  <Link href="/sign-up" className="inline-flex items-center gap-2">
                    {t('landing.btnStart')}
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 rounded-xl px-6 text-sm font-semibold">
                  <a href="#how-it-works" className="inline-flex items-center gap-2">
                    {t('landing.btnHow')}
                    <ArrowLeft className={cn('h-4 w-4', !isAr && 'rotate-180')} />
                  </a>
                </Button>
              </div>

              <div
                className="rise-in mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-semibold text-muted-foreground"
                style={{ animationDelay: '280ms' }}
              >
                {[t('landing.bullet1'), t('landing.bullet2'), t('landing.bullet3')].map((item) => (
                  <span key={item} className="flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-primary" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {/* Sync schematic */}
            <div className="rise-in relative" style={{ animationDelay: '180ms' }}>
              <div className="relative rounded-2xl border border-border bg-card p-5 shadow-[0_30px_80px_-60px_hsl(var(--primary)/0.6)] md:p-6">
                <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
                  <span className="flex items-center gap-2 text-xs font-bold">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                    </span>
                    {isAr ? 'قناة المزامنة' : 'Sync channel'}
                  </span>
                  <span className={EYEBROW}>{isAr ? 'مباشر' : 'live'}</span>
                </div>

                <div className="flex flex-col">
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-background/60 p-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground/70">
                      <ShoppingBag className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className={cn(EYEBROW, 'text-[9px]')}>{isAr ? 'المتجر' : 'Store'}</p>
                      <p className="truncate text-sm font-bold">Zid · Salla · Shopify</p>
                    </div>
                  </div>

                  <div className="ms-[28px] flex h-10 items-center" aria-hidden>
                    <svg width="2" height="40" viewBox="0 0 2 40" className="overflow-visible">
                      <line
                        x1="1"
                        y1="0"
                        x2="1"
                        y2="40"
                        stroke="hsl(var(--primary))"
                        strokeWidth="2"
                        strokeOpacity="0.55"
                        className="flow-line"
                      />
                    </svg>
                  </div>

                  <div className="flex items-center gap-3 rounded-lg border border-primary/35 bg-primary/[0.06] p-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <LinkIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className={cn(EYEBROW, 'text-[9px]')}>{isAr ? 'محرّك الربط' : 'Link engine'}</p>
                      <p className="truncate text-sm font-bold">ErpLink</p>
                    </div>
                    <span className="ms-auto font-mono text-[10px] font-bold text-primary">2s</span>
                  </div>

                  <div className="ms-[28px] flex h-10 items-center" aria-hidden>
                    <svg width="2" height="40" viewBox="0 0 2 40" className="overflow-visible">
                      <line
                        x1="1"
                        y1="0"
                        x2="1"
                        y2="40"
                        stroke="hsl(var(--primary))"
                        strokeWidth="2"
                        strokeOpacity="0.55"
                        className="flow-line"
                      />
                    </svg>
                  </div>

                  <div className="flex items-center gap-3 rounded-lg border border-border bg-background/60 p-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground/70">
                      <Box className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className={cn(EYEBROW, 'text-[9px]')}>{isAr ? 'نظام الـ ERP' : 'ERP'}</p>
                      <p className="truncate text-sm font-bold">Odoo · ERPNext</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 space-y-1.5 border-t border-border pt-4 font-mono text-[10.5px] leading-relaxed">
                  {flowLog.map((row, idx) => (
                    <div
                      key={row.from}
                      className="rise-in flex items-center gap-2"
                      style={{ animationDelay: `${320 + idx * 80}ms` }}
                    >
                      <span className="w-12 shrink-0 text-muted-foreground">{row.time}</span>
                      <span className="truncate text-muted-foreground">{row.from}</span>
                      <span className="text-primary">→</span>
                      <span className="truncate font-bold text-foreground">{row.to}</span>
                      <Check className="ms-auto h-3 w-3 shrink-0 text-primary" />
                    </div>
                  ))}
                </div>
              </div>

              <span className="absolute -top-3 end-4 rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                schema 01
              </span>
            </div>
          </div>

          {/* Proof numbers */}
          <div className="relative border-t border-border bg-secondary/30">
            <div className="mx-auto grid max-w-7xl grid-cols-3 divide-x divide-border px-6 md:px-12 rtl:divide-x-reverse">
              {[
                { value: '99.9%', label: t('landing.stats1') },
                { value: '<2s', label: t('landing.stats2') },
                { value: '24/7', label: isAr ? 'دعم فني' : 'Support' },
              ].map((s, idx) => (
                <div
                  key={s.label}
                  className="reveal px-3 py-6 text-center"
                  style={{ animationDelay: `${idx * 90}ms` }}
                >
                  <div className="font-mono text-2xl font-black tabular-nums tracking-tight md:text-3xl">
                    {s.value}
                  </div>
                  <div className={cn(EYEBROW, 'mt-1.5 text-[9px]')}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Platforms strip ─────────────────────────────────── */}
        <section className="border-b border-border">
          <div className="reveal mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 py-5 md:px-12">
            <span className={EYEBROW}>{t('landing.trustedBy')}</span>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 md:gap-x-10">
              {platforms.map((p) => (
                <span
                  key={p}
                  className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground/65 transition-colors duration-300 hover:text-primary"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── 01 · Before / After ─────────────────────────────── */}
        <section className="px-6 py-20 md:px-12 md:py-28">
          <div className="mx-auto max-w-6xl">
            <div className="reveal mb-10 grid items-start gap-5 md:grid-cols-[180px_1fr] md:gap-10">
              <div className={cn(EYEBROW, 'md:pt-2')}>01 — {isAr ? 'الفارق' : 'the delta'}</div>
              <h2 className="text-3xl font-black leading-tight tracking-tight md:text-5xl">
                {isAr ? (
                  <>
                    قبل ERP Link،
                    <br />
                    <span className="text-muted-foreground">كل طلب كان عملية يدوية.</span>
                  </>
                ) : (
                  <>
                    Before ERP Link,
                    <br />
                    <span className="text-muted-foreground">every order was manual work.</span>
                  </>
                )}
              </h2>
            </div>

            <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2">
              <div className="reveal bg-card p-6 md:p-8">
                <p className={cn(EYEBROW, 'mb-5')}>{isAr ? 'قبل' : 'before'}</p>
                <ul className="space-y-3">
                  {before.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground">
                        <X className="h-3 w-3" />
                      </span>
                      <span className="leading-relaxed text-muted-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div
                className="reveal bg-card p-6 md:p-8"
                style={{ animationDelay: '110ms' }}
              >
                <p className={cn(EYEBROW, 'mb-5 text-primary')}>{isAr ? 'بعد' : 'after'}</p>
                <ul className="space-y-3">
                  {after.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="leading-relaxed text-foreground/85">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── 02 · Capabilities ───────────────────────────────── */}
        <section
          id="features"
          className="scroll-mt-14 border-y border-border bg-secondary/20 px-6 py-20 md:scroll-mt-16 md:px-12 md:py-28"
        >
          <div className="mx-auto max-w-6xl">
            <div className="reveal mb-10 grid items-start gap-5 md:grid-cols-[180px_1fr] md:gap-10">
              <div className={cn(EYEBROW, 'md:pt-2')}>02 — {isAr ? 'القدرات' : 'capabilities'}</div>
              <div className="space-y-4">
                <h2 className="text-3xl font-black tracking-tight md:text-5xl">
                  {t('landing.featuresTitle')}
                </h2>
                <p className="max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
                  {t('landing.featuresDesc')}
                </p>
              </div>
            </div>

            <div className="border-t border-border">
              {features.map(({ icon: Icon, title, desc }, idx) => (
                <div
                  key={title}
                  className="reveal group grid grid-cols-[32px_1fr] items-start gap-x-4 gap-y-2 border-b border-border py-6 transition-colors hover:bg-card md:grid-cols-[56px_250px_1fr] md:items-center md:gap-6 md:px-3"
                  style={{ animationDelay: `${Math.min(idx, 5) * 70}ms` }}
                >
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <div className="flex items-center gap-3">
                    <Icon className="h-4 w-4 shrink-0 text-primary transition-transform duration-300 group-hover:scale-110" />
                    <h3 className="text-sm font-bold md:text-base">{title}</h3>
                  </div>
                  <p className="col-start-2 text-sm leading-relaxed text-muted-foreground md:col-start-3">
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 03 · Custom mapping ─────────────────────────────── */}
        <section
          id="custom-mapping"
          className="scroll-mt-14 px-6 py-20 md:scroll-mt-16 md:px-12 md:py-28"
        >
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_0.9fr] lg:gap-16">
            <div className="reveal">
              <div className={cn(EYEBROW, 'mb-5')}>03 — {isAr ? 'الربط المخصص' : 'custom mapping'}</div>
              <h2 className="text-3xl font-black leading-tight tracking-tight md:text-5xl">
                {isAr ? (
                  <>
                    ربط مخصص…
                    <br />
                    <span className="text-primary">مش بس الافتراضي</span>
                  </>
                ) : (
                  <>
                    Custom mapping,
                    <br />
                    <span className="text-primary">not just the default</span>
                  </>
                )}
              </h2>
              <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground md:text-base">
                {isAr
                  ? 'لو احتياجك خارج الجاهز، ابنِ ربطك بنفسك: اختر أي موديول في Odoo — حتى الموديولات المخصصة التي أنشأتها — وحدّد الحدث في متجرك، والاتجاه، والعملية، والحقول. كله من داخل النظام بدون كود.'
                  : 'If your case goes beyond the built-in presets, build the mapping yourself: pick any Odoo module — including your own custom models — then choose the store event, direction, operation, and fields. All in-app, no code.'}
              </p>

              <ul className="mt-7 space-y-3">
                {[
                  isAr
                    ? 'أي موديول في Odoo، حتى الموديولات المخصصة (x_)'
                    : 'Any Odoo module, including custom (x_) models',
                  isAr
                    ? 'أي حدث من أحداث المتجر: إنشاء، تعديل، أو حذف'
                    : 'Any store event: create, update, or delete',
                  isAr
                    ? 'اتجاه واحد أو مزدوج: من المتجر للـ ERP، أو العكس، أو كلاهما'
                    : 'One-way or dual: store to ERP, ERP to store, or both',
                  isAr
                    ? 'تحكم كامل بالحقول، والموديلات المرتبطة، والحقول المخصصة'
                    : 'Full control of fields, related models, and custom fields',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="leading-relaxed text-foreground/80">{item}</span>
                  </li>
                ))}
              </ul>

              <Button asChild size="sm" className="mt-7 h-9 px-4 text-xs font-bold">
                <Link href="/sign-up">{isAr ? 'جرّب الربط المخصص' : 'Try custom mapping'}</Link>
              </Button>
            </div>

            <div
              className="reveal overflow-hidden rounded-xl border border-border bg-card"
              style={{ animationDelay: '120ms' }}
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  routes.json
                </span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                  {isAr ? 'اتجاهان' : 'bidirectional'}
                </span>
              </div>
              <div className="divide-y divide-border">
                {routes.map((row) => (
                  <div
                    key={row.event}
                    className={cn(
                      'grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-3 font-mono text-[11px] transition-colors hover:bg-secondary/50',
                      row.custom && 'bg-primary/[0.04]'
                    )}
                  >
                    <span className={cn('truncate', row.custom ? 'text-primary' : 'text-muted-foreground')}>
                      {row.event}
                    </span>
                    <ArrowLeft className={cn('h-3 w-3 shrink-0 text-primary/70', !isAr && 'rotate-180')} />
                    <span className="truncate text-end font-bold text-foreground">{row.model}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-border bg-secondary/40 px-4 py-2.5 font-mono text-[10px] text-muted-foreground">
                {isAr ? '٣ مسارات افتراضية + مسار مخصص' : '3 default routes + 1 custom'}
              </div>
            </div>
          </div>
        </section>

        {/* ── 04 · How it works ───────────────────────────────── */}
        <section
          id="how-it-works"
          className="scroll-mt-16 border-y border-border bg-secondary/20 px-6 py-20 md:scroll-mt-20 md:px-12 md:py-28"
        >
          <div className="mx-auto max-w-6xl">
            <div className="reveal mb-12 grid items-start gap-5 md:grid-cols-[180px_1fr] md:gap-10">
              <div className={cn(EYEBROW, 'md:pt-2')}>04 — {isAr ? 'الخطوات' : 'the steps'}</div>
              <div className="space-y-3">
                <h2 className="text-3xl font-black tracking-tight md:text-5xl">{t('how.title')}</h2>
                <p className="text-sm text-muted-foreground md:text-base">{t('how.subtitle')}</p>
              </div>
            </div>

            <div className="grid gap-10 md:grid-cols-3 md:gap-8">
              {steps.map(({ icon: Icon, title, desc }, idx) => (
                <div
                  key={title}
                  className="reveal relative"
                  style={{ animationDelay: `${idx * 110}ms` }}
                >
                  <div className="mb-5 flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 font-mono text-[11px] font-bold text-primary">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span
                      className={cn(
                        'hidden h-px flex-1 md:block',
                        idx < steps.length - 1
                          ? 'bg-gradient-to-r from-primary/40 to-border rtl:bg-gradient-to-l'
                          : 'bg-transparent'
                      )}
                    />
                    <Icon className="h-4 w-4 text-muted-foreground md:hidden" />
                  </div>
                  <h3 className="text-base font-bold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 05 · One plan ───────────────────────────────────── */}
        <section className="px-6 py-20 md:px-12 md:py-24">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1fr_auto] lg:gap-16">
            <div className="reveal">
              <div className="mb-5 flex items-center gap-2">
                <div className={EYEBROW}>05 — {isAr ? 'الخطة' : 'the plan'}</div>
                <Shield className="h-3.5 w-3.5 text-primary" />
              </div>
              <h2 className="text-3xl font-black tracking-tight md:text-5xl">
                {isAr ? 'سعر واحد، كل المزايا' : 'One price, every feature'}
              </h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground md:text-base">
                {isAr
                  ? 'ابدأ بتجربة مجانية ٧ أيام، ثم استمر بسعر ثابت — بدون باقات متعددة ولا حدود مخفية.'
                  : 'Start with a 7-day free trial, then continue at one flat price — no plan tiers, no hidden limits.'}
              </p>
              <ul className="mt-6 space-y-2.5">
                {[
                  isAr ? 'متاجر وأعضاء فريق غير محدودين' : 'Unlimited stores and team members',
                  isAr ? 'كل المزايا مفتوحة من اليوم الأول' : 'Every feature unlocked from day one',
                  isAr ? 'إلغاء في أي وقت' : 'Cancel anytime',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-foreground/80">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div
              className="reveal w-full rounded-2xl border border-border bg-card p-8 shadow-[0_24px_60px_-48px_hsl(var(--primary)/0.55)] lg:w-[340px]"
              style={{ animationDelay: '120ms' }}
            >
              <div className="flex items-center justify-between">
                <p className={EYEBROW}>{t('pricing.business.name')}</p>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                  {isAr ? '٧ أيام مجاناً' : '7 days free'}
                </span>
              </div>
              <div className="mt-5 flex items-baseline gap-1.5">
                <span className="font-mono text-5xl font-black tabular-nums">
                  <span className="align-top text-xl text-muted-foreground">$</span>
                  {t('pricing.business.price')}
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  {t('pricing.business.period')}
                </span>
              </div>
              <Button asChild variant="brand" className="mt-7 w-full rounded-xl font-bold">
                <Link href="/pricing">{isAr ? 'عرض الخطة' : 'View the plan'}</Link>
              </Button>
              <Link
                href="/sign-up"
                className="mt-3 block text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('landing.startFree')}
              </Link>
            </div>
          </div>
        </section>

        {/* ── Search-friendly integration entry points ──────────── */}
        <section className="border-t border-border px-6 py-16 md:px-12 md:py-20" aria-labelledby="integration-guides-heading">
          <div className="mx-auto max-w-6xl">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className={EYEBROW}>erp-link / integrations</p>
                <h2 id="integration-guides-heading" className="mt-3 text-2xl font-black md:text-4xl">
                  {isAr ? 'ربط زد وسلة وشوبيفاي بأودوو' : 'Connect Zid, Salla and Shopify with Odoo'}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
                  {isAr ? 'اعرف خطوات مزامنة الطلبات والمنتجات والمخزون والعملاء، وما يجب اختباره قبل التشغيل.' : 'Explore order, product, inventory and customer flows, with practical checks before rollout.'}
                </p>
              </div>
              <Link href="/integrations" className="text-sm font-bold text-primary underline">{isAr ? 'كل التكاملات' : 'All integrations'}</Link>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {[
                { href: '/integrations/zid-odoo', title: isAr ? 'ربط زد بأودوو' : 'Zid Odoo Integration', description: isAr ? 'الطلبات والمرتجعات والضريبة والمخزون.' : 'Orders, returns, VAT and stock.' },
                { href: '/integrations/salla-odoo', title: isAr ? 'ربط سلة بأودوو' : 'Salla Odoo Integration', description: isAr ? 'الأصناف وحالات الطلب والمخازن.' : 'Catalog, order statuses and warehouses.' },
                { href: '/integrations/shopify-odoo', title: isAr ? 'ربط شوبيفاي بأودوو' : 'Shopify Odoo Integration', description: isAr ? 'الأحداث والمنتجات والمدفوعات والشحن.' : 'Webhooks, products, payments and fulfillment.' },
              ].map((item) => (
                <article key={item.href} className="rounded-2xl border border-border bg-card p-6">
                  <h3 className="text-lg font-bold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">{item.description}</p>
                  <Link href={item.href} className="mt-5 inline-flex text-sm font-bold text-primary underline">{isAr ? 'اقرأ دليل الربط' : 'Read integration guide'}</Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────── */}
        <section className="border-t border-border px-6 py-20 md:px-12 md:py-28">
          <div className="mx-auto max-w-4xl">
            <div className="reveal mb-8 grid items-start gap-5 md:grid-cols-[180px_1fr] md:gap-10">
              <div className={cn(EYEBROW, 'md:pt-2')}>{t('landing.faqBadge')}</div>
              <h2 className="text-3xl font-black tracking-tight md:text-4xl">{t('landing.faqTitle')}</h2>
            </div>

            <div className="border-t border-border">
              {faqs.map((faq, idx) => (
                <details
                  key={idx}
                  className="reveal group border-b border-border"
                  style={{ animationDelay: `${idx * 70}ms` }}
                >
                  <summary className="flex cursor-pointer list-none items-start gap-4 py-5">
                    <span className="pt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span className="flex-1 text-sm font-bold md:text-base">{faq.q}</span>
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="pb-5 ps-10 pe-8 text-sm leading-relaxed text-muted-foreground">
                    {faq.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────────── */}
        <section className="px-6 pb-20 md:px-12 md:pb-28">
          <div className="reveal relative mx-auto max-w-6xl overflow-hidden rounded-3xl border border-border bg-card">
            <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden />
            <div
              className="float-slow pointer-events-none absolute -end-16 -top-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl"
              aria-hidden
            />

            <div className="relative px-6 py-14 text-center md:px-14 md:py-20">
              <span className={cn(EYEBROW, 'inline-flex items-center gap-2')}>
                <Shield className="h-3.5 w-3.5 text-primary" />
                {t('cta.badge')}
              </span>
              <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-black leading-tight tracking-tight md:text-5xl">
                {t('cta.title')}
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
                {t('cta.subtitle')}
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button asChild size="lg" variant="brand" className="h-12 rounded-xl px-8 text-sm font-bold">
                  <Link href="/sign-up" className="inline-flex items-center gap-2">
                    {t('cta.btnStart')}
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 rounded-xl px-6 text-sm font-semibold">
                  <Link href="/sign-in">{t('landing.signIn')}</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicSiteFooter lang={lang} />
    </div>
  )
}
