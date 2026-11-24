import type { GuideContent } from '../types'

export const zidOdooReturnsGuide: GuideContent = {
  meta: {
    slug: 'zid-odoo-returns',
    title: {
      ar: 'إدارة مرتجعات زد في أودوو: المرتجع الجزئي والكامل والمخزون',
      en: 'Managing Zid Returns in Odoo: Partial, Full Returns, and Stock Restocking',
    },
    h1Title: {
      ar: 'إدارة مرتجعات زد في نظام أودوو: الدليل العملي للمرتجع الجزئي والكامل والمخزون',
      en: 'Managing Zid Store Returns in Odoo: Partial, Full Returns, Credit Notes & Restocking',
    },
    description: {
      ar: 'دليل تشغيلي متكامل لمعالجة مرتجعات متجر زد في أودوو: الفرق بين الإلغاء والمرتجع، إنشاء الإشعارات الدائنة، وإرجاع المخزون السليم دون تكرار العمليات.',
      en: 'A comprehensive operational guide to handling Zid store returns in Odoo: cancellation vs. return, automated credit notes, stock replenishment, and duplicate prevention.',
    },
    summary: {
      ar: 'يوضح هذا الدليل كيفية معالجة المرتجعات الجزئية والكاملة لطلبات زد داخل أودوو، وتوليد القيود المحاسبية العكسية وسندات استرجاع البضائع للمستودع بدقة.',
      en: 'This guide details how to automate partial and full return workflows from Zid to Odoo, creating credit notes, adjusting customer receivables, and returning items to warehouse locations.',
    },
    category: 'returns',
    primaryKeyword: {
      ar: 'مرتجعات زد أودوو',
      en: 'Zid Odoo returns',
    },
    secondaryKeywords: {
      ar: ['ربط مرتجع زد بأودوو', 'مرتجع جزئي Odoo', 'إرجاع المخزون بعد المرتجع', 'إشعار دائن أودوو لمتجر زد'],
      en: ['Odoo e-commerce return management', 'partial order return Odoo', 'credit note generation Zid', 'reverse logistics e-commerce'],
    },
    readingTimeMinutes: 12,
    publishedAt: '2026-11-24',
    updatedAt: '2026-11-24',
    relatedPlatform: 'zid',
    relatedIntegrationPath: '/integrations/zid-odoo',
    relatedGuideSlugs: ['zid-odoo-setup', 'zid-odoo-stock-sync', 'zid-odoo-checklist'],
    featured: false,
  },
  sections: [
    {
      id: 'cancellation-vs-return',
      title: {
        ar: 'الفرق الجوهري بين إلغاء الطلب (Cancellation) ومرتجع المبيعات (Return)',
        en: 'The Fundamental Distinction: Order Cancellation vs. Return Merchandise',
      },
      paragraphs: [
        {
          ar: 'من أكبر الأخطاء التي تسبب ارتباكًا في الحسابات والمستودعات هو الخلط بين "إلغاء الطلب قبل الشحن" و"مرتجع الطلب بعد الاستلام". لكل حالة مسار محاسبي ومخزني مختلف تمامًا داخل نظام أودوو:',
          en: 'A frequent operational pitfall in e-commerce is conflating pre-shipment order cancellations with post-delivery customer returns. Each scenario follows an entirely distinct accounting and logistical workflow in Odoo:',
        },
      ],
      table: {
        headers: [
          { ar: 'نوع العملية', en: 'Workflow Type' },
          { ar: 'توقيت الحدوث', en: 'Occurrence Timing' },
          { ar: 'الأثر المخزني في أودوو', en: 'Odoo Inventory Impact' },
          { ar: 'الأثر المالي في أودوو', en: 'Odoo Financial Impact' },
        ],
        rows: [
          [
            { ar: 'إلغاء الطلب (Order Cancelled)', en: 'Order Cancelled' },
            { ar: 'قبل خروج البضاعة من المستودع (قيد التجهيز)', en: 'Before fulfillment/dispatch from warehouse' },
            { ar: 'إلغاء حجز الكمية (Unreserve) دون الحاجة لسند إرجاع', en: 'Unreserves allocated stock; no return picking required' },
            { ar: 'إلغاء أمر البيع أو الفاتورة المسودة دون إنشاء إشعار دائن', en: 'Cancels draft quotation/invoice with no credit note' },
          ],
          [
            { ar: 'مرتجع المبيعات (Order Returned)', en: 'Sales Return' },
            { ar: 'بعد شحن الطلب واستلام العميل له بالفعل', en: 'After delivery is confirmed and items leave warehouse' },
            { ar: 'إنشاء سند استلام مرتجع (Return Picking) لفحص البضاعة', en: 'Generates Return Picking to restock or inspect goods' },
            { ar: 'إنشاء إشعار دائن (Credit Note) يعكس الفاتورة المرحلة', en: 'Creates posted Credit Note reversing original invoice' },
          ],
        ],
      },
    },
    {
      id: 'partial-vs-full-returns',
      title: {
        ar: 'المرتجع الجزئي (Partial) مقابل المرتجع الكامل (Full Return)',
        en: 'Partial Returns vs. Full Order Reversals',
      },
      paragraphs: [
        {
          ar: 'في التجارة الإلكترونية، نادرًا ما يرجع العميل كامل محتويات الطلب، بل غالبًا ما يطلب استرجاع قطعة واحدة بسبب المقاس أو رغبة شخصية:',
          en: 'In modern retail, shoppers frequently return a single line item (such as an ill-fitting shoe size) while keeping the remainder of their multi-item order:',
        },
      ],
      steps: [
        {
          title: {
            ar: '1. معالجة المرتجع الجزئي (Partial Return Logic)',
            en: '1. Partial Return Execution',
          },
          text: {
            ar: 'عندما يُسجل في متجر زد استرجاع منتج واحد من أصل ثلاثة، يقوم ERP Link بقراءة قائمة البنود المرتجعة بدقة. في أودوو، يتم إنشاء إشعار دائن جزئي مقتصر على قيمة هذا البند فقط مع ضريبته، بالإضافة إلى إنشاء سند استرجاع مخزني خاص بالكمية المرتجعة فقط، مع الإبقاء على الفاتورة الأصلية وسند الشحن الأساسي ساريين للبنود غير المرتجعة.',
            en: 'When a Zid return covers one item from a 3-item order, ERP Link parses returned lines exclusively. In Odoo, a partial Credit Note is issued matching only the returned item value and corresponding VAT, alongside a return picking for that specific unit, preserving the remaining delivered lines.',
          },
        },
        {
          title: {
            ar: '2. معالجة المرتجع الكامل (Full Return Logic)',
            en: '2. Full Return Execution',
          },
          text: {
            ar: 'في المرتجع الكامل، يتم عكس كافة بنود الطلب، مع خيار تحديد ما إذا كانت رسوم الشحن مستردة أم غير مستردة بحسب سياسة متجرك المعتمدة في إعدادات ERP Link.',
            en: 'For full returns, all order lines are reversed simultaneously. Configuration settings in ERP Link dictate whether original outbound delivery fees are refunded or retained per your store return policy.',
          },
        },
      ],
    },
    {
      id: 'inventory-restock-and-quarantine',
      title: {
        ar: 'المسار المخزني للبضاعة المرتجعة: المستودع السليم أم التالف؟',
        en: 'Logistical Routing: Restocking Salable Goods vs. Damaged Scrap',
      },
      paragraphs: [
        {
          ar: 'لا ينبغي إعادة كل قطعة مرتجعة إلى المخزون المتاح للبيع فورًا، فقد تكون القطعة مفتوحة أو تالفة نتيجة الشحن:',
          en: 'Returned merchandise should not always immediately re-enter available-to-promise inventory, as packages may arrive opened or damaged in transit:',
        },
        {
          ar: '1. إرجاع مباشر للمستودع (Immediate Restock): إذا كانت سياسة متجرك تعتمد استلام المرتجع كبضاعة سليمة، يتم توجيه سند الاسترجاع (Return Picking) إلى موقع المستودع الافتراضي (WH/Stock) لرفع الكمية المتاحة للبيع فورًا في أودوو وزد.\n2. منطقة الفحص والفرز (Quality Quarantine): يتيح لك أودوو توجيه المرتجع إلى موقع فرز وسيط (مثل WH/Input/Returns). يقوم أمين المستودع بفحص المنتج، وتأكيد القطع الصالحة لإعادتها للرف، أو تحويل القطع التالفة إلى موقع التوالف (Scrap Location).',
          en: '1. Direct Restocking: For sealed merchandise, the return picking deposits units into WH/Stock, restoring live availability in both Odoo and Zid.\n2. Quarantine / Inspection Location: Odoo allows routing incoming returns to a staging buffer (e.g., WH/Input/Returns). Warehouse staff inspect packaging, restocking pristine units and scrapping damaged items to Scrap/Loss accounts.',
        },
      ],
    },
    {
      id: 'preventing-duplicate-returns',
      title: {
        ar: 'منع تكرار المرتجعات والحفاظ على سلامة القيود المحاسبية',
        en: 'Idempotency Guarantees: Preventing Duplicate Credit Notes',
      },
      paragraphs: [
        {
          ar: 'تعد مشكلة إنشاء إشعار دائن مكرر لنفس الطلب كارثة محاسبية تؤدي إلى مضاعفة التزامات الشركة تجاه العميل والتلاعب غير المقصود في المخزون. يضمن ERP Link الحماية الصارمة من خلال:',
          en: 'Accidentally generating duplicate Credit Notes or double return pickings for a single return event distorts financials and inflates phantom stock. ERP Link protects ledger integrity through multi-layer verification:',
        },
      ],
      steps: [
        {
          title: {
            ar: 'بصمة المرتجع الفريدة (Return Event Fingerprinting)',
            en: 'Return Event Fingerprinting',
          },
          text: {
            ar: 'يولد النظام بصمة رقمية فريدة (Hash) لكل حدث مرتجع، تجمع بين معرف الطلب في زد، معرف عملية الإرجاع، والبنود المحددة. إذا أرسل زد نفس الإشعار مرة أخرى، يكتشف النظام البصمة المسجلة مسبقًا ويتخطى المعالجة فورًا.',
            en: 'Our engine generates a unique cryptographic fingerprint combining the Zid Order ID, Return ID, and returned SKU items. If duplicate webhook deliveries arrive, the system matches the prior hash and skips execution safely.',
          },
        },
        {
          title: {
            ar: 'التحقق المباشر من القيود القائمة في أودوو (Live Ledger Audit)',
            en: 'Live Ledger Audit Before Odoo Write',
          },
          text: {
            ar: 'قبل إنشاء أي إشعار دائن (account.move) في أودوو، يبحث النظام في سجلات الفاتورة المرتبطة بالطلب للتأكد من عدم وجود إشعار دائن مرحل لنفس السلعة مسبقًا.',
            en: 'Before dispatching write commands to account.move in Odoo, the integration queries the source invoice to confirm no posted reverse credit note already covers the targeted line items.',
          },
        },
      ],
    },
    {
      id: 'testing-returns-workflow',
      title: {
        ar: 'سيناريو اختبار تطبيقي لمرتجع جزئي',
        en: 'Practical Testing Walkthrough for Partial Returns',
      },
      paragraphs: [
        {
          ar: 'اتبع هذا السيناريو على طلب تجريبي للتأكد من اكتمال دورة المرتجعات بنجاح:',
          en: 'Run this validation test on a staging order to confirm end-to-end return behavior:',
        },
      ],
      steps: [
        {
          title: {
            ar: '1. إنشاء طلب تجريبي بمنتجين مختلفين وإكماله',
            en: '1. Create and Fulfill a 2-Item Test Order',
          },
          text: {
            ar: 'أنشئ طلبًا في متجر زد يحتوي على منتجين (مثل: منتج A بقيمة 100 ريال، ومنتج B بقيمة 150 ريال). انقل حالة الطلب إلى "مكتمل" وتأكد من إنشاء أمر البيع والفاتورة وترحيلها في أودوو.',
            en: 'Place a Zid test order containing 2 distinct items (Product A: 100 SAR, Product B: 150 SAR). Advance the status to "Completed" and confirm the confirmed Sales Order and posted invoice in Odoo.',
          },
        },
        {
          title: {
            ar: '2. إنشاء طلب إرجاع للبند الأول فقط في زد',
            en: '2. Initiate a Return for Product A in Zid',
          },
          text: {
            ar: 'من لوحة تحكم زد، افتح تفاصيل الطلب وسجل مرتجعًا للمنتج A فقط، ثم حدد حالة المرتجع كمعتمد ومستلم.',
            en: 'From the Zid admin panel, initiate a return for Product A only, advancing its status to approved and received.',
          },
        },
        {
          title: {
            ar: '3. فحص القيود في أودوو وسجلات ERP Link',
            en: '3. Verify Odoo Ledgers and ERP Link Sync Logs',
          },
          text: {
            ar: 'افتح صفحة سجلات ERP Link وتأكد من نجاح معالجة حدث المرتجع. ثم افتح أودوو: تحقق من ظهور إشعار دائن بقيمة 100 ريال + الضريبة مربوط بالفاتورة الأصلية، وتحقق من عودة قطعة واحدة من المنتج A إلى مستودع المخزون.',
            en: 'Check ERP Link sync logs for a clean 200 execution. In Odoo, verify a partial Credit Note for 100 SAR + 15% VAT tied to the original invoice, along with 1 restocked unit of Product A.',
          },
        },
      ],
      callout: {
        type: 'warning',
        title: {
          ar: 'تنبيه بشأن تباين إعدادات المرتجعات بين المتاجر',
          en: 'Variation in Store Operational Policies',
        },
        text: {
          ar: 'لا تعمل جميع سيناريوهات المرتجعات تلقائيًا في كل بيئة؛ يعتمد ذلك على ضبط خيارات ERP Link (مثل تفعيل الإرجاع التلقائي أو الاكتفاء بإنشاء مسودة إشعار دائن للمراجعة). يمكنك اختيار السلوك المتوافق مع سياستك المحاسبية الداخلية.',
          en: 'Return automation behavior depends on your configured ERP Link preferences (e.g., auto-posting credit notes vs. staging drafts for financial review). Tailor these settings to reflect your company internal controls.',
        },
      },
    },
  ],
  faqs: [
    {
      question: {
        ar: 'هل يمكن إرجاع المبالغ للعميل تلقائيًا عبر بوابة الدفع عند تسجيل المرتجع؟',
        en: 'Does ERP Link trigger payment gateway refunds automatically?',
      },
      answer: {
        ar: 'يركز ERP Link على مزامنة القيود المحاسبية وحركة المخزون بين زد وأودوو. تتم استعادة المبالغ المالية لحساب العميل البنكي عادة من خلال بوابة الدفع المعتمدة في متجر زد (مثل تمارا، تابي، ميسر، أو بوابات الدفع المباشرة).',
        en: 'ERP Link manages ERP ledger accounting and inventory restocks between Zid and Odoo. Monetary refunds to consumer bank accounts or cards are processed directly via your Zid payment gateway.',
      },
    },
    {
      question: {
        ar: 'ماذا يحدث إذا كان الطلب الأصلي قد تم إلغاؤه قبل شحنه؟',
        en: 'What occurs if an order is cancelled prior to shipping?',
      },
      answer: {
        ar: 'إذا أُلغي الطلب وهو في حالة المسودة أو قيد التجهيز في زد، يقوم ERP Link بإلغاء أمر البيع في أودوو وإلغاء حجز البضاعة تلقائيًا دون إنشاء إشعارات دائنة غير ضرورية.',
        en: 'If an order is cancelled while still in draft or fulfillment stages, ERP Link cancels the Odoo Sales Order and releases reserved items automatically, bypassing superfluous credit note creation.',
      },
    },
  ],
  summaryKeyTakeaways: {
    ar: [
      'فرّق دائمًا بين إلغاء الطلب قبل الشحن (فك حجز المخزون) والمرتجع بعد التسليم (إشعار دائن وسند إرجاع).',
      'يدعم ERP Link المرتجعات الجزئية بدقة على مستوى كل بند دون التأثير على البنود الأخرى في الطلب.',
      'نظام البصمة الرقمية يمنع تكرار الإشعارات الدائنة حتى لو تكرر وصول إشعار الويب من المنصة.',
      'حدد موقع استلام المرتجع في أودوو (مستودع مباشر أو منطقة فحص) لضمان عدم بيع سلع تالفة.',
    ],
    en: [
      'Differentiate strictly between pre-dispatch cancellations and post-delivery returns.',
      'ERP Link isolates partial returns at the line level, leaving untouched order lines intact.',
      'Cryptographic event hashing guarantees zero duplicate Credit Notes on network retries.',
      'Route returns to dedicated quarantine inspection locations to prevent recirculating damaged stock.',
    ],
  },
  officialDocLinks: [
    {
      label: { ar: 'دليل مرتجعات المبيعات والإشعارات الدائنة في أودوو (Odoo Credit Notes)', en: 'Odoo Credit Notes & Customer Returns' },
      url: 'https://www.odoo.com/documentation/17.0/applications/finance/accounting/customer_invoices/credit_notes.html',
    },
    {
      label: { ar: 'دليل إدارة الطلبات والمرتجعات في زد (Zid Orders & Returns)', en: 'Zid Orders & Returns Reference' },
      url: 'https://help.zid.sa/ar/apps/private-apps',
    },
  ],
}
