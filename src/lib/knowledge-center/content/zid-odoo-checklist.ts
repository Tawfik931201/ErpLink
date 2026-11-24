import type { GuideContent } from '../types'

export const zidOdooChecklistGuide: GuideContent = {
  meta: {
    slug: 'zid-odoo-checklist',
    title: {
      ar: 'كيفية ربط زد بأودوو: دليل الاختبار والتشغيل',
      en: 'Zid–Odoo Setup & Testing Checklist',
    },
    h1Title: {
      ar: 'كيفية تجهيز واختبار ربط زد بأودوو خطوة بخطوة',
      en: 'Zid–Odoo Connection: Setup and Test Checklist',
    },
    description: {
      ar: 'قائمة عملية لتجهيز وربط زد مع أودوو: خريطة البيانات والضرائب والشحن والطلبات والمرتجعات والتأكد من عدم التكرار.',
      en: 'A practical Zid Odoo integration checklist for product matching, taxes, shipping, returns, order events and test scenarios.',
    },
    summary: {
      ar: 'الربط الناجح ليس مجرد وصول أول طلب. هذا الدليل يوضح القرارات التي يجب حسمها والاختبارات التي تكشف مشكلات الفواتير والمخزون والمرتجعات قبل التشغيل الحقيقي.',
      en: 'A connection is not complete when the first order arrives. This checklist covers the decisions and tests that reveal invoicing, inventory and return issues before production.',
    },
    category: 'zid-odoo',
    primaryKeyword: {
      ar: 'اختبار ربط زد بأودوو',
      en: 'Zid Odoo testing checklist',
    },
    secondaryKeywords: {
      ar: ['دليل فحص ربط زد أودوو', 'قائمة تشغيل زد أودوو', 'فحص المرتجعات والضرائب زد'],
      en: ['Zid Odoo verification', 'Zid integration audit', 'e-commerce Odoo test cases'],
    },
    readingTimeMinutes: 8,
    publishedAt: '2026-11-24',
    updatedAt: '2026-11-24',
    relatedPlatform: 'zid',
    relatedIntegrationPath: '/integrations/zid-odoo',
    relatedGuideSlugs: ['zid-odoo-setup', 'zid-odoo-stock-sync', 'zid-odoo-vat-15', 'zid-odoo-returns'],
    featured: false,
  },
  sections: [
    {
      id: 'define-data-direction',
      title: {
        ar: '1. حدد شكل انتقال البيانات',
        en: '1. Define the direction of data',
      },
      paragraphs: [
        {
          ar: 'قبل تفعيل الربط، اكتب أين تُنشأ الطلبات وأين تُدار الكميات والفواتير. يختلف المصدر الصحيح للمخزون عن المصدر الصحيح لحالة الدفع؛ لا تجعل كل نوع بيانات ثنائي الاتجاه بدون سبب.',
          en: 'Decide where orders originate and where quantities and invoices are managed. The stock source may differ from the payment-status source; not every field should synchronize both ways.',
        },
      ],
    },
    {
      id: 'configuration-decisions',
      title: {
        ar: '2. قائمة إعدادات يجب مراجعتها',
        en: '2. Configuration decisions to review',
      },
      paragraphs: [
        {
          ar: 'راجع مرجع المنتجات (SKU)، تطابق العملاء، مصدر المخزون، الأسعار والضريبة، وأحداث الطلب والمرتجع ونتائج العمليات في السجلات.',
          en: 'Review product references, customer deduplication, stock locations, taxes, discount distributions, and queue outcome logs.',
        },
      ],
    },
    {
      id: 'order-lifecycle-testing',
      title: {
        ar: '3. اختبر دورة الطلب بالكامل',
        en: '3. Test the whole order lifecycle',
      },
      paragraphs: [
        {
          ar: 'نفّذ الاختبارات على متجر وأودوو تجريبيين، ثم قارن نتائج كل مرحلة في سجلات العمليات والطابور: طلب جديد، ضريبة وشحن وخصم، تغيير حالة الطلب، مرتجع جزئي، مرتجع كامل، وتكرار الحدث.',
          en: 'Run these cases on a test store and test Odoo database, comparing every step with synchronization logs and queue outcomes: new order, VAT & discounts, status changes, returns, and duplicate events.',
        },
      ],
    },
    {
      id: 'ready-for-production',
      title: {
        ar: '4. متى تعرف أن الربط جاهز؟',
        en: '4. What does ready for production mean?',
      },
      paragraphs: [
        {
          ar: 'عندما تتطابق المبالغ والكميات في الاختبارات، ولا تنشأ سجلات مكررة، وتُعرف أسباب السجلات الفاشلة أو المتخطاة، وتعمل قواعد الإرجاع حسب الإعدادات المحفوظة.',
          en: 'When amounts and quantities match, retries do not duplicate records, failed and skipped events have understood causes, and returns behave according to saved settings.',
        },
      ],
    },
  ],
  faqs: [
    {
      question: {
        ar: 'هل يتطلب فحص الربط بيئة اختبارية منفصلة؟',
        en: 'Does pre-launch verification require a dedicated sandbox environment?',
      },
      answer: {
        ar: 'نوصي دائمًا بإجراء الاختبارات على قاعدة بيانات تجريبية (Staging Database) أو استخدام طلبات تجريبية محدودة قبل بدء العمليات الحية.',
        en: 'We strongly recommend executing trial runs on an Odoo staging branch or controlled live test orders before scaling to production volume.',
      },
    },
  ],
  summaryKeyTakeaways: {
    ar: [
      'الربط الناجح يتطلب حسم مصدر المخزون وحالات الطلب مسبقًا.',
      'اختبر دورة الطلب والمرتجع والضريبة بالكامل في بيئة تجريبية.',
      'تأكد من عدم إنشاء سجلات مكررة عند إعادة إرسال الأحداث.',
    ],
    en: [
      'Successful sync requires pre-defining stock sources and order transition rules.',
      'Thoroughly test complete lifecycles: new orders, taxes, status shifts, and returns.',
      'Validate idempotency to ensure replayed events never duplicate records.',
    ],
  },
  officialDocLinks: [
    {
      label: { ar: 'وثائق زد الرسمية لربط الأنظمة', en: 'Official Zid Integration Guidance' },
      url: 'https://help.zid.sa/ar/apps/private-apps',
    },
  ],
}
