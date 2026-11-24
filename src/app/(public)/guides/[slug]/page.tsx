import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Info,
  Lightbulb,
} from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { GuideBreadcrumbs } from '@/components/knowledge-center/guide-breadcrumbs'
import { GuideCard } from '@/components/knowledge-center/guide-card'
import { GuideCta } from '@/components/knowledge-center/guide-cta'
import { GuideFaqSection } from '@/components/knowledge-center/guide-faq'
import { GuideToc } from '@/components/knowledge-center/guide-toc'
import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import {
  allGuides,
  getGuideBySlug,
  getRelatedGuides,
  guideCategories,
  isGuideSlug,
  type GuideSlug,
} from '@/lib/knowledge-center'
import { publicPageMetadata, type PublicPagePath } from '@/lib/public-seo'
import { guideArticleStructuredData } from '@/lib/public-structured-data'
import { resolveLanguage } from '@/lib/translations'

interface GuidePageProps {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  return allGuides
    .filter((g) => g.meta.slug !== 'zid-odoo-checklist')
    .map((g) => ({ slug: g.meta.slug }))
}

export async function generateMetadata({ params }: GuidePageProps) {
  const { slug } = await params
  if (!isGuideSlug(slug)) {
    return {}
  }
  const path = `/guides/${slug}` as PublicPagePath
  return publicPageMetadata(path)
}

