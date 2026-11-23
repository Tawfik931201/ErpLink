import Link from 'next/link'
import { cookies } from 'next/headers'

import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { publicPageMetadata } from '@/lib/public-seo'
import { zidOdooGuideStructuredData } from '@/lib/public-structured-data'
import { resolveLanguage } from '@/lib/translations'

export const generateMetadata = () => publicPageMetadata('/guides/zid-odoo-checklist')

const scenarios = [
  {
    scenario: { ar: 'طلب جديد', en: 'New order' },
    action: { ar: 'أنشئ طلبًا بمنتج واحد وبعميل جديد في زد.', en: 'Create a Zid order with one item and a new customer.' },
    check: { ar: 'أمر البيع والعميل والمنتج والإجمالي في أودوو، دون تكرار.', en: 'Sales order, customer, product and totals in Odoo, with no duplicate.' },
  },
  {
    scenario: { ar: 'ضريبة وشحن وخصم', en: 'Tax, delivery and discount' },
    action: { ar: 'أنشئ طلبًا به ضريبة ورسوم شحن وخصم عند توفرها.', en: 'Create a test order with VAT, delivery fees and a discount where available.' },
    check: { ar: 'طابق السعر قبل الضريبة وإجمالي أمر البيع والفاتورة.', en: 'Compare the pre-tax amount, sales-order total and invoice total.' },
  },
  {
    scenario: { ar: 'تغيير حالة الطلب', en: 'Order state change' },
    action: { ar: 'حوّل حالة الطلب إلى مكتمل طبقًا لإعدادات الربط.', en: 'Move the order to a completed status according to your mapping.' },
    check: { ar: 'راجع تأكيد الطلب والصرف والفاتورة حسب ما فعّلته بالفعل.', en: 'Inspect confirmation, stock movement and invoicing as configured.' },
  },
  {
    scenario: { ar: 'مرتجع جزئي', en: 'Partial return' },
    action: { ar: 'أرجع منتجًا واحدًا فقط من طلب متعدد البنود.', en: 'Return just one line from a multi-line order.' },
    check: { ar: 'راقب الكمية والمرتجع المحاسبي والمنتج غير المرتجع.', en: 'Check returned quantity, accounting adjustment and untouched order lines.' },
  },
  {
    scenario: { ar: 'مرتجع كامل', en: 'Full return' },
    action: { ar: 'أرجع جميع بنود طلب تجريبي.', en: 'Return all items in a sample order.' },
    check: { ar: 'راجع حالة كل بند وإرجاع المخزون ومعالجة الفاتورة.', en: 'Verify all line states, stock movements and invoice handling.' },
  },
  {
    scenario: { ar: 'تكرار حدث', en: 'Repeated event' },
    action: { ar: 'اختبر إعادة وصول نفس إشعار الطلب داخل بيئة الاختبار.', en: 'Replay an existing test order event in a safe environment.' },
    check: { ar: 'تأكد من عدم إنشاء طلب أو فاتورة مكررة.', en: 'Confirm that no extra order or invoice is created.' },
  },
]

const decisions = [
  { key: { ar: 'مرجع المنتجات', en: 'Product identity' }, value: { ar: 'SKU والمتغيرات والمنتج المقابل في أودوو', en: 'SKU, variants and the corresponding Odoo product' } },
  { key: { ar: 'تطابق العملاء', en: 'Customer matching' }, value: { ar: 'البريد أو الهاتف أو معرف العميل مع معالجة التكرارات', en: 'Email, phone or customer reference with duplicate handling' } },
  { key: { ar: 'المخزون', en: 'Inventory' }, value: { ar: 'المستودع ومصدر الكمية واتجاه التحديث', en: 'Warehouse, stock source and update direction' } },
  { key: { ar: 'الأسعار والضريبة', en: 'Pricing and VAT' }, value: { ar: 'شامل أو غير شامل الضريبة، والشحن والخصومات', en: 'Tax-inclusive vs exclusive pricing, shipping and discounts' } },
  { key: { ar: 'أحداث الطلب والمرتجع', en: 'Order and return events' }, value: { ar: 'الحالة التي تؤكد البيع أو تفوتره أو تعيد المخزون', en: 'Which statuses confirm orders, invoice or restock goods' } },
  { key: { ar: 'نتائج العمليات', en: 'Operation outcomes' }, value: { ar: 'النجاح والفشل والتخطي وإعادة المحاولة والطابور', en: 'Success, failures, skips, retries and queue outcomes' } },
]

