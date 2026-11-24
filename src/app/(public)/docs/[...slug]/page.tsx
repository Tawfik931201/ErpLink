import { Clock, Calendar, LifeBuoy } from 'lucide-react'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { DocsBreadcrumbs } from '@/components/documentation/docs-breadcrumbs'
import { DocsContent } from '@/components/documentation/docs-content'
import { DocsLayout } from '@/components/documentation/docs-layout'
import { DocsPagination } from '@/components/documentation/docs-pagination'
import { DocsTableOfContents } from '@/components/documentation/docs-toc'
import { findAdjacentArticles, getAllDocSlugs } from '@/lib/documentation/docs-navigation'
import { getDocArticleBySlug } from '@/lib/documentation/docs-registry'
import { docsMetadata, docsArticleStructuredData } from '@/lib/documentation/docs-seo'
import { resolveLanguage } from '@/lib/translations'

interface DocPageProps {
  params: Promise<{
    slug: string[]
  }>
}

export async function generateStaticParams() {
  const slugs = getAllDocSlugs()
  return slugs.map((slug) => ({
    slug: slug.split('/'),
  }))
}

export async function generateMetadata({ params }: DocPageProps): Promise<Metadata> {
  const resolvedParams = await params
  const slugPath = resolvedParams.slug.join('/')
  const article = getDocArticleBySlug(slugPath)

  if (!article) return {}

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  return docsMetadata(article, lang)
}

export default async function DocArticlePage({ params }: DocPageProps) {
  const resolvedParams = await params
  const slugPath = resolvedParams.slug.join('/')
  const article = getDocArticleBySlug(slugPath)

  if (!article) {
    notFound()
  }

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const isAr = lang === 'ar'

  const structuredData = docsArticleStructuredData(article, lang)
  const { prev, next } = findAdjacentArticles(article.slug)

  const breadcrumbs = [
    {
      label: article.title[lang],
    },
  ]

  return (
    <DocsLayout lang={lang}>
      {/* Schema.org TechArticle & BreadcrumbList */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_240px] gap-8">
        {/* Main Article Body */}
        <article className="min-w-0 max-w-3xl">
          <DocsBreadcrumbs items={breadcrumbs} lang={lang} />

          {/* Article Header */}
          <header className="space-y-3 pb-6 border-b border-border">
            <div className="flex items-center gap-2 flex-wrap">
              {article.badge && (
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    article.badge.variant === 'brand'
                      ? 'bg-primary/15 text-primary'
                      : article.badge.variant === 'success'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {article.badge.text[lang]}
                </span>
              )}
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>
                  {isAr
                    ? `${article.readTimeMinutes} دقائق قراءة`
                    : `${article.readTimeMinutes} min read`}
                </span>
              </span>
              <span className="text-muted-foreground/40">•</span>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span>
                  {isAr ? 'آخر تحديث: ' : 'Updated: '}
                  {article.lastUpdated}
                </span>
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground leading-tight">
              {article.title[lang]}
            </h1>

            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              {article.description[lang]}
            </p>
          </header>

          {/* Mobile TOC */}
          <DocsTableOfContents headings={article.headings} lang={lang} />

          {/* Rendered Article Content */}
          <div className="mt-6">
            <DocsContent content={article.content[lang]} lang={lang} />
          </div>

          {/* Article Support CTA */}
          <div className="my-10 p-5 rounded-xl border border-border bg-card/50 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-start">
              <div className="p-2.5 rounded-lg bg-primary/10 text-primary shrink-0">
                <LifeBuoy className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-foreground">
                  {isAr ? 'هل واجهتك مشكلة أثناء تطبيق هذا الدليل؟' : 'Encountered an issue applying this guide?'}
                </h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {isAr
                    ? 'يمكنك فتح تذكرة دعم فني مباشرة ليقوم مهندسونا بفحص السجلات ومساعدتك.'
                    : 'Open a support ticket to have our engineering desk inspect logs directly.'}
                </p>
              </div>
            </div>
            <Link
              href="/docs/support"
              className="px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity shrink-0"
            >
              {isAr ? 'تواصل مع الدعم' : 'Contact Support'}
            </Link>
          </div>

          {/* Adjacent Pagination */}
          <DocsPagination prev={prev} next={next} lang={lang} />
        </article>

        {/* Desktop Sticky Table of Contents */}
        <aside className="hidden xl:block">
          <DocsTableOfContents headings={article.headings} lang={lang} />
        </aside>
      </div>
    </DocsLayout>
  )
}
