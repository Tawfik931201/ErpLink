import { BookOpen, Sparkles } from 'lucide-react'
import { cookies } from 'next/headers'

import { GuideCard } from '@/components/knowledge-center/guide-card'
import { GuideCta } from '@/components/knowledge-center/guide-cta'
import { GuideSearchFilter } from '@/components/knowledge-center/guide-search-filter'
import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { allGuides, categoryList, getFeaturedGuides } from '@/lib/knowledge-center'
import { publicPageMetadata } from '@/lib/public-seo'
import { knowledgeCenterStructuredData } from '@/lib/public-structured-data'
import { resolveLanguage } from '@/lib/translations'

export const generateMetadata = () => publicPageMetadata('/guides')

export default async function KnowledgeCenterPage() {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const isAr = lang === 'ar'
  const structuredData = knowledgeCenterStructuredData(lang)
  const featuredGuides = getFeaturedGuides()

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" dir={isAr ? 'rtl' : 'ltr'}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
      />
      <PublicSiteHeader lang={lang} />

      <main className="flex-1">
        {/* ── Hero Section ───────────────────────────────────── */}
        <section className="relative overflow-hidden border-b border-border bg-secondary/15 py-16 md:py-24">
          <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden />

          <div className="relative mx-auto max-w-7xl px-6 md:px-12">
            <div className="mx-auto max-w-3xl text-center">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
                <BookOpen className="h-3.5 w-3.5" />
                <span>{isAr ? 'مركز المعرفة والأدلة الفنية' : 'Knowledge Center & Technical Guides'}</span>
              </div>

              <h1 className="mt-5 text-3xl font-black tracking-tight text-foreground sm:text-5xl md:leading-tight">
                {isAr ? 'مركز معرفة ERP Link' : 'ERP Link Knowledge Center'}
              </h1>

              <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base sm:leading-8">
                {isAr
                  ? 'أدلة عملية وتطبيقية لفهم ربط المتاجر الإلكترونية بأنظمة ERP، ومزامنة الطلبات والمخزون والضرائب والمرتجعات خطوة بخطوة.'
                  : 'Practical, in-depth guides to connecting e-commerce stores with ERP systems: real-time orders, multi-warehouse inventory, 15% VAT, and automated return lifecycles.'}
              </p>

              <div className="mt-6 flex items-center justify-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-card/80 px-2.5 py-1 font-mono font-bold text-foreground border border-border/60">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  {allGuides.length} {isAr ? 'أدلة تقنية مكتملة' : 'published guides'}
                </span>
                <span className="hidden sm:inline-block">•</span>
                <span className="hidden sm:inline-block">
                  {isAr ? 'تحديثات مستمرة وتغطية لمنصات زد وسلة وشوبيفاي وأودوو' : 'Targeting Zid, Salla, Shopify & Odoo'}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Featured Guides ─────────────────────────────────── */}
        {featuredGuides.length > 0 && (
          <section className="border-b border-border/60 py-12 px-6 md:px-12 bg-card/30">
            <div className="mx-auto max-w-7xl">
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

              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {featuredGuides.slice(0, 3).map((guide) => (
                  <GuideCard key={guide.meta.slug} guide={guide} lang={lang} featured={true} />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── Search, Categories & Guide Grid ─────────────────── */}
        <section className="py-14 px-6 md:px-12">
          <div className="mx-auto max-w-7xl">
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

        {/* ── CTA Section ─────────────────────────────────────── */}
        <section className="border-t border-border py-16 px-6 md:px-12 bg-secondary/10">
          <div className="mx-auto max-w-7xl">
            <GuideCta lang={lang} />
          </div>
        </section>
      </main>

      <PublicSiteFooter lang={lang} />
    </div>
  )
}
