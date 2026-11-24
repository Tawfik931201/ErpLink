import {
  Rocket,
  Link2,
  GitBranch,
  ShoppingCart,
  Activity,
  Users,
  LifeBuoy,
  ArrowRight,
  ArrowLeft,
  BookOpen,
  Sparkles,
} from 'lucide-react'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { DocsLayout } from '@/components/documentation/docs-layout'
import { DOCS_SECTIONS } from '@/lib/documentation/docs-navigation'
import { docsMetadata } from '@/lib/documentation/docs-seo'
import { resolveLanguage } from '@/lib/translations'

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  return docsMetadata(undefined, lang)
}

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Rocket,
  Link2,
  GitBranch,
  ShoppingCart,
  Activity,
  Users,
  LifeBuoy,
}

export default async function DocsHomePage() {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const isAr = lang === 'ar'
  const Arrow = isAr ? ArrowLeft : ArrowRight

  return (
    <DocsLayout lang={lang}>
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Hero Section */}
        <div className="text-center space-y-4 pt-4 pb-6 border-b border-border">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold bg-primary/10 text-primary border border-primary/20">
            <Sparkles className="h-3.5 w-3.5" />
            <span>{isAr ? 'مركز التوثيق ودليل الاستخدام الرسمي' : 'Official ERP Link Documentation'}</span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            {isAr
              ? 'كل ما تحتاج معرفته لاستخدام ERP Link'
              : 'Everything you need to master ERP Link'}
          </h1>

          <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            {isAr
              ? 'تعرّف على إعداد حسابك، وربط متجرك بأودوو، وضبط المزامنة، ومتابعة الطلبات والمخزون والمرتجعات، من خلال أدلة استخدام واضحة خطوة بخطوة.'
              : 'Learn how to configure your account, connect your store to Odoo, calibrate standard mappings, and track orders, stock, and returns step-by-step.'}
          </p>
        </div>

        {/* Featured Quickstart Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link
            href="/docs/getting-started"
            className="group p-5 rounded-xl border border-border bg-card/60 hover:bg-card hover:border-primary/40 transition-all shadow-sm flex flex-col justify-between"
          >
            <div>
              <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
                <Rocket className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                {isAr ? 'البدء السريع' : 'Quickstart'}
              </h3>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                {isAr
                  ? 'خطوات الربط الأربعة الأساسية لربط متجرك بأودوو في دقائق.'
                  : 'The four essential steps to connect your store with Odoo in minutes.'}
              </p>
            </div>
            <span className="flex items-center gap-1 text-[11px] font-bold text-primary mt-4 group-hover:underline">
              <span>{isAr ? 'ابدأ الآن' : 'Start now'}</span>
              <Arrow className="h-3.5 w-3.5" />
            </span>
          </Link>

          <Link
            href="/docs/mapping/overview"
            className="group p-5 rounded-xl border border-border bg-card/60 hover:bg-card hover:border-primary/40 transition-all shadow-sm flex flex-col justify-between"
          >
            <div>
              <div className="h-9 w-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3">
                <GitBranch className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                {isAr ? 'مركز الخرائط' : 'Mapping Center'}
              </h3>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                {isAr
                  ? 'دليل ضبط مطابقة أوامر البيع والمنتجات وحسابات الضريبة 15%.'
                  : 'Guide to configuring sales orders, SKUs, and 15% VAT parity.'}
              </p>
            </div>
            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mt-4 group-hover:underline">
              <span>{isAr ? 'استكشف الخرائط' : 'Explore mappings'}</span>
              <Arrow className="h-3.5 w-3.5" />
            </span>
          </Link>

          <Link
            href="/docs/troubleshooting"
            className="group p-5 rounded-xl border border-border bg-card/60 hover:bg-card hover:border-primary/40 transition-all shadow-sm flex flex-col justify-between"
          >
            <div>
              <div className="h-9 w-9 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3">
                <LifeBuoy className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                {isAr ? 'حل المشكلات' : 'Troubleshooting'}
              </h3>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                {isAr
                  ? 'تشخيص وحل 12 مشكلة تشغيلية شائعة في المزامنة والسجلات.'
                  : 'Diagnose and resolve 12 common sync, inventory, and log exceptions.'}
              </p>
            </div>
            <span className="flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400 mt-4 group-hover:underline">
              <span>{isAr ? 'دليل الحلول' : 'View solutions'}</span>
              <Arrow className="h-3.5 w-3.5" />
            </span>
          </Link>
        </div>

        {/* Categories Section Grid */}
        <div className="space-y-6">
          <h2 className="text-lg sm:text-xl font-bold text-foreground">
            {isAr ? 'أقسام التوثيق المتخصصة' : 'Specialized Documentation Modules'}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {DOCS_SECTIONS.map((section) => {
              const Icon = CATEGORY_ICONS[section.iconName] || BookOpen
              return (
                <div
                  key={section.category}
                  className="rounded-xl border border-border bg-card/40 p-5 space-y-4 hover:border-border/80 transition-colors"
                >
                  <div className="flex items-center gap-2.5 pb-2 border-b border-border/50">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground">
                        {section.title[lang]}
                      </h3>
                      <span className="text-[10px] text-muted-foreground">
                        {isAr
                          ? `${section.items.length} أدلة تفصيلية`
                          : `${section.items.length} practical guides`}
                      </span>
                    </div>
                  </div>

                  <ul className="space-y-2 text-xs">
                    {section.items.map((item) => (
                      <li key={item.slug}>
                        <Link
                          href={item.href}
                          className="group flex items-center justify-between text-muted-foreground hover:text-foreground transition-colors py-0.5"
                        >
                          <span className="group-hover:text-primary transition-colors truncate">
                            {item.title[lang]}
                          </span>
                          <Arrow className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-primary shrink-0 ms-2" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>

        {/* Support & Community Footer Card */}
        <div className="rounded-xl border border-border bg-gradient-to-r from-primary/5 via-primary/10 to-transparent p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="space-y-1 text-center sm:text-start">
            <h3 className="text-sm font-bold text-foreground">
              {isAr ? 'هل تحتاج إلى مساعدة إضافية في إعداد الربط؟' : 'Need additional help setting up?'}
            </h3>
            <p className="text-xs text-muted-foreground">
              {isAr
                ? 'فريق الدعم الفني جاهز لمساعدتك عبر نظام التذاكر المباشر أو البريد الإلكتروني.'
                : 'Our technical team is ready to assist via direct in-app tickets or email.'}
            </p>
          </div>
          <Link
            href="/docs/support"
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity shrink-0"
          >
            {isAr ? 'تواصل مع الدعم الفني' : 'Contact Support'}
          </Link>
        </div>
      </div>
    </DocsLayout>
  )
}
