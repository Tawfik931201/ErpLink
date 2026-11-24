import type { DocArticle } from '../docs-types'

export const articlesOrders: DocArticle[] = [
  {
    slug: 'orders',
    category: 'orders',
    title: {
      ar: 'دورة حياة مزامنة الطلب من المتجر إلى أودوو',
      en: 'Order Synchronization Lifecycle',
    },
    description: {
      ar: 'شرح تفصيلي للمسار الكامل للطلب: استقبال الويب هوك، التحقق المالي، إنشاء أمر البيع، حجز المخزون، وإصدار الفاتورة.',
      en: 'In-depth explanation of end-to-end order sync: webhook ingestion, financial reconciliation, sales order creation, stock delivery, and invoicing.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 7,
    headings: [
      { id: 'end-to-end-pipeline', text: { ar: 'المسار الكامل لمعالجة الطلب', en: 'End-to-End Processing Pipeline' }, level: 2 },
      { id: 'anti-data-loss', text: { ar: 'ضمانات منع فقدان وتكرار الطلبات (Idempotency)', en: 'Anti-Data-Loss & Idempotency Guards' }, level: 2 },
      { id: 'line-items-breakdown', text: { ar: 'معالجة بنود الطلب والشحن والخصومات', en: 'Line Items, Shipping & Discounts' }, level: 2 },
      { id: 'order-state-transitions', text: { ar: 'تتبع حالات الطلب ومراحل اكتماله', en: 'Order State Transitions' }, level: 2 },
    ],
    keywords: ['Orders Pipeline', 'Sales Order', 'Webhooks', 'Idempotency', 'Anti-Data-Loss', 'Odoo Sync'],
    content: {
      ar: `## المسار الكامل لمعالجة الطلب {#end-to-end-pipeline}
يمر كل طلب يتم إجراؤه في متجرك الإلكتروني عبر مسار معالجة محكم وفوري يضمن دقة الأرقام والبيانات:

1. **استقبال الحدث (Webhook Ingestion):**
   عند اكتمال الدفع أو إنشاء الطلب في المتجر، يُرسل المتجر إشعار ويب هوك فوري إلى خادمنا. يتم التحقق من التوقيع الأمني للطلب ثم تسجيله في طابور المعالجة المحمي (\`sync_queue\`).
2. **استخراج البيانات والتدقيق (Payload Enrichment):**
   يقوم المحرك بقراءة بيانات الطلب الأصلية (اسم العميل، رقم الجوال، الأصناف، الأسعار، رسوم الشحن، رسوم الدفع عند الاستلام، وكوبونات الخصم). إذا كان إشعار الويب هوك مختصراً، يستدعي المحرك واجهة المتجر فوراً لجلب التفاصيل الكاملة.
3. **مطابقة العميل والمنتجات:**
   يتم فحص العميل في أودوو وتوحيده برقم الجوال (+966)، ثم مطابقة كل صنف في سلة المشتريات بالرمز الداخلي (SKU) في أودوو.
4. **إنشاء أمر البيع (Sales Order Creation):**
   يُنشئ النظام سجل أمر البيع (\`sale.order\`) في أودوو حاملاً جميع البنود المحسوبة، الضرائب، وملاحظات الطلب.
5. **تنفيذ الإجراءات الإضافية (حسب إعداداتك):**
   * تأكيد أمر البيع (\`action_confirm\`).
   * توليد إذن الصرف المخزني (\`stock.picking\`).
   * إصدار فاتورة العميل (\`account.move\`) وتسجيل قيد الدفع في دفتر اليومية المحدد.
6. **توثيق العملية في السجلات:**
   يتم تحديث حالة العملية في [سجلات المزامنة](/docs/logs) كعملية ناجحة مع ربط رقم الطلب في أودوو.

## ضمانات منع فقدان وتكرار الطلبات (Idempotency) {#anti-data-loss}
يحتوي محرك ERP Link على قواعد أمان صارمة تم اختبارها لمنع أي أخطاء شائعة:
* **مفتاح منع التكرار (Deduplication Key):** يمتلك كل طلب مفتاح بصمة فريد (\`dedup_key\`) مكوناً من معرف المتجر ورقم الطلب. إذا قام المتجر بإعادة إرسال نفس الويب هوك، يتعرف المحرك على وجود الطلب مسبقاً ويتجاهل إعادة الإنشاء منعاً لتكرار الفواتير.
* **حظر كتابة الطلبات الفارغة:** إذا وصل حدث طلب يفتقر إلى بنود المنتجات (Empty Line Items)، يرفض المحرك حفظ أمر بيع فارغ ويقوم فوراً بإعادة جلب الطلب من المتجر بشكل كامل قبل الكتابة في أودوو.

## معالجة بنود الطلب والشحن والخصومات {#line-items-breakdown}
* **رسوم الشحن (Shipping Fees):** يتم إدراج تكلفة التوصيل كبند خدمة مخصص في أمر البيع مع تطبيق ضريبة القيمة المضافة 15% بدقة.
* **رسوم الدفع عند الاستلام (COD Fee):** تُضاف كبند خدمة منفصل لضمان مطابقة إجمالي الفاتورة لما تم تحصيله من العميل.
* **كوبونات الخصم (Discounts):** تُوزع الخصومات على بنود الطلب أو تُدرج كبند خصم سالب لضمان دقة صافي الفاتورة.

## تتبع حالات الطلب ومراحل اكتماله {#order-state-transitions}
يمكنك متابعة انتقال الطلب من خلال شاشات أودوو:
* \`Quotation (مسودة)\` -> \`Sales Order (أمر بيع مؤكد)\` -> \`Invoiced (تمت الفوترة)\` -> \`Delivered (تم التسليم)\`.`,

      en: `## End-to-End Processing Pipeline {#end-to-end-pipeline}
Every checkout on your storefront passes through an automated pipeline into Odoo:

1. **Webhook Ingestion:**
   Upon checkout completion, your store dispatches an instant webhook to ERP Link. The engine verifies security signatures and stages the payload in \`sync_queue\`.
2. **Payload Enrichment:**
   The engine extracts customer details, items, prices, shipping fees, COD surcharges, and discounts. If thin payloads are received, full payloads are fetched via store APIs.
3. **Customer & Product Resolution:**
   The customer is matched by phone (+966), and each line item is resolved by SKU (\`default_code\`) in Odoo.
4. **Sales Order Provisioning:**
   The engine generates a \`sale.order\` record in Odoo containing line items, VAT, and custom reference fields.
5. **Workflow Execution (per settings):**
   * Sales order confirmation (\`action_confirm\`).
   * Stock delivery creation (\`stock.picking\`).
   * Customer invoice generation and payment allocation.
6. **Log Finalization:**
   The transaction is finalized in [Sync Logs](/docs/logs) linking the Odoo order ID.

## Anti-Data-Loss & Idempotency Guards {#anti-data-loss}
ERP Link enforces rigorous safety standards:
* **Idempotency Deduplication Key:** Every order generates a deterministic \`dedup_key\` combining store identity and order ID. Redelivered webhooks are recognized and safely deduplicated.
* **Empty Order Guard:** If a webhook payload lacks line items, the engine refuses to persist an empty order and re-queries the storefront API for full lines.

## Line Items, Shipping & Discounts {#line-items-breakdown}
* **Shipping Fees:** Injected as a dedicated service line item with accurate 15% VAT calculation.
* **COD Surcharges:** Mapped as an auxiliary service fee ensuring invoice total parity.
* **Discounts:** Distributed proportionally across items or booked as discount lines.

## Order State Transitions {#order-state-transitions}
Track order lifecycle directly within Odoo views:
* \`Quotation (draft)\` -> \`Sales Order (sale)\` -> \`Invoiced\` -> \`Delivered\`.`,
    },
  },
  {
    slug: 'inventory',
    category: 'orders',
    title: {
      ar: 'مزامنة المخزون وتعدد المستودعات في أودوو',
      en: 'Inventory & Multi-Warehouse Sync in Odoo',
    },
    description: {
      ar: 'كيفية مزامنة الكميات المتوفرة للبيع (virtual_available)، دعم الفروع المتعددة، ومنع تذبذب تحديثات المخزون بين المتجر وأودوو.',
      en: 'Synchronize available-to-promise inventory quantities, multi-warehouse routing, and inventory oscillation suppression.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 6,
    headings: [
      { id: 'stock-concept', text: { ar: 'مفهوم المخزون المتوفر للبيع مقابل الفعلي', en: 'Forecasted vs. On-Hand Inventory' }, level: 2 },
      { id: 'multi-warehouse-routing', text: { ar: 'تعدد المستودعات وتوجيه الخصم', en: 'Multi-Warehouse Routing' }, level: 2 },
      { id: 'oscillation-suppression', text: { ar: 'منع التذبذب وحلقات التحديث المتكررة', en: 'Oscillation Suppression & Loop Guards' }, level: 2 },
      { id: 'stock-troubleshooting', text: { ar: 'تشخيص فروقات المخزون', en: 'Stock Discrepancy Diagnostics' }, level: 2 },
    ],
    keywords: ['Inventory Sync', 'virtual_available', 'Multi-Warehouse', 'Stock Picking', 'Oscillation Guard', 'Overselling'],
    content: {
      ar: `## مفهوم المخزون المتوفر للبيع مقابل الفعلي {#stock-concept}
من أكبر التحديات التي تواجه المتاجر الإلكترونية هي **البيع الزائد (Overselling)** للبضاعة المحجوزة في طلبات لم تُسلم بعد.

لحل هذه المشكلة، يعتمد ERP Link في مزامنة المخزون على معادلة **الكمية المتوقعة المتوفرة للبيع (Forecasted / Virtual Available)** في أودوو:
$$\\text{الكمية المعروضة في المتجر} = \\text{الكمية الموجودة فعلياً في المستودع} - \\text{الكميات المحجوزة لأوامر البيع الجارية}$$

بذلك، بمجرد تأكيد طلب في المتجر، يتم حجز كميته في أودوو وتحديث رصيد المتجر فوراً بالكمية الحقيقية المتبقية للبيع فقط!

## تعدد المستودعات وتوجيه الخصم {#multi-warehouse-routing}
إذا كان متجرك يدير عدة فروع أو مستودعات (مثال: مستودع الرياض الرئيسي، فرع جدة):
* يمكنك تحديد المستودع الافتراضي لكل متجر في [إعدادات الطلبات](/docs/mapping/orders).
* في منصتي **زد** و**سلة**، يدعم النظام مزامنة أرصدة الفروع المحددة بدقة.
* عند تأكيد أمر بيع صادر من متجر محدد، يتم توجيه إذن الصرف (\`stock.picking\`) تلقائياً إلى موقع التخزين (\`stock.location\`) التابع للمستودع المخصص.

## منع التذبذب وحلقات التحديث المتكررة {#oscillation-suppression}
عندما يتم تحديث المخزون في أودوو وإرساله للمتجر، يقوم المتجر بإطلاق إشعار ويب هوك يفيد بتحديث المنتج. إذا لم تتم معالجة ذلك، قد يدخل النظامان في حلقة تحديث لا نهائية (Infinite Sync Loop).

يحتوي ERP Link على **حارس كبح التذبذب (Oscillation Guard)**:
* يسجل المحرك بصمة آخر رصيد مخزني تم دفعه للمتجر.
* عندما يرسل المتجر ويب هوك تحديث لنفس الرصيد، يتعرف النظام على أن التغيير صادر منه ويتجاهل معالجته بأمان دون إطلاق أي عمليات غير ضرورية.

## تشخيص فروقات المخزون {#stock-troubleshooting}
* **المتجر يظهر كمية غير مطابقة للجرد الفعلي في أودوو:**
  * *الفحص:* افتح شاشة الصنف في أودوو وافحص حقل **الكمية المتوفرة للبيع (Forecasted)** مقابل **الكمية المتوفرة (On Hand)**. إذا كان هناك أمر بيع معلق لم يُلغَ، فإنه يحجز المخزون تلقائياً.`,

      en: `## Forecasted vs. On-Hand Inventory {#stock-concept}
A critical challenge in e-commerce is preventing **overselling** of items reserved by in-progress orders awaiting delivery.

ERP Link synchronizes inventory based on Odoo's authoritative **Forecasted Quantity (\`virtual_available\`)**:
$$\\text{Store Display Quantity} = \\text{Physical On-Hand Quantity} - \\text{Reserved Sales Order Quantities}$$

As a result, as soon as an order confirms, stock reservations deduct immediately from available catalog quantities.

## Multi-Warehouse Routing {#multi-warehouse-routing}
For businesses operating multiple distribution hubs (e.g. Riyadh Central Warehouse, Jeddah Branch):
* Assign default warehouses per storefront in [Order Settings](/docs/mapping/orders).
* For **Zid** and **Salla**, the engine updates branch-level stock balances.
* When sales orders confirm, warehouse delivery pickings (\`stock.picking\`) allocate stock from the designated \`stock.location\`.

## Oscillation Suppression & Loop Guards {#oscillation-suppression}
Pushing an inventory balance from Odoo to your store can trigger an upstream store \`product.update\` webhook, risking an infinite sync loop.

ERP Link implements an automated **Oscillation Guard**:
* Retains a hash of the last transmitted inventory quantity.
* Inbound webhooks reflecting identical values are identified as self-originated echo events and safely ignored.

## Stock Discrepancy Diagnostics {#stock-troubleshooting}
* **Store displays different quantities than Odoo physical on-hand:**
  * *Check:* Inspect Odoo's **Forecasted Quantity** vs. **On Hand**. Unshipped confirmed sales orders reserve units, reducing available store inventory.`,
    },
  },
  {
    slug: 'taxes',
    category: 'orders',
    title: {
      ar: 'الضريبة 15% وحل فوارق الأسعار الشاملة في أودوو',
      en: '15% VAT & Halala Price Parity in Odoo',
    },
    description: {
      ar: 'المعادلات المحاسبية لاستخراج السعر غير الشامل من الأسعار الشاملة لضريبة القيمة المضافة، مطابقة الهللات، وصادرات الصفر الضريبي.',
      en: 'Accounting mechanics for net price extraction from tax-inclusive checkouts, halala rounding parity, and zero-rated exports.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 6,
    headings: [
      { id: 'inclusive-vat-challenge', text: { ar: 'تحدي الأسعار الشاملة وفوارق الهللات', en: 'The Tax-Inclusive Rounding Challenge' }, level: 2 },
      { id: 'mathematical-extraction', text: { ar: 'المعادلة الرياضية لاستخراج السعر الصافي', en: 'Mathematical Net Extraction' }, level: 2 },
      { id: 'invoice-parity-reconciliation', text: { ar: 'تسوية ومطابقة الفاتورة مع سلة المتجر', en: 'Draft Invoice Parity Reconciliation' }, level: 2 },
      { id: 'zero-rated-exports', text: { ar: 'الطلبات الدولية والصادرات المعفاة', en: 'International Orders & Zero-Rated Exports' }, level: 2 },
    ],
    keywords: ['VAT 15%', 'ZATCA', 'Inclusive Tax', 'Tax Parity', 'Halala Rounding', 'Export Tax'],
    content: {
      ar: `## تحدي الأسعار الشاملة وفوارق الهللات {#inclusive-vat-challenge}
في المملكة العربية السعودية، تُلزم الأنظمة التجارية المتاجر الإلكترونية بعرض الأسعار للمستهلك النهائي **شاملة ضريبة القيمة المضافة 15%**.

لكن في أنظمة ERP مثل أودوو، يتم حساب الفواتير افتراضياً بضرب السعر الصافي (غير الشامل) في نسبة الضريبة. يؤدي هذا الاختلاف عند تقريب الكسور العشرية إلى **ظهور فرق هللة واحدة (±0.01 ريال)** بين إجمالي سلة الشراء في المتجر وإجمالي فاتورة أودوو، مما يعطل الفوترة الإلكترونية لدى هيئة الزكاة (ZATCA).

## المعادلة الرياضية لاستخراج السعر الصافي {#mathematical-extraction}
قام فريق هندسة ERP Link بتطوير خوارزمية تسوية دقيقة (\`tests/unit/zid-inclusive-invoice-parity.test.ts\`):
$$\\text{السعر غير الشامل} = \\frac{\\text{إجمالي البند الشامل للضريبة}}{1 + \\text{نسبة الضريبة (0.15)}}$$

يتم حساب السعر الصافي بدقة تصل إلى 4 خانات عشرية، مع تعديل سطر التسوية المالي لضمان أن يكون إجمالي فاتورة أودوو النهائية مطابقاً بالهللة لما دفعه العميل في بوابة الدفع.

## تسوية ومطابقة الفاتورة مع سلة المتجر {#invoice-parity-reconciliation}
عند توليد الفاتورة في أودوو:
1. يتم فحص كل صنف واستخراج وعائه الضريبي.
2. يتم فحص ضريبة الشحن وضريبة رسوم الدفع عند الاستلام.
3. يقوم النظام بقراءة إجمالي الفاتورة ومقارنته بإجمالي المتجر. إذا وجد فرق تقريب (0.01 ريال)، يتم تعديله في سطر تسوية تلقائي دون التأثير على حسابات الأرباح.

## الطلبات الدولية والصادرات المعفاة {#zero-rated-exports}
إذا كان العميل يطلب من خارج المملكة العربية السعودية (شحن دولي):
* يتعرف محرك ERP Link تلقائياً على عنوان الشحن (\`isSaudiShippingAddress\`).
* في حال الشحن الدولي، يتم تطبيق ضريبة الصادرات (ضريبة بنسبة 0%) وفق لوائح هيئة الزكاة والضريبة والجمارك.`,

      en: `## The Tax-Inclusive Rounding Challenge {#inclusive-vat-challenge}
In Saudi Arabia, e-commerce regulations mandate displaying prices **inclusive of 15% VAT** to retail consumers.

However, ERP systems like Odoo standardly compute invoices by multiplying net unit prices by tax percentages. This rounding discrepancy frequently causes a **one-halala variance (±0.01 SAR)** between store checkouts and ERP invoice totals, risking ZATCA compliance rejections.

## Mathematical Net Extraction {#mathematical-extraction}
ERP Link implements an authoritative tax reconciliation algorithm (\`tests/unit/zid-inclusive-invoice-parity.test.ts\`):
$$\\text{Net Unit Price} = \\frac{\\text{Gross Item Price}}{1 + \\text{Tax Rate (0.15)}}$$

Calculated up to 4 decimal precision points, ensuring the final generated Odoo invoice matches customer checkout totals down to the halala.

## Draft Invoice Parity Reconciliation {#invoice-parity-reconciliation}
When compiling customer invoices:
1. Net tax bases are computed across individual line items.
2. Shipping fees and COD surcharges are taxed appropriately.
3. The invoice total is reconciled against the storefront checkout. Fractional 0.01 SAR variances are automatically resolved on adjustment lines.

## International Orders & Zero-Rated Exports {#zero-rated-exports}
For cross-border export shipments:
* The engine evaluates the destination address (\`isSaudiShippingAddress\`).
* Non-domestic deliveries automatically map to export tax configurations (0% Zero-Rated VAT) in compliance with regional tax authority directives.`,
    },
  },
  {
    slug: 'returns',
    category: 'orders',
    title: {
      ar: 'المرتجعات والإشعارات الدائنة واسترجاع المخزون',
      en: 'Returns, Credit Notes & Stock Restock in Odoo',
    },
    description: {
      ar: 'دليل معالجة طلبات الإرجاع في المتجر، إصدار الإشعارات الدائنة (Credit Notes)، استرجاع المخزون السليم، وضمان عدم التكرار.',
      en: 'Handle store return webhooks, automate customer credit notes, restock inventory pickings, and prevent duplicate refunds.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 7,
    headings: [
      { id: 'return-policies-overview', text: { ar: 'خيارات وسياسات المرتجعات في مركز الخرائط', en: 'Return Policies in Mapping Center' }, level: 2 },
      { id: 'zid-salla-returns', text: { ar: 'آلية معالجة المرتجع في زد وسلة', en: 'Return Processing in Zid & Salla' }, level: 2 },
      { id: 'credit-notes-in-odoo', text: { ar: 'إنشاء الإشعارات الدائنة في أودوو (Credit Notes)', en: 'Generating Credit Notes in Odoo' }, level: 2 },
      { id: 'returns-troubleshooting', text: { ar: 'التحقق ومنع الأخطاء في المرتجعات', en: 'Return Verification & Diagnostics' }, level: 2 },
    ],
    keywords: ['Returns', 'Credit Note', 'out_refund', 'Stock Reversal', 'Refunds', 'Zid Returns', 'Salla Returns'],
    content: {
      ar: `## خيارات وسياسات المرتجعات في مركز الخرائط {#return-policies-overview}
يتيح لك ERP Link اختيار السياسة التي تناسب نموذج عمل متجرك عند تسجيل طلب إرجاع في المتجر:

| خيار السياسة في الواجهة | الإجراء المنفذ في أودوو | متى يُفضل استخدامه؟ |
|---|---|---|
| **عدم اتخاذ أي إجراء (Nothing)** | لا يقوم النظام بأي تعديل في أودوو | إذا كنت تفضل إدارة المرتجعات يدوياً بالكامل في المحاسبة |
| **استرجاع المخزون فقط (Stock Return Only)** | إنشاء إذن استلام مخزني عكسي (\`reverse picking\`) | للمتاجر التي تقوم باستبدال المنتجات دون رد المبالغ |
| **إشعار دائن فقط (Credit Note Only)** | إصدار إشعار دائن (\`account.move\` من نوع \`out_refund\`) | عند استرداد المبلغ للعميل مع تلف البضاعة أو عدم إعادتها |
| **مخزون وإشعار دائن (Stock & Credit Note)** | استرجاع البضاعة للمستودع وإصدار إشعار دائن مالي معاً | السياسة الكاملة الأكثر شيوعاً للمرتجعات السليمة |

## آلية معالجة المرتجع في زد وسلة {#zid-salla-returns}
* **في متجر زد (Zid):** عند تغيير حالة الطلب إلى \`returned\` أو استلام حدث طلب الإرجاع العكسي، يفحص المحرك كميات البنود المسترجعة ويربطها بأمر البيع الأصلي.
* **في متجر سلة (Salla):** عند تنفيذ استرداد مالي جزئي أو كلي، يستقبل المحرك حدث \`order.refunded\` ويقرأ مصفوفة \`refunded_items\` لإصدار إشعار دائن للبنود المحددة فقط.
* **في متجر شوبيفاي (Shopify):** أحداث \`refunds/create\` غير مفعلة حالياً في الكود ويتم تخطيها في السجلات.

## إنشاء الإشعارات الدائنة في أودوو (Credit Notes) {#credit-notes-in-odoo}
عند تطبيق سياسة الإشعار الدائن:
1. يبحث النظام عن الفاتورة الأصلية المرتبطة بأمر البيع.
2. يُنشئ إشعاراً دائناً (\`account.move\` بنوع \`out_refund\`) يحمل الأصناف المسترجعة والضرائب المطابقة.
3. يتم إدراج رقم مرجع طلب الإرجاع في المتجر لتسهيل المراجعة وتدقيق الحسابات.

## التحقق ومنع الأخطاء في المرتجعات {#returns-troubleshooting}
* **منع الإرجاع المكرر:** يحفظ المحرك بصمة فريدة لعملية الإرجاع (\`return_key\`). إذا أرسل المتجر أكثر من تنبيه لنفس المرتجع، يتم تجاهل التكرار لمنع خصم مبالغ مكررة.
* **خطأ "Original Invoice Not Found":**
  * *السبب:* لم تكن الفاتورة الأصلية قد صدرت في أودوو عند حدوث المرتجع.
  * *الحل:* تأكد من تفعيل "إنشاء الفواتير تلقائياً" للطلبات، أو أصدر الفاتورة الأصلية يدوياً في أودوو قبل إعادة محاولة المرتجع.`,

      en: `## Return Policies in Mapping Center {#return-policies-overview}
Configure return behaviors directly within your [Orders Mapping](/docs/mapping/orders) tab:

| UI Policy Option | Action Executed in Odoo | When to Use? |
|---|---|---|
| **Nothing** | No changes in Odoo | When returns are handled purely manually |
| **Stock Return Only** | Generates reverse picking (\`reverse picking\`) | For product exchanges where no refund is credited |
| **Credit Note Only** | Issues customer credit note (\`out_refund\`) | When customer is refunded for damaged goods not returned |
| **Stock & Credit Note** | Both restocks warehouse and issues credit note | Standard comprehensive policy for resalable items |

## Return Processing in Zid & Salla {#zid-salla-returns}
* **Zid Integration:** Listens for \`returned\` status transitions and reverse logistics labels, mapping returned quantities back to the initial sales order.
* **Salla Integration:** Ingests \`order.refunded\` webhooks, extracting the \`refunded_items\` array to build partial or full credit notes.
* **Shopify Integration:** \`refunds/create\` events currently resolve to null and are skipped.

## Generating Credit Notes in Odoo {#credit-notes-in-odoo}
When a credit note is triggered:
1. Locates the posted customer invoice associated with the sales order.
2. Provisions a credit note (\`account.move\` of type \`out_refund\`) carrying matching tax proportions.
3. Tags store return reference IDs in remarks for auditable bookkeeper reconciliation.

## Return Verification & Diagnostics {#returns-troubleshooting}
* **Duplicate Return Suppression:** Stores unique transaction signatures (\`return_key\`) to prevent repeated credit note postings during redundant webhooks.
* **"Original Invoice Not Found":**
  * *Cause:* Return received before the customer invoice was generated in Odoo.
  * *Resolution:* Ensure automatic invoice creation is active, or validate the original invoice in Odoo before retrying the return.`,
    },
  },
]