export default async function IndividualGuidePage({ params }: GuidePageProps) {
  const { slug } = await params
  if (!isGuideSlug(slug) || slug === 'zid-odoo-checklist') {
    notFound()
  }

  const guide = getGuideBySlug(slug as GuideSlug)
  if (!guide) {
    notFound()
  }

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const isAr = lang === 'ar'
  const category = guideCategories[guide.meta.category]
  const relatedGuides = getRelatedGuides(guide.meta.slug)
  const structuredData = guideArticleStructuredData(guide, lang)
  const Arrow = isAr ? ArrowLeft : ArrowRight

  const breadcrumbItems = [
    { name: isAr ? 'الرئيسية' : 'Home', href: '/' },
    { name: isAr ? 'مركز المعرفة' : 'Knowledge', href: '/guides' },
    { name: guide.meta.title[lang] },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" dir={isAr ? 'rtl' : 'ltr'}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
      />
      <PublicSiteHeader lang={lang} />

      <main className="flex-1">
        {/* ── Header / Hero Section ───────────────────────────── */}
        <header className="border-b border-border bg-secondary/15 px-4 py-10 sm:px-8 md:px-12 xl:px-16 md:py-14">
          <div className="w-full">
            <GuideBreadcrumbs items={breadcrumbItems} lang={lang} />

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-xs font-bold text-primary">
                {category?.title[lang]}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>
                  {guide.meta.readingTimeMinutes} {isAr ? 'دقائق قراءة تقديرية' : 'min estimated read'}
                </span>
              </span>
              <span className="hidden sm:inline text-muted-foreground/60">•</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span>
                  {isAr ? 'نُشر في:' : 'Published:'} {guide.meta.publishedAt}
                </span>
              </span>
            </div>

            <h1 className="mt-5 text-2xl font-black leading-tight tracking-tight text-foreground sm:text-4xl md:text-5xl">
              {guide.meta.h1Title[lang]}
            </h1>

            <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-base sm:leading-8 max-w-4xl">
              {guide.meta.summary[lang]}
            </p>
          </div>
        </header>

        {/* ── Main Content Layout ─────────────────────────────── */}
        <div className="w-full px-4 py-10 sm:px-8 md:px-12 xl:px-16 md:py-14">
          <div className="grid gap-10 lg:grid-cols-[1fr_280px] xl:grid-cols-[1fr_320px] lg:gap-12 xl:gap-16 w-full">
            {/* Guide Body */}
            <article className="min-w-0 w-full max-w-none overflow-hidden space-y-12 leading-relaxed">
              {guide.sections.map((section, sIdx) => (
                <section key={section.id} id={section.id} className="scroll-mt-24 space-y-5">
                  <h2 className="text-xl font-black tracking-tight text-foreground sm:text-2xl border-b border-border/60 pb-3">
                    <span className="font-mono text-primary me-2">0{sIdx + 1}.</span>
                    {section.title[lang]}
                  </h2>

                  {section.paragraphs?.map((p, pIdx) => (
                    <p key={pIdx} className="text-sm leading-7 text-muted-foreground whitespace-pre-line sm:text-base sm:leading-8">
                      {p[lang]}
                    </p>
                  ))}

                  {/* Section Steps */}
                  {section.steps && (
                    <div className="space-y-4 pt-2">
                      {section.steps.map((step, stepIdx) => (
                        <div
                          key={stepIdx}
                          className="rounded-2xl border border-border bg-card/60 p-5 transition-colors hover:border-primary/40"
                        >
                          <h3 className="text-sm font-bold text-foreground sm:text-base">
                            {step.title[lang]}
                          </h3>
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                            {step.text[lang]}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Section Comparison Table */}
                  {section.table && (
                    <div className="overflow-x-auto rounded-2xl border border-border bg-card/60">
                      <table className="w-full min-w-[550px] text-xs sm:text-sm">
                        <thead className="border-b border-border bg-secondary/50">
                          <tr>
                            {section.table.headers.map((h, hIdx) => (
                              <th key={hIdx} scope="col" className="p-3.5 text-start font-bold text-foreground">
                                {h[lang]}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {section.table.rows.map((row, rIdx) => (
                            <tr key={rIdx} className="align-top hover:bg-secondary/20">
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} className="p-3.5 text-muted-foreground leading-relaxed">
                                  {cell[lang]}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Callout */}
                  {section.callout && (
                    <div
                      className={`rounded-2xl border p-5 ${
                        section.callout.type === 'warning'
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
                          : section.callout.type === 'tip'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
                          : 'border-blue-500/30 bg-blue-500/10 text-blue-900 dark:text-blue-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-bold text-xs sm:text-sm">
                        {section.callout.type === 'warning' ? (
                          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        ) : section.callout.type === 'tip' ? (
                          <Lightbulb className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <Info className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                        )}
                        <span>{section.callout.title[lang]}</span>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed opacity-90 sm:text-sm">
                        {section.callout.text[lang]}
                      </p>
                    </div>
                  )}
                </section>
              ))}

              {/* Official Documentation Links */}
              {guide.officialDocLinks && guide.officialDocLinks.length > 0 && (
                <section className="rounded-2xl border border-border bg-secondary/15 p-6">
                  <h3 className="text-sm font-bold text-foreground">
                    {isAr ? 'مصادر ووثائق المنصة الرسمية' : 'Official Platform Documentation'}
                  </h3>
                  <ul className="mt-3 space-y-2 text-xs sm:text-sm">
                    {guide.officialDocLinks.map((doc, dIdx) => (
                      <li key={dIdx}>
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 font-semibold text-primary underline hover:opacity-80"
                        >
                          <span>{doc.label[lang]}</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Summary / Key Takeaways */}
              {guide.summaryKeyTakeaways && (
                <section className="rounded-3xl border border-primary/20 bg-primary/5 p-6 md:p-8">
                  <div className="flex items-center gap-2 text-primary">
                    <CheckCircle2 className="h-5 w-5" />
                    <h3 className="text-lg font-bold text-foreground">
                      {isAr ? 'أهم النقاط المستفادة من هذا الدليل' : 'Key Practical Takeaways'}
                    </h3>
                  </div>
                  <ul className="mt-4 space-y-2.5 text-xs sm:text-sm text-muted-foreground">
                    {guide.summaryKeyTakeaways[lang].map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="font-bold text-primary">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* FAQs Section */}
              <GuideFaqSection faqs={guide.faqs} lang={lang} />

              {/* Mobile In-Article Integration Callout (Clean, static, non-jumping) */}
              {guide.meta.relatedIntegrationPath && (
                <div className="lg:hidden w-full max-w-full overflow-hidden rounded-2xl border border-primary/25 bg-primary/5 p-5 text-start shadow-sm space-y-3">
                  <div className="space-y-1">
                    <h4 className="font-bold text-sm text-foreground">
                      {isAr ? 'هل تريد تشغيل هذا الربط؟' : 'Need this integration?'}
                    </h4>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {isAr
                        ? 'يقوم ERP Link بربط هذا المتجر مع أودوو ومزامنة كافة العمليات تلقائيًا.'
                        : 'ERP Link connects this platform with Odoo, synchronizing transactions automatically.'}
                    </p>
                  </div>
                  <Link
                    href={guide.meta.relatedIntegrationPath}
                    className="inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground hover:opacity-90 transition-opacity"
                  >
                    {isAr ? 'استكشف تفاصيل الربط' : 'Explore Integration Details'}
                  </Link>
                </div>
              )}

              {/* Back to Hub & Integration Links */}
              <div className="pt-6 border-t border-border flex flex-wrap items-center justify-between gap-4">
                <Link
                  href="/guides"
                  className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Arrow className="h-4 w-4 rotate-180" />
                  <span>{isAr ? 'العودة إلى مركز المعرفة' : 'Back to Knowledge'}</span>
                </Link>

                {guide.meta.relatedIntegrationPath && (
                  <Link
                    href={guide.meta.relatedIntegrationPath}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
                  >
                    <span>{isAr ? 'استكشف صفحة التكامل ذات الصلة' : 'Explore Related Integration Page'}</span>
                    <Arrow className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            </article>

            {/* Desktop Stable Sidebar (TOC + CTA in unified sticky container) */}
            <aside className="hidden lg:block shrink-0">
              <div className="sticky top-24 space-y-5">
                <GuideToc sections={guide.sections} lang={lang} />

                {guide.meta.relatedIntegrationPath && (
                  <div className="w-full rounded-2xl border border-border bg-card/85 p-5 text-xs shadow-sm space-y-2">
                    <h4 className="font-bold text-foreground">
                      {isAr ? 'هل تريد تشغيل هذا الربط؟' : 'Need this integration?'}
                    </h4>
                    <p className="leading-relaxed text-muted-foreground">
                      {isAr
                        ? 'يقوم ERP Link بربط هذا المتجر مع أودوو ومزامنة كافة العمليات تلقائيًا.'
                        : 'ERP Link connects this platform with Odoo, synchronizing transactions automatically.'}
                    </p>
                    <Link
                      href={guide.meta.relatedIntegrationPath}
                      className="inline-flex w-full items-center justify-center rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 transition-opacity"
                    >
                      {isAr ? 'تفاصيل الربط' : 'Integration Details'}
                    </Link>
                  </div>
                )}
              </div>
            </aside>
          </div>

          {/* Related Guides Section */}
          {relatedGuides.length > 0 && (
            <section className="mt-20 border-t border-border pt-12">
              <div className="mb-6">
                <h3 className="text-xl font-black text-foreground">
                  {isAr ? 'أدلة إضافية ذات صلة' : 'Related Guides'}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isAr
                    ? 'اكتشف أدلة ومقالات مكملة لهذا الموضوع لإتقان ربط متجرك بأنظمة ERP'
                    : 'Explore complementary guides to deepen your knowledge of e-commerce ERP workflows'}
                </p>
              </div>

              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {relatedGuides.slice(0, 3).map((related) => (
                  <GuideCard key={related.meta.slug} guide={related} lang={lang} />
                ))}
              </div>
            </section>
          )}

          {/* Bottom CTA */}
          <div className="mt-16">
            <GuideCta lang={lang} />
          </div>
        </div>
      </main>

      <PublicSiteFooter lang={lang} />
    </div>
  )
}
