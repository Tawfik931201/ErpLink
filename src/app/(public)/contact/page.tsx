import {
  ArrowLeft,
  Clock,
  Headset,
  LifeBuoy,
  Link2,
  MessageSquare,
  Receipt,
  ShieldCheck,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { ContactForm } from '@/components/contact-form'
import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { resolveLanguage } from '@/lib/translations'
import { cn } from '@/lib/utils'

const EYEBROW = 'font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground'

export default async function ContactPage() {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const isAr = lang === 'ar'

  const steps = [
    {
      title: isAr ? 'تصل لنا مباشرة' : 'It lands with us',
      desc: isAr
        ? 'تُحوَّل رسالتك إلى تذكرة داخل نظامنا — لا صندوق بريد مهمل ولا رد آلي.'
        : 'Your message becomes a ticket inside our system — no abandoned inbox, no auto-reply.',
    },
    {
      title: isAr ? 'نراجع التفاصيل' : 'We review the details',
      desc: isAr
        ? 'نطابق طلبك مع حسابك ومتجرك لنعرف إن كانت المشكلة في الربط أو في البيانات.'
        : 'We match your request with your account and store to see whether the issue is the link or the data.',
    },
    {
      title: isAr ? 'نرد على بريدك' : 'We reply by email',
      desc: isAr
        ? 'يأتيك الرد على البريد نفسه الذي كتبته في النموذج، بنفس اللغة التي راسلتنا بها.'
        : 'The reply goes to the email you wrote in the form, in the language you wrote in.',
    },
  ]

  const includes = [
    {
      icon: LifeBuoy,
      title: isAr ? 'مشكلة في المزامنة' : 'A sync problem',
      desc: isAr
        ? 'اذكر رقم الطلب أو اسم المنتج، والفترة التي لاحظت فيها المشكلة — نتبعه في سجلات المزامنة.'
        : 'Include the order number or product name plus when you noticed it — we trace it in the sync logs.',
    },
    {
      icon: Receipt,
      title: isAr ? 'استفسار اشتراك أو فاتورة' : 'Subscription or invoice',
      desc: isAr
        ? 'اكتب البريد المسجّل في حسابك حتى نجد اشتراكك بسرعة دون أسئلة إضافية.'
        : 'Use the email on your account so we can find your subscription straight away.',
    },
    {
      icon: Link2,
      title: isAr ? 'ربط متجر جديد' : 'Connecting a new store',
      desc: isAr
        ? 'حدّد المنصة (زد، سلة، شوبيفاي) ونظام الـ ERP (Odoo أو ERPNext) وحجم الطلبات الشهري.'
        : 'Name the platform (Zid, Salla, Shopify) and the ERP (Odoo or ERPNext) plus your monthly order volume.',
    },
  ]

  const quickLinks = [
    { href: '/pricing', label: isAr ? 'الأسعار والخطة' : 'Pricing & plan' },
    { href: '/#features', label: isAr ? 'ما الذي تتم مزامنته' : 'What gets synced' },
    { href: '/#how-it-works', label: isAr ? 'كيف يعمل الربط' : 'How it works' },
    { href: '/sign-in', label: isAr ? 'لديّ حساب بالفعل' : 'I already have an account' },
  ]

  return (
    <div
      className="flex min-h-screen flex-col overflow-x-clip bg-background font-sans text-foreground"
      dir={dir}
    >
      <PublicSiteHeader lang={lang} />

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-b border-border">
          <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden />

          <div className="relative mx-auto max-w-7xl px-6 pb-16 pt-14 md:px-12 md:pb-20 md:pt-20">
            <div className="rise-in mb-7 flex flex-wrap items-center gap-3">
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                <Headset className="h-3 w-3" />
                {isAr ? 'دعم ٢٤/٧' : '24/7 support'}
              </span>
              <span className={EYEBROW}>erp-link / contact</span>
            </div>

            <div className="grid items-end gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:gap-12">
              <h1
                className="rise-in text-4xl font-black leading-[1.08] tracking-tight md:text-6xl md:leading-[1.02]"
                style={{ animationDelay: '70ms' }}
              >
                {isAr ? 'تواصل معنا' : 'Talk to us'}
              </h1>

              <p
                className="rise-in max-w-md text-sm leading-relaxed text-muted-foreground md:text-base"
                style={{ animationDelay: '140ms' }}
              >
                {isAr
                  ? 'اكتب لنا أي استفسار عن المزامنة أو الاشتراك أو ربط متجر جديد. رسالتك تصل لفريق يقرأها فعلاً، ويأتيك الرد على بريدك.'
                  : 'Write to us about anything — sync, billing, or connecting a new store. A real person reads it, and the reply comes to your inbox.'}
              </p>
            </div>
          </div>
        </section>

        {/* ── Form + aside ─────────────────────────────────────── */}
        <section className="px-6 py-16 md:px-12 md:py-24">
          <div className="mx-auto grid max-w-7xl grid-cols-1 items-start gap-10 lg:grid-cols-[1.1fr_0.8fr] lg:gap-14">
            {/* Form card */}
            <div className="reveal overflow-hidden rounded-2xl border border-border bg-card shadow-[0_30px_80px_-70px_hsl(var(--foreground)/0.5)]">
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {isAr ? 'نموذج التواصل' : 'contact.form'}
                </span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                  {isAr ? 'كل الحقول مطلوبة' : 'all fields required'}
                </span>
              </div>
              <div className="p-5 md:p-7">
                <ContactForm lang={lang} />
              </div>
            </div>

            {/* Aside */}
            <aside className="space-y-6">
              <div className="reveal" style={{ animationDelay: '100ms' }}>
                <div className={cn(EYEBROW, 'mb-5')}>
                  {isAr ? 'ماذا يحدث بعد الإرسال' : 'what happens next'}
                </div>
                <ol className="space-y-5">
                  {steps.map((step, idx) => (
                    <li key={step.title} className="flex gap-3.5">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-secondary/60 font-mono text-[10px] font-bold text-primary">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <div>
                        <h3 className="text-sm font-bold">{step.title}</h3>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.desc}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div
                className="reveal rounded-2xl border border-border bg-secondary/20 p-5"
                style={{ animationDelay: '180ms' }}
              >
                <div className={cn(EYEBROW, 'mb-3')}>{isAr ? 'روابط سريعة' : 'quick links'}</div>
                <ul className="divide-y divide-border">
                  {quickLinks.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="group flex items-center justify-between gap-3 py-2.5 text-sm font-semibold text-foreground/85 transition-colors hover:text-primary"
                      >
                        {link.label}
                        <ArrowLeft
                          className={cn(
                            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:-translate-x-0.5 group-hover:text-primary',
                            !isAr && 'rotate-180 group-hover:translate-x-0.5'
                          )}
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div
                className="reveal flex items-start gap-3 rounded-2xl border border-border bg-card p-4"
                style={{ animationDelay: '260ms' }}
              >
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {isAr
                    ? 'لا تشارك كلمة المرور أو مفاتيح API في الرسالة — لا نحتاجها لتشخيص أي مشكلة.'
                    : 'Never include passwords or API keys in your message — we do not need them to diagnose anything.'}
                </p>
              </div>
            </aside>
          </div>
        </section>

        {/* ── What to include ──────────────────────────────────── */}
        <section className="border-t border-border bg-secondary/20 px-6 py-16 md:px-12 md:py-20">
          <div className="mx-auto max-w-7xl">
            <div className="reveal mb-9 grid items-start gap-4 md:grid-cols-[180px_1fr] md:gap-10">
              <div className={cn(EYEBROW, 'md:pt-2')}>{isAr ? 'قبل أن ترسل' : 'before you send'}</div>
              <div className="space-y-3">
                <h2 className="text-2xl font-black tracking-tight md:text-4xl">
                  {isAr ? 'سطران إضافيان يوفّران جولة كاملة.' : 'Two extra details save a whole round-trip.'}
                </h2>
                <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                  {isAr
                    ? 'كلما كانت الرسالة محددة، كان التشخيص أسرع — هذه أكثر ثلاث حالات تصلنا.'
                    : 'The more specific the message, the faster the diagnosis — these are the three cases we get most.'}
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {includes.map(({ icon: Icon, title, desc }, idx) => (
                <div
                  key={title}
                  className="reveal group rounded-xl border border-border bg-card p-5 transition-shadow duration-300 hover:shadow-card-hover"
                  style={{ animationDelay: `${idx * 90}ms` }}
                >
                  <div className="mb-3 flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary transition-transform duration-300 group-hover:scale-110">
                      <Icon className="h-4 w-4" />
                    </span>
                    <h3 className="text-sm font-bold">{title}</h3>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Closing note ─────────────────────────────────────── */}
        <section className="px-6 py-14 md:px-12 md:py-16">
          <div className="reveal mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
            <span className={cn(EYEBROW, 'inline-flex items-center gap-2')}>
              <Clock className="h-3.5 w-3.5 text-primary" />
              {isAr ? 'لديك حساب بالفعل؟' : 'already a customer?'}
            </span>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {isAr
                ? 'فتح التذكرة من داخل لوحتك يربطها بحسابك ومتجرك تلقائياً، فتصل إليك المتابعة في نفس المكان دون تكرار التفاصيل.'
                : 'Opening a ticket inside your dashboard ties it to your account and store automatically, so the follow-up stays in one place.'}
            </p>
            <Link
              href="/app/tickets"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-primary underline-offset-4 hover:underline"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {isAr ? 'فتح تذكرة من لوحة التحكم' : 'Open a ticket from the dashboard'}
            </Link>
          </div>
        </section>
      </main>

      <PublicSiteFooter lang={lang} />
    </div>
  )
}
