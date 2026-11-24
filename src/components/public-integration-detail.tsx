import { cookies } from 'next/headers'
import Link from 'next/link'

import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { integrations, type IntegrationPlatform } from '@/lib/integration-content'
import { integrationPageStructuredData } from '@/lib/public-structured-data'
import { resolveLanguage } from '@/lib/translations'

const platforms: IntegrationPlatform[] = ['zid', 'salla', 'shopify']

export async function PublicIntegrationDetail({ platform }: { platform: IntegrationPlatform }) {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const isAr = lang === 'ar'
  const details = integrations[platform]
  const linkClass = 'inline-flex rounded-lg border border-border px-5 py-3 text-sm font-bold transition-colors hover:border-primary hover:text-primary'

  const structuredData = integrationPageStructuredData(platform, lang)

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" dir={isAr ? 'rtl' : 'ltr'}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
      <PublicSiteHeader lang={lang} />
      <main className="flex-1">
        <section className="border-b border-border bg-secondary/20 px-6 py-16 md:px-12 md:py-24">
          <div className="mx-auto max-w-5xl">
            <nav aria-label={isAr ? 'مسار الصفحة' : 'Breadcrumb'} className="mb-8 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Link href="/">{isAr ? 'الرئيسية' : 'Home'}</Link><span>/</span>
              <Link href="/integrations">{isAr ? 'التكاملات' : 'Integrations'}</Link><span>/</span>
              <span>{details.platformName} + Odoo</span>
            </nav>
            <p className="mb-4 text-xs font-bold uppercase tracking-widest text-primary">ERP Link / {details.platformName} + Odoo</p>
            <h1 className="max-w-4xl text-4xl font-black leading-tight md:text-5xl">{details.title[lang]}</h1>
            <p className="mt-6 max-w-3xl text-base leading-8 text-muted-foreground md:text-lg">{details.summary[lang]}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/sign-up" className="inline-flex rounded-lg bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:opacity-90">{isAr ? 'ابدأ تجربة ERP Link' : 'Try ERP Link'}</Link>
              <Link href="/contact" className={linkClass}>{isAr ? 'اسأل عن الربط' : 'Ask about integration'}</Link>
            </div>
          </div>
        </section>
        <section className="px-6 py-16 md:px-12">
          <div className="mx-auto max-w-5xl space-y-12">
            <div className="max-w-3xl">
              <h2 className="text-2xl font-black">{isAr ? 'لمن يناسب هذا الربط؟' : 'Who is this integration for?'}</h2>
              <p className="mt-3 leading-8 text-muted-foreground">{details.audience[lang]}</p>
            </div>
            <div>
              <h2 className="mb-6 text-2xl font-black">{isAr ? 'تدفقات البيانات التي تحتاج مراجعتها' : 'Data flows worth reviewing'}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {details.sections.map((part) => (
                  <article key={part.title.en} className="rounded-2xl border border-border bg-card p-6">
                    <h3 className="text-lg font-bold">{part.title[lang]}</h3>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">{part.text[lang]}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
        <section className="border-y border-border bg-secondary/20 px-6 py-16 md:px-12">
          <div className="mx-auto max-w-5xl">
            <h2 className="mb-6 text-2xl font-black">{isAr ? 'خطوات قبل التشغيل الفعلي' : 'Before you go live'}</h2>
            <ol className="grid gap-4 md:grid-cols-3">
              {details.preparation.map((part, index) => (
                <li key={part.title.en} className="rounded-xl border border-border bg-background p-6">
                  <span className="text-sm font-mono font-bold text-primary">0{index + 1}</span>
                  <h3 className="mt-3 font-bold">{part.title[lang]}</h3>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">{part.text[lang]}</p>
                </li>
              ))}
            </ol>
            {platform === 'zid' && (
              <Link href="/guides/zid-odoo-checklist" className="mt-6 inline-flex text-sm font-bold text-primary underline">
                {isAr ? 'الدليل العملي لاختبار ربط زد مع أودوو' : 'Read the Zid–Odoo setup and testing checklist'}
              </Link>
            )}
          </div>
        </section>
        <section className="px-6 py-16 md:px-12">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-2xl font-black">{isAr ? 'الأسئلة الشائعة' : 'Frequently asked questions'}</h2>
            <div className="mt-6 divide-y divide-border border-y border-border">
              {details.questions.map((faq) => (
                <div key={faq.question.en} className="py-6">
                  <h3 className="font-bold">{faq.question[lang]}</h3>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">{faq.answer[lang]}</p>
                </div>
              ))}
            </div>
            <p className="mt-8 text-xs leading-6 text-muted-foreground">
              {isAr ? 'نتائج الربط الدقيقة تعتمد على صلاحيات حساباتك وإعدادات الخرائط والمستودعات والحالات؛ تحقق منها باستخدام بيانات تجريبية.' : 'Exact behavior depends on your permissions, field mappings, warehouses and status rules; validate with test data.'}
            </p>
          </div>
        </section>
        <section className="border-t border-border px-6 py-12 md:px-12">
          <div className="mx-auto max-w-5xl">
            <h2 className="mb-4 text-xl font-bold">{isAr ? 'استكشف ربط منصة أخرى' : 'Explore another integration'}</h2>
            <div className="flex flex-wrap gap-3">
              {platforms.filter((item) => item !== platform).map((item) => (
                <Link className={linkClass} href={`/integrations/${item}-odoo`} key={item}>{integrations[item].platformName} + Odoo</Link>
              ))}
              <Link className={linkClass} href="/integrations">{isAr ? 'كل التكاملات' : 'All integrations'}</Link>
            </div>
          </div>
        </section>
      </main>
      <PublicSiteFooter lang={lang} />
    </div>
  )
}
