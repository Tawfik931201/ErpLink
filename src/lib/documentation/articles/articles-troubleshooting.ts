import type { DocArticle } from '../docs-types'

export const articlesTroubleshooting: DocArticle[] = [
  {
    slug: 'troubleshooting',
    category: 'troubleshooting',
    title: {
      ar: 'دليل تشخيص واستكشاف المشكلات التشغيلية الشائعة',
      en: 'Common Operational Diagnostics & Troubleshooting',
    },
    description: {
      ar: 'حلول عملية ومجربة لـ 12 مشكلة تشغيلية قد تواجهها: فشل الاتصال، عدم وصول الطلبات، فروقات الضريبة والمخزون، وتوقف الطابور.',
      en: 'Practical solutions for 12 common operational scenarios: connection dropouts, missing orders, tax variances, and queue blocks.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 9,
    headings: [
      { id: 'connection-issues', text: { ar: 'مشكلات الاتصال بمتجرك وبنظام أودوو', en: 'Store & Odoo Connectivity Issues' }, level: 2 },
      { id: 'order-sync-issues', text: { ar: 'مشكلات وصول ومزامنة الطلبات', en: 'Order Delivery & Sync Issues' }, level: 2 },
      { id: 'tax-and-price-issues', text: { ar: 'مشكلات اختلاف الضرائب وأسعار الفواتير', en: 'Tax & Invoice Pricing Discrepancies' }, level: 2 },
      { id: 'inventory-issues', text: { ar: 'مشكلات عدم تطابق المخزون وتوقف التحديث', en: 'Inventory Mismatches & Stagnation' }, level: 2 },
      { id: 'queue-and-logs-issues', text: { ar: 'مشكلات طابور العمليات والسجلات الفاشلة', en: 'Queue Delays & Persistent Failures' }, level: 2 },
      { id: 'escalation-guidelines', text: { ar: 'متى وكيف تُصعد المشكلة للدعم الفني؟', en: 'When & How to Escalate to Support' }, level: 2 },
    ],
    keywords: ['Troubleshooting', 'Fix Errors', 'Failed Sync', 'Missing Orders', 'Tax Difference', 'Odoo Error'],
    content: {
      ar: `## مشكلات الاتصال بمتجرك وبنظام أودوو {#connection-issues}

### 1. المتجر يظهر مفصولاً (Store Disconnected)
* **العرض:** تظهر بطاقة المتجر بحالة مفصولة أو تتوقف السجلات عن الاستقبال.
* **السبب:** قام أحد مديري المتجر بإلغاء تثبيت التطبيق أو تجديد الصلاحيات من لوحة المتجر، مما أبطل رمز الوصول (Token).
* **خطوات الفحص:** افتح شاشة [ربط المتجر](/docs/connect/zid) وافحص نص الحالة المعروض.
* **الحل:** اضغط على زر **إعادة الربط (Reconnect)** وأكمل موافقة OAuth لمنح رمز وصول جديد فوراً.

### 2. اتصال أودوو يفشل (Odoo Connection Failed)
* **العرض:** ظهور رسالة خطأ \`Access Denied\` أو \`Cannot connect to server\` عند الضغط على فحص الاتصال.
* **السبب:** تغيير كلمة مرور مستخدم أودوو، انتهاء صلاحية مفتاح الـ API، أو تغيير اسم قاعدة البيانات.
* **خطوات الفحص:** افتح شاشة أودوو في متصفحك وسجل الدخول بنفس بيانات مستخدم الربط.
* **الحل:** أنشئ مفتاح API جديد في أودوو، وانسخه بدقة في شاشة [الاتصال بأودوو](/docs/connect/odoo)، وتأكد من كتابة رابط الخادم بصيغة \`https://\` دون أي شرطة مائلة إضافية في النهاية.

---

## مشكلات وصول ومزامنة الطلبات {#order-sync-issues}

### 3. الطلب لا يظهر في أودوو بعد إتمامه في المتجر
* **العرض:** العميل أتم الطلب ودفع قيمته في المتجر، لكنه غير موجود في قائمة أوامر البيع في أودوو.
* **خطوات الفحص:**
  1. افتح شاشة [سجلات المزامنة](/docs/logs) وابحث برقم الطلب.
  2. افتح شاشة [طابور العمليات](/docs/queue) وتحقق من تبويب \`Pending\` أو \`Frozen\`.
* **الحل:**
  * إذا ظهر السجل بحالة **فاشلة (Failed):** انقر عليه لمعرفة سبب الرفض (مثال: صنف غير موجود في أودوو). أضف الصنف في أودوو ثم اضغط **إعادة المحاولة (Retry)**.
  * إذا كان في تبويب **المتجمدة (Frozen):** انتظر دقيقة ليقوم النظام بإعادة المحاولة التلقائية بعد فك قفل الشبكة.
  * إذا لم يظهر السجل نهائياً: اضغط زر **تحديث الويب هوكس (Refresh Webhooks)** في شاشة ربط المتجر.

### 4. الطلب يظهر في السجلات بحالة تم التخطي (Skipped)
* **العرض:** يظهر الطلب باللون الرمادي/الأصفر وحالته Skipped دون إنشاء أمر بيع.
* **السبب:** هذا سلوك طبيعي في حالتين:
  1. حالة الطلب في المتجر غير مفعلة في خريطة الحالات (مثل طلب تم إنشاؤه بحالة \`pending_payment\` وأنت قمت بضبط النظام على مزامنة الطلبات المدفوعة فقط).
  2. وصول ويب هوك مكرر لطلب تم إنشاؤه مسبقاً، حيث يقوم مفتاح منع التكرار (Idempotency) بتخطيه لحمايتك.

---

## مشكلات اختلاف الضرائب وأسعار الفواتير {#tax-and-price-issues}

### 5. وجود فرق هللة واحدة (0.01 ريال) بين المتجر وأودوو
* **العرض:** إجمالي فاتورة أودوو يختلف بهللة واحدة عن المبلغ المسحوب في بوابة الدفع.
* **السبب:** عدم تفعيل خيار "الأسعار شاملة الضريبة" في أودوو، أو عدم ضبط معدل الضريبة 15% بدقة على بنود الشحن.
* **الحل:** راجع دليل [حل اختلاف ضريبة 15%](/docs/taxes). تأكد أن حقل الضريبة المطبق في مركز الخرائط يطابق ضريبة الـ 15% الرسمية المعتمدة في أودوو.

### 6. عدم تطبيق الضريبة على رسوم الشحن
* **العرض:** المنتجات خاضعة للضريبة ولكن سطر الشحن يظهر بنسبة 0% ضريبة.
* **السبب:** عدم تعيين ضريبة مبيعات افتراضية على بطاقة خدمة التوصيل المحددة في مركز الخرائط.
* **الحل:** افتح بطاقة صنف الشحن في أودوو وتأكد من تفعيل ضريبة المبيعات 15% عليها.

---

## مشكلات عدم تطابق المخزون وتوقف التحديث {#inventory-issues}

### 7. رصيد المخزون في المتجر لا يتطابق مع رصيد المستودع في أودوو
* **العرض:** يعرض المتجر كمية 10 قطع بينما المستودع يحتوي على 15 قطعة.
* **السبب:** توجد 5 قطع محجوزة في أوامر بيع مؤكدة لم تُسلّم بعد. يعتمد النظام دائماً على **الكمية المتوفرة للبيع (Forecasted)** لحمايتك من البيع الزائد.
* **الحل:** راجع شاشة الصنف في أودوو وتحقق من بند \`Forecasted Units\`.

### 8. تغيير المخزون في أودوو لا ينعكس في المتجر
* **السبب:** عدم إعداد أحداث المخزون التلقائية، أو عدم تطابق رمز الـ SKU بين الصنف في أودوو والمتجر.
* **الحل:** تأكد من تطابق رمز \`Internal Reference\` في أودوو مع SKU المتجر تماماً دون مسافات زائدة.

---

## مشكلات طابور العمليات والسجلات الفاشلة {#queue-and-logs-issues}

### 9. تراكم العمليات في طابور الانتظار (Queue Pending)
* **العرض:** زيادة عدد عناصر الطابور المعلقة دون تناقصها السريع.
* **السبب:** حدوث تدفق استثنائي في المبيعات، أو بطء مؤقت في استجابة خادم أودوو.
* **الحل:** انتظر بضع دقائق؛ يقوم الطابور بتفريغ العمليات بمعدل آمن ومحمي. لا تقم بحذف العناصر يدوياً.

---

## متى وكيف تُصعد المشكلة للدعم الفني؟ {#escalation-guidelines}
إذا استمرت المشكلة بعد اتباع الخطوات السابقة:
1. افتح شاشة [تذاكر الدعم](/docs/support) (\`/app/tickets\`).
2. انقر على **تذكرة جديدة**.
3. اذكر بوضوح:
   * رقم مساحة العمل (\`Workspace ID\`).
   * رقم الطلب في المتجر ورقم السجل الفاشل في ERP Link.
   * نص رسالة الخطأ الظاهرة في نافذة تفاصيل السجل.
4. سيرد عليك مهندس الربط في محادثة مباشرة للمساعدة الفورية.`,

      en: `## Store & Odoo Connectivity Issues {#connection-issues}

### 1. Store Shows Disconnected
* **Symptom:** Store status badge displays disconnected, or new orders cease arriving.
* **Cause:** A store manager revoked the app or re-authenticated via another browser session, invalidating OAuth tokens.
* **Check:** Open [Store Connection](/docs/connect/zid) and inspect the current status banner.
* **Resolution:** Click **Reconnect** to initiate a clean OAuth handshake and restore valid tokens.

### 2. Odoo Connection Failed
* **Symptom:** \`Access Denied\` or \`Cannot connect to server\` error dialog when clicking Test Connection.
* **Cause:** User password changed, API key expired, or database renamed.
* **Check:** Sign into your Odoo web interface with the same user credentials.
* **Resolution:** Generate a new API Key in Odoo, paste it into [Connect Odoo](/docs/connect/odoo), and ensure the URL begins with \`https://\` without trailing slashes.

---

## Order Delivery & Sync Issues {#order-sync-issues}

### 3. Order Missing in Odoo After Store Checkout
* **Symptom:** Checkout completed upstream, but absent in Odoo sales orders.
* **Check:**
  1. Open [Sync Logs](/docs/logs) and search by store order number.
  2. Check [Processing Queue](/docs/queue) under \`Pending\` or \`Frozen\` tabs.
* **Resolution:**
  * If **Failed:** Inspect the log row to identify the root cause (e.g. unknown SKU). Create the item in Odoo and click **Retry Sync**.
  * If **Frozen:** Wait 60 seconds; the backoff circuit breaker will auto-retry after network cooling.
  * If absent from logs entirely: Click **Refresh Webhooks** in your store connection screen.

### 4. Order Marked as Skipped
* **Symptom:** Order appears in gray/amber status marked as Skipped.
* **Cause:** Normal expected behavior in two scenarios:
  1. The initial store status is excluded by your mapping rules (e.g. unpaid order).
  2. Duplicate webhook payload arrived, safely filtered by the idempotency guard.

---

## Tax & Invoice Pricing Discrepancies {#tax-and-price-issues}

### 5. Fractional Halala Variance (±0.01 SAR)
* **Symptom:** Odoo customer invoice deviates by 0.01 SAR from payment gateway checkout totals.
* **Cause:** Tax-exclusive unit price rounding discrepancy.
* **Resolution:** Follow our [15% VAT & Price Parity Guide](/docs/taxes). Ensure the configured VAT rate matches your Odoo tax definition.

### 6. Missing VAT on Shipping Lines
* **Symptom:** Order line items calculate 15% VAT, but delivery freight computes at 0%.
* **Cause:** Odoo shipping service product lacks a default customer tax rate.
* **Resolution:** Open the delivery service item in Odoo and assign the standard 15% sales tax.

---

## Inventory Mismatches & Stagnation {#inventory-issues}

### 7. Store Stock Disagrees with Odoo Physical On-Hand
* **Symptom:** Store shows 10 units while warehouse floor has 15.
* **Cause:** 5 units are reserved by unshipped confirmed sales orders. ERP Link intentionally pushes **Forecasted Quantity (\`virtual_available\`)** to protect you from overselling.
* **Resolution:** Inspect the product card in Odoo and verify the \`Forecasted\` metric.

### 8. Odoo Inventory Adjustments Do Not Push to Store
* **Cause:** Mismatched SKU or missing automated webhooks.
* **Resolution:** Verify that Odoo's \`Internal Reference\` exactly matches the store SKU without trailing whitespace.

---

## When & How to Escalate to Support {#escalation-guidelines}
If an anomaly persists after following these steps:
1. Navigate to [Support Tickets](/docs/support) (\`/app/tickets\`).
2. Click **New Ticket**.
3. Provide:
   * Your \`Workspace ID\`.
   * Store order number and failed ERP Link Log ID.
   * Raw error trace copied from the log detail modal.
4. An integration engineer will assist directly via live chat.`,
    },
  },
  {
    slug: 'faq',
    category: 'troubleshooting',
    title: {
      ar: 'الأسئلة الأكثر تكراراً والأمان والموثوقية',
      en: 'Frequently Asked Questions, Security & Privacy',
    },
    description: {
      ar: 'إجابات واضحة عن الأسئلة الشائعة: أمان البيانات، التكلفة، دعم المنصات، تشفير كلمات المرور، وشهادات الزكاة.',
      en: 'Direct answers to frequent questions regarding data privacy, security, pricing, platform support, and ZATCA compliance.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 5,
    headings: [
      { id: 'security-faq', text: { ar: 'أمان البيانات وتشفير كلمات المرور', en: 'Data Privacy & Encryption' }, level: 2 },
      { id: 'platform-faq', text: { ar: 'المنصات وإصدارات أودوو المدعومة', en: 'Supported Platforms & Versions' }, level: 2 },
      { id: 'billing-faq', text: { ar: 'الاشتراكات والتجربة والرسوم الإضافية', en: 'Pricing, Trials & Fees' }, level: 2 },
      { id: 'compliance-faq', text: { ar: 'الفوترة الإلكترونية وهيئة الزكاة (ZATCA)', en: 'E-Invoicing & ZATCA Compliance' }, level: 2 },
    ],
    keywords: ['FAQ', 'Security', 'AES-256', 'ZATCA', 'Data Privacy', 'Odoo Support'],
    content: {
      ar: `## أمان البيانات وتشفير كلمات المرور {#security-faq}

### هل يقوم ERP Link بحفظ بيانات بطاقات الائتمان الخاصة بعملائي؟
**لا على الإطلاق.** لا يتعامل ERP Link مع أرقام البطاقات الائتمانية أو رموز CVV نهائياً. تتم معالجة المدفوعات داخل بوابات الدفع المرخصة في متجرك (مثل ميسر، بيتابس، تابي، تمارا)، ونستقبل فقط تأكيد نجاح الدفع ورقم المرجع المحاسبي.

### كيف يتم تأمين مفاتيح API وبيانات أودوو في خوادمكم؟
يتم تشفير جميع الرموز السرية ومفاتيح أودوو في قاعدة البيانات باستخدام خوارزمية التشفير المعتمدة دولياً **AES-256-GCM** (\`src/lib/crypto.ts\`). مفتاح فك التشفير غير مخزن في الكود المصدري ولا يمتلك أي طرف خارجي حق الوصول إليه.

---

## المنصات وإصدارات أودوو المدعومة {#platform-faq}

### ما هي إصدارات أودوو التي تدعمها المنصة؟
تدعم منصة ERP Link جميع إصدارات أودوو من **Odoo 14 حتى Odoo 20**، بما يشمل:
* Odoo Online (سحابة أودوو الرسمية \`odoo.com\`).
* Odoo.sh (منصة الاستضافة المدارة).
* Odoo Community & Enterprise على خوادمك المستقلة الخاصة (AWS, DigitalOcean, Hetzner).

### هل أحتاج لتثبيت موديول خارجي في أودوو؟
**لا.** تعتمد منصتنا على واجهات البرمجة القياسية المدمجة في أودوو (XML-RPC / JSON-RPC). لا تحتاج لتثبيت أي ملفات في خادمك لبدء الربط.

---

## الاشتراكات والتجربة والرسوم الإضافية {#billing-faq}

### هل توجد أي عمولات مقتطعة على المبيعات؟
**لا توجد أي عمولات على المبيعات.** تدفع فقط اشتراكك الثابت المعلن، وتذهب 100% من أرباح مبيعات متجرك إلى حسابك البنكي دون أي استقطاع.

### هل يتم سحب مبالغ من بطاقتي بعد انتهاء التجربة المجانية؟
**لا.** نحن لا نطلب أي بيانات بطاقة ائتمانية عند التسجيل في التجربة المجانية 7 أيام، ولا نستخدم أي سحب آلي. تفعيل الاشتراك يتم حصرياً بالتحويل البنكي المباشر بطلبك.

---

## الفوترة الإلكترونية وهيئة الزكاة (ZATCA) {#compliance-faq}

### هل يدعم الربط متطلبات الفوترة الإلكترونية السعودية؟
نعم. يقوم ERP Link بإنشاء فواتير المبيعات في أودوو متضمنة جميع البيانات الإلزامية لهيئة الزكاة والضريبة والجمارك (الرقم الضريبي للمتجر، ضريبة 15% الصريحة، وتفاصيل البنود والهللات)، مما يسمح لتطبيق الفوترة الإلكترونية المعتمد في أودوو بتوليد رمز الاستجابة السريع (QR Code) وختم الـ XML بنجاح.`,

      en: `## Data Privacy & Encryption {#security-faq}

### Does ERP Link store my customers' credit card information?
**Never.** ERP Link never touches or stores raw credit card numbers or CVV security codes. Payment captures occur entirely within certified store gateways (Moyasar, PayTabs, Tabby, Tamara). We receive only transaction settlement references and confirmation flags.

### How are Odoo API keys and tokens encrypted?
All access tokens and ERP credentials are encrypted at rest using industry-standard **AES-256-GCM** encryption (\`src/lib/crypto.ts\`). Encryption keys are maintained in protected environmental secrets completely separated from source code.

---

## Supported Platforms & Versions {#platform-faq}

### Which Odoo versions are supported?
ERP Link supports all releases from **Odoo 14 through Odoo 20**, including:
* Odoo Online (SaaS on \`odoo.com\`).
* Odoo.sh (Managed cloud hosting).
* Odoo Community & Enterprise on self-hosted instances (AWS, Cloud, on-premise).

### Do I need to install custom third-party modules inside Odoo?
**No.** We connect exclusively through Odoo's native XML-RPC / JSON-RPC APIs. No external modules or modifications are required in your Odoo instance.

---

## Pricing, Trials & Fees {#billing-faq}

### Does ERP Link take transaction commission fees on my sales?
**Zero commission fees.** You pay only your flat subscription rate. 100% of your checkout revenue flows directly to your merchant accounts.

### Will my card be charged after the 7-day trial?
**No.** We never request credit card numbers during trial registration. Continuing with an active plan is settled voluntarily via commercial bank transfer.

---

## E-Invoicing & ZATCA Compliance {#compliance-faq}

### Is ERP Link compatible with Saudi e-invoicing (ZATCA Phase 1 & 2)?
Yes. Sales invoices compiled in Odoo carry complete ZATCA compliance requirements (merchant tax ID, line-level 15% VAT, and halala precision), enabling your installed Odoo e-invoicing solution to generate compliant QR codes and cryptographic XML stamps seamlessly.`,
    },
  },
]
