import type { DocArticle } from '../docs-types'

export const articlesMapping: DocArticle[] = [
  {
    slug: 'mapping/overview',
    category: 'mapping',
    title: {
      ar: 'دليل مركز الخرائط والمطابقة (Mapping Center)',
      en: 'Standard Mapping Center Overview',
    },
    description: {
      ar: 'فهم معمارية مركز المطابقة في ERP Link، الفرق بين المطابقة القياسية والمطابقة المخصصة، وكيفية توجيه البيانات إلى أودوو بدقة.',
      en: 'Understand ERP Link Mapping Center architecture, Standard vs. Custom mappings, and precise data routing into Odoo.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 6,
    headings: [
      { id: 'mapping-philosophy', text: { ar: 'مفهوم وأهمية مركز الخرائط', en: 'Mapping Center Philosophy' }, level: 2 },
      { id: 'standard-vs-custom', text: { ar: 'الفرق بين Standard Mapping و Custom Mapping', en: 'Standard vs. Custom Mapping' }, level: 2 },
      { id: 'navigation-tabs', text: { ar: 'أقسام وتبويبات مركز الخرائط', en: 'Mapping Center Navigation Tabs' }, level: 2 },
      { id: 'best-practices', text: { ar: 'أفضل الممارسات وقواعد الضبط الآمن', en: 'Best Practices & Safe Configuration' }, level: 2 },
    ],
    keywords: ['Mapping Center', 'Standard Mapping', 'Custom Mapping', 'Fields', 'Settings', 'Odoo Mapping'],
    content: {
      ar: `## مفهوم وأهمية مركز الخرائط {#mapping-philosophy}
يُعد **مركز الخرائط (Mapping Center)** هو العقل المدبر لمنصة ERP Link، حيث يتحكم بدقة في كيفية تحويل بيانات متجرك الإلكتروني (الطلبات، البنود، العملاء، الخصومات، والضرائب) إلى كائنات وسجلات محاسبية ومخزنية داخل نظام أودوو.

بدون ضبط سليم لمركز الخرائط، قد تصل الطلبات إلى أودوو بحسابات غير دقيقة أو دون ربط صحيح بالمستودع أو دفاتر القبض. يوفر مركز الخرائط واجهة بصرية مباشرة تغنيك تماماً عن كتابة أي أكواد برمجية.

## الفرق بين Standard Mapping و Custom Mapping {#standard-vs-custom}
يقسم النظام إعدادات المطابقة إلى مستويين متكاملين:

### 1. المطابقة القياسية (Standard Mapping):
وهي الإعدادات الأساسية الجاهزة المضمنة في النظام، وتغطي 95% من متطلبات تشغيل المتاجر:
* دورة حياة الطلب (مسودة، تأكيد، إصدار فاتورة، صرف المخزون).
* طريقة مطابقة المنتجات (SKU، الباركود).
* طريقة مطابقة العملاء (رقم الجوال، البريد).
* ربط الضرائب وحسابات الإيرادات والمصروفات.
* دفاتر اليومية (Journals) لكل وسيلة دفع (مدى، فيزا، تابي، تمارا، كاش).

### 2. المطابقة المخصصة (Custom Mapping):
مخصصة للمتاجر التي تمتلك متطلبات عمل خاصة أو حقولاً إضافية في أودوو:
* إنشاء حقول جديدة (\`x_*\`) وحقنها في شاشات أودوو.
* رسم خرائط مباشرة بين حقول JSON في المتجر وحقول محددة في نماذج أودوو (\`sale.order\`, \`res.partner\`, \`product.template\`).
* استخدام جداول المطابقة الثابتة المحمية (Allowlisted Static Mappings).

## أقسام وتبويبات مركز الخرائط {#navigation-tabs}
عند فتح شاشة مركز الخرائط (\`/app/mapping-center\`)، ستجد التبويبات التالية:
* **الطلبات (Orders Tab):** يحدد حالات أوامر البيع، أتمتة الفواتير، وسياسات المستودع.
* **المنتجات (Products Tab):** يحدد آلية مطابقة الباركود والـ SKU وفئات المنتجات الافتراضية.
* **العملاء (Customers Tab):** يحدد مطابقة أرقام الجوال وصيغ الأسماء وجهات الاتصال.
* **التصنيفات (Categories Mapping):** يربط أقسام المتجر بفئات المنتجات في أودوو.
* **الحقول المخصصة (Custom Fields):** لإضافة حقول إضافية يدعمها أودوو ستوديو.

## أفضل الممارسات وقواعد الضبط الآمن {#best-practices}
:::important
1. **ابدأ بالوضع اليدوي:** عند بدء التشغيل، لا تقم بتفعيل خيار "تأكيد الطلب التلقائي" أو "إنشاء الفاتورة التلقائي". دع الطلبات تصل كمسودات (Draft Sales Orders) لمراجعتها والتأكد من صحة الأسعار.
2. **مطابقة الـ SKU:** تأكد من أن الـ SKU في متجرك يطابق تماماً حقل الرمز الداخلي (\`Internal Reference\`) في أودوو.
3. **تحديد الدفاتر بدقة:** اربط كل وسيلة دفع بالدفتر المالي المخصص لها (مثال: ربط تابي بدفتر وسيط وليس الحساب البنكي الرئيسي مباشرة).
:::`,

      en: `## Mapping Center Philosophy {#mapping-philosophy}
The **Mapping Center** serves as the central control engine of ERP Link. It governs how incoming e-commerce entities (orders, line items, customers, discounts, and taxes) map into operational and financial records inside Odoo ERP.

Without a configured Mapping Center, orders might land in Odoo with missing warehouses, ambiguous revenue accounts, or unmatched payment journals. The Mapping Center provides an intuitive visual UI that requires zero coding.

## Standard vs. Custom Mapping {#standard-vs-custom}
ERP Link organizes mapping into two complementary tiers:

### 1. Standard Mapping:
Pre-built, rock-solid configurations covering 95% of e-commerce operational needs:
* Sales Order lifecycle (Draft, Confirmed, Auto-Invoiced, Auto-Delivered).
* Product matching criteria (Internal Reference SKU, Barcode).
* Customer resolution (Mobile phone number, email).
* Tax computation and default income/expense accounts.
* Payment journal allocation (Mada, Visa, Tabby, Tamara, Cash on Delivery).

### 2. Custom Mapping:
Designed for enterprises with bespoke workflows and custom Odoo attributes:
* Creating custom fields (\`x_*\`) and injecting them into Odoo models.
* Direct property mapping from store webhooks to specific Odoo model attributes.
* Leveraging strictly allowlisted static mapping lookup tables.

## Mapping Center Navigation Tabs {#navigation-tabs}
When accessing the Mapping Center (\`/app/mapping-center\`), you will find:
* **Orders Tab:** Controls sales order states, invoice posting, and warehouse routing.
* **Products Tab:** Governs barcode/SKU matching and fallback product categories.
* **Customers Tab:** Governs contact identification and phone normalization.
* **Categories Mapping:** Maps store navigation categories to Odoo product categories.
* **Custom Fields:** Tools to inject custom attributes into Odoo forms via Studio.

## Best Practices & Safe Configuration {#best-practices}
:::important
1. **Start in Draft Mode:** During initial testing, leave "Auto Confirm Sales Orders" and "Auto Post Invoices" disabled. Inspect initial orders in Draft state first.
2. **Standardize SKUs:** Ensure store variant SKUs exactly match the Odoo product \`Internal Reference\` field.
3. **Dedicated Journals:** Map electronic payment methods (e.g. Tabby/Tamara) to dedicated clearing journals rather than your primary checking account.
:::`,
    },
  },
  {
    slug: 'mapping/orders',
    category: 'mapping',
    title: {
      ar: 'مطابقة الطلبات والحالات والدفع في أودوو',
      en: 'Orders & Status Mapping in Odoo',
    },
    description: {
      ar: 'شرح كامل لكل حقل وإعداد داخل تبويب مطابقة الطلبات: أمر البيع، الفاتورة، التسليم، دفاتر الدفع، والتوزيع التحليلي.',
      en: 'Complete field-by-field reference for the Orders Mapping tab: Sales Orders, Invoices, Delivery, Journals, and Analytic Distribution.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 8,
    headings: [
      { id: 'order-settings-table', text: { ar: 'جدول توثيق إعدادات الطلبات الأساسية', en: 'Core Order Settings Reference' }, level: 2 },
      { id: 'status-mapping-table', text: { ar: 'خريطة حالات الطلب بين المتجر وأودوو', en: 'Store-to-Odoo Status Mapping' }, level: 2 },
      { id: 'payment-journal-mapping', text: { ar: 'ربط وسائل الدفع بالدفاتر المحاسبية', en: 'Payment Method & Journal Mapping' }, level: 2 },
      { id: 'analytic-distribution', text: { ar: 'التوزيع التحليلي ومراكز التكلفة', en: 'Analytic Accounts & Cost Centers' }, level: 2 },
      { id: 'verification-steps', text: { ar: 'كيفية التحقق من نجاح إعدادات الطلب', en: 'How to Verify Order Settings' }, level: 2 },
    ],
    keywords: ['Orders Mapping', 'Sales Order', 'Invoice', 'Payment Journal', 'Analytic Distribution', 'Odoo Status'],
    content: {
      ar: `## جدول توثيق إعدادات الطلبات الأساسية {#order-settings-table}
يوضح الجدول التالي كل إعداد حقيقي موجود داخل تبويب مطابقة الطلبات في الواجهة (\`src/app/(app)/app/mapping-center/standard-components/order-settings-tab.tsx\`):

| اسم الإعداد في الواجهة | الوصف التشغيلي | الخيارات المتاحة | التأثير عند التفعيل | تحذيرات ومخاطر |
|---|---|---|---|---|
| **تفعيل مزامنة الطلبات** (\`order_sync_enabled\`) | تفعيل أو إيقاف استقبال الطلبات تلقائياً | مفعل / معطل (Toggle) | عند تفعيله، يتم تحويل أي طلب جديد في المتجر إلى أمر بيع فوراً | إيقافه يوقف تدفق المبيعات إلى أودوو |
| **تأكيد أمر البيع تلقائياً** (\`auto_confirm_orders\`) | تحويل الطلب من مسودة إلى مؤكد | مفعل / معطل | ينقل الطلب في أودوو من \`draft\` إلى \`sale\` ويحجز المخزون | يجب التأكد من توفر الكميات قبل تفعيله |
| **إنشاء الفاتورة تلقائياً** (\`auto_create_invoice\`) | إصدار فاتورة عميل في أودوو | مفعل / معطل | ينشئ فاتورة عميل (\`account.move\`) مسودة أو معتمدة مرتبطة بالطلب | لا تفعله إذا كنت تفضل مراجعة الفواتير يدوياً |
| **تسليم المخزون تلقائياً** (\`auto_deliver_stock\`) | تأكيد إذن الصرف المخزني | مفعل / معطل | يقوم بالتحقق من أمر التسليم (\`stock.picking\`) واعتماده فوراً | يتطلب توفر بضاعة في المستودع المحدد |
| **المستودع الافتراضي** (\`default_warehouse\`) | المستودع الذي تصدر منه المبيعات | قائمة مستودعات أودوو الحية | تخصيص مخزن الصرف وحجز الكميات | اختياره خطأ يخصم المخزون من الفرع الخطأ |
| **دفتر المبيعات الافتراضي** (\`default_sale_journal\`) | دفتر اليومية الذي تُسجل فيه الفواتير | قائمة دفاتر المبيعات (\`sale\`) | توجيه قيود فواتير العملاء | اختياره خاطئ يؤدي لخلخلة شجرة الحسابات |

## خريطة حالات الطلب بين المتجر وأودوو {#status-mapping-table}
تتيح لك واجهة ERP Link تحديد ما يحدث في أودوو عندما تتغير حالة الطلب في المتجر:

| حالة الطلب في المتجر (زد / سلة) | الحالة المقابلة في أودوو | الإجراء التلقائي المنفذ |
|---|---|---|
| **طلب جديد (New / In Review)** | مسودة أمر بيع (\`draft\`) | إنشاء \`sale.order\` بجميع البنود والأسعار |
| **قيد التجهيز (In Progress / Confirmed)** | أمر بيع مؤكد (\`sale\`) | تأكيد أمر البيع وحجز الكميات في \`stock.picking\` |
| **جاهز للشحن / تم الشحن (Shipped)** | إذن تسليم منتهي (\`done\`) | اعتماد صرف البضاعة من المستودع |
| **مكتمل (Delivered / Completed)** | فاتورة معتمدة ومدفوعة | إنشاء الفاتورة واعتمادها وتسجيل قيد الدفع |
| **ملغي (Cancelled)** | أمر بيع ملغي (\`cancel\`) | إلغاء أمر البيع وإرجاع حجز المخزون |

## ربط وسائل الدفع بالدفاتر المحاسبية {#payment-journal-mapping}
لكل وسيلة دفع يدعمها متجرك، يجب تخصيص دفتر محاسبي (\`account.journal\`) وسيط:
* **مدى / فيزا (Mada / Visa):** اربطه بدفتر المدفوعات الإلكترونية أو بوابة الدفع.
* **تابي وتمارا (Tabby / Tamara):** اربطه بدفتر وسيط خاص بشركات التقسيط لمطابقة العمولات والتحصيلات الدورية.
* **الدفع عند الاستلام (COD):** اربطه بدفتر وسيط لمندوبي أو شركات الشحن لمطابقة المبالغ بعد تسليمها.

## التوزيع التحليلي ومراكز التكلفة {#analytic-distribution}
إذا كنت تستخدم الحسابات التحليلية في أودوو لتتبع أرباح الفروع ومصادر المبيعات:
* في **Odoo 17 و 18 و 19 و 20:** يدعم محركنا الحقل الجديد \`analytic_distribution\` بصيغة JSON، حيث يمكنك توزيع 100% من مبيعات الطلب على مركز تكلفة المتجر الإلكتروني.
* في **Odoo 14 و 15 و 16:** يتم توجيه المبيعات إلى حقل الحساب التحليلي الفردي \`analytic_account_id\`.
* يتم تطبيق الحساب التحليلي تلقائياً على كل بند من بنود أمر البيع والفاتورة.

## كيفية التحقق من نجاح إعدادات الطلب {#verification-steps}
1. أنشئ طلباً تجريبياً في متجرك.
2. افتح [سجلات المزامنة](/docs/logs) في ERP Link وتأكد من ظهور العملية باللون الأخضر (\`Success\`).
3. اضغط على السجل لعرض رقمه التعريفي في أودوو (مثال: \`SO0142\`).
4. افتح نظام أودوو وتأكد من مطابقة إجمالي الطلب، الضرائب، واسم العميل.`,

      en: `## Core Order Settings Reference {#order-settings-table}
The table below details every operational field available in the Orders Mapping tab (\`src/app/(app)/app/mapping-center/standard-components/order-settings-tab.tsx\`):

| UI Field Name | Operational Description | Available Options | Effect When Enabled | Risks & Precautions |
|---|---|---|---|---|
| **Enable Order Sync** (\`order_sync_enabled\`) | Toggles automatic order ingestion | Enabled / Disabled | Incoming store checkouts create Sales Orders immediately | Disabling stops order flow into Odoo |
| **Auto Confirm Sales Orders** (\`auto_confirm_orders\`) | Moves SO from Draft to Sale state | Enabled / Disabled | Confirms SO in Odoo and reserves inventory pickings | Verify stock availability before enabling |
| **Auto Create Invoices** (\`auto_create_invoice\`) | Issues customer invoices in Odoo | Enabled / Disabled | Generates customer invoice (\`account.move\`) linked to SO | Leave disabled if manual billing review is preferred |
| **Auto Deliver Stock** (\`auto_deliver_stock\`) | Validates warehouse delivery orders | Enabled / Disabled | Auto-validates the outbound picking (\`stock.picking\`) | Requires sufficient available on-hand stock |
| **Default Warehouse** (\`default_warehouse\`) | Source warehouse for sales | Dynamic list of Odoo warehouses | Sets location where items are picked and reserved | Wrong selection deducts stock from wrong branch |
| **Default Sales Journal** (\`default_sale_journal\`) | Accounting journal for customer invoices | Dynamic list of sales journals | Determines ledger entry destination | Inaccurate selection disrupts Chart of Accounts |

## Store-to-Odoo Status Mapping {#status-mapping-table}
ERP Link lets you configure exact Odoo workflow transitions based on store status updates:

| Store Status (Zid / Salla) | Odoo Equivalent State | Automated Action Executed |
|---|---|---|
| **New / In Review** | Draft Sales Order (\`draft\`) | Creates \`sale.order\` with lines and taxes |
| **In Progress / Confirmed** | Confirmed Order (\`sale\`) | Confirms SO and generates stock picking |
| **Shipped** | Done Delivery (\`done\`) | Validates stock picking from warehouse |
| **Delivered / Completed** | Paid & Invoiced Order | Generates and validates customer invoice |
| **Cancelled** | Cancelled Order (\`cancel\`) | Cancels SO and releases inventory reservation |

## Payment Method & Journal Mapping {#payment-journal-mapping}
Each payment method in your online store should route to a dedicated clearing journal:
* **Mada / Credit Cards:** Map to your electronic payment clearing journal.
* **Tabby & Tamara:** Map to dedicated installment intermediary journals for easy fee reconciliation.
* **Cash on Delivery (COD):** Map to a logistics/carrier clearing journal to track cash collections.

## Analytic Accounts & Cost Centers {#analytic-distribution}
For merchants tracking profitability by store or brand channel:
* In **Odoo 17, 18, 19, and 20:** Supported via the JSON-based \`analytic_distribution\` model.
* In **Odoo 14, 15, and 16:** Injected into the legacy single \`analytic_account_id\` attribute.
* Distribution rules inject automatically onto each sales order line without altering line totals.

## How to Verify Order Settings {#verification-steps}
1. Create a test order on your storefront.
2. Open [Sync Logs](/docs/logs) in ERP Link and confirm a green \`Success\` entry.
3. Click the log row to view the created Odoo record ID (e.g., \`SO0142\`).
4. Log into Odoo and inspect order total, line items, customer, and tax breakdown.`,
    },
  },
  {
    slug: 'mapping/products',
    category: 'mapping',
    title: {
      ar: 'مطابقة المنتجات والـ SKU والباركود في أودوو',
      en: 'Products, SKUs & Barcode Mapping in Odoo',
    },
    description: {
      ar: 'كيفية مطابقة منتجات المتجر بمنتجات أودوو عبر رمز الـ SKU أو الباركود، وقواعد إنشاء المنتجات الجديدة وحسابات الإيراد.',
      en: 'Learn how to match store items to Odoo products by SKU or Barcode, with rules for automatic creation and accounts.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 6,
    headings: [
      { id: 'product-matching-rules', text: { ar: 'قواعد وأولويات مطابقة المنتجات', en: 'Product Matching Rules & Priority' }, level: 2 },
      { id: 'product-settings-table', text: { ar: 'جدول إعدادات المنتجات في مركز الخرائط', en: 'Product Settings Reference Table' }, level: 2 },
      { id: 'variants-and-barcodes', text: { ar: 'التعامل مع المتغيرات (Variants) والباركود', en: 'Handling Variants & Barcodes' }, level: 2 },
      { id: 'product-troubleshooting', text: { ar: 'حل مشكلات عدم تطابق المنتجات', en: 'Product Matching Diagnostics' }, level: 2 },
    ],
    keywords: ['Products Mapping', 'SKU', 'Barcode', 'Variants', 'Internal Reference', 'Product Category'],
    content: {
      ar: `## قواعد وأولويات مطابقة المنتجات {#product-matching-rules}
عند وصول طلب جديد أو مزامنة الكتالوج، يبحث ERP Link في نظام أودوو عن المنتج المطابق باستخدام استراتيجية هرمية آمنة:

1. **المطابقة بالرمز الداخلي (Internal Reference / SKU):** يبحث النظام أولاً عن منتج في أودوو يطابق حقل \`default_code\` فيه رمز الـ SKU في المتجر.
2. **المطابقة بالباركود (Barcode):** إذا لم يتوفر SKU، يبحث النظام عن المنتج عبر حقل الباركود العالمي \`barcode\`.
3. **المطابقة بالاسم (Name Fallback):** خيار احتياطي إضافي إذا تم تفعيله للبحث عن الاسم المطابق بدقة.

:::tip
يوصى بشدة بالاعتماد على **رمز الـ SKU** كمعرف رئيسي وثابت للمنتجات والمتغيرات بين متجرك وأودوو لضمان دقة لا تحتمل الخطأ.
:::

## جدول إعدادات المنتجات في مركز الخرائط {#product-settings-table}
يوضح الجدول أدناه الحقول الحقيقية في تبويب مطابقة المنتجات (\`src/app/(app)/app/mapping-center/standard-components/product-settings-tab.tsx\`):

| الإعداد في الواجهة | الوظيفة التشغيلية | الخيارات المتاحة | التأثير العملي |
|---|---|---|---|
| **معيار المطابقة الرئيسي** (\`product_match_field\`) | الحقل الذي يعتمد عليه النظام في أودوو | \`default_code\` (SKU) / \`barcode\` | يحدد الحقل الذي يُقارن به كود المتجر |
| **إنشاء المنتج تلقائياً** (\`auto_create_products\`) | إنشاء المنتج في أودوو إذا لم يكن موجوداً | مفعل / معطل | ينشئ بطاقة منتج جديدة في \`product.product\` عند وجود طلب لمنتج غير مسبوق |
| **الفئة الافتراضية للمنتجات** (\`default_product_category\`) | فئة المنتجات الجديدة المنشأة | قائمة فئات أودوو (\`product.category\`) | تصنيف المنتجات الجديدة تلقائياً تحت الفئة المختارة |
| **نوع المنتج في أودوو** (\`default_product_type\`) | نوع بطاقة الصنف | صنف مخزني (\`product\`) / استهلاكي (\`consu\`) | تحديد ما إذا كان المنتج يخضع للجرد وتتبع المخزون |
| **حساب الدخل الافتراضي** (\`default_income_account\`) | حساب الإيراد في شجرة الحسابات | قائمة حسابات الإيراد في أودوو | تسجيل إيرادات مبيعات هذا الصنف في الحساب المالي المحدد |

## التعامل مع المتغيرات (Variants) والباركود {#variants-and-barcodes}
إذا كان منتجك يحتوي على خيارات وأحجام متعددة (مثل: لون، مقاس):
* في **أودوو:** يتم تمثيل الصنف كقالب منتج (\`product.template\`) تتفرع منه متغيرات محددة (\`product.product\`).
* في **المتجر (زد / سلة / شوبيفاي):** يمتلك كل متغير رمز SKU وباركود خاصاً به.
* يقوم محرك ERP Link بربط المتغير بدقة مع السجل التابع له في أودوو (\`product.product\`) وتحديث رصيد المخزون للمتغير المحدد دون أي خلط بين المقاسات.

## حل مشكلات عدم تطابق المنتجات {#product-troubleshooting}
* **ظهور خطأ "Product Not Found" في السجلات:**
  * *السبب:* رمز الـ SKU في المتجر يحتوي على مسافات زائدة، أو غير مسجل في حقل \`Internal Reference\` في أودوو.
  * *الحل:* انسخ الرمز من المتجر بدقة وألصقه في حقل \`Internal Reference\` في أودوو، أو فعّل خيار "إنشاء المنتجات تلقائياً".
* **إنشاء منتجات مكررة:**
  * *السبب:* وجود منتجات تحمل نفس الاسم ولكن دون رمز SKU أو باركود.
  * *الحل:* تأكد من ملء رموز الـ SKU لجميع منتجات المتجر قبل إجراء المزامنة.`,

      en: `## Product Matching Rules & Priority {#product-matching-rules}
When synchronizing orders or catalog data, ERP Link identifies the correct Odoo item using a strict matching hierarchy:

1. **SKU Matching (\`default_code\`):** The engine searches for an Odoo product where \`default_code\` matches the store variant SKU.
2. **Barcode Matching (\`barcode\`):** If SKU is empty, the engine matches against the international barcode.
3. **Name Fallback:** An optional fallback matching against exact product titles.

:::tip
We strongly advise standardizing on **SKU (\`default_code\`)** as the primary immutable identifier across all storefront variants and Odoo items.
:::

## Product Settings Reference Table {#product-settings-table}
The table below documents fields in the Products Mapping tab (\`src/app/(app)/app/mapping-center/standard-components/product-settings-tab.tsx\`):

| UI Field Name | Operational Role | Options | Practical Impact |
|---|---|---|---|
| **Primary Match Field** (\`product_match_field\`) | Target field in Odoo | \`default_code\` (SKU) / \`barcode\` | Selects which attribute is queried |
| **Auto Create Products** (\`auto_create_products\`) | Creates item if missing | Enabled / Disabled | Provisions a new \`product.product\` card when an unknown item is ordered |
| **Default Product Category** (\`default_product_category\`) | Category for created items | List of Odoo \`product.category\` | Automatically assigns new items to this category |
| **Default Product Type** (\`default_product_type\`) | Stock trackability | Storable (\`product\`) / Consumable (\`consu\`) | Determines whether stock pickings track quantities |
| **Default Income Account** (\`default_income_account\`) | Ledger revenue account | Odoo chart of accounts | Allocates sales credit to this ledger account |

## Handling Variants & Barcodes {#variants-and-barcodes}
For apparel and multi-attribute products with colors and sizes:
* In **Odoo:** Managed as a \`product.template\` parent with multiple \`product.product\` child variants.
* In **Storefronts:** Each variant holds its own unique SKU and barcode.
* ERP Link resolves line items directly to child \`product.product\` records, ensuring accurate inventory deduction for the exact size or color.

## Product Matching Diagnostics {#product-troubleshooting}
* **"Product Not Found" Error in Sync Logs:**
  * *Cause:* SKU in the store contains trailing spaces or is missing from Odoo \`default_code\`.
  * *Resolution:* Copy the exact SKU into Odoo's \`Internal Reference\` field, or enable "Auto Create Products".
* **Duplicate Products Created:**
  * *Cause:* Items share identical names without distinct SKUs.
  * *Resolution:* Populate distinct SKUs across all catalog items before running full synchronization.`,
    },
  },
  {
    slug: 'mapping/customers',
    category: 'mapping',
    title: {
      ar: 'مطابقة العملاء وجهات الاتصال في أودوو',
      en: 'Customer & Contact Matching in Odoo',
    },
    description: {
      ar: 'شرح آلية مطابقة العملاء برقم الجوال (+966) والبريد، تجنب تكرار جهات الاتصال في res.partner، ومعالجة طلبات الزوار.',
      en: 'Learn how to resolve customers by mobile (+966) and email, prevent duplicate res.partner contacts, and handle guest checkouts.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 5,
    headings: [
      { id: 'customer-matching-strategy', text: { ar: 'استراتيجية مطابقة العميل وتوحيده', en: 'Customer Identification Strategy' }, level: 2 },
      { id: 'customer-settings-table', text: { ar: 'جدول إعدادات العملاء في مركز الخرائط', en: 'Customer Settings Reference Table' }, level: 2 },
      { id: 'phone-normalization', text: { ar: 'توحيد صيغ أرقام الجوال (+966)', en: 'Saudi Mobile Number Normalization (+966)' }, level: 2 },
      { id: 'guest-and-fallback', text: { ar: 'التعامل مع طلبات الزوار وجهة الاتصال الافتراضية', en: 'Guest Checkouts & Generic Contact' }, level: 2 },
    ],
    keywords: ['Customers Mapping', 'res.partner', 'Mobile Normalization', 'Guest Checkout', 'Odoo Contacts'],
    content: {
      ar: `## استراتيجية مطابقة العميل وتوحيده {#customer-matching-strategy}
لمنع تكرار بطاقات العملاء في أودوو (\`res.partner\`) وتشتت سجلات المشتريات، يتبع ERP Link تسلسلاً ذكياً للبحث عن العميل:

1. **البحث برقم الجوال الموحد:** يتم تنظيف وتوحيد رقم الجوال والبحث عنه في حقول الجوال والهاتف في أودوو.
2. **البحث بالبريد الإلكتروني:** إذا لم يُعثر على تطابق بالجوال، يبحث النظام عن العميل بواسطة البريد الإلكتروني.
3. **الإنشاء الآمن أو استخدام العميل الافتراضي:** إذا كان العميل جديداً تماماً، ينشئ النظام بطاقة جديدة باسمه وعنوانه، أو يربط الطلب بعميل عام افتراضي وفق إعداداتك.

## جدول إعدادات العملاء في مركز الخرائط {#customer-settings-table}
الحقول المتوفرة في تبويب مطابقة العملاء (\`src/app/(app)/app/mapping-center/standard-components/customer-settings-tab.tsx\`):

| الإعداد في الواجهة | الوظيفة التشغيلية | الخيارات المتاحة | التأثير العملي |
|---|---|---|---|
| **معيار المطابقة الأول** (\`customer_match_field\`) | المعيار المفضل للبحث عن العميل | رقم الجوال (\`mobile\`) / البريد (\`email\`) | يحدد الأولوية الأولى في البحث عن العميل |
| **إنشاء عميل جديد تلقائياً** (\`auto_create_customer\`) | إنشاء بطاقة في \`res.partner\` للعملاء الجدد | مفعل / معطل | حفظ بيانات كل مشترٍ كجهة اتصال مستقلة |
| **العميل الافتراضي الاحتياطي** (\`default_customer_id\`) | عميل عام للطلبات غير المعرفة | قائمة عملاء أودوو | يُستخدم لطلبات الزوار السريعة أو عند تعطل إنشاء العميل |
| **تحديث بيانات العميل القائم** (\`update_existing_customer\`) | تحديث العنوان والجوال إذا تغير في المتجر | مفعل / معطل | إبقاء بيانات الاتصال محدثة دائماً |

## توحيد صيغ أرقام الجوال (+966) {#phone-normalization}
يواجه أصحاب المتاجر في السعودية مشكلة إدخال العملاء لأرقام هواتفهم بصيغ متعددة (مثال: \`0501234567\`، \`966501234567\`، أو \`+966 50 123 4567\`).

يقوم محرك ERP Link تلقائياً بتنظيف الرقم وحذف المسافات والرموز الزائدة وتوحيده إلى الصيغة الدولية القياسية (\`+9665XXXXXXXX\`)، مما يضمن العثور على العميل حتى لو كتب رقمه بصيغة مختلفة في الطلب التالي.

## التعامل مع طلبات الزوار وجهة الاتصال الافتراضية {#guest-and-fallback}
في حال قام عميل بالشراء السريع دون تسجيل حساب في المتجر:
* يمكنك تفعيل خيار **استخدام العميل الافتراضي** واختيار جهة اتصال مثل (عميل نقدي / Cash Customer).
* سيتم تسجيل أمر البيع باسم هذا العميل الافتراضي مع تضمين عنوان التوصيل الفعلي داخل نص ملاحظات الطلب.`,

      en: `## Customer Identification Strategy {#customer-matching-strategy}
To prevent duplicate \`res.partner\` records and fragmented sales histories in Odoo, ERP Link uses a robust contact matching sequence:

1. **Normalized Mobile Search:** Scans Odoo \`mobile\` and \`phone\` fields using standardized phone strings.
2. **Email Match:** If no mobile match exists, searches by customer email address.
3. **Provision or Generic Fallback:** Creates a new \`res.partner\` card, or links the order to a generic cash customer based on your configuration.

## Customer Settings Reference Table {#customer-settings-table}
Fields available in the Customers Mapping tab (\`src/app/(app)/app/mapping-center/standard-components/customer-settings-tab.tsx\`):

| UI Setting Name | Operational Role | Options | Practical Impact |
|---|---|---|---|
| **Primary Match Field** (\`customer_match_field\`) | Search priority | Mobile Phone / Email | Determines the first attribute queried |
| **Auto Create Customers** (\`auto_create_customer\`) | Provisions new \`res.partner\` | Enabled / Disabled | Stores each shopper as a distinct Odoo contact |
| **Default Generic Customer** (\`default_customer_id\`) | Fallback contact | List of Odoo contacts | Used for anonymous guest orders |
| **Update Existing Contacts** (\`update_existing_customer\`) | Refreshes address/phone | Enabled / Disabled | Keeps customer contact profiles up to date |

## Saudi Mobile Number Normalization (+966) {#phone-normalization}
Shoppers enter phone numbers in varied formats (\`0501234567\`, \`966501234567\`, or \`+966 50 123 4567\`).

ERP Link automatically strips non-numeric characters and normalizes Saudi mobile numbers into the canonical international format (\`+9665XXXXXXXX\`), guaranteeing matching regardless of input style.

## Guest Checkouts & Generic Contact {#guest-and-fallback}
When visitors complete checkouts without registering a permanent store account:
* You can configure a **Default Generic Customer** (e.g., "Cash Customer / عميل نقدي").
* The sales order is assigned to this generic partner while preserving the delivery address in the order remarks.`,
    },
  },
  {
    slug: 'mapping/categories',
    category: 'mapping',
    title: {
      ar: 'مطابقة التصنيفات والفئات بين المتجر وأودوو',
      en: 'Categories Mapping in Odoo',
    },
    description: {
      ar: 'ربط أقسام وتصنيفات متجرك الإلكتروني بفئات المنتجات في أودوو مع دعم التسلسل الهرمي وعلاقات الآباء والأبناء.',
      en: 'Map online store categories to Odoo product categories with support for hierarchical parent-child trees.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 5,
    headings: [
      { id: 'category-mapping-role', text: { ar: 'أهمية مطابقة التصنيفات في أودوو', en: 'Importance of Category Mapping' }, level: 2 },
      { id: 'mapping-interface', text: { ar: 'واجهة ربط التصنيفات وطريقة العمل', en: 'Category Mapping Interface' }, level: 2 },
      { id: 'hierarchy-support', text: { ar: 'دعم التصنيفات الفرعية والتسلسل الهرمي', en: 'Parent-Child Hierarchy Support' }, level: 2 },
      { id: 'auto-creation-rules', text: { ar: 'قواعد الإنشاء التلقائي للتصنيفات', en: 'Auto-Creation Rules' }, level: 2 },
    ],
    keywords: ['Categories Mapping', 'product.category', 'Category Hierarchy', 'Parent Category', 'Odoo Taxonomy'],
    content: {
      ar: `## أهمية مطابقة التصنيفات في أودوو {#category-mapping-role}
في نظام أودوو، لا تُستخدم فئات المنتجات (\`product.category\`) للتنظيم البصري فقط، بل تتحكم بشكل مباشر في:
* **حسابات الدخل والمصروفات الافتراضية** للمنتجات التابعة لها.
* **طريقة تقييم المخزون** (يدوي أو آلي Automated FIFO/AVCO).
* **دفاتر وحسابات المخزون المعلق** والتحويلات.

لذلك، يتيح لك ERP Link ربط كل قسم في متجرك (زد، سلة، شوبيفاي) بفئة محددة مسبقاً في أودوو لضمان دقة التقارير المحاسبية.

## واجهة ربط التصنيفات وطريقة العمل {#mapping-interface}
يمكنك الوصول إلى شاشة مطابقة التصنيفات عبر:
\`مركز الخرائط > مطابقة التصنيفات\` (\`/app/mapping-center/categories\`).

1. تعرض الشاشة جدولاً يحتوي على جميع التصنيفات المستوردة من متجرك الإلكتروني.
2. بجانب كل تصنيف متجر، تظهر قائمة منسدلة تضم جميع فئات المنتجات المتاحة في أودوو.
3. اختر فئة أودوو المناسبة لكل تصنيف متجر.
4. انقر على زر **حفظ المطابقة (Save Mappings)**.

## دعم التصنيفات الفرعية والتسلسل الهرمي {#hierarchy-support}
يدعم محرك ERP Link التسلسل الهرمي الكامل للتصنيفات (Parent-Child Structure):
* إذا كان لديك قسم رئيسي (مثل: \`إلكترونيات\`) وقسم فرعي (مثل: \`هواتف ذكية\`)، يتعرف النظام على علاقة التبعية.
* في حال إنشاء الفئات تلقائياً، يتم إنشاؤها داخل أودوو مع ربط حقل \`parent_id\` بدقة لتعكس نفس الشجرة الموجودة في المتجر.

## قواعد الإنشاء التلقائي للتصنيفات {#auto-creation-rules}
* إذا قمت بتفعيل خيار **إنشاء التصنيفات تلقائياً (Auto-create categories)**:
  * يقوم النظام بفحص فئات أودوو أولاً لمنع التكرار.
  * إذا لم يتم العثور على الفئة، يتم إنشاؤها مع إسنادها للفئة الأم المحددة افتراضياً.`,

      en: `## Importance of Category Mapping {#category-mapping-role}
In Odoo, product categories (\`product.category\`) control much more than visual taxonomy. They directly govern:
* **Default Income & Expense Accounts** applied to line items.
* **Inventory Valuation Methods** (Manual vs. Automated FIFO/AVCO).
* **Interim Stock Accounts** and balance sheet reconciliations.

ERP Link ensures every store catalog department maps to an authoritative Odoo product category.

## Category Mapping Interface {#mapping-interface}
Access the category alignment screen at:
\`Mapping Center > Categories Mapping\` (\`/app/mapping-center/categories\`).

1. The page renders a mapping table listing all active storefront categories.
2. Alongside each store category, a searchable select dropdown lists available Odoo categories.
3. Match each store category to its appropriate ERP destination.
4. Click **Save Mappings**.

## Parent-Child Hierarchy Support {#hierarchy-support}
ERP Link respects multi-tier category structures:
* Parent categories (e.g., \`Electronics\`) and sub-categories (e.g., \`Smartphones\`) preserve relational hierarchies.
* When auto-provisioning categories in Odoo, the \`parent_id\` relation is maintained seamlessly.

## Auto-Creation Rules {#auto-creation-rules}
* With **Auto-create categories** enabled:
  * The engine verifies whether a matching category name already exists in Odoo before inserting.
  * If missing, it provisions the category linked to your specified parent tier.`,
    },
  },
  {
    slug: 'mapping/custom-fields',
    category: 'mapping',
    title: {
      ar: 'الحقول المخصصة واستوديو أودوو (Custom Fields)',
      en: 'Custom Fields & Odoo Studio Integration',
    },
    description: {
      ar: 'شرح كيفية إنشاء حقول مخصصة (x_*) داخل أودوو عبر ir.model.fields وحقنها بـ XPath مع التحقق الأمني الكامل.',
      en: 'Learn how to create custom fields (x_*) in Odoo via ir.model.fields and inject them safely using XPath validation.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 6,
    headings: [
      { id: 'why-custom-fields', text: { ar: 'لماذا تحتاج إلى الحقول المخصصة؟', en: 'Why Use Custom Fields?' }, level: 2 },
      { id: 'add-field-form', text: { ar: 'واجهة إضافة الحقول المخصصة', en: 'Custom Field Creation Interface' }, level: 2 },
      { id: 'supported-models-and-types', text: { ar: 'النماذج وأنواع الحقول المدعومة', en: 'Supported Models & Data Types' }, level: 2 },
      { id: 'security-and-xml-validation', text: { ar: 'الأمان والتحقق من صحة XML', en: 'Security & XML Validation' }, level: 2 },
    ],
    keywords: ['Custom Fields', 'Odoo Studio', 'ir.model.fields', 'XPath', 'x_zid_order_id', 'Field Injection'],
    content: {
      ar: `## لماذا تحتاج إلى الحقول المخصصة؟ {#why-custom-fields}
عند مزامنة المتاجر مع أودوو، تحتاج فِرق العمليات غالباً إلى رؤية بيانات خاصة بالمتجر مباشرة على شاشة أمر البيع أو الفاتورة، مثل:
* رقم الطلب في زد أو سلة (\`x_zid_order_id\`, \`x_salla_order_id\`).
* وسيلة الشحن أو كود بوليصة التتبع (\`x_tracking_number\`).
* ملاحظات التوصيل الخاصة بالعميل.
* الرقم الضريبي للعميل المسجل في المتجر.

يتيح لك ERP Link إنشاء وحقن هذه الحقول داخل أودوو مباشرة بضغطة زر واحدة دون الحاجة لتثبيت تطبيق Odoo Studio المدفوع أو كتابة كود بايثون!

## واجهة إضافة الحقول المخصصة {#add-field-form}
لإنشاء حقل مخصص جديد في أودوو:
1. انتقل إلى **مركز الخرائط > إضافة حقل مخصص** (\`/app/mapping-center/add-field\`).
2. اختر النموذج المستهدف في أودوو (مثل: أمر البيع \`sale.order\`).
3. أدخل اسم الحقل التقني (يبدأ تلقائياً بـ \`x_\` وفق معايير أودوو، مثال: \`x_store_order_number\`).
4. أدخل التسمية العربية والإنجليزية التي ستظهر للموظفين على الشاشة (Field Label).
5. حدد نوع الحقل (نص، رقم، منطقي، أو قائمة خيارات).
6. انقر على **حقن الحقل في أودوو (Inject Field)**.

## النماذج وأنواع الحقول المدعومة {#supported-models-and-types}
يدعم النظام إنشاء الحقول على النماذج الأساسية التالية:
* **أوامر البيع (\`sale.order\`):** لتسجيل أرقام الطلبات الأصلية وبيانات الدفع والتوصيل.
* **فواتير العملاء (\`account.move\`):** لتسجيل المعرفات الضريبية وأرقام الفواتير في المتجر.
* **جهات الاتصال والعملاء (\`res.partner\`):** لتسجيل المدينة والموقع والاسم التجاري.
* **المنتجات (\`product.template\`):** لتسجيل معرفات التصنيف والروابط.

**أنواع الحقول المتاحة:**
* \`char\` — نصوص قصيرة (حتى 255 حرفاً).
* \`text\` — نصوص طويلة وملاحظات.
* \`integer\` / \`float\` — أرقام صحيحة أو عشرية.
* \`boolean\` — خيار نعم / لا.
* \`selection\` — قائمة منسدلة بخيارات محددة.

## الأمان والتحقق من صحة XML {#security-and-xml-validation}
يحتوي خادمنا على محرك فحص وتطهير صارم (\`src/lib/custom-field-validation.ts\`):
* يتم التحقق الصارم من أسماء الحقول لمنع حقن نصوص برمجية خبيثة.
* يتم تطهير جميع مدخلات الواجهة والتأكد من توافق أقواس XML قبل إرسال نداءات XPath لتعديل واجهات أودوو.
* يضمن المحرك عدم تكرار الحقول القائمة مسبقاً في قاعدة بيانات أودوو.`,

      en: `## Why Use Custom Fields? {#why-custom-fields}
When synchronizing e-commerce orders into Odoo, operations teams frequently require native visibility over storefront metadata directly within Odoo form views, such as:
* Upstream storefront order numbers (\`x_zid_order_id\`, \`x_salla_order_id\`).
* Shipping waybill tracking numbers (\`x_tracking_number\`).
* Custom customer delivery notes.
* Customer VAT/Tax identification numbers.

ERP Link lets you provision and inject these fields directly into Odoo without requiring Odoo Studio enterprise modules or custom Python code!

## Custom Field Creation Interface {#add-field-form}
To provision a new field in Odoo:
1. Navigate to **Mapping Center > Add Custom Field** (\`/app/mapping-center/add-field\`).
2. Select the target Odoo model (e.g., Sales Order \`sale.order\`).
3. Enter the technical field name (prefixed automatically with \`x_\`, e.g., \`x_store_order_number\`).
4. Enter the user-facing Field Label.
5. Choose the data type (Char, Text, Float, Boolean, Selection).
6. Click **Inject Field into Odoo**.

## Supported Models & Data Types {#supported-models-and-types}
Custom fields can be injected into core business models:
* **Sales Orders (\`sale.order\`):** For store order numbers, delivery notes, and carrier codes.
* **Customer Invoices (\`account.move\`):** For tax identifiers and payment gateway references.
* **Contacts (\`res.partner\`):** For district names, commercial IDs, and national addresses.
* **Products (\`product.template\`):** For external catalog IDs and metadata.

**Available Data Types:**
* \`char\` — Short string values (up to 255 characters).
* \`text\` — Multi-line remarks and descriptions.
* \`integer\` / \`float\` — Numeric quantities or currency amounts.
* \`boolean\` — Yes/No toggle flags.
* \`selection\` — Predefined dropdown choices.

## Security & XML Validation {#security-and-xml-validation}
Our backend enforces rigorous sanitization (\`src/lib/custom-field-validation.ts\`):
* Technical names are strictly regex-validated to prevent injection vulnerabilities.
* View XML modifications are verified before submitting XPath payloads to Odoo.
* Collision checks guarantee that existing Odoo core fields are never overwritten.`,
    },
  },
]
