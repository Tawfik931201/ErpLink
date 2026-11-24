import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Layers,
  Sparkles,
  Zap,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { GuideCard } from '@/components/knowledge-center/guide-card'
import { GuideCta } from '@/components/knowledge-center/guide-cta'
import { GuideSearchFilter } from '@/components/knowledge-center/guide-search-filter'
import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { integrations, type IntegrationPlatform } from '@/lib/integration-content'
import { allGuides, categoryList, getFeaturedGuides } from '@/lib/knowledge-center'
import { publicPageMetadata } from '@/lib/public-seo'
import { knowledgeCenterStructuredData } from '@/lib/public-structured-data'
import { resolveLanguage } from '@/lib/translations'

export const generateMetadata = () => publicPageMetadata('/guides')

const platforms: IntegrationPlatform[] = ['zid', 'salla', 'shopify']

export default async function KnowledgeCenterPage() {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const isAr = lang === 'ar'
  const structuredData = knowledgeCenterStructuredData(lang)
  const featuredGuides = getFeaturedGuides()
  const Arrow = isAr ? ArrowLeft : ArrowRight

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" dir={isAr ? 'rtl' : 'ltr'}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
      />
      <PublicSiteHeader lang={lang} />

      <main className="flex-1">
        {/* ── Hero Section (Full Width) ────────────────────────── */}
        <section className="relative overflow-hidden border-b border-border bg-secondary/15 py-14 px-4 sm:px-8 md:px-12 xl:px-16 2xl:px-20 md:py-20">
          <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden />

          <div className="relative w-full">
            <div className="mx-auto max-w-4xl text-center">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
                <BookOpen className="h-3.5 w-3.5" />
                <span>{isAr ? 'مركز المعرفة والأدلة الفنية' : 'Knowledge & Technical Guides'}</span>
              </div>

              <h1 className="mt-5 text-3xl font-black tracking-tight text-foreground sm:text-5xl md:leading-tight">
                {isAr ? 'مركز معرفة ERP Link' : 'ERP Link Knowledge'}
              </h1>

              <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base sm:leading-8">
                {isAr
                  ? 'أدلة عملية وتطبيقية لفهم ربط المتاجر الإلكترونية بأنظمة ERP، ومزامنة الطلبات والمخزون والضرائب والمرتجعات خطوة بخطوة.'
                  : 'Practical, in-depth guides to connecting e-commerce stores with ERP systems: real-time orders, multi-warehouse inventory, 15% VAT, and automated return lifecycles.'}
              </p>

              <div className="mt-6 flex items-center justify-center gap-4 text-xs text-muted-foreground flex-wrap">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-card/80 px-2.5 py-1 font-mono font-bold text-foreground border border-border/60">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  {allGuides.length} {isAr ? 'أدلة تقنية مكتملة' : 'published guides'}
                </span>
                <span className="hidden sm:inline-block">•</span>
                <span className="text-xs text-muted-foreground">
                  {isAr ? 'تغطية لمنصات زد، سلة، شوبيفاي مع أودوو ERP' : 'Covering Zid, Salla, Shopify with Odoo ERP'}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Supported Store Integrations Section (Merged from Integrations) ── */}
        <section className="border-b border-border/80 bg-card/30 py-14 px-4 sm:px-8 md:px-12 xl:px-16 2xl:px-20">
          <div className="w-full">
            <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary mb-3">
                  <Layers className="h-3.5 w-3.5" />
                  <span>{isAr ? 'تكاملات المتاجر مع أودوو' : 'Supported Store Integrations'}</span>
                </div>
                <h2 className="text-xl font-black text-foreground md:text-2xl">
                  {isAr ? 'منصات التجارة الإلكترونية المدعومة للربط مع أودوو' : 'Supported E-Commerce Platforms for Odoo'}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground max-w-3xl">
                  {isAr
                    ? 'اربط متجرك الإلكتروني بنظام أودوو ERP مع مزامنة لحظية للطلبات، وتحديث المخزون متعدد المستودعات، وحساب ضريبة 15%، وإدارة المرتجعات تلقائيًا.'
                    : 'Connect your store with Odoo ERP for automated order capture, multi-warehouse stock sync, 15% VAT, and streamlined return processing.'}
                </p>
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {platforms.map((platform) => {
                const details = integrations[platform]
                return (
                  <article
                    key={platform}
                    className="flex flex-col justify-between rounded-2xl border border-border bg-card/70 p-6 transition-all hover:border-primary/40 hover:shadow-md"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-bold font-mono text-primary border border-primary/20">
                          {details.platformName} + Odoo
                        </span>
                        <Zap className="h-4 w-4 text-primary" />
                      </div>

                      <h3 className="mt-4 text-base font-bold text-foreground">
                        {details.title[lang]}
                      </h3>

                      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground line-clamp-3">
                        {details.summary[lang]}
                      </p>

                      <ul className="mt-4 space-y-2 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
                        {details.sections.slice(0, 2).map((sec, idx) => (
                          <li key={idx} className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="font-medium text-foreground/80">{sec.title[lang]}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <Link
                      href={`/integrations/${platform}-odoo`}
                      className="mt-6 inline-flex items-center justify-between rounded-xl border border-border bg-background px-4 py-2.5 text-xs font-bold text-primary hover:bg-primary hover:text-primary-foreground transition-colors group"
                    >
                      <span>{isAr ? `دليل وتفاصيل ربط ${details.platformName}` : `Explore ${details.platformName} Details`}</span>
                      <Arrow className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </article>
                )
              })}
            </div>

            {/* Pre-Connection Readiness Callout */}
            <div className="mt-8 rounded-2xl border border-border bg-secondary/15 p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="max-w-3xl space-y-2">
                <h3 className="text-sm md:text-base font-bold text-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>{isAr ? 'ما الذي يجب تجهيزه قبل بدء ربط متجرك بأودوو؟' : 'What should be prepared before connecting to Odoo?'}</span>
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {isAr
                    ? 'ابدأ بمراجعة صلاحيات متجرك وبيانات اتصال أودوو، وتأكد من مطابقة أكواد المنتجات (SKU)، وضبط إعدادات ضريبة القيمة المضافة 15%، وخريطة مستودعات التوصيل وحالات الطلب. اطلع على دليل التحقق العملي خطوة بخطوة.'
                    : 'Check API permissions, ensure product SKUs match in both systems, configure 15% VAT mapping, warehouse delivery origins, and order lifecycle states. Follow our practical step-by-step checklist.'}
                </p>
              </div>

              <Link
                href="/guides/zid-odoo-checklist"
                className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground hover:opacity-90 transition-opacity"
              >
                <span>{isAr ? 'دليل قائمة التحقق للربط' : 'View Pre-Connection Checklist'}</span>
                <Arrow className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </section>

        {/* ── Featured Guides (Full Width) ────────────────────── */}
        {featuredGuides.length > 0 && (
          <section className="border-b border-border/60 py-12 px-4 sm:px-8 md:px-12 xl:px-16 2xl:px-20 bg-card/20">
            <div className="w-full">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black text-foreground md:text-xl">
                    {isAr ? 'أهم الأدلة المقترحة' : 'Featured Guides'}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isAr
                      ? 'أدلة إرشادية أساسية للأكثر بحثًا واستخدامًا في ربط المتاجر بأنظمة ERP'
                      : 'High-impact guides covering core e-commerce ERP workflows and common questions'}
                  </p>
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4">
                {featuredGuides.slice(0, 4).map((guide) => (
                  <GuideCard key={guide.meta.slug} guide={guide} lang={lang} featured={true} />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── Search, Categories & Guide Grid (Full Width) ────── */}
        <section className="py-14 px-4 sm:px-8 md:px-12 xl:px-16 2xl:px-20">
          <div className="w-full">
            <div className="mb-8">
              <h2 className="text-xl font-black text-foreground md:text-2xl">
                {isAr ? 'تصفح جميع الأدلة والمقالات التقنية' : 'Browse All Technical Guides'}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {isAr
                  ? 'استخدم البحث الفوري أو صفّ الأدلة بحسب المنصة والموضوع.'
                  : 'Search instantly or filter guides by platform category.'}
              </p>
            </div>

            <GuideSearchFilter guides={allGuides} categories={categoryList} lang={lang} />
          </div>
        </section>

        {/* ── CTA Section (Full Width) ────────────────────────── */}
        <section className="border-t border-border py-16 px-4 sm:px-8 md:px-12 xl:px-16 2xl:px-20 bg-secondary/10">
          <div className="w-full">
            <GuideCta lang={lang} />
          </div>
        </section>
      </main>

      <PublicSiteFooter lang={lang} />
    </div>
  )
}
