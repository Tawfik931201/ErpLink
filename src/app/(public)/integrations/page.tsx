import { cookies } from 'next/headers'
import Link from 'next/link'

import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { integrations, type IntegrationPlatform } from '@/lib/integration-content'
import { publicPageMetadata } from '@/lib/public-seo'
import { integrationsIndexStructuredData } from '@/lib/public-structured-data'
import { resolveLanguage } from '@/lib/translations'

export const generateMetadata = () => publicPageMetadata('/integrations')
const platforms: IntegrationPlatform[] = ['zid', 'salla', 'shopify']

export default async function IntegrationsPage() {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const isAr = lang === 'ar'
  const structuredData = integrationsIndexStructuredData(lang)
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" dir={isAr ? 'rtl' : 'ltr'}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
      <PublicSiteHeader lang={lang} />
      <main className="flex-1">
        <section className="border-b border-border bg-secondary/20 px-6 py-20 md:px-12">
          <div className="mx-auto max-w-5xl">
            <p className="mb-4 text-xs font-bold uppercase tracking-widest text-primary">ERP Link / Integrations</p>
            <h1 className="text-4xl font-black md:text-5xl">{isAr ? 'ربط المتاجر الإلكترونية بأودوو وأنظمة ERP' : 'Connect Online Stores with Odoo and ERP'}</h1>
            <p className="mt-6 max-w-3xl text-base leading-8 text-muted-foreground">
              {isAr ? 'استكشف أدلة ربط زد وسلة وشوبيفاي مع أودوو، وتعرّف على كيفية تجهيز الطلبات والمنتجات والعملاء والمخزون قبل المزامنة.' : 'Explore practical Zid, Salla and Shopify connection guides for Odoo, including order, product, customer and inventory preparation.'}
            </p>
          </div>
        </section>
        <section className="px-6 py-16 md:px-12">
          <div className="mx-auto max-w-5xl">
            <h2 className="mb-6 text-2xl font-black">{isAr ? 'اختر منصة متجرك' : 'Choose your store platform'}</h2>
            <div className="grid gap-5 md:grid-cols-3">
              {platforms.map((platform) => {
                const details = integrations[platform]
                return (
                  <article key={platform} className="flex flex-col rounded-2xl border border-border bg-card p-6">
                    <p className="text-xs font-bold uppercase tracking-widest text-primary">{details.platformName} + Odoo</p>
                    <h3 className="mt-3 text-xl font-bold">{details.title[lang]}</h3>
                    <p className="mt-3 flex-1 text-sm leading-7 text-muted-foreground">{details.summary[lang]}</p>
                    <Link href={`/integrations/${platform}-odoo`} className="mt-6 font-bold text-primary underline">
                      {isAr ? `تفاصيل ربط ${details.platformName} بأودوو` : `Explore ${details.platformName} Odoo integration`}
                    </Link>
                  </article>
                )
              })}
            </div>
          </div>
        </section>
        <section className="border-y border-border bg-secondary/20 px-6 py-16 md:px-12">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-2xl font-black">{isAr ? 'ما الذي يجب تجهيزه قبل الربط؟' : 'What should be ready before connecting?'}</h2>
            <p className="mt-4 max-w-3xl leading-8 text-muted-foreground">
              {isAr ? 'ابدأ بصلاحيات كل نظام، ثم أكواد المنتجات والعميل والمستودع، وبعدها خريطة حالات الطلب والضريبة والشحن. اختبر المعالجة والمرتجع والكمية على بيانات تجريبية، وتابع نتائج السجل والطابور.' : 'Start with each system’s permissions, product codes, customer and warehouse mapping, then order states, taxes and shipping. Test fulfillment, returns and quantities with sample records, checking logs and queues.'}
            </p>
            <Link href="/guides/zid-odoo-checklist" className="mt-6 inline-flex rounded-lg border border-border px-5 py-3 text-sm font-bold hover:text-primary">{isAr ? 'دليل عملي: تجهيز واختبار ربط زد بأودوو' : 'Practical guide: Zid–Odoo setup and testing'}</Link>
          </div>
        </section>
        <section className="px-6 py-14 md:px-12">
          <div className="mx-auto max-w-5xl flex flex-wrap items-center justify-between gap-5">
            <div>
              <h2 className="text-xl font-bold">{isAr ? 'هل تحتاج مساعدة في اختيار مسار الربط؟' : 'Need help choosing a sync workflow?'}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{isAr ? 'اشرح لنا منصة متجرك ونظام ERP والعمليات المطلوبة.' : 'Tell us your store, ERP and the operations you need.'}</p>
            </div>
            <Link href="/contact" className="rounded-lg bg-primary px-6 py-3 text-sm font-bold text-primary-foreground">{isAr ? 'تواصل معنا' : 'Contact us'}</Link>
          </div>
        </section>
      </main>
      <PublicSiteFooter lang={lang} />
    </div>
  )
}
