import {
  ShoppingBag,
  FileText,
  Users,
  Tag,
  Box,
  Link as LinkIcon,
  Settings,
  RefreshCw,
  Layers,
  ArrowLeft,
  Check,
  Zap,
  BarChart3,

  ChevronDown,
  CreditCard,
  ExternalLink,
  Activity,
  Clock,
  Database,
  UserPlus,
  Shield,
  TrendingUp,
  Bell,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { Button } from '@/components/ui/button'
import { type Language, translations } from '@/lib/translations'
import { cn } from '@/lib/utils'

export default function HomePage() {
  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) =>
    translations[lang][key] || translations['ar'][key]

  const features = [
    {
      icon: ShoppingBag,
      title: t('feature.multiStore.title'),
      desc: t('feature.multiStore.desc'),
      dot: 'bg-blue-500',
    },
    {
      icon: FileText,
      title: t('feature.orders.title'),
      desc: t('feature.orders.desc'),
      dot: 'bg-emerald-500',
    },
    {
      icon: Tag,
      title: t('feature.products.title'),
      desc: t('feature.products.desc'),
      dot: 'bg-violet-500',
    },
    {
      icon: Box,
      title: t('feature.stock.title'),
      desc: t('feature.stock.desc'),
      dot: 'bg-amber-500',
    },
    {
      icon: Users,
      title: t('feature.customers.title'),
      desc: t('feature.customers.desc'),
      dot: 'bg-cyan-500',
    },
    {
      icon: CreditCard,
      title: t('feature.accounting.title'),
      desc: t('feature.accounting.desc'),
      dot: 'bg-orange-500',
    },
  ]

  const stats = [
    { value: '99.9%', label: t('landing.stats1') },
    { value: '<2s', label: t('landing.stats2') },
  ]

  const problems = [
    {
      icon: FileText,
      title: lang === 'ar' ? 'إدخال يدوي مكرر' : 'Duplicate Manual Entry',
      desc: lang === 'ar'
        ? 'الطلبات والعملاء والمنتجات تُدخل مرتين — مرة في المتجر ومرة في برنامج ERP. كل طلب جديد يعني نسخ ولصق.'
        : 'Orders, customers and products typed twice — once in your store and once in your ERP. Every new order means copy-paste work.',
      dot: 'bg-blue-500',
    },
    {
      icon: Activity,
      title: lang === 'ar' ? 'انحراف المخزون' : 'Inventory Drift',
      desc: lang === 'ar'
        ? 'البيع على المتجر والمخزون في برنامج ERP. بدون مزامنة لحظية، تبيع منتجات غير متوفرة ويخسر العملاء ثقتهم.'
        : 'Selling on your store while inventory lives in your ERP. Without live sync, you sell out-of-stock items and lose customer trust.',
      dot: 'bg-emerald-500',
    },
    {
      icon: Database,
      title: lang === 'ar' ? 'فوضى البيانات' : 'Data Chaos',
      desc: lang === 'ar'
        ? 'الفئات والعلامات والخصائص تضيع بين النظامين. المطابقة اليدوية للفواتير والعملاء تستهلك ساعات كل أسبوع.'
        : 'Categories, tags and attributes get orphaned between systems. Manual invoice and customer matching eats hours each week.',
      dot: 'bg-violet-500',
    },
    {
      icon: Clock,
      title: lang === 'ar' ? 'كسور صامتة' : 'Silent Failures',
      desc: lang === 'ar'
        ? 'الويبهوك يتعطل ولا تعرف. طلبات تفوت والمخزون يتجمد — تكتشف المشكلة بعد خسارة أيام من العمل.'
        : 'A webhook breaks silently. Orders are missed, inventory freezes — you discover the issue after losing days of work.',
      dot: 'bg-amber-500',
    },
    {
      icon: UserPlus,
      title: lang === 'ar' ? 'فوضى الفرق' : 'Team Chaos',
      desc: lang === 'ar'
        ? 'كل فرد في الفريق يحتاج صلاحيات مختلفة. بدون نظام RBAC، الموظف الجديد قد يخرب المزامنة كلها.'
        : 'Each team member needs different permissions. Without RBAC, a new hire can break your entire sync setup.',
      dot: 'bg-cyan-500',
    },
    {
      icon: TrendingUp,
      title: lang === 'ar' ? 'تشتت المتاجر' : 'Multi-Store Fragmentation',
      desc: lang === 'ar'
        ? 'وكالة تدير ٣٠ متجراً — كل واحد يحتاج توكناته وإعداداته المستقلة. بدون بيئات عمل منفصلة، فوضى عارمة.'
        : 'An agency running 30 stores — each needs its own tokens and independent settings. Without isolated workspaces, it is chaos.',
      dot: 'bg-orange-500',
    },
  ]

  const solutions = [
    {
      icon: RefreshCw,
      title: lang === 'ar' ? 'مزامنة فورية بالويبهوك' : 'Real-time Webhook Sync',
      desc: lang === 'ar'
        ? 'اربط متجرك بأي نظام ERP (أودو، ERPNext، زوهو). الطلبات والمنتجات والمخزون والعملاء يتدفقون تلقائياً — بدون تدخل يدوي. ندعم زد، سلة، وشوبيفاي.'
        : 'Connect your store to any ERP (Odoo, ERPNext, Zoho). Orders, products, inventory and customers flow automatically — no manual work. Supports Zid, Salla & Shopify.',
      detail: lang === 'ar' ? 'اتجاهين (متجر ← ERP ومتجر → ERP)' : 'Bidirectional (Store → ERP and ERP → Store)',
      dot: 'bg-blue-500',
    },
    {
      icon: Layers,
      title: lang === 'ar' ? 'مركز ربط الحقول' : 'Field Mapping Center',
      desc: lang === 'ar'
        ? 'لكل متجر حقوله المختلفة. حدد بالضبط أي حقل في المتجر يقابل أي حقل في برنامج ERP — مع ١٢+ قالب جاهز.'
        : 'Every store has different fields. Map exactly which store field goes to which ERP field — with 12+ pre-built templates.',
      detail: lang === 'ar' ? 'حقول متداخلة، قوالب، مطابقة تلقائية' : 'Nested fields, templates, auto-matching',
      dot: 'bg-emerald-500',
    },
    {
      icon: Shield,
      title: lang === 'ar' ? 'أمان وتشفير كامل' : 'Full Encryption & Security',
      desc: lang === 'ar'
        ? 'جميع البيانات مشفرة بـ SSL/TLS أثناء النقل والتخزين. مفاتيح API والتوكنات مشفرة بـ AES-256-CBC. صلاحيات دقيقة لكل عضو.'
        : 'All data encrypted with SSL/TLS in transit and at rest. API keys and tokens encrypted with AES-256-CBC. Granular permissions per team member.',
      detail: lang === 'ar' ? 'AES-256-CBC · RLS · صلاحيات صفحات' : 'AES-256-CBC · RLS · Page-level RBAC',
      dot: 'bg-violet-500',
    },
    {
      icon: Bell,
      title: lang === 'ar' ? 'إشعارات تيليجرام فورية' : 'Instant Telegram Alerts',
      desc: lang === 'ar'
        ? 'كل عملية مزامنة — نجاح أو فشل — تنبيه فوري على تيليجرام. تعرف على أي مشكلة قبل أن يشتكي العميل.'
        : 'Every sync — success or failure — instant Telegram alert. Know about any issue before your client complains.',
      detail: lang === 'ar' ? 'بوتات متعددة · فلترة · عربي/إنجليزي' : 'Multi-bot · Filtering · AR/EN',
      dot: 'bg-amber-500',
    },
    {
      icon: Activity,
      title: lang === 'ar' ? 'سجل مزامنة وتدقيق' : 'Sync Logs & Audit Trail',
      desc: lang === 'ar'
        ? 'كل عملية مزامنة مسجلة مع التفاصيل الكاملة. ارجع لأي عملية فاشلة، شاهد الـ Payload، وأعد الإرسال بنقرة.'
        : 'Every sync logged with full details. Review any failed operation, inspect the payload, and resend with one click.',
      detail: lang === 'ar' ? 'سجل 72 ساعة · فحص البيانات · إعادة إرسال' : '72h logs · Payload inspection · Resend',
      dot: 'bg-cyan-500',
    },
    {
      icon: Database,
      title: lang === 'ar' ? 'نقل البيانات الأولي' : 'Bulk Historical Transfer',
      desc: lang === 'ar'
        ? 'عند الربط لأول مرة، انقل منتجاتك وعملاءك وفئاتك السابقة دفعة واحدة عبر API — بدون CSV ولا عناء.'
        : 'When first connecting, transfer your existing products, customers and categories in one batch via API — no CSVs, no hassle.',
      detail: lang === 'ar' ? 'API مباشر · شريط تقدم · سجل عمليات' : 'Direct API · Progress bar · Operation log',
      dot: 'bg-orange-500',
    },
  ]

  const faqs = [
    { q: t('landing.faq1Q'), a: t('landing.faq1A') },
    { q: t('landing.faq2Q'), a: t('landing.faq2A') },
    { q: t('landing.faq3Q'), a: t('landing.faq3A') },
    { q: t('landing.faq4Q'), a: t('landing.faq4A') },
  ]

  const platforms = [
    { name: 'Zid', color: 'text-blue-500' },
    { name: 'Salla', color: 'text-emerald-500' },
    { name: 'Shopify', color: 'text-violet-500' },
    { name: 'Odoo', color: 'text-amber-500' },
    { name: 'ERPNext', color: 'text-rose-500' },
    { name: 'Zoho', color: 'text-sky-500' },
  ]

  return (
    <div
      className="flex min-h-screen flex-col bg-background text-foreground font-sans overflow-x-hidden"
      dir={dir}
    >
      <PublicSiteHeader lang={lang} />

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="pt-20 pb-24 px-6 md:px-12 relative">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col items-center text-center gap-6 max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted border border-border">
                <Zap className="h-3 w-3 text-muted-foreground" />
                <span className="text-[11px] font-semibold text-muted-foreground">
                  {t('landing.badge')}
                </span>
              </div>

              <h1 className="text-4xl md:text-5xl font-black text-foreground leading-[1.15] tracking-tight">
                {lang === 'ar' ? (
                  <>اربط <span className="text-foreground">متجرك</span> بنظام <span className="text-foreground">ERP</span></>
                ) : (
                  <>Connect Your Store to Your <span className="text-foreground">ERP System</span></>
                )}
              </h1>

              <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
                {t('landing.heroSubtitle')}
              </p>

              <ul className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
                {[t('landing.bullet1'), t('landing.bullet2'), t('landing.bullet3')].map(
                  (item) => (
                    <li key={item} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-foreground shrink-0" />
                      {item}
                    </li>
                  )
                )}
              </ul>

              <div className="flex flex-row items-center gap-3 pt-2">
                <Button
                  asChild
                  className="bg-foreground text-background hover:bg-foreground/90 h-10 text-xs font-bold px-5"
                >
                  <Link href="/sign-up" className="flex items-center gap-1.5">
                    {t('landing.btnStart')}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="border-border text-foreground hover:bg-muted h-10 text-xs font-semibold px-4"
                >
                  <Link href="#how-it-works" className="flex items-center gap-1.5">
                    {t('landing.btnHow')}
                    <ArrowLeft
                      className={cn(
                        'h-3.5 w-3.5',
                        lang === 'ar' ? '' : 'rotate-180'
                      )}
                    />
                  </Link>
                </Button>
              </div>
            </div>

            {/* Stats bar - like dashboard KPI cards */}
            <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto mt-16">
              {stats.map((s) => (
                <div key={s.label} className="bg-card border border-border p-4 text-center">
                  <div className="text-xl font-bold tracking-tight text-foreground">
                    {s.value}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 font-semibold uppercase tracking-widest">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Trusted Platforms ───────────────────────────────── */}
        <section className="py-10 px-6 md:px-12 border-y border-border bg-muted/30">
          <div className="max-w-5xl mx-auto">
            <p className="text-center text-[10px] text-muted-foreground font-semibold uppercase tracking-widest mb-6">
              {t('landing.trustedBy')}
            </p>
            <div className="flex items-center justify-center flex-wrap gap-6 md:gap-10">
              {platforms.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-2 px-4 py-2 bg-card border border-border"
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', p.color.replace('text-', 'bg-'))} />
                  <span className="text-xs font-semibold text-foreground">
                    {p.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Problems ──────────────────────────────────────────── */}
        <section className="py-16 px-6 md:px-12">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted border border-border text-[11px] font-semibold text-muted-foreground mb-3">
                <Activity className="h-3 w-3" />
                {lang === 'ar' ? 'المشاكل اللي يحلها النظام' : 'Problems We Solve'}
              </span>
              <h2 className="text-2xl font-bold tracking-tight text-foreground mt-2">
                {lang === 'ar' ? 'تعبان من إدخال البيانات يدوياً؟' : 'Tired of manual data entry?'}
              </h2>
              <p className="text-sm text-muted-foreground max-w-xl mx-auto mt-2">
                {lang === 'ar'
                  ? 'هذه هي المشاكل اليومية اللي يواجهها كل تاجر يدير متجره مع نظام ERP — و ERP Link يحلها كلها.'
                  : 'These are the daily problems every merchant faces running a store with an ERP — and ERP Link solves them all.'}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {problems.map(({ icon: Icon, title, desc, dot }) => (
                <div
                  key={title}
                  className="bg-card border border-border p-4 relative"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded bg-muted text-muted-foreground shrink-0 mt-0.5">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dot)} />
                        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {desc}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Solutions / How ERP Link Fixes Them ─────────────── */}
        <section id="solutions" className="py-16 px-6 md:px-12 bg-muted/30">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted border border-border text-[11px] font-semibold text-muted-foreground mb-3">
                <Shield className="h-3 w-3" />
                {lang === 'ar' ? 'الحلول' : 'Solutions'}
              </span>
              <h2 className="text-2xl font-bold tracking-tight text-foreground mt-2">
                {lang === 'ar' ? 'ERP Link يحلها كلها' : 'ERP Link Fixes Them All'}
              </h2>
              <p className="text-sm text-muted-foreground max-w-xl mx-auto mt-2">
                {lang === 'ar'
                  ? ' six حلول متكاملة جاهزة للتطبيق فور ربط حساباتك.'
                  : 'Six integrated solutions ready the moment you connect your accounts.'}
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {solutions.map(({ icon: Icon, title, desc, detail, dot }) => (
                <div
                  key={title}
                  className="bg-card border border-border p-5 relative"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-muted-foreground shrink-0">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dot)} />
                        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">
                        {desc}
                      </p>
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-foreground/60">
                        <Check className="h-3 w-3" />
                        {detail}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────── */}
        <section id="features" className="py-16 px-6 md:px-12">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted border border-border text-[11px] font-semibold text-muted-foreground mb-3">
                <BarChart3 className="h-3 w-3" />
                <span>{t('landing.featuresBadge')}</span>
              </span>
              <h2 className="text-2xl font-bold tracking-tight text-foreground mt-2">
                {t('landing.featuresTitle')}
              </h2>
              <p className="text-sm text-muted-foreground max-w-xl mx-auto mt-2">
                {t('landing.featuresDesc')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {features.map(({ icon: Icon, title, desc, dot }) => (
                <div
                  key={title}
                  className="bg-card border border-border p-4 relative"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-muted text-muted-foreground">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dot)} />
                      <h3 className="text-xs font-semibold text-foreground">{title}</h3>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How It Works ─────────────────────────────────────── */}
        <section
          id="how-it-works"
          className="py-16 px-6 md:px-12 bg-muted/30"
        >
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted border border-border text-[11px] font-semibold text-muted-foreground mb-3">
                <Settings className="h-3 w-3" />
                <span>{t('how.stepsBadge')}</span>
              </span>
              <h2 className="text-2xl font-bold tracking-tight text-foreground mt-2">
                {t('how.title')}
              </h2>
              <p className="text-sm text-muted-foreground mt-2">
                {t('how.subtitle')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  num: lang === 'ar' ? '١' : '1',
                  icon: LinkIcon,
                  title: t('how.step1'),
                  desc: t('how.step1Desc'),
                  dot: 'bg-blue-500',
                },
                {
                  num: lang === 'ar' ? '٢' : '2',
                  icon: Settings,
                  title: t('how.step2'),
                  desc: t('how.step2Desc'),
                  dot: 'bg-emerald-500',
                },
                {
                  num: lang === 'ar' ? '٣' : '3',
                  icon: RefreshCw,
                  title: t('how.step3'),
                  desc: t('how.step3Desc'),
                  dot: 'bg-violet-500',
                },
              ].map(({ num, icon: Icon, title, desc, dot }) => (
                <div
                  key={title}
                  className="bg-card border border-border p-5 text-center"
                >
                  <div className="flex items-center justify-center mb-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded bg-foreground text-background text-sm font-bold">
                      {num}
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded bg-muted text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dot)} />
                  </div>
                  <h3 className="text-xs font-semibold text-foreground mb-1">{title}</h3>
                  <p className="text-[11px] text-muted-foreground leading-relaxed max-w-xs mx-auto">
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────── */}
        <section className="py-16 px-6 md:px-12 bg-muted/30">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-10">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted border border-border text-[11px] font-semibold text-muted-foreground mb-3">
                <ChevronDown className="h-3 w-3" />
                <span>{t('landing.faqBadge')}</span>
              </span>
              <h2 className="text-2xl font-bold tracking-tight text-foreground mt-2">
                {t('landing.faqTitle')}
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

        {/* ── CTA ──────────────────────────────────────────────── */}
        <section className="py-16 px-6 md:px-12">
          <div className="max-w-3xl mx-auto">
            <div className="bg-card border border-border p-8 md:p-10 text-center relative">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted border border-border text-[11px] font-semibold text-muted-foreground">
                  <Shield className="h-3 w-3" />
                  <span>{t('cta.badge')}</span>
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground">
                  {t('cta.title')}
                </h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  {t('cta.subtitle')}
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
                  <Button
                    asChild
                    className="bg-foreground text-background hover:bg-foreground/90 h-10 text-xs font-bold px-5"
                  >
                    <Link href="/sign-up" className="flex items-center gap-1.5">
                      {t('cta.btnStart')}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="border-border text-foreground hover:bg-muted h-10 text-xs font-semibold px-4"
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
