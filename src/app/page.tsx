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
  Shield,
  BarChart3
} from 'lucide-react'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { SignedIn, SignedOut } from '@clerk/nextjs'

import { Button } from '@/components/ui/button'
import { Language, translations } from '@/lib/translations'
import LanguageSwitcher from '@/components/language-switcher'
import ThemeSwitcher from '@/components/theme-switcher'
import { cn } from '@/lib/utils'

export default function HomePage() {
  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) => translations[lang][key] || translations['ar'][key]

  const features = [
    {
      icon: FileText,
      title: t('feature.orders.title'),
      desc: t('feature.orders.desc'),
      color: 'blue',
    },
    {
      icon: Tag,
      title: t('feature.products.title'),
      desc: t('feature.products.desc'),
      color: 'violet',
    },
    {
      icon: Box,
      title: t('feature.stock.title'),
      desc: t('feature.stock.desc'),
      color: 'blue',
    },
    {
      icon: Users,
      title: t('feature.customers.title'),
      desc: t('feature.customers.desc'),
      color: 'violet',
    },
    {
      icon: FileText,
      title: t('feature.accounting.title'),
      desc: t('feature.accounting.desc'),
      color: 'blue',
    },
    {
      icon: ShoppingBag,
      title: t('feature.multiStore.title'),
      desc: t('feature.multiStore.desc'),
      color: 'violet',
    },
  ]

  const stats = [
    { value: '99.9%', label: t('landing.stats1') },
    { value: '<2s', label: t('landing.stats2') },
    { value: '500+', label: t('landing.stats3') },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground font-sans overflow-x-hidden" dir={dir}>

      {/* ── Header ───────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 w-full border-b border-border/70 glass-light">
        <div className="flex h-16 items-center justify-between px-6 md:px-12 max-w-7xl mx-auto">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 select-none">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-brand text-white shadow-primary">
              <Layers className="h-5 w-5" />
            </div>
            <span className="text-xl font-black tracking-tight text-foreground">ERP Link</span>
          </Link>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
            <Link href="#features" className="transition-colors hover:text-primary">{t('landing.features')}</Link>
            <Link href="#how-it-works" className="transition-colors hover:text-primary">{t('landing.btnHow')}</Link>
            <Link href="#pricing" className="transition-colors hover:text-primary">{t('landing.pricing')}</Link>
          </nav>

          {/* CTA */}
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <ThemeSwitcher />
            
            <SignedOut>
              <Link href="/sign-in" className="text-sm font-semibold text-slate-600 hover:text-blue-600 transition-colors hidden sm:block">
                {t('landing.signIn')}
              </Link>
              <Button asChild size="sm" className="gradient-brand text-white rounded-xl px-5 shadow-primary hover:shadow-lg hover:opacity-90 transition-all duration-200 font-bold">
                <Link href="/sign-up">{t('landing.startFree')}</Link>
              </Button>
            </SignedOut>

            <SignedIn>
              <Button asChild size="sm" className="gradient-primary text-white rounded-xl px-5 shadow-primary hover:shadow-lg hover:opacity-90 transition-all duration-200 font-bold">
                <Link href="/dashboard">{t('landing.goToDashboard')}</Link>
              </Button>
            </SignedIn>
          </div>
        </div>
      </header>

      <main className="flex-1">

        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="gradient-hero pt-20 pb-28 px-6 md:px-12 relative overflow-hidden">
          {/* Decorative circles */}
          <div className="absolute top-[-80px] right-[-80px] w-[400px] h-[400px] rounded-full bg-blue-500/5 blur-3xl pointer-events-none" />
          <div className="absolute bottom-[-80px] left-[-80px] w-[350px] h-[350px] rounded-full bg-violet-500/5 blur-3xl pointer-events-none" />

          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center relative">

            {/* Text details */}
            <div className={cn("space-y-8", lang === 'ar' ? "text-right" : "text-left")}>
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-600 text-sm font-semibold">
                <Zap className="h-3.5 w-3.5" />
                <span>{t('landing.badge')}</span>
              </div>

              <h1 className="text-5xl md:text-6xl font-black text-slate-900 leading-[1.15] tracking-tight">
                {t('landing.heroTitle1')}{' '}
                <span className="text-blue-600 font-extrabold">{t('landing.heroTitle2')}</span>
                {' '}{t('landing.heroTitle3')}{' '}
                <span className="text-violet-600 font-extrabold">{t('landing.heroTitle4')}</span>
              </h1>

              <p className="text-lg text-slate-500 leading-relaxed max-w-lg">
                {t('landing.heroSubtitle')}
              </p>

              {/* Social proof */}
              <ul className="flex flex-col gap-2 text-sm text-slate-600">
                {[t('landing.bullet1'), t('landing.bullet2'), t('landing.bullet3')].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shrink-0">
                      <Check className="h-3 w-3" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>

              <div className="flex flex-row items-center gap-4 pt-2">
                <Button asChild className="gradient-brand text-white rounded-xl px-8 py-6 text-base font-bold shadow-primary hover:shadow-lg hover:opacity-90 transition-all duration-200">
                  <Link href="/sign-up">{t('landing.btnStart')}</Link>
                </Button>
                <Button asChild variant="outline" className="border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl px-6 py-6 text-base font-semibold transition-all duration-200">
                  <Link href="#how-it-works" className="flex items-center gap-2">
                    <span>{t('landing.btnHow')}</span>
                    <ArrowLeft className={cn("h-4 w-4 transition-transform", lang === 'ar' ? "group-hover:-translate-x-0.5" : "group-hover:translate-x-0.5 rotate-180")} />
                  </Link>
                </Button>
              </div>
            </div>

            {/* Right: Visual */}
            <div className="flex justify-center items-center lg:justify-end">
              <div className="relative w-[380px] h-[380px] flex items-center justify-center">
                {/* Outer animated ring */}
                <svg className="absolute w-[320px] h-[320px] animate-spin-slow" viewBox="0 0 200 200" fill="none">
                  <circle cx="100" cy="100" r="80" stroke="url(#ringGrad)" strokeWidth="1.5" strokeDasharray="8 6" />
                  <defs>
                    <linearGradient id="ringGrad" x1="0" y1="0" x2="200" y2="200">
                      <stop offset="0%" stopColor="#2563EB" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#7C3AED" stopOpacity="0.4" />
                    </linearGradient>
                  </defs>
                </svg>

                {/* Inner ring */}
                <div className="absolute w-[220px] h-[220px] rounded-full border border-slate-200/60" />

                {/* Central node */}
                <div className="absolute z-10 w-24 h-24 rounded-2xl gradient-brand flex flex-col items-center justify-center text-center shadow-primary border-4 border-white">
                  <RefreshCw className="h-6 w-6 text-white mb-1 animate-spin-slow" style={{ animationDuration: '3s' }} />
                  <span className="text-[10px] font-black text-white uppercase tracking-widest">ERP Link</span>
                </div>

                {/* Orbit nodes */}
                {[
                  { icon: FileText, label: t('feature.orders.title'), pos: 'top-4 left-1/2 -translate-x-1/2', color: 'blue' },
                  { icon: ShoppingBag, label: t('feature.multiStore.title'), pos: 'right-4 top-1/2 -translate-y-1/2', color: 'violet' },
                  { icon: Box, label: t('feature.stock.title'), pos: 'bottom-4 left-1/2 -translate-x-1/2', color: 'blue' },
                  { icon: Tag, label: t('db.storeOdoo'), pos: 'left-4 top-1/2 -translate-y-1/2', color: 'violet' },
                ].map(({ icon: Icon, label, pos, color }) => (
                  <div key={label} className={`absolute ${pos} z-10`}>
                    <div className={`w-14 h-14 rounded-2xl bg-white border-2 ${color === 'blue' ? 'border-blue-200 text-blue-600' : 'border-violet-200 text-violet-600'} shadow-card flex flex-col items-center justify-center gap-0.5`}>
                      <Icon className="h-5 w-5" />
                      <span className="text-[9px] font-bold">{label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Stats bar */}
          <div className="max-w-7xl mx-auto mt-20">
            <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto">
              {stats.map((s) => (
                <div key={s.label} className="text-center">
                  <div className="text-3xl font-black text-slate-900">{s.value}</div>
                  <div className="text-xs text-slate-500 mt-1 font-medium">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────── */}
        <section id="features" className="py-24 px-6 md:px-12 bg-white">
          <div className="max-w-7xl mx-auto">
            {/* Section header */}
            <div className="text-center mb-16 space-y-4">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-50 border border-violet-100 text-violet-600 text-sm font-semibold">
                <BarChart3 className="h-3.5 w-3.5" />
                <span>{t('landing.featuresBadge')}</span>
              </div>
              <h2 className="text-4xl font-black text-slate-900">{t('landing.featuresTitle')}</h2>
              <p className="text-slate-500 text-lg max-w-xl mx-auto">
                {t('landing.featuresDesc')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {features.map(({ icon: Icon, title, desc, color }) => (
                <div
                  key={title}
                  className="group relative bg-white rounded-2xl border border-slate-100 p-7 shadow-card card-hover overflow-hidden"
                >
                  {/* Top accent line */}
                  <div className={cn("absolute top-0 right-0 h-1 w-full rounded-t-2xl", color === 'blue' ? 'gradient-primary' : 'gradient-accent')} />

                  <div className={cn("inline-flex p-3 rounded-xl mb-5", color === 'blue' ? 'bg-blue-50 text-blue-600' : 'bg-violet-50 text-violet-600')}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">{title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How It Works ─────────────────────────────────────── */}
        <section id="how-it-works" className="py-24 px-6 md:px-12 bg-[#F5F7FA]">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-16 space-y-4">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-600 text-sm font-semibold">
                <Settings className="h-3.5 w-3.5" />
                <span>{t('how.stepsBadge')}</span>
              </div>
              <h2 className="text-4xl font-black text-slate-900">{t('how.title')}</h2>
              <p className="text-slate-500 text-lg">{t('how.subtitle')}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
              {/* Connector line (desktop) */}
              <div className={cn("hidden md:block absolute top-16 h-0.5 bg-gradient-to-l from-violet-200 via-blue-200 to-blue-200", lang === 'ar' ? "right-[16.5%] left-[16.5%]" : "left-[16.5%] right-[16.5%]")} />

              {[
                { num: lang === 'ar' ? '١' : '1', icon: LinkIcon, title: t('how.step1'), desc: t('how.step1Desc') },
                { num: lang === 'ar' ? '٢' : '2', icon: Settings, title: t('how.step2'), desc: t('how.step2Desc') },
                { num: lang === 'ar' ? '٣' : '3', icon: RefreshCw, title: t('how.step3'), desc: t('how.step3Desc') },
              ].map(({ num, icon: Icon, title, desc }) => (
                <div key={title} className="relative flex flex-col items-center text-center space-y-4">
                  {/* Step number circle */}
                  <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl gradient-brand text-white text-2xl font-black shadow-primary">
                    {num}
                  </div>
                  <div className="w-10 h-10 -mt-2 flex items-center justify-center rounded-xl bg-white border border-slate-100 shadow-card text-blue-600">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">{title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed max-w-xs">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA Banner ───────────────────────────────────────── */}
        <section className="py-20 px-6 md:px-12 bg-white">
          <div className="max-w-4xl mx-auto text-center">
            <div className="rounded-3xl gradient-brand p-12 md:p-16 relative overflow-hidden shadow-primary">
              {/* Decorative */}
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.1),transparent_60%)]" />

              <div className="relative space-y-6">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/20 text-white text-sm font-semibold backdrop-blur-sm">
                  <Shield className="h-3.5 w-3.5" />
                  <span>{t('cta.badge')}</span>
                </div>
                <h2 className="text-4xl md:text-5xl font-black text-white leading-tight">
                  {t('cta.title')}
                </h2>
                <p className="text-blue-100 text-lg max-w-lg mx-auto">
                  {t('cta.subtitle')}
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
                  <Button asChild size="lg" className="bg-white text-blue-700 hover:bg-blue-50 rounded-xl px-8 py-6 text-base font-bold shadow-lg transition-all duration-200">
                    <Link href="/sign-up">{t('cta.btnStart')}</Link>
                  </Button>
                  <Button asChild variant="ghost" size="lg" className="text-white hover:bg-white/10 rounded-xl px-6 py-6 text-base font-semibold">
                    <Link href="/sign-in">{t('landing.signIn')}</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 py-10 bg-white">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-brand text-white">
              <Layers className="h-4 w-4" />
            </div>
            <span className="font-bold text-slate-900">ERP Link</span>
          </div>
          <p className="text-sm text-slate-500">{t('footer.rights')}</p>
          <div className="flex gap-6 text-sm text-slate-500">
            <Link href="#" className="hover:text-blue-600 transition-colors">{t('footer.privacy')}</Link>
            <Link href="#" className="hover:text-blue-600 transition-colors">{t('footer.terms')}</Link>
            <Link href="#" className="hover:text-blue-600 transition-colors">{t('footer.contact')}</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
