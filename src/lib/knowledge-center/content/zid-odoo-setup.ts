import type { GuideContent } from '../types'

export const zidOdooSetupGuide: GuideContent = {
  meta: {
    slug: 'zid-odoo-setup',
    title: {
      ar: 'كيفية ربط زد بأودوو خطوة بخطوة: من الإعداد إلى أول طلب',
      en: 'How to Connect Zid to Odoo Step by Step: From Setup to First Order',
    },
    h1Title: {
      ar: 'كيفية ربط متجر زد بنظام أودوو (Odoo): الدليل الشامل من الإعداد إلى أول طلب',
      en: 'Connecting Zid Store to Odoo ERP: The Complete Step-by-Step Setup Guide',
    },
    description: {
      ar: 'دليل عملي وتطبيقي يوضح خطوات ربط متجر زد بنظام أودوو Odoo، وإعداد مطابقة المنتجات والعملاء والطلبات وتتبع السجلات واختبار أول عملية بيع بنجاح.',
      en: 'A comprehensive, practical guide on connecting your Zid store with Odoo ERP: credentials setup, product and customer matching, order workflows, and verifying your first live order.',
    },
    summary: {
      ar: 'يوضح هذا الدليل الخطوات الأساسية لربط متجر زد بنظام أودوو، بدءًا من منح الصلاحيات ومطابقة الـ SKU والعملاء، وحتى إعداد حالات الطلب وفحص سجلات المزامنة لتجنب التكرار.',
      en: 'This guide details the core workflow for integrating Zid with Odoo ERP, from application authorization and SKU/customer matching to order status mapping and sync log audits.',
    },
    category: 'zid-odoo',
    primaryKeyword: {
      ar: 'ربط زد بأودوو',
      en: 'Zid Odoo integration',
    },
    secondaryKeywords: {
      ar: ['ربط متجر زد مع Odoo', 'برنامج ربط زد بأودوو', 'مزامنة طلبات زد مع أودوو', 'تكامل زد وأودوو'],
      en: ['connect Zid with Odoo', 'Zid Odoo connector', 'Zid order sync to Odoo', 'e-commerce Odoo ERP integration'],
    },
    readingTimeMinutes: 11,
    publishedAt: '2026-11-24',
    updatedAt: '2026-11-24',
    relatedPlatform: 'zid',
    relatedIntegrationPath: '/integrations/zid-odoo',
    relatedGuideSlugs: ['zid-odoo-checklist', 'zid-odoo-stock-sync', 'zid-odoo-vat-15', 'zid-odoo-returns'],
    featured: true,
  },
  sections: [
    {
      id: 'why-integrate-zid-odoo',
      title: {
        ar: 'ما معنى ربط زد بأودوو ولماذا تحتاجه المتاجر الإلكترونية المتنامية؟',
        en: 'What is Zid-Odoo Integration and Why Do Growing Stores Need It?',
      },
      paragraphs: [
        {
          ar: 'يعتبر متجر زد (Zid) واجهة البيع الأمامية التي يتفاعل معها عملاؤك، حيث يتصفحون المنتجات ويدفعون إلكترونيًا ويستقبلون إشعارات الشحن. بالمقابل، يمثل نظام أودوو (Odoo ERP) المحرك الخلفي لإدارة العمليات التشغيلية، من مسك الدفاتر المحاسبية، ومتابعة شجرة الحسابات، وإدارة مستودعات البضائع، والتعامل مع الموردين وأوامر الشراء.',
          en: 'Your Zid store serves as your digital storefront where shoppers browse catalog items, complete checkouts, and receive order status updates. Meanwhile, Odoo ERP acts as the operational backbone managing general ledger accounting, warehouse stock picking, supplier purchase orders, and tax compliance.',
        },
        {
          ar: 'عندما ينمو حجم المبيعات إلى عشرات أو مئات الطلبات يوميًا، يصبح النسخ اليدوي للطلبات والعملاء من لوحة تحكم زد إلى أودوو مستحيلًا وعالي المخاطر. يؤدي العمل اليدوي إلى تأخر إصدار الفواتير، ونفاد المخزون بسبب بيع بضاعة غير متوفرة، وتشتت الحسابات بين رصيد بوابة الدفع وما يقيده المحاسب. يضمن الربط الآلي عبر ERP Link انتقال البيانات فور حدوثها بدقة وموثوقية ودون أي تدخل يدوي.',
          en: 'As sales scale to dozens or hundreds of orders daily, manually re-keying customer information, line items, and receipts from Zid into Odoo becomes error-prone and unsustainable. Manual data entry causes delayed invoicing, out-of-stock overselling, and discrepancies between payment gateway payouts and ledger balances. Automated integration via ERP Link synchronizes transactions instantaneously without human friction.',
        },
      ],
      table: {
        headers: [
          { ar: 'نوع البيانات في زد', en: 'Zid Store Entity' },
          { ar: 'الكيان المقابل في أودوو', en: 'Corresponding Odoo Entity' },
          { ar: 'اتجاه المزامنة النموذجي', en: 'Standard Sync Direction' },
          { ar: 'الهدف التشغيلي', en: 'Operational Objective' },
        ],
        rows: [
          [
            { ar: 'الطلب الجديد (New Order)', en: 'New Order' },
            { ar: 'أمر بيع (sale.order)', en: 'Sales Order (sale.order)' },
            { ar: 'من زد إلى أودوو', en: 'Zid → Odoo' },
            { ar: 'حجز الكميات وتجهيز الفاتورة وسند الشحن', en: 'Reserve items, prepare invoice, and create picking' },
          ],
          [
            { ar: 'بيانات العميل (Customer)', en: 'Customer Profile' },
            { ar: 'شريك تجاري (res.partner)', en: 'Contact / Partner (res.partner)' },
            { ar: 'من زد إلى أودوو', en: 'Zid → Odoo' },
            { ar: 'بناء سجل موحد للعميل بناءً على رقم الجوال أو البريد', en: 'Unified customer ledger matched by phone/email' },
          ],
          [
            { ar: 'المخزون المتوفر (Stock)', en: 'Available Quantity' },
            { ar: 'كميات المستودع (stock.quant)', en: 'Stock Quant (stock.quant)' },
            { ar: 'من أودوو إلى زد (أو العكس بحسب المصدر)', en: 'Odoo → Zid (or master defined)' },
            { ar: 'منع البيع الزائد ومطابقة أرصدة المستودعات الفعلية', en: 'Prevent overselling and align on-hand stock' },
          ],
          [
            { ar: 'مرتجع الطلب (Order Return)', en: 'Order Return' },
            { ar: 'إشعار دائن + إرجاع مخزني', en: 'Credit Note (account.move) + Return Picking' },
            { ar: 'من زد إلى أودوو', en: 'Zid → Odoo' },
            { ar: 'تسوية القيود المحاسبية وإرجاع القطع الصالحة للمستودع', en: 'Reconcile accounting balances and restock items' },
          ],
        ],
      },
    },
    {
      id: 'prerequisites-and-credentials',
      title: {
        ar: 'متطلبات البدء وتجهيز بيانات الاتصال في زد وأودوو',
        en: 'Prerequisites and Gathering Connection Credentials in Zid and Odoo',
      },
      paragraphs: [
        {
          ar: 'قبل البدء في إعداد الربط عبر لوحة تحكم ERP Link، تأكد من توفر البيانات التالية وصلاحيات الوصول الإدارية لكل من المنصتين:',
          en: 'Before establishing the connection in the ERP Link dashboard, ensure you have gathered the following administrative access tokens and system details:',
        },
      ],
      steps: [
        {
          title: {
            ar: '1. بيانات متجر زد وتطبيق المطورين',
            en: '1. Zid Store Credentials and Application Authorization',
          },
          text: {
            ar: 'تحتاج إلى تفعيل تطبيق ERP Link عبر متجر تطبيقات زد أو تزويد رمز الترخيص (Authorization Token) ومعرف المتجر (Store ID). تأكد من أن حسابك يمتلك صلاحيات المدير (Manager Role) للوصول إلى الطلبات والمنتجات والمخزون وإشعارات الويب (Webhooks).',
            en: 'Authorize the ERP Link application through the Zid App Market or retrieve your Manager Access Token and Store ID. Ensure your account possesses Manager-level privileges covering orders, inventory, products, and webhook events.',
          },
        },
        {
          title: {
            ar: '2. بيانات خادم أودوو (Odoo Connection Parameters)',
            en: '2. Odoo Server Connection Parameters',
          },
          text: {
            ar: 'يتطلب الربط رابط خادم أودوو المباشر (مثل https://yourcompany.odoo.com)، واسم قاعدة البيانات (Database Name)، واسم المستخدم (User Email)، ومفتاح API مخصص (API Key). نوصي دائمًا بإنشاء مستخدم مخصص للربط باسم "Integration ERP Link" مع منحه صلاحيات إدارة المبيعات والفواتير والمخزون، وتجنب استخدام كلمة مرور المدير الشخصية.',
            en: 'You need the exact Odoo URL (e.g., https://yourcompany.odoo.com), the Database Name, technical username/email, and a dedicated API Key generated under the user profile. We strongly recommend creating a dedicated integration user (e.g., "ERP Link System") with Sales, Invoicing, and Inventory administrative access rather than using personal master credentials.',
          },
        },
        {
          title: {
            ar: '3. تجهيز بيانات الدليل ورموز SKU في أودوو',
            en: '3. Standardizing Catalog SKUs in Odoo',
          },
          text: {
            ar: 'تأكد من أن كل منتج في متجر زد يحتوي على رمز SKU مطابق تمامًا للحقل المقابل "Internal Reference" (default_code) في بطاقة منتج أودوو. إذا كانت المنتجات تحتوي على خيارات ومتغيرات (كاللون والمقاس)، فيجب تعيين SKU مستقل لكل متغير (Product Variant).',
            en: 'Verify that every active product in your Zid catalog has an identical SKU assigned to the "Internal Reference" (default_code) field in Odoo. For variant products (e.g., size or color attributes), each individual variant must carry its own unique SKU.',
          },
        },
      ],
      callout: {
        type: 'warning',
        title: {
          ar: 'تنبيه أمني هام بشأن مفاتيح الوصول',
          en: 'Important Security Note on API Credentials',
        },
        text: {
          ar: 'لا تشارك أبدًا مفتاح الـ API الخاص بأودوو أو رمز الوصول لمتجر زد عبر البريد أو المحادثات غير المشفرة. يقوم نظام ERP Link بتشفير جميع المفاتيح السرية في طبقة البيانات باستخدام معايير التشفير العسكري ولا يتم كشفها في المتصفح أبدًا.',
          en: 'Never share your Odoo API key or Zid access tokens over unencrypted email or public messaging. ERP Link encrypts all credentials at rest with zero-knowledge operational principles, ensuring tokens are never exposed in browser payloads.',
        },
      },
    },
    {
      id: 'step-by-step-setup-workflow',
      title: {
        ar: 'خطوات إعداد الربط في منصة ERP Link خطوة بخطوة',
        en: 'Step-by-Step Configuration Workflow in ERP Link',
      },
      paragraphs: [
        {
          ar: 'إليك المسار التطبيقي خطوة بخطوة لتفعيل التكامل بنجاح واختباره بالكامل:',
          en: 'Here is the comprehensive walkthrough to configure, map, and activate your store integration:',
        },
      ],
      steps: [
        {
          title: {
            ar: 'الخطوة الأولى: ربط متجر زد والتحقق من الاتصال',
            en: 'Step 1: Connect Zid Store and Validate Access',
          },
          text: {
            ar: 'توجه إلى لوحة تحكم ERP Link واختر "ربط المتجر" (Connect Store)، ثم حدد منصة زد (Zid). بعد إتمام الموافقة على الأذونات، يقوم النظام باختبار الاتصال فورياً واستخراج معرف المتجر وإعداد مستمعي الأحداث التلقائيين.',
            en: 'Navigate to the ERP Link dashboard, click "Connect Store", and select Zid. After granting the required platform permissions, the system instantly verifies token validity, records your Store ID, and registers backend event listeners.',
          },
        },
        {
          title: {
            ar: 'الخطوة الثانية: ربط خادم أودوو واختبار بروتوكول XML-RPC',
            en: 'Step 2: Connect Odoo and Verify XML-RPC Handshake',
          },
          text: {
            ar: 'أدخل رابط خادم أودوو، اسم قاعدة البيانات، بريد المستخدم الفني، ومفتاح الـ API. ينفذ ERP Link اتصال اختبار فوري يفحص إصدار أودوو (يدعم الإصدارات 14، 15، 16، 17، و18 بالإضافة إلى Odoo.sh وOdoo Online) ويتأكد من توفر الصلاحيات للكتابة على sale.order وres.partner وstock.quant.',
            en: 'Enter your Odoo server URL, database name, technical user email, and API key. ERP Link executes a live handshake ping verifying your Odoo version (supporting Odoo 14, 15, 16, 17, 18, Odoo.sh, and Odoo Online) and confirming write access to sale.order, res.partner, and stock.quant.',
          },
        },
        {
          title: {
            ar: 'الخطوة الثالثة: إعداد خريطة مطابقة المنتجات والعملاء',
            en: 'Step 3: Define Product and Customer Matching Rules',
          },
          text: {
            ar: 'في مركز الخرائط (Mapping Center)، حدد استراتيجية مطابقة المنتجات (SKU مقابل default_code). بالنسبة للعملاء، حدد قاعدة البحث في أودوو: يفضل مطابقة العميل بناءً على رقم الجوال الدولي، أو البريد الإلكتروني في حال عدم توفر الجوال، مع خيار إنشاء عميل جديد تلقائيًا إذا لم يكن مسجلًا مسبقًا.',
            en: 'In the Mapping Center, confirm the product identity strategy (SKU matching default_code). For customers, set the deduplication rule in Odoo: prioritize international phone format, fallback to email, and specify whether to create a new res.partner if no match is discovered.',
          },
        },
        {
          title: {
            ar: 'الخطوة الرابعة: ضبط حالات الطلب (Order Status Workflow)',
            en: 'Step 4: Configure Order Statuses and Document Generation',
          },
          text: {
            ar: 'حدد متى ينتقل الطلب من زد إلى أودوو: هل يُسجل الطلب الجديد كعرض سعر مسودة (Quotation) لمراجعته، أم يؤكد تلقائيًا كأمر بيع معتمد (Sales Order)؟ كما يمكنك تحديد ما إذا كان يجب إنشاء فاتورة ضريبية وترحيلها تلقائيًا عند وصول الطلب إلى حالة "جاهز" أو "مكتمل" في متجر زد.',
            en: 'Determine when transactions populate Odoo: should incoming orders enter as draft Quotations for manual review, or instantly confirm as confirmed Sales Orders? You can also automate draft or posted customer invoices once Zid marks the order as "Ready" or "Delivered".',
          },
        },
      ],
    },
    {
      id: 'testing-first-order',
      title: {
        ar: 'كيفية اختبار إنشاء أول طلب ومتابعة سجلات المزامنة',
        en: 'How to Test Your First Order and Inspect Sync Logs',
      },
      paragraphs: [
        {
          ar: 'لا تقم مطلقًا بتفعيل الربط على متجرك التجاري الحي دون إجراء اختبار عملي متكامل في بيئة تجريبية أو باستخدام طلب تجريبي منخفض القيمة. اتبع هذا السيناريو الدقيق للتحقق:',
          en: 'Never enable real-time synchronization on your live store without conducting an end-to-end sandbox or low-value live test transaction. Follow this exact validation sequence:',
        },
        {
          ar: '1. أنشئ طلبًا تجريبيًا في متجر زد يحتوي على منتج واحد معروف الـ SKU، مع إدخال عنوان شحن حقيقي وبيانات عميل تجريبية واضحة.\n2. افتح صفحة "سجلات المزامنة" (Sync Logs) في لوحة ERP Link.\n3. تأكد من ظهور حدث وصول الطلب (order.create) بحالة "ناجح" (Success) مع بيان معرف الطلب في زد ورقم أمر البيع في أودوو (مثل SO00124).\n4. ادخل إلى نظام أودوو وافتح تطبيق المبيعات: تحقق من صحة اسم العميل، أسعار البنود، ضريبة القيمة المضافة 15%، وقيمة الشحن وطريقة الدفع المسجلة.',
          en: '1. Place a test order in Zid with a known SKU, authentic Saudi delivery address, and unique test customer data.\n2. Open the "Sync Logs" module in your ERP Link dashboard.\n3. Confirm that the inbound event (order.create) displays "Success" status, referencing the Zid order ID and the resulting Odoo Sales Order number (e.g., SO00124).\n4. Log into Odoo Sales: verify partner name, line items, 15% VAT calculation, shipping fee line, and payment terms.',
        },
      ],
      callout: {
        type: 'note',
        title: {
          ar: 'حماية منع تكرار الطلبات (Idempotency Guard)',
          en: 'Duplicate Prevention (Idempotency Guarantee)',
        },
        text: {
          ar: 'يحتوي محرك ERP Link على نظام حماية تلقائي يمنع إنشاء أمر بيع مكرر في أودوو حتى لو أرسلت منصة زد إشعار الويب (Webhook) عدة مرات نتيجة انقطاع شبكي مؤقت. يتم فحص المعرف الفريد للطلب قبل أي عملية إنشاء.',
          en: 'ERP Link features built-in idempotency protection. Even if Zid retries a webhook notification multiple times due to transient network latency, our queue verifies the unique platform order ID, strictly preventing duplicate Sales Orders or invoices in Odoo.',
        },
      },
    },
    {
      id: 'common-troubleshooting',
      title: {
        ar: 'أخطاء شائعة وكيفية تشخيصها وحلها فورًا',
        en: 'Common Setup Errors and Practical Troubleshooting',
      },
      paragraphs: [
        {
          ar: 'عند مواجهة أي تعثر في وصول الطلب، تكون السجلات في لوحة ERP Link هي مرجعك الأول لمعرفة السبب الفعلي. إليك أكثر الأخطاء شيوعًا:',
          en: 'When an order fails to synchronize, ERP Link sync logs provide immediate diagnostic traces. Below are the most frequent configuration pitfalls and their resolutions:',
        },
      ],
      steps: [
        {
          title: {
            ar: 'خطأ: Product SKU Not Found in Odoo',
            en: 'Error: Product SKU Not Found in Odoo',
          },
          text: {
            ar: 'السبب: لا يوجد منتج في أودوو يحمل نفس الرمز في حقل default_code، أو أن المنتج في أودوو مؤرشف (Archived). الحل: طابق رمز الـ SKU في بطاقة منتج أودوو مع رمز المنتج أو المتغير في زد بدقة مع مراعاة حالة الأحرف.',
            en: 'Cause: No product in Odoo matches the incoming SKU in default_code, or the product is archived. Resolution: Open Odoo Products, verify the Internal Reference matches the Zid variant SKU, and ensure the item is active.',
          },
        },
        {
          title: {
            ar: 'خطأ: Access Denied / Invalid Database Credentials',
            en: 'Error: Access Denied / Invalid Database Credentials',
          },
          text: {
            ar: 'السبب: تم تغيير كلمة مرور أو مفتاح الـ API لمستخدم أودوو، أو أن المستخدم لا يملك صلاحية إنشاء فواتير أو أوامر بيع. الحل: قم بإعادة توليد مفتاح API جديد وتحديثه في إعدادات الاتصال بـ ERP Link.',
            en: 'Cause: The Odoo API key was revoked, expired, or the user lacks Sales/Invoicing permissions. Resolution: Re-generate a fresh API key under the Odoo integration user profile and update your ERP Link connection settings.',
          },
        },
        {
          title: {
            ar: 'خطأ: Fiscal Position / Tax Mapping Mismatch',
            en: 'Error: Fiscal Position / Tax Mapping Mismatch',
          },
          text: {
            ar: 'السبب: أودوو يحاول تطبيق ضريبة تختلف عن ضريبة الـ 15% المقيدة في متجر زد، أو أن المنتج معفى والطلب خاضع. الحل: راجع إعدادات الموقف الضريبي (Fiscal Position) والضرائب الافتراضية للبنود.',
            en: 'Cause: Odoo is applying a default tax rate conflicting with Zid 15% inclusive pricing, or the customer fiscal position overrides tax lines. Resolution: Review default sales taxes and fiscal positions in Odoo Invoicing settings.',
          },
        },
      ],
    },
  ],
  faqs: [
    {
      question: {
        ar: 'هل يمكن للربط مزامنة الطلبات القديمة التي تم إنشاؤها قبل تثبيت ERP Link؟',
        en: 'Can ERP Link synchronize historical orders created prior to installation?',
      },
      answer: {
        ar: 'نعم، يوفر ERP Link ميزة النقل المبدئي (Initial Transfer) التي تمكنك من استيراد وتحديد نطاق تاريخي للطلبات والمنتجات السابقة لنقلها إلى أودوو دفعة واحدة بعد ضبط الخرائط واختبار الاتصال.',
        en: 'Yes. ERP Link includes an Initial Transfer tool allowing you to backfill and synchronize historical orders, customer databases, and catalog products across a custom date range after confirming your mapping settings.',
      },
    },
    {
      question: {
        ar: 'ماذا يحدث إذا انقطع خادم أودوو للصيانة أثناء إرسال طلب جديد من متجر زد؟',
        en: 'What happens if our Odoo server goes offline for maintenance while Zid receives new orders?',
      },
      answer: {
        ar: 'لن تفقد أي بيانات إطلاقًا. يقوم طابور المعالجة في ERP Link بحفظ الطلب بأمان وإعادة المحاولة تلقائيًا بفواصل زمنية تصاعدية (Exponential Backoff) فور عودة خادم أودوو للعمل بشكل طبيعي.',
        en: 'No transactions will be lost. ERP Link queues every inbound webhook durably. If Odoo is unreachable, our automated runner applies exponential backoff retries, delivering queued orders as soon as your server resumes availability.',
      },
    },
    {
      question: {
        ar: 'هل يدعم الربط المتاجر التي تستخدم ضريبة القيمة المضافة 15% في السعودية؟',
        en: 'Does this integration fully support Saudi 15% VAT compliance?',
      },
      answer: {
        ar: 'نعم، تم تصميم ERP Link مع مراعاة كاملة لمتطلبات هيئة الزكاة والضريبة والجمارك (ZATCA)، حيث يدعم مطابقة الأسعار الشاملة وغير الشاملة للضريبة وتوزيع ضريبة الشحن والخصومات بدقة محاسبية تامة.',
        en: 'Yes. ERP Link is specifically engineered for Saudi e-commerce and ZATCA e-invoicing standards, seamlessly reconciling tax-inclusive pricing, delivery fees, and promo code discounts down to the exact halala.',
      },
    },
  ],
  summaryKeyTakeaways: {
    ar: [
      'الربط الناجح يبدأ بمطابقة رموز الـ SKU بدقة بين متجر زد وحقل default_code في أودوو.',
      'استخدم مستخدم نظام فني مخصص في أودوو مع مفتاح API مستقل بدلًا من استخدام حسابات المشرفين الشخصية.',
      'افحص أول طلب في بيئة اختبارية أو بطلب رمزي وتأكد من مطابقة الأسعار والضريبة وسجلات المزامنة قبل الإطلاق.',
      'للاطلاع على قائمة التدقيق والاختبارات الفنية المعمقة، راجع دليل الفحص: /guides/zid-odoo-checklist.',
    ],
    en: [
      'Successful sync begins with strict SKU consistency between Zid and Odoo default_code fields.',
      'Always configure a dedicated technical Odoo user with an API key rather than personal admin passwords.',
      'Audit your first order on a staging instance or controlled transaction to reconcile totals, taxes, and sync logs.',
      'For the dedicated operational test checklist, consult our companion guide: /guides/zid-odoo-checklist.',
    ],
  },
  officialDocLinks: [
    {
      label: { ar: 'دليل مطوري وتطبيقات زد الرسمية (Zid Developer Docs)', en: 'Zid Developer Documentation' },
      url: 'https://help.zid.sa/ar/apps/private-apps',
    },
    {
      label: { ar: 'دليل واجهة برمجة تطبيقات أودوو (Odoo External API)', en: 'Odoo External API Reference' },
      url: 'https://www.odoo.com/documentation/17.0/developer/reference/external_api.html',
    },
  ],
}
