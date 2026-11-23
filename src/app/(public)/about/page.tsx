import { cookies } from 'next/headers'

import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { publicPageMetadata } from '@/lib/public-seo'
import { resolveLanguage } from '@/lib/translations'

export const generateMetadata = () => publicPageMetadata('/about')

export default async function AboutPage() {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const isAr = lang === 'ar'
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" dir={isAr ? 'rtl' : 'ltr'}>
      <PublicSiteHeader lang={lang} />
      <main className="flex-1 px-6 py-20 md:px-12">
        <div className="mx-auto max-w-3xl space-y-8">
          <div className="space-y-4">
            <h1 className="text-4xl font-black md:text-5xl">{isAr ? 'عن ERP Link' : 'About ERP Link'}</h1>
            <p className="text-lg leading-8 text-muted-foreground">
              {isAr
                ? 'ERP Link منصة لربط المتاجر الإلكترونية بأنظمة إدارة الموارد والمؤسسات (ERP)، بهدف تقليل العمل اليدوي وتنظيم تدفق البيانات بين أنظمة نشاطك.'
                : 'ERP Link connects online stores with ERP systems to reduce manual work and keep business data moving between the systems you use.'}
            </p>
          </div>
          <section className="space-y-3">
            <h2 className="text-2xl font-bold">{isAr ? 'ماذا تقدم المنصة؟' : 'What does the platform do?'}</h2>
            <p className="leading-8 text-muted-foreground">
              {isAr
                ? 'تساعد المنصة على مزامنة الطلبات والمنتجات والمخزون والعملاء، وتوفر إعدادات لتخصيص الربط ومتابعة العمليات وسجلاتها. تشمل منصات المتاجر المذكورة على موقعنا زد وسلة وشوبيفاي، وأنظمة ERP مثل أودوو.'
                : 'The platform helps synchronize orders, products, inventory and customers, with mapping settings and operational logs. Platforms described on this site include Zid, Salla and Shopify, with ERP systems such as Odoo.'}
            </p>
          </section>
          <section className="space-y-3">
            <h2 className="text-2xl font-bold">{isAr ? 'تواصل معنا' : 'Get in touch'}</h2>
            <p className="leading-8 text-muted-foreground">
              {isAr ? 'للاستفسار عن الخدمة أو طلب الدعم، يمكنك التواصل معنا عبر صفحة الاتصال.' : 'For questions about the service or support, reach us through the contact page.'}
              {' '}
              <a href="/contact" className="font-semibold text-primary underline">{isAr ? 'صفحة التواصل' : 'Contact page'}</a>
            </p>
          </section>
        </div>
      </main>
      <PublicSiteFooter lang={lang} />
    </div>
  )
}
