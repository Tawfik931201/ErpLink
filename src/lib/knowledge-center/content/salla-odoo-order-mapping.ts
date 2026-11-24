import type { GuideContent } from '../types'

export const sallaOdooOrderMappingGuide: GuideContent = {
  meta: {
    slug: 'salla-odoo-order-mapping',
    title: {
      ar: 'ربط سلة بأودوو: كيفية إعداد خرائط الطلبات والعملاء والمنتجات',
      en: 'Connecting Salla to Odoo: Configuring Order, Customer, and Product Mappings',
    },
    h1Title: {
      ar: 'ربط متجر سلة بنظام أودوو (Odoo): الدليل التطبيقي لإعداد خرائط الطلبات والمنتجات والعملاء',
      en: 'Connecting Salla Store to Odoo ERP: Field Mapping, Customer Matching & Order Workflows',
    },
    description: {
      ar: 'دليل عملي شامل لإعداد خرائط البيانات بين متجر سلة ونظام أودوو: مطابقة المنتجات وSKU، مزامنة جهات الاتصال دون تكرار، وتعيين مراحل الطلبات والفواتير التلقائية.',
      en: 'A step-by-step technical guide to mapping data between Salla and Odoo: product SKU matching, customer deduplication, and configuring order status workflows into Sales Orders.',
    },
    summary: {
      ar: 'يوضح هذا الدليل كيفية ربط متجر سلة بنظام أودوو عبر منصة ERP Link، وشرح آليات مطابقة العملاء والمنتجات، وتحويل حالات طلبات سلة إلى أوامر بيع وفواتير محاسبية بدقة.',
      en: 'This guide explores how to link Salla with Odoo via ERP Link, mastering SKU and customer deduplication algorithms, and transforming Salla order stages into confirmed Odoo sales documents.',
    },
    category: 'salla-odoo',
    primaryKeyword: {
      ar: 'ربط سلة بأودوو',
      en: 'Salla Odoo integration',
    },
    secondaryKeywords: {
      ar: ['مزامنة سلة Odoo', 'نقل طلبات سلة إلى أودوو', 'ربط المنتجات والعملاء سلة', 'خرائط الربط أودوو سلة'],
      en: ['connect Salla to Odoo', 'Salla order sync Odoo', 'Salla product mapping', 'Saudi e-commerce ERP automation'],
    },
    readingTimeMinutes: 12,
    publishedAt: '2026-11-24',
    updatedAt: '2026-11-24',
    relatedPlatform: 'salla',
    relatedIntegrationPath: '/integrations/salla-odoo',
    relatedGuideSlugs: ['zid-odoo-setup', 'zid-odoo-stock-sync'],
    featured: true,
  },
  sections: [
    {
      id: 'salla-architecture-overview',
      title: {
        ar: 'كيف يعمل تكامل متجر سلة مع نظام أودوو عبر منصة ERP Link؟',
        en: 'How Salla and Odoo Integration Operates via ERP Link Architecture',
      },
      paragraphs: [
        {
          ar: 'تعد منصة سلة (Salla) إحدى أبرز منصات التجارة الإلكترونية في الشرق الأوسط. يتميز نظام سلة بمرونة عالية من خلال واجهات برمجة التطبيقات (Salla Partners API) وشبكة إشعارات الويب (Webhooks) التي تبث تحديثات المتجر لحظة بلحظة.',
          en: 'Salla is one of the leading e-commerce platforms across the MENA region. Its robust ecosystem relies on the Salla Partners API and low-latency webhooks broadcasting live store events.',
        },
        {
          ar: 'يعمل ERP Link كطبقة وسيطة ذكية وآمنة تستقبل أحداث سلة (مثل إنشاء طلب جديد، تحديث حالة الدفع، أو الشحن)، وتقوم بمعالجة الحقول ومطابقتها وفق قواعد مخصصة، ثم تنفيذ العمليات داخل قاعدة بيانات أودوو عبر بروتوكولات الاتصال المعتمدة، مع تسجيل دقيق لكل معاملة ومنع أي فقدان أو تكرار للبيانات.',
          en: 'ERP Link functions as an intelligent middleware layer. It ingests inbound Salla webhook events (such as order creation, payment confirmation, or shipment fulfillment), applies custom field mappings, and executes authenticated transactions inside Odoo via XML-RPC/JSON-RPC, keeping comprehensive audit trails.',
        },
      ],
    },
    {
      id: 'prerequisites-and-scopes',
      title: {
        ar: 'متطلبات الربط وصلاحيات الوصول (Scopes) الإلزامية في سلة',
        en: 'Prerequisites and Required Application Scopes in Salla',
      },
      paragraphs: [
        {
          ar: 'لبدء الربط بسلاسة، يجب تثبيت تطبيق ERP Link عبر بوابة شركاء سلة أو متجر تطبيقات سلة مع منح الصلاحيات التشغيلية التالية:',
          en: 'To ensure uninterrupted data synchronization, the ERP Link app must be granted the following core OAuth scopes:',
        },
      ],
      steps: [
        {
          title: {
            ar: 'صلاحيات قراءة وكتابة الطلبات (orders.read / orders.write)',
            en: 'Order Scopes: orders.read / orders.write',
          },
          text: {
            ar: 'تمكن النظام من التقاط تفاصيل الطلبات الجديدة، وأسماء العملاء، وتفاصيل البنود والضرائب والشحن، وتحديث حالة الطلب في سلة عند الرغبة.',
            en: 'Enables real-time ingestion of newly placed orders, line items, shipping fees, tax lines, and payment statuses, with optional two-way status updates.',
          },
        },
        {
          title: {
            ar: 'صلاحيات المنتجات والمخزون (products.read / products.write)',
            en: 'Product & Stock Scopes: products.read / products.write',
          },
          text: {
            ar: 'تتيح مطابقة رموز SKU للمنتجات والمتغيرات، وتحديث الكميات المتاحة في سلة فور تغيرها في مستودعات أودوو.',
            en: 'Grants access to catalog SKU references and enables live stock replenishment from Odoo fulfillment locations to Salla.',
          },
        },
        {
          title: {
            ar: 'صلاحيات العملاء (customers.read)',
            en: 'Customer Profile Access: customers.read',
          },
          text: {
            ar: 'للوصول إلى رقم جوال العميل، بريده الإلكتروني، وعنوان الشحن لتسجيله كشريك تجاري (res.partner) في أودوو.',
            en: 'Permits fetching customer mobile numbers, emails, and physical shipping addresses to populate Odoo res.partner contacts.',
          },
        },
      ],
    },
    {
      id: 'product-sku-matching',
      title: {
        ar: 'إعداد خريطة مطابقة المنتجات والخيارات (Options & SKUs)',
        en: 'Product SKU and Multi-Option Variant Mapping',
      },
      paragraphs: [
        {
          ar: 'تتيح سلة نوعين رئيسيين من المنتجات: المنتجات الجاهزة البسيطة والمنتجات التي تحتوي على خيارات وقيم (كاللون والمقاس):',
          en: 'Salla manages both simple standalone items and complex variant products with configurable options (e.g., color, size, volume):',
        },
        {
          ar: '1. المنتجات البسيطة: تأكد من كتابة رمز الـ SKU في حقل "رمز المنتج" في سلة بما يطابق تمامًا حقل "المرجع الداخلي" (Internal Reference / default_code) في أودوو.\n2. المنتجات ذات الخيارات: في سلة، ينتج عن كل تركيبة خيارات (مثل: قميص أزرق / مقاس L) رمز SKU مستقل ومحدد. يجب أن يطابق هذا الرمز تحديدًا متغير المنتج المقابل في جدول product.product في أودوو.\n3. منتجات الشحن والخصم: أنشئ في أودوو منتج خدمة باسم "رسوم شحن سلة" (نوع Service) ومنتجًا آخر باسم "خصم ترويجي سلة" لاستخدامهما في تسجيل سطور الشحن والقسائم الترويجية.',
          en: '1. Simple Products: Ensure the Salla "Product SKU" precisely matches the Odoo "Internal Reference" (default_code).\n2. Variant Products: In Salla, every specific attribute combination carries its own unique SKU. Each must correspond to an active variant in Odoo product.product.\n3. Service Lines: Create a dedicated "Salla Delivery Service" product and a "Salla Promo Discount" line in Odoo to absorb delivery charges and discount coupons cleanly.',
        },
      ],
    },
    {
      id: 'customer-deduplication',
      title: {
        ar: 'مطابقة العملاء ومنع تكرار جهات الاتصال (res.partner) في أودوو',
        en: 'Customer Deduplication and Contact Management in Odoo',
      },
      paragraphs: [
        {
          ar: 'إذا اشترى نفس العميل من متجرك ثلاث مرات، فأنت بالتأكيد لا تريد إنشاء 3 جهات اتصال مختلفة في أودوو. يعتمد ERP Link استراتيجية مطابقة ذكية متعددة المستويات:',
          en: 'If a customer shops three times on your store, you want all three transactions consolidated under a single Odoo contact ledger rather than cluttering your database with duplicate partners. ERP Link applies a multi-tier deduplication algorithm:',
        },
      ],
      steps: [
        {
          title: {
            ar: 'المستوى الأول: مطابقة رقم الجوال بالصيغة الدولية (+966)',
            en: 'Tier 1: E.164 International Phone Matching',
          },
          text: {
            ar: 'يقوم المحرك بتنظيف رقم الجوال ومطابقته بصيغة E.164 (مثل +9665xxxxxxxx). إذا وُجد شريك في أودوو يحمل نفس الرقم، يتم ربط الطلب به مباشرة.',
            en: 'Our engine normalizes phone numbers into E.164 format (+9665xxxxxxxx). If an existing Odoo res.partner shares this number, the order is attached immediately.',
          },
        },
        {
          title: {
            ar: 'المستوى الثاني: مطابقة البريد الإلكتروني (Email Fallback)',
            en: 'Tier 2: Normalized Email Fallback',
          },
          text: {
            ar: 'في حال عدم توفر رقم الجوال أو اختلافه، يبحث النظام عن تطابق في البريد الإلكتروني للعميل بعد تحويل الأحرف إلى الحالة الصغيرة وإزالة الفراغات.',
            en: 'If phone numbers differ or are absent, the system searches Odoo contacts by lowercase normalized email addresses.',
          },
        },
        {
          title: {
            ar: 'المستوى الثالث: إنشاء جهة اتصال جديدة بدقة',
            en: 'Tier 3: Structured New Contact Creation',
          },
          text: {
            ar: 'إذا كان العميل جديدًا تمامًا، ينشئ ERP Link جهة اتصال جديدة في أودوو متضمنة الاسم الكامل، رقم الجوال، وعنوان الشحن الافتراضي (المدينة والحي والرمز البريدي).',
            en: 'If no match exists, ERP Link creates a fresh res.partner record containing full customer name, phone, email, and detailed delivery addresses.',
          },
        },
      ],
    },
    {
      id: 'order-status-workflow',
      title: {
        ar: 'إعداد دورة حالات الطلب والفواتير وسندات الشحن',
        en: 'Configuring Order Status Lifecycles and Document Automation',
      },
      paragraphs: [
        {
          ar: 'يوفر مركز الخرائط (Mapping Center) مرونة كاملة في تحديد كيفية تفاعل أودوو مع كل مرحلة من مراحل طلبات سلة:',
          en: 'The ERP Link Mapping Center grants fine-grained control over how Odoo responds to every Salla order state transition:',
        },
      ],
      table: {
        headers: [
          { ar: 'حالة الطلب في سلة', en: 'Salla Order Status' },
          { ar: 'الإجراء في أودوو (خيار 1: تحفظي)', en: 'Odoo Action (Conservative)' },
          { ar: 'الإجراء في أودوو (خيار 2: مؤتمت بالكامل)', en: 'Odoo Action (Fully Automated)' },
        ],
        rows: [
          [
            { ar: 'بانتظار الدفع (Under Review / Pending)', en: 'Pending Payment' },
            { ar: 'إنشاء عرض سعر مسودة (Draft Quotation)', en: 'Draft Quotation' },
            { ar: 'تجاهل الطلب حتى تأكيد الدفع', en: 'Ignore until payment confirmed' },
          ],
          [
            { ar: 'قيد التنفيذ / مدفوع (In Progress)', en: 'In Progress / Paid' },
            { ar: 'تأكيد أمر البيع (Sales Order) وحجز المخزون', en: 'Confirm Sales Order & reserve stock' },
            { ar: 'تأكيد البيع + إنشاء وترحيل الفاتورة الضريبية', en: 'Confirm Order + Post Tax Invoice' },
          ],
          [
            { ar: 'تم الشحن / جاري التوصيل (Delivering)', en: 'Delivering / Shipped' },
            { ar: 'إنشاء أمر تسليم البضاعة (Delivery Picking)', en: 'Generate Delivery Picking' },
            { ar: 'تأكيد التسليم وصرف البضاعة من المستودع', en: 'Validate Picking & Deduct Physical Stock' },
          ],
          [
            { ar: 'مكتمل (Completed)', en: 'Completed' },
            { ar: 'ترحيل الفاتورة وإقفال المدفوعات', en: 'Post invoice & register payment' },
            { ar: 'إقفال كامل لدورة البيع محاسبيًا ومخزنيًا', en: 'Full order reconciliation and closure' },
          ],
        ],
      },
    },
    {
      id: 'payment-methods-and-cod',
      title: {
        ar: 'معالجة بوابات الدفع الإلكتروني والدفع عند الاستلام (COD)',
        en: 'Payment Gateway Journal Mapping and Cash on Delivery (COD)',
      },
      paragraphs: [
        {
          ar: 'تتعدد طرق الدفع في سلة بين مدى، البطاقات الائتمانية، أبل باي، تابي، تمارا، والدفع عند الاستلام. في المحاسبة السليمة، لا يجوز توجيه جميع المقبوضات إلى دفتر يومية واحد:',
          en: 'Salla accommodates diverse payment channels: Mada, Apple Pay, credit cards, Tabby, Tamara, and Cash on Delivery (COD). Sound financial practice requires routing settlements to distinct Odoo payment journals:',
        },
        {
          ar: '1. بوابات الدفع المباشرة (Mada / Apple Pay): يتم ربطها بحساب وسيط لبوابة الدفع (مثل: Salla Gateway Clearing Account) لسهولة مطابقة كشوفات الحساب البنكية مع مبالغ الإيداع الفعلية.\n2. تمارا وتابي (Buy Now Pay Later): يتم توجيهها لدفتر يومية مخصص لتسجيل عمولة التقسيط ومطابقة الدفعات المستحقة.\n3. الدفع عند الاستلام (COD): يترك حساب العميل مدينًا حتى تأكيد شركة الشحن استلام المبلغ وتحويله للمتجر.',
          en: '1. Electronic Gateways (Mada, Apple Pay): Map to a dedicated clearing account (e.g., Salla Payment Clearing) to simplify reconciling bulk bank deposits against gross sales.\n2. Buy Now Pay Later (Tabby / Tamara): Route to designated BNPL journals to properly account for financing fee deductions.\n3. Cash on Delivery (COD): Keeps customer receivables open until the fulfillment carrier confirms physical cash collection and remits funds.',
        },
      ],
    },
  ],
  faqs: [
    {
      question: {
        ar: 'هل يمكن مزامنة فروع ومستودعات متعددة لمتجر سلة؟',
        en: 'Does ERP Link support multi-branch fulfillment for Salla stores?',
      },
      answer: {
        ar: 'نعم، إذا كان متجرك في سلة مفعلًا للفروع المتعددة، يستطيع ERP Link قراءة معرف الفرع (Branch ID) المنسوب للطلب وتوجيه أمر الصرف إلى مستودع أودوو المقابل لهذا الفرع بالتحديد.',
        en: 'Yes. For Salla Plus and Pro stores utilizing multiple branch locations, ERP Link captures the branch ID tagged to incoming orders, routing fulfillment pickings to the corresponding regional Odoo warehouse.',
      },
    },
    {
      question: {
        ar: 'ماذا يحدث إذا احتوى الطلب في سلة على منتج غير مضاف في أودوو؟',
        en: 'What happens if a Salla order contains an SKU that does not exist in Odoo?',
      },
      answer: {
        ar: 'يقوم ERP Link بإيقاف معالجة هذا الطلب مؤقتًا ويسجل تنبيهًا تفصيليًا في صفحة السجلات يحدد رمز الـ SKU المفقود. بمجرد إضافة المنتج في أودوو، يمكنك الضغط على زر "إعادة المحاولة" (Retry) ليتم استكمال الطلب فورًا دون أي تكرار.',
        en: 'ERP Link safely holds the transaction in the queue and records an alert in the Sync Logs specifying the missing SKU. Once you register or fix the SKU in Odoo, click "Retry" to complete the sync cleanly.',
      },
    },
  ],
  summaryKeyTakeaways: {
    ar: [
      'مطابقة الـ SKU بدقة بين سلة وحقل default_code في أودوو هي أساس نجاح مزامنة الطلبات.',
      'يعتمد النظام خوارزمية ذكية لمطابقة العملاء بالجوال والبريد لمنع تكرار جهات الاتصال في أودوو.',
      'يوفر مركز الخرائط مرونة كاملة في تحديد وقت تأكيد البيع وإصدار الفواتير وسندات الشحن.',
      'توجيه بوابات الدفع إلى دفاتر يومية مخصصة يسهل التسويات المحاسبية والمطابقة البنكية.',
    ],
    en: [
      'Exact SKU alignment between Salla and Odoo default_code is the foundation of order synchronization.',
      'Multi-tier customer deduplication by phone and email prevents duplicate contacts in Odoo.',
      'The Mapping Center provides complete flexibility over quotation confirmation, invoicing, and fulfillment.',
      'Mapping payment gateways to specific Odoo journals streamlines bank reconciliations and settlement audits.',
    ],
  },
  officialDocLinks: [
    {
      label: { ar: 'دليل مطوري وشركاء سلة الرسمية (Salla Partners Docs)', en: 'Salla Partners API Documentation' },
      url: 'https://docs.salla.dev',
    },
    {
      label: { ar: 'دليل تطبيق المبيعات والعملاء في أودوو (Odoo Sales)', en: 'Odoo Sales Application Reference' },
      url: 'https://www.odoo.com/documentation/17.0/applications/sales/sales.html',
    },
  ],
}
