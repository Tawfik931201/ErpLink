import type { GuideContent } from '../types'

export const zidOdooStockSyncGuide: GuideContent = {
  meta: {
    slug: 'zid-odoo-stock-sync',
    title: {
      ar: 'مزامنة المخزون بين زد وأودوو: المستودعات وSKU وتحديث الكميات',
      en: 'Inventory Synchronization Between Zid and Odoo: Warehouses, SKUs, and Stock Updates',
    },
    h1Title: {
      ar: 'مزامنة المخزون بين زد وأودوو (Odoo): الدليل التشغيلي للمستودعات وتحديث الكميات',
      en: 'Mastering Stock Sync Between Zid and Odoo: Warehouses, SKUs, and Real-Time Inventory',
    },
    description: {
      ar: 'تعلم كيفية إعداد مزامنة المخزون بين متجر زد ونظام أودوو بدقة: الفرق بين الكمية الفعلية والمتاحة للبيع، وتحديد مستودعات الصرف، ومنع البيع الزائد وحلقات التحديث المفرغة.',
      en: 'Learn how to accurately synchronize inventory between Zid and Odoo: understand on-hand vs. forecasted stock, configure fulfillment warehouses, and prevent overselling or race conditions.',
    },
    summary: {
      ar: 'يوضح هذا الدليل المفاهيم الأساسية لإدارة المخزون متعدد المستودعات، وطريقة مطابقة الـ SKU، وكيفية حساب الكمية المتاحة للبيع في أودوو وتحديثها تلقائيًا في متجر زد دون تكرار.',
      en: 'This guide details multi-warehouse inventory management, SKU alignment, calculating available-to-promise stock in Odoo, and reliably updating quantities in Zid without sync loops.',
    },
    category: 'stock',
    primaryKeyword: {
      ar: 'مزامنة مخزون زد مع أودوو',
      en: 'Zid Odoo stock sync',
    },
    secondaryKeywords: {
      ar: ['تحديث مخزون زد من Odoo', 'ربط المستودعات بأودوو', 'مشكلة اختلاف المخزون', 'إدارة مخزون المتجر الإلكتروني'],
      en: ['Odoo Zid inventory synchronization', 'multi-warehouse stock mapping', 'e-commerce overselling prevention', 'Odoo stock quant update'],
    },
    readingTimeMinutes: 12,
    publishedAt: '2026-11-24',
    updatedAt: '2026-11-24',
    relatedPlatform: 'zid',
    relatedIntegrationPath: '/integrations/zid-odoo',
    relatedGuideSlugs: ['zid-odoo-setup', 'zid-odoo-checklist', 'zid-odoo-returns'],
    featured: true,
  },
  sections: [
    {
      id: 'the-inventory-sync-challenge',
      title: {
        ar: 'تحديات مزامنة المخزون ومخاطر البيع الزائد في المتاجر الإلكترونية',
        en: 'The Inventory Synchronization Challenge and Overselling Risks',
      },
      paragraphs: [
        {
          ar: 'يعد الحفاظ على دقة أرصدة المخزون بين متجرك الإلكتروني في زد ونظام إدارة الموارد أودوو من أكثر المهام حساسية. فعندما يعرض المتجر منتجًا متوفرًا بينما نفدت كميته في المستودع الفعلي، تضطر إلى إلغاء الطلب، وإرجاع المبلغ للعميل، وتحمل تكاليف معالجة غير ضرورية بالإضافة إلى خسارة ثقة المشتري.',
          en: 'Maintaining real-time inventory parity between your Zid storefront and Odoo ERP is critical. Showing products in stock when warehouse bins are empty leads to backorders, forced cancellations, merchant transaction fees, and damaged customer trust.',
        },
        {
          ar: 'على الجانب الآخر، إذا تأخر النظام في رفع كميات البضائع المستلمة حديثًا من الموردين، فإنك تفقد مبيعات فورية كان من الممكن اقتناصها. تهدف مزامنة المخزون عبر ERP Link إلى تحويل نظام أودوو إلى "المصدر الحقيقي الوحيد" (Single Source of Truth) لأرصدتك المخزنية، وتحديث متجر زد فور حدوث أي حركة استلام أو صرف.',
          en: 'Conversely, delays in reflecting newly received supplier shipments on the storefront forfeit immediate revenue. ERP Link positions Odoo as your single source of truth for stock levels, pushing updated quantities to Zid as soon as goods are received, allocated, or returned.',
        },
      ],
    },
    {
      id: 'on-hand-vs-forecasted',
      title: {
        ar: 'الفرق الحاسم: الكمية الفعلية (On Hand) مقابل المتاحة للبيع (Forecasted)',
        en: 'The Crucial Difference: Quantity On Hand vs. Forecasted / Available Stock',
      },
      paragraphs: [
        {
          ar: 'من أكبر الأخطاء التي تقع فيها المتاجر هو مزامنة "الكمية الفعلية الموجودة في الرف" (Quantity On Hand) مباشرة إلى واجهة المتجر. إليك الفرق الجوهري في أودوو وكيف يجب ضبطه:',
          en: 'One of the most frequent mistakes merchants make is synchronizing physical "Quantity On Hand" directly to customer storefronts. Understanding Odoo internal stock mechanics is essential:',
        },
      ],
      table: {
        headers: [
          { ar: 'المفهوم في أودوو', en: 'Odoo Concept' },
          { ar: 'المعنى التقني', en: 'Technical Definition' },
          { ar: 'مثال توضيحي', en: 'Practical Example' },
          { ar: 'هل يجب إرساله للمتجر؟', en: 'Should it sync to Zid?' },
        ],
        rows: [
          [
            { ar: 'الكمية الفعلية (Quantity On Hand)', en: 'Quantity On Hand' },
            { ar: 'إجمالي القطع الموجودة فيزيائيًا داخل المستودع', en: 'Total physical units located inside warehouse bins' },
            { ar: 'لديك 10 قطع فيزيائيًا في الرف', en: 'You have 10 physical units on shelves' },
            { ar: 'لا! قد يؤدي إلى بيع قطع محجوزة', en: 'No! Risks selling reserved stock' },
          ],
          [
            { ar: 'الكميات المحجوزة (Reserved Quantity)', en: 'Reserved Quantity' },
            { ar: 'قطع تم بيعها وتنتظر التجهيز والتغليف والشحن', en: 'Units allocated to pending sales orders awaiting picking' },
            { ar: '3 قطع بيعت قبل قليل ولم تغادر بعد', en: '3 units reserved for processing orders' },
            { ar: 'تُخصم فورًا من المعروض للبيع', en: 'Deducted immediately from availability' },
          ],
          [
            { ar: 'المتاح للبيع (Available to Promise / Free to Use)', en: 'Free to Use / Available to Promise' },
            { ar: 'الكمية الفعلية ناقص الكميات المحجوزة (qty_available - outgoing_qty)', en: 'On-hand minus reserved/allocated units' },
            { ar: '10 - 3 = 7 قطع جاهزة للبيع للزبائن الجدد', en: '10 - 3 = 7 units truly available for new shoppers' },
            { ar: 'نعم! هذه هي الكمية الصحيحة لزد', en: 'YES! This is the precise figure for Zid' },
          ],
        ],
      },
      callout: {
        type: 'tip',
        title: {
          ar: 'قاعدة ذهبية في ERP Link',
          en: 'Golden Rule in ERP Link',
        },
        text: {
          ar: 'يعتمد محرك ERP Link افتراضيًا على حقل "الكمية المتاحة للبيع" (Free to Use Stock) في مستودع أودوو المحدد، مما يمنع بيع أي قطعة تم حجزها مسبقًا في أمر بيع قيد التجهيز.',
          en: 'By default, ERP Link extracts the "Free to Use" available quantity from your designated Odoo stock location, guaranteeing that units reserved for unfulfilled orders are never re-offered for sale.',
        },
      },
    },
    {
      id: 'warehouse-mapping-strategy',
      title: {
        ar: 'إدارة المستودعات المتعددة ومصادر التغذية',
        en: 'Multi-Warehouse Strategy and Stock Location Routing',
      },
      paragraphs: [
        {
          ar: 'إذا كانت شركتك تدير عدة فروع أو مستودعات (مثل: مستودع الرياض الرئيسي، مستودع جدة، ومستودع المعرض)، فإنك بحاجة إلى تحديد المستودع الذي يغذي متجر زد الإلكتروني بدقة:',
          en: 'If your business operates multiple branches or fulfillment centers (e.g., Central Riyadh Warehouse, Western Hub Jeddah, Retail Showroom), you must deliberately choose your inventory source for Zid:',
        },
      ],
      steps: [
        {
          title: {
            ar: 'المستودع المنفرد المخصص للمتجر (Dedicated E-commerce Warehouse)',
            en: 'Dedicated E-commerce Warehouse',
          },
          text: {
            ar: 'يتم حصر كمية المتجر بموقع مخزني محدد في أودوو (مثل WH/Stock/Ecom). تضمن هذه الطريقة عزل بضاعة المتجر عن مبيعات الجملة والمعارض التقليدية.',
            en: 'Store stock is bound strictly to a dedicated Odoo internal location (e.g., WH/Stock/Ecom). This segregates online inventory from B2B wholesale or retail point-of-sale allocations.',
          },
        },
        {
          title: {
            ar: 'التجميع من عدة مستودعات (Aggregated Warehouses)',
            en: 'Aggregated Warehouse Calculation',
          },
          text: {
            ar: 'يسمح لك ERP Link بتحديد عدة مواقع مستودعية، ليقوم النظام بجمع الكميات المتاحة فيها وتحديث متجر زد بالمجموع الإجمالي، مع مراعاة قواعد الصرف في أودوو.',
            en: 'ERP Link enables multi-location aggregation, calculating the sum of free-to-use units across selected regional hubs and publishing the consolidated available count to Zid.',
          },
        },
      ],
    },
    {
      id: 'sku-matching-and-variants',
      title: {
        ar: 'مطابقة الـ SKU للمنتجات البسيطة والمتغيرة (Variants)',
        en: 'SKU Alignment for Simple Products and Multi-Attribute Variants',
      },
      paragraphs: [
        {
          ar: 'الـ SKU (Stock Keeping Unit) هو حجر الزاوية لأي ربط مخزني ناجح. لا يمكن لأي نظام تخمين تطابق المنتجات بالاسم لأن الأسماء قد تتغير أو تترجم:',
          en: 'The SKU (Stock Keeping Unit) is the bedrock of inventory synchronization. Automated platforms must never rely on matching by product title, as titles frequently shift across marketing campaigns or languages:',
        },
        {
          ar: '1. المنتجات المفردة (Simple Products): يجب أن يتطابق حقل SKU في زد مع حقل "Internal Reference" (default_code) في بطاقة المنتج في أودوو.\n2. المنتجات ذات المتغيرات (Variants): في المنتجات التي تحتوي على خيارات (مثل: عطر بحجم 50 مل و100 مل)، يجب أن يمتلك كل متغير في زد رمز SKU خاصًا به، ويقابل هذا الرمز بالضبط المتغير المقابل في جدول product.product في أودوو.\n3. الفراغات وحالة الأحرف: تأكد من خلو رموز الـ SKU من المسافات المخفية في البداية والنهاية، ومراعاة الأحرف الإنجليزية الكبيرة والصغيرة.',
          en: '1. Simple Products: The Zid SKU must mirror the Odoo "Internal Reference" (default_code) exactly.\n2. Variant Products: For items with attributes (e.g., Perfume 50ml vs. 100ml), each variant in Zid must carry a unique SKU corresponding to the respective variant record in Odoo product.product model.\n3. Whitespace and Casing: Ensure SKUs are free of accidental leading/trailing spaces and observe consistent character casing across both platforms.',
        },
      ],
    },
    {
      id: 'preventing-infinite-loops',
      title: {
        ar: 'منع الحلقات المفرغة وتحديثات المخزون المتكررة',
        en: 'Preventing Race Conditions, Ping-Pong Updates, and Infinite Loops',
      },
      paragraphs: [
        {
          ar: 'من أخطر المشاكل البرمجية في تكاملات المخزون هو حدوث "حلقة مفرغة" (Infinite Loop / Ping-Pong Sync): يقوم أودوو بتحديث الكمية إلى 10 في زد، فيرسل زد إشعارًا بأن المخزون تغير، فيقوم نظام الربط بمحاولة تحديث أودوو مجددًا، وهكذا تستهلك آلاف الطلبات وتتوقف الخوادم.',
          en: 'A classic hazard in automated e-commerce synchronization is the ping-pong infinite loop: Odoo updates stock to 10 in Zid, Zid fires an inventory.updated webhook, the integration attempts to update Odoo, triggering another broadcast until API quotas are exhausted and servers stall.',
        },
        {
          ar: 'في ERP Link، تم بناء الحماية المعمارية التالية:\n- حظر الحلقات التلقائي (Origin Tagging): يميز النظام التحديثات الصادرة من محرك المزامنة نفسه ويتجاهل إشعارات الويب الناتجة عنها فورًا.\n- عزل اتجاه المزامنة (Unidirectional Stock Authority): نوصي بجعل أودوو هو المصدر المعتمد الحصري للكميات. عندما يصل طلب جديد من زد، يقوم أودوو بحجز الكمية وإنشاء أمر البيع، ومن ثم يحسب أودوو الكمية المتاحة الجديدة ويرسلها إلى زد تلقائيًا.',
          en: 'ERP Link enforces stringent architectural safeguards against sync loops:\n- Origin Tagging: Updates dispatched by ERP Link are tracked with cryptographic state tags, allowing the webhook engine to silently discard echo events.\n- Unidirectional Authority: We advise establishing Odoo as the authoritative inventory master. When a new Zid order arrives, Odoo reserves stock and recalculates availability, dispatching the refreshed count to Zid cleanly.',
        },
      ],
    },
    {
      id: 'practical-stock-test',
      title: {
        ar: 'سيناريو اختبار عملي خطوة بخطوة للتحقق من مزامنة المخزون',
        en: 'Step-by-Step Practical Stock Update Verification Scenario',
      },
      paragraphs: [
        {
          ar: 'قبل تفعيل مزامنة جميع المنتجات، نفذ الاختبار التالي على منتج تجريبي واحد للتأكد من سلاسة العمل:',
          en: 'Before activating catalog-wide inventory sync, execute this controlled test on a single designated SKU:',
        },
      ],
      steps: [
        {
          title: {
            ar: '1. تحديد منتج تجريبي وفحص رصيده الحالي',
            en: '1. Identify a Test SKU and Inspect Current State',
          },
          text: {
            ar: 'اختر منتجًا يحمل SKU واضحًا (مثل TEST-SKU-001) وسجل الكمية الحالية في متجر زد (مثلًا: 5 قطع).',
            en: 'Select an active product with a clean SKU (e.g., TEST-SKU-001) and observe its existing Zid stock count (e.g., 5 units).',
          },
        },
        {
          title: {
            ar: '2. تنفيذ تسوية مخزنية في أودوو (Inventory Adjustment)',
            en: '2. Perform an Inventory Adjustment in Odoo',
          },
          text: {
            ar: 'في أودوو، انتقل إلى تطبيق المخزون > العمليات > تسويات المخزون (Inventory Adjustments)، وعدل الكمية المتاحة للبيع للمنتج لتصبح 12 قطعة، ثم اعتمد الحركة (Apply).',
            en: 'In Odoo Inventory > Operations > Inventory Adjustments, update the on-hand quantity for this item to 12 units and apply the adjustment.',
          },
        },
        {
          title: {
            ar: '3. مراقبة حركة المزامنة في سجلات ERP Link',
            en: '3. Monitor Real-Time Synchronization Logs',
          },
          text: {
            ar: 'افتح صفحة السجلات (Sync Logs) في ERP Link: ستلاحظ رصد حركة stock.quant.updated من أودوو وإرسال تحديث الكمية بنجاح إلى متجر زد خلال ثوانٍ معدودة.',
            en: 'Check ERP Link Sync Logs: you will observe the Odoo stock.quant adjustment event captured and dispatched to Zid with an HTTP 200 success receipt in seconds.',
          },
        },
        {
          title: {
            ar: '4. فحص واجهة متجر زد وتحديث الصفحة',
            en: '4. Verify Storefront Product Quantity in Zid',
          },
          text: {
            ar: 'افتح لوحة تحكم زد ثم صفحة المنتج: تأكد من أن الكمية المعروضة أصبحت 12 قطعة فورًا دون أي تدخل يدوي.',
            en: 'Refresh the Zid dashboard product catalog: verify that the available quantity reflects 12 units without delay.',
          },
        },
      ],
    },
  ],
  faqs: [
    {
      question: {
        ar: 'كم يستغرق تحديث كمية المنتج في متجر زد بعد تعديلها في أودوو؟',
        en: 'How fast does stock update on Zid after an adjustment in Odoo?',
      },
      answer: {
        ar: 'في حال استخدام مستمعي الأحداث في أودوو وإشعارات الويب، يتم التحديث في غضون ثوانٍ قليلة (شبه فوري). كما تتوفر آلية فحص مجدولة دورية لضمان المطابقة الكاملة لأي عمليات لم تلتقطها الأحداث المباشرة.',
        en: 'Using automated triggers and webhooks, stock updates reflect in Zid within seconds. A background reconciler also executes periodic integrity scans to ensure absolute stock parity.',
      },
    },
    {
      question: {
        ar: 'هل يمكن ضبط حد أمان للمخزون (Safety Buffer) في المتجر؟',
        en: 'Can we configure a safety stock buffer to keep on reserve?',
      },
      answer: {
        ar: 'نعم، يوفر ERP Link إمكانية تحديد هامش أمان (Buffer Rule)، مثل حسم قطعتين دائمًا من الكمية المرسلة لزد، بحيث يظهر المنتج "غير متوفر" في المتجر إذا انخفض رصيده في أودوو إلى قطعتين أو أقل.',
        en: 'Yes. ERP Link supports buffer rules (e.g., subtract 2 units from the quantity broadcasted to Zid), displaying the item as sold out online whenever Odoo stock drops to the safety threshold.',
      },
    },
    {
      question: {
        ar: 'ماذا لو كان لدي منتج مجمع (Bundle / Kit) في أودوو؟',
        en: 'How does stock sync handle bundled products or BoM kits in Odoo?',
      },
      answer: {
        ar: 'إذا كان المنتج في أودوو عبارة عن حزمة تجميعية (Kit/BoM)، فإن أودوو يحسب الكمية المتاحة للحزمة بناءً على أقل مكون متوفر في مكوناتها، ويقوم ERP Link بنقل هذه الكمية الناتجة إلى المنتج المقابل في زد بدقة.',
        en: 'For kit products managed via Bill of Materials (BoM Kits), Odoo dynamically calculates maximum buildable packages based on component availability, and ERP Link pushes this calculated available count directly to Zid.',
      },
    },
  ],
  summaryKeyTakeaways: {
    ar: [
      'اعتمد دائمًا على الكمية المتاحة للبيع (Free to Use) وليس الكمية الفعلية (On Hand) لتجنب البيع الزائد.',
      'اجعل نظام أودوو هو المصدر الحصري والمعتمد للكميات لتفادي تضارب الأرصدة والحلقات المفرغة.',
      'تأكد من مطابقة رموز SKU بدقة متناهية وخلوها من المسافات المخفية لكل متغير من متغيرات المنتجات.',
      'راجع حركة المخزون وسجلات التحديث فور إجراء أي تسوية مخزنية للتأكد من سلامة الاتصال.',
    ],
    en: [
      'Always base storefront availability on free-to-use stock rather than physical on-hand quantities.',
      'Establish Odoo as your single source of truth for stock quantities to prevent sync loops and data conflicts.',
      'Maintain exact, whitespace-free SKU matching across all simple and variant catalog items.',
      'Routinely inspect ERP Link sync logs following warehouse inventory adjustments to verify delivery.',
    ],
  },
  officialDocLinks: [
    {
      label: { ar: 'دليل إدارة المخزون والمستودعات في أودوو (Odoo Inventory)', en: 'Odoo Inventory Management Documentation' },
      url: 'https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory.html',
    },
    {
      label: { ar: 'وثائق إدارة المنتجات والكميات في زد (Zid Products API)', en: 'Zid Products API Documentation' },
      url: 'https://help.zid.sa/ar/apps/private-apps',
    },
  ],
}