export default async function ZidOdooChecklistPage() {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const isAr = lang === 'ar'
  const structuredData = zidOdooGuideStructuredData(lang)
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" dir={isAr ? 'rtl' : 'ltr'}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
      <PublicSiteHeader lang={lang} />
      <main className="flex-1">
        <article>
          <header className="border-b border-border bg-secondary/20 px-6 py-16 md:px-12">
            <div className="mx-auto max-w-4xl">
              <nav aria-label={isAr ? 'مسار الصفحة' : 'Breadcrumb'} className="mb-7 flex gap-2 text-xs text-muted-foreground">
                <Link href="/">{isAr ? 'الرئيسية' : 'Home'}</Link><span>/</span>
                <Link href="/integrations/zid-odoo">Zid + Odoo</Link><span>/</span>
                <span>{isAr ? 'دليل الاختبار' : 'Testing guide'}</span>
              </nav>
              <p className="text-xs font-bold uppercase tracking-widest text-primary">ERP Link / Integration checklist</p>
              <h1 className="mt-4 text-4xl font-black leading-tight md:text-5xl">
                {isAr ? 'كيفية تجهيز واختبار ربط زد بأودوو خطوة بخطوة' : 'Zid–Odoo Connection: Setup and Test Checklist'}
              </h1>
              <p className="mt-6 text-base leading-8 text-muted-foreground">
                {isAr
                  ? 'الربط الناجح ليس مجرد وصول أول طلب. هذا الدليل يوضح القرارات التي يجب حسمها والاختبارات التي تكشف مشكلات الفواتير والمخزون والمرتجعات قبل التشغيل الحقيقي.'
                  : 'A connection is not complete when the first order arrives. This checklist covers the decisions and tests that reveal invoicing, inventory and return issues before production.'}
              </p>
              <p className="mt-4 text-xs text-muted-foreground">{isAr ? 'دليل تشغيلي من ERP Link — مخصص للتحضير والفحص، وليس ضمانًا لسلوك كل إعداد.' : 'An operational preparation guide from ERP Link; not a guarantee for every configuration.'}</p>
            </div>
          </header>
          <section className="px-6 py-14 md:px-12">
            <div className="mx-auto max-w-4xl">
              <h2 className="text-2xl font-black">{isAr ? '1. حدد شكل انتقال البيانات' : '1. Define the direction of data'}</h2>
              <p className="mt-3 leading-8 text-muted-foreground">
                {isAr
                  ? 'قبل تفعيل الربط، اكتب أين تُنشأ الطلبات وأين تُدار الكميات والفواتير. يختلف المصدر الصحيح للمخزون عن المصدر الصحيح لحالة الدفع؛ لا تجعل كل نوع بيانات ثنائي الاتجاه بدون سبب.'
                  : 'Decide where orders originate and where quantities and invoices are managed. The stock source may differ from the payment-status source; not every field should synchronize both ways.'}
              </p>
              <h2 className="mt-12 text-2xl font-black">{isAr ? '2. قائمة إعدادات يجب مراجعتها' : '2. Configuration decisions to review'}</h2>
              <dl className="mt-6 divide-y divide-border border-y border-border">
                {decisions.map((decision) => (
                  <div key={decision.key.en} className="grid gap-2 py-5 md:grid-cols-[190px_1fr] md:gap-8">
                    <dt className="font-bold">{decision.key[lang]}</dt>
                    <dd className="text-sm leading-7 text-muted-foreground">{decision.value[lang]}</dd>
                  </div>
                ))}
              </dl>
              <h2 className="mt-12 text-2xl font-black">{isAr ? '3. اختبر دورة الطلب بالكامل' : '3. Test the whole order lifecycle'}</h2>
              <p className="mt-3 leading-8 text-muted-foreground">{isAr ? 'نفّذ الاختبارات على متجر وأودوو تجريبيين، ثم قارن نتائج كل مرحلة في سجلات العمليات والطابور.' : 'Run these cases on a test store and test Odoo database, comparing every step with synchronization logs and queue outcomes.'}</p>
              <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
                <table className="w-full min-w-[650px] text-sm">
                  <thead className="bg-secondary/50 text-start"><tr>
                    <th scope="col" className="p-4 text-start">{isAr ? 'السيناريو' : 'Scenario'}</th>
                    <th scope="col" className="p-4 text-start">{isAr ? 'التجربة' : 'Action'}</th>
                    <th scope="col" className="p-4 text-start">{isAr ? 'ما يجب التحقق منه' : 'Check'}</th>
                  </tr></thead>
                  <tbody>{scenarios.map((test) => (
                    <tr key={test.scenario.en} className="border-t border-border align-top">
                      <th scope="row" className="p-4 text-start font-bold">{test.scenario[lang]}</th>
                      <td className="p-4 leading-6 text-muted-foreground">{test.action[lang]}</td>
                      <td className="p-4 leading-6 text-muted-foreground">{test.check[lang]}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <h2 className="mt-12 text-2xl font-black">{isAr ? '4. متى تعرف أن الربط جاهز؟' : '4. What does ready for production mean?'}</h2>
              <p className="mt-3 leading-8 text-muted-foreground">
                {isAr
                  ? 'عندما تتطابق المبالغ والكميات في الاختبارات، ولا تنشأ سجلات مكررة، وتُعرف أسباب السجلات الفاشلة أو المتخطاة، وتعمل قواعد الإرجاع حسب الإعدادات المحفوظة. سجّل النتائج وراجع أي اختلاف قبل التوسع.'
                  : 'When amounts and quantities match, retries do not duplicate records, failed and skipped events have understood causes, and returns behave according to saved settings. Record outcomes and resolve differences before scaling.'}
              </p>
              <h2 className="mt-12 text-2xl font-black">{isAr ? 'مصادر مفيدة من المنصة' : 'Platform documentation'}</h2>
              <p className="mt-3 leading-8 text-muted-foreground">
                {isAr ? 'لفهم نموذج الصلاحيات والربط المخصص في زد، راجع الوثائق الرسمية، ثم استخدم إعدادات ERP Link لتجربة الربط الملائم لنشاطك.' : 'For Zid application access and custom integrations, consult its official guidance and then test the connection configured for your store.'}
              </p>
              <a href="https://help.zid.sa/ar/apps/private-apps" rel="noopener noreferrer" target="_blank" className="mt-4 inline-flex text-sm font-bold text-primary underline">{isAr ? 'وثائق زد الرسمية لربط الأنظمة' : 'Official Zid integration guidance'}</a>
              <div className="mt-12 flex flex-wrap gap-3">
                <Link href="/integrations/zid-odoo" className="rounded-lg border border-border px-5 py-3 text-sm font-bold hover:text-primary">{isAr ? 'تفاصيل ربط زد بأودوو' : 'Zid–Odoo integration'}</Link>
                <Link href="/contact" className="rounded-lg bg-primary px-5 py-3 text-sm font-bold text-primary-foreground">{isAr ? 'استفسر عن حالتك' : 'Ask about your case'}</Link>
              </div>
            </div>
          </section>
        </article>
      </main>
      <PublicSiteFooter lang={lang} />
    </div>
  )
}
