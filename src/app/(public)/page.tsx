import {
  Activity,
  ArrowLeft,
  Bell,
  Box,
  Check,
  ChevronDown,
  ExternalLink,
  Gift,
  Link as LinkIcon,
  RefreshCw,
  Settings,
  Shield,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Users,
  Workflow,
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

  const liveRows = [
    {
      icon: ShoppingBag,
      title: isAr ? 'طلب جديد #1284' : 'New order #1284',
      sub: isAr ? 'أُنشئ في Odoo' : 'Created in Odoo',
      time: isAr ? 'قبل ثانيتين' : '2s ago',
    },
    {
      icon: Box,
      title: isAr ? 'تحديث مخزون' : 'Stock update',
      sub: isAr ? 'من Odoo إلى المتجر' : 'Odoo → store',
      time: isAr ? 'قبل ٤ ثوانٍ' : '4s ago',
    },
    {
      icon: Tag,
      title: isAr ? 'منتج جديد' : 'New product',
      sub: isAr ? 'تمت مزامنته بالكامل' : 'Fully synced',
      time: isAr ? 'قبل ٩ ثوانٍ' : '9s ago',
    },
    {
      icon: Users,
      title: isAr ? 'عميل جديد' : 'New customer',
      sub: isAr ? 'تمت مزامنته' : 'Synced',
      time: isAr ? 'قبل ١٢ ثانية' : '12s ago',
    },
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

  const faqs = [
    { q: t('landing.faq1Q'), a: t('landing.faq1A') },
    { q: t('landing.faq2Q'), a: t('landing.faq2A') },
    { q: t('landing.faq3Q'), a: t('landing.faq3A') },
    { q: t('landing.faq4Q'), a: t('landing.faq4A') },
  ]

  const platforms = ['Zid', 'Salla', 'Shopify', 'Odoo', 'ERPNext']

  return (
    <div
      className="flex min-h-screen flex-col bg-background text-foreground font-sans overflow-x-hidden"
      dir={dir}
    >
      <PublicSiteHeader lang={lang} />

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="pt-20 pb-20 px-6 md:px-12 relative overflow-hidden">
          <div className="absolute top-[-120px] right-[-120px] w-[420px] h-[420px] rounded-full bg-primary/[0.04] blur-3xl pointer-events-none" />
          <div className="absolute bottom-[-140px] left-[-100px] w-[380px] h-[380px] rounded-full bg-foreground/[0.03] blur-3xl pointer-events-none" />

          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-14 lg:gap-16 items-center relative">
            {/* Copy */}
            <div className="space-y-7">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
                <Gift className="h-3 w-3" />
                <span>{isAr ? '٧ أيام تجربة مجانية' : '7-day free trial'}</span>
              </div>

              <h1 className="text-4xl md:text-5xl xl:text-6xl font-black leading-[1.12] tracking-tight">
                {isAr ? (
                  <>اربط متجرك بنظام ERP —<br className="hidden md:block" /> وانسَ الإدخال اليدوي</>
                ) : (
                  <>Connect your store to your ERP —<br className="hidden md:block" /> and forget manual entry</>
                )}
              </h1>

              <p className="text-base md:text-lg text-muted-foreground leading-relaxed max-w-xl">
                {t('landing.heroSubtitle')}
              </p>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <Button
                  asChild
                  size="lg"
                  className="bg-foreground text-background hover:opacity-90 rounded-xl px-7 py-6 text-sm font-bold shadow-sm"
                >
                  <Link href="/sign-up" className="flex items-center gap-1.5">
                    {t('landing.btnStart')}
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="rounded-xl px-6 py-6 text-sm font-semibold"
                >
                  <Link href="#how-it-works" className="flex items-center gap-1.5">
                    {t('landing.btnHow')}
                    <ArrowLeft className={cn('h-4 w-4', !isAr && 'rotate-180')} />
                  </Link>
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                {[
                  isAr ? 'بدون بطاقة ائتمانية' : 'No credit card',
                  isAr ? 'إعداد في دقائق' : 'Setup in minutes',
                  isAr ? 'إلغاء في أي وقت' : 'Cancel anytime',
                ].map((item) => (
                  <span key={item} className="flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {/* Live sync visual */}
            <div className="flex justify-center lg:justify-end">
              <div className="relative w-full max-w-md rotate-[-2deg] transition-transform duration-300 hover:rotate-0">
                <div className="absolute inset-0 translate-x-3 translate-y-3 rounded-3xl border border-border bg-secondary/60" />

                <div className="relative rounded-3xl border border-border bg-card p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                      </span>
                      <span className="text-xs font-bold">
                        {isAr ? 'المزامنة المباشرة' : 'Live sync'}
                      </span>
                    </div>
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      {isAr ? 'الآن' : 'Now'}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {liveRows.map(({ icon: Icon, title, sub, time }) => (
                      <div
                        key={title}
                        className="flex items-center gap-3 rounded-xl border border-border/70 bg-secondary/30 px-3 py-2.5"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-card text-foreground/70 shrink-0">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold truncate">{title}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[9px] text-muted-foreground">{time}</span>
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 pt-4 border-t border-border flex flex-wrap items-center justify-center gap-1.5">
                    {platforms.map((p) => (
                      <span
                        key={p}
                        className="px-2 py-0.5 rounded-md bg-muted text-foreground/70 text-[10px] font-bold"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="max-w-7xl mx-auto mt-16 grid grid-cols-3 gap-4 md:gap-6">
            {[
              { value: '99.9%', label: t('landing.stats1') },
              { value: '<2s', label: t('landing.stats2') },
              { value: '24/7', label: isAr ? 'دعم فني' : 'Support' },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-2xl md:text-3xl font-black tracking-tight">{s.value}</div>
                <div className="text-[11px] text-muted-foreground mt-1 font-semibold">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Platforms strip ─────────────────────────────────── */}
        <section className="py-10 px-6 md:px-12 border-y border-border bg-muted/30">
          <div className="max-w-5xl mx-auto">
            <p className="text-center text-[10px] text-muted-foreground font-semibold uppercase tracking-widest mb-5">
              {t('landing.trustedBy')}
            </p>
            <div className="flex items-center justify-center flex-wrap gap-x-8 gap-y-3 md:gap-x-12">
              {platforms.map((p) => (
                <span key={p} className="text-sm font-bold text-foreground/60">
                  {p}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────── */}
        <section id="features" className="py-20 md:py-28 px-6 md:px-12">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-14 space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
                <Sparkles className="h-3 w-3" />
                <span>{t('landing.featuresBadge')}</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight">
                {t('landing.featuresTitle')}
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
                {t('landing.featuresDesc')}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {features.map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="rounded-2xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-foreground/70 mb-4">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="text-base font-bold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Custom mapping ──────────────────────────────────── */}
        <section id="custom-mapping" className="py-20 md:py-28 px-6 md:px-12 border-y border-border">
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
                <Workflow className="h-3 w-3" />
                <span>{isAr ? 'ميزة متقدمة' : 'Advanced feature'}</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight leading-tight">
                {isAr ? 'ربط مخصص… مش بس الافتراضي' : 'Custom mapping, not just the default'}
              </h2>
              <p className="text-muted-foreground leading-relaxed max-w-md">
                {isAr
                  ? 'لو احتياجك خارج الجاهز، ابنِ ربطك بنفسك: اختر أي موديول في Odoo — حتى الموديولات المخصصة التي أنشأتها — وحدّد الحدث في متجرك، والاتجاه، والعملية، والحقول. كله من داخل النظام بدون كود.'
                  : 'If your case goes beyond the built-in presets, build the mapping yourself: pick any Odoo module — including your own custom models — then choose the store event, direction, operation, and fields. All in-app, no code.'}
              </p>
              <ul className="space-y-3">
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
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background shrink-0 mt-0.5">
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="text-foreground/80 leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                size="sm"
                className="bg-foreground text-background hover:bg-foreground/90 h-9 text-xs font-bold px-4"
              >
                <Link href="/sign-up">
                  {isAr ? 'جرّب الربط المخصص' : 'Try custom mapping'}
                </Link>
              </Button>
            </div>

            {/* Mapping visual */}
            <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-foreground/70">
                    <SlidersHorizontal className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-bold">
                    {isAr ? 'مركز الربط — ربط مخصص' : 'Mapping Center — Custom'}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-bold">
                  {isAr ? 'اتجاهان' : 'Dual'}
                </span>
              </div>
              <div className="divide-y divide-border">
                {[
                  { event: 'order.created', model: 'sale.order', custom: false },
                  { event: 'product.updated', model: 'product.template', custom: false },
                  { event: 'customer.created', model: 'res.partner', custom: false },
                  { event: 'x_custom.event', model: 'x_projects', custom: true },
                ].map((row) => (
                  <div key={row.event} className="flex items-center gap-3 px-5 py-3.5">
                    <code className="text-[11px] text-muted-foreground font-mono truncate">
                      {row.event}
                    </code>
                    <ArrowLeft className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground/50', !isAr && 'rotate-180')} />
                    <code className="text-[11px] font-mono font-bold text-foreground truncate">
                      {row.model}
                    </code>
                    {row.custom && (
                      <span className="ms-auto shrink-0 px-2 py-0.5 rounded-md bg-foreground text-background text-[9px] font-bold">
                        {isAr ? 'موديول مخصص' : 'Custom'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="px-5 py-3.5 bg-muted/40 border-t border-border">
                <p className="text-[11px] text-muted-foreground">
                  {isAr
                    ? 'أي موديول • أي حدث • تحكم كامل بالحقول'
                    : 'Any module • any event • full field control'}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Before / After ──────────────────────────────────── */}
        <section className="py-20 md:py-28 px-6 md:px-12 bg-muted/30">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-14 space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
                <Zap className="h-3 w-3" />
                <span>{isAr ? 'الفرق واضح' : 'The difference'}</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight">
                {isAr ? 'قبل ERP Link وبعده' : 'Before and after ERP Link'}
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-border bg-card p-6 md:p-7">
                <h3 className="text-sm font-black text-muted-foreground uppercase tracking-wide mb-5">
                  {isAr ? 'قبل' : 'Before'}
                </h3>
                <ul className="space-y-3">
                  {before.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground shrink-0 mt-0.5">
                        <X className="h-3 w-3" />
                      </span>
                      <span className="text-muted-foreground leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-primary/30 bg-card p-6 md:p-7 shadow-sm">
                <h3 className="text-sm font-black text-primary uppercase tracking-wide mb-5">
                  {isAr ? 'مع ERP Link' : 'With ERP Link'}
                </h3>
                <ul className="space-y-3">
                  {after.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background shrink-0 mt-0.5">
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="text-foreground/80 leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── How It Works ─────────────────────────────────────── */}
        <section id="how-it-works" className="py-20 md:py-28 px-6 md:px-12">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-14 space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
                <Settings className="h-3 w-3" />
                <span>{t('how.stepsBadge')}</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight">
                {t('how.title')}
              </h2>
              <p className="text-muted-foreground">{t('how.subtitle')}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative">
              {[
                { num: isAr ? '١' : '1', icon: LinkIcon, title: t('how.step1'), desc: t('how.step1Desc') },
                { num: isAr ? '٢' : '2', icon: Settings, title: t('how.step2'), desc: t('how.step2Desc') },
                { num: isAr ? '٣' : '3', icon: RefreshCw, title: t('how.step3'), desc: t('how.step3Desc') },
              ].map(({ num, icon: Icon, title, desc }, idx) => (
                <div key={title} className="relative rounded-2xl border border-border bg-card p-6 md:p-7">
                  <div className="flex items-center justify-between mb-5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground text-background text-sm font-black">
                      {num}
                    </span>
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <h3 className="text-base font-bold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                  {idx < 2 && (
                    <span className="hidden md:block absolute top-1/2 -translate-y-1/2 ltr:-right-3 rtl:-left-3 text-muted-foreground/40">
                      <ArrowLeft className={cn('h-5 w-5', !isAr && 'rotate-180')} />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pricing teaser ──────────────────────────────────── */}
        <section className="py-20 md:py-24 px-6 md:px-12 bg-muted/30">
          <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
                <Shield className="h-3 w-3" />
                <span>{isAr ? 'خطة واحدة' : 'One plan'}</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight">
                {isAr ? 'سعر واحد، كل المزايا' : 'One price, every feature'}
              </h2>
              <p className="text-muted-foreground leading-relaxed max-w-md">
                {isAr
                  ? 'ابدأ بتجربة مجانية ٧ أيام، ثم استمر بسعر ثابت — بدون باقات متعددة ولا حدود مخفية.'
                  : 'Start with a 7-day free trial, then continue at one flat price — no plan tiers, no hidden limits.'}
              </p>
              <ul className="space-y-2.5">
                {[
                  isAr ? 'متاجر وأعضاء فريق غير محدودين' : 'Unlimited stores and team members',
                  isAr ? 'كل المزايا مفتوحة من اليوم الأول' : 'Every feature unlocked from day one',
                  isAr ? 'إلغاء في أي وقت' : 'Cancel anytime',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-card text-foreground shrink-0 mt-0.5">
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="text-foreground/80">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex justify-center lg:justify-end">
              <div className="relative w-full max-w-sm rotate-[2deg] transition-transform duration-300 hover:rotate-0">
                <div className="absolute inset-0 -translate-x-3 translate-y-3 rounded-3xl border border-border bg-secondary/70" />

                <div className="relative rounded-3xl border border-border bg-card p-8 shadow-xl">
                  <p className="text-sm font-bold text-muted-foreground mb-3">
                    {t('pricing.business.name')}
                  </p>
                  <div className="flex items-baseline gap-1.5 mb-2">
                    <span className="text-5xl font-black">
                      <span className="text-2xl font-black text-foreground/60 align-top">$</span>
                      {t('pricing.business.price')}
                    </span>
                    <span className="text-sm text-muted-foreground font-medium">
                      {t('pricing.business.period')}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-primary mb-7">
                    {isAr ? '٧ أيام تجربة مجانية' : '7-day free trial'}
                  </p>

                  <Button
                    asChild
                    className="w-full rounded-xl font-bold bg-foreground text-background hover:opacity-90"
                  >
                    <Link href="/pricing">{isAr ? 'عرض الخطة' : 'View the plan'}</Link>
                  </Button>
                  <Link
                    href="/sign-up"
                    className="mt-3 block text-center text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t('landing.startFree')}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────── */}
        <section className="py-20 md:py-28 px-6 md:px-12">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-12 space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
                <ChevronDown className="h-3 w-3" />
                <span>{t('landing.faqBadge')}</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight">
                {t('landing.faqTitle')}
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

        {/* ── CTA ──────────────────────────────────────────────── */}
        <section className="pt-4 pb-20 px-6 md:px-12">
          <div className="max-w-4xl mx-auto">
            <div className="rounded-3xl bg-card border border-border p-10 md:p-14 text-center relative overflow-hidden shadow-sm">
              <div className="absolute inset-0 bg-muted/20" />

              <div className="relative space-y-5">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-muted text-muted-foreground text-sm font-semibold">
                  <Bell className="h-3.5 w-3.5" />
                  <span>{t('cta.badge')}</span>
                </div>

                <h2 className="text-3xl md:text-4xl font-black tracking-tight leading-tight">
                  {t('cta.title')}
                </h2>

                <p className="text-muted-foreground max-w-lg mx-auto leading-relaxed">
                  {t('cta.subtitle')}
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
                  <Button
                    asChild
                    size="lg"
                    className="bg-foreground text-background hover:opacity-90 rounded-xl px-8 py-6 text-base font-bold shadow-sm"
                  >
                    <Link href="/sign-up" className="flex items-center gap-2">
                      {t('cta.btnStart')}
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="rounded-xl px-6 py-6 text-base font-semibold"
                  >
                    <Link href="/sign-in">{t('landing.signIn')}</Link>
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
