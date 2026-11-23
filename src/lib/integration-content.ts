export type IntegrationPlatform = 'zid' | 'salla' | 'shopify'
export type SiteLanguage = 'ar' | 'en'

type Bilingual = { ar: string; en: string }
type Topic = { title: Bilingual; text: Bilingual }
type Question = { question: Bilingual; answer: Bilingual }

export type IntegrationDetails = {
  platformName: string
  title: Bilingual
  summary: Bilingual
  audience: Bilingual
  sections: Topic[]
  preparation: Topic[]
  questions: Question[]
}

export const integrations: Record<IntegrationPlatform, IntegrationDetails> = {
  zid: {
    platformName: 'Zid',
    title: {
      ar: 'ربط زد بأودوو Odoo: الطلبات والمخزون والعملاء',
      en: 'Zid Odoo Integration: Orders, Inventory & Customers',
    },
    summary: {
      ar: 'هل تدير متجر زد وعملياتك المحاسبية والمخزون على أودوو؟ تعرّف على ما يجب ضبطه قبل الربط، وكيف تتابع المزامنة وتتجنب تكرار الطلبات واختلاف الضرائب.',
      en: 'Running a Zid store with Odoo for accounting and inventory? Understand the data flow, the settings to review, and how to test orders, taxes and returns before going live.',
    },
    audience: {
      ar: 'مناسب لفرق التشغيل التي تستخدم زد للبيع وأودوو لإدارة الطلبات والمخزون والفواتير، وتريد تقليل الإدخال اليدوي دون فقدان القدرة على مراجعة العمليات.',
      en: 'For operations teams selling on Zid and managing orders, stock and invoices in Odoo, who need less manual re-entry and better visibility into synchronization.',
    },
    sections: [
      { title: { ar: 'نقل الطلبات دون ازدواج', en: 'Keep orders consistent across both systems' }, text: { ar: 'ابدأ بتحديد رقم الطلب المرجعي وطريقة مطابقة العميل والمنتجات. عند وصول حدث من زد، راقب إنشاء أمر البيع في أودوو وفق قواعد الربط، وتحقق من عدم إنشاء نسخة ثانية عند تكرار الإشعار.', en: 'Start with order references and customer/product matching. When Zid sends an order event, check the Odoo sales order against your mapping rules and verify retries do not create duplicates.' } },
      { title: { ar: 'الضرائب والشحن وطرق الدفع', en: 'Taxes, shipping and payment mapping' }, text: { ar: 'احسم أولًا هل سعر المنتج في أودوو شامل ضريبة القيمة المضافة أم غير شاملها. اربط رسوم التوصيل وطريقة الدفع بالحسابات والإعدادات المناسبة، ثم طابق إجمالي أمر البيع والفاتورة قبل الاعتماد.', en: 'Decide whether Odoo product prices include VAT. Map delivery charges and payment methods deliberately, then reconcile sales-order amounts with invoices before enabling automated fulfillment.' } },
      { title: { ar: 'المخزون والمنتجات', en: 'Products and stock availability' }, text: { ar: 'طابق SKU والمتغيرات مع أصناف أودوو وحدد المستودع ومصدر الكمية. اختبر تحديث مخزون منتج واحد أولًا، ثم راقب انعكاس التغيير في النظام الآخر وفق اتجاه المزامنة الذي اخترته.', en: 'Match SKUs and variants to Odoo products, then choose the warehouse and stock source. Test one stock change first and inspect the direction of updates configured in your integration.' } },
      { title: { ar: 'المرتجعات الجزئية والكاملة', en: 'Partial and full refunds' }, text: { ar: 'المرتجع ليس مجرد تغيير حالة. اختبر إرجاع بند واحد، وإرجاع طلب كامل، وتأثير كل منهما على الكمية والفاتورة والإشعارات في أودوو. قد تختلف الخطوات باختلاف إعداداتك المحاسبية.', en: 'A return is more than a status change. Test one returned line and a full order return, including quantities, invoice adjustments and Odoo notifications. Accounting behavior depends on configuration.' } },
    ],
    preparation: [
      { title: { ar: 'جهّز الوصول والصلاحيات', en: 'Prepare access and permissions' }, text: { ar: 'تأكد من صلاحيات متجر زد وبيانات اتصال أودوو، وحدد الشركة والمستودع اللذين ستستخدمهما.', en: 'Verify Zid permissions and Odoo connection credentials; select the company and warehouse involved.' } },
      { title: { ar: 'راجع الحقول الأساسية', en: 'Review field mappings' }, text: { ar: 'راجع SKU والعميل والضريبة والشحن وطرق الدفع وحالات الطلب والمرتجع في مركز الربط.', en: 'Review SKUs, customer matching, taxes, shipping, payment methods, order statuses and return states.' } },
      { title: { ar: 'اختبر ثم فعّل', en: 'Test before rollout' }, text: { ar: 'ابدأ بطلب تجريبي، ثم الإكمال ثم المرتجع الجزئي؛ تأكد من سجلات العمليات والطابور قبل توسيع التشغيل.', en: 'Start with a test order, a completion event and a partial return. Inspect logs and queue outcomes before wider rollout.' } },
    ],
    questions: [
      { question: { ar: 'هل يمكن ربط زد بأودوو دون إعادة إدخال الطلبات يدويًا؟', en: 'Can I connect Zid to Odoo without manually re-entering orders?' }, answer: { ar: 'يهدف التكامل إلى نقل بيانات الطلبات تلقائيًا حسب الإعدادات والصلاحيات المتاحة. قبل تشغيله فعليًا، تحقق من مطابقة المنتجات والعملاء والضرائب على طلب تجريبي.', en: 'The integration is designed to transfer order data according to configured rules and permissions. Validate product, customer and tax mapping with a test order first.' } },
      { question: { ar: 'هل يزامن الربط مخزون زد مع أودوو؟', en: 'Can Zid stock be synchronized with Odoo?' }, answer: { ar: 'يمكن إعداد تدفقات المخزون وفق الإعدادات المتاحة. حدد اتجاه المزامنة والمستودع والمنتجات المطابقة ثم اختبر تعديل كمية صغيرة قبل الاعتماد.', en: 'Stock flows depend on your integration settings. Confirm the synchronization direction, warehouse and product match before testing a small quantity change.' } },
      { question: { ar: 'ماذا عن مرتجعات زد والضرائب؟', en: 'What about Zid returns and tax handling?' }, answer: { ar: 'تحتاج المرتجعات والضريبة إلى ضبط صريح بحسب حالات الطلب وطريقة تسعير أودوو. راجع سيناريوهات الإرجاع الجزئي والكامل قبل تفعيل المعالجة الآلية.', en: 'Returns and tax calculations need explicit status and pricing configuration. Verify partial and full return scenarios before automating accounting actions.' } },
    ],
  },
  salla: {
    platformName: 'Salla',
    title: {
      ar: 'ربط سلة بأودوو Odoo: مزامنة المتجر مع ERP',
      en: 'Salla Odoo Integration: Connect Store Operations',
    },
    summary: {
      ar: 'اربط عمليات متجر سلة بنظام أودوو مع خطة واضحة لمطابقة المنتجات والطلبات والمخزون. تعرف على نقاط الفحص قبل بدء استقبال بيانات المتجر في ERP.',
      en: 'Plan a Salla–Odoo connection around product matching, order handling and inventory controls. Learn what to check before enabling automated store-to-ERP workflows.',
    },
    audience: {
      ar: 'للتجار الذين يديرون المبيعات على سلة ويريدون سجل تشغيل موحدًا في أودوو مع قواعد واضحة للعميل والمخزن والضرائب.',
      en: 'For merchants selling through Salla and managing operational records in Odoo with explicit customer, warehouse and tax rules.',
    },
    sections: [
      { title: { ar: 'مزامنة الطلبات وحالاتها', en: 'Orders and status transitions' }, text: { ar: 'حدد أي حالة في سلة تؤدي إلى إنشاء أمر بيع أو تأكيده أو فوترته في أودوو. لا تفترض أن انتقال الحالة يعني إنشاء فاتورة تلقائيًا؛ اختبر الإعداد لكل سيناريو.', en: 'Decide which Salla order statuses create, confirm or invoice a sale in Odoo. Status changes do not imply automatic invoicing unless configured and tested.' } },
      { title: { ar: 'مطابقة الأصناف والخيارات', en: 'Match products and variants' }, text: { ar: 'افحص أكواد SKU وخيارات المنتجات ومخزون كل مستودع. اختلاف رمز الصنف أو التعامل مع المتغيرات من أكثر أسباب عدم دقة الكميات في أي مشروع ربط.', en: 'Audit SKUs, variants and warehouse-specific stock. Identifier mismatches and variant handling are common causes of inventory inconsistencies in integrations.' } },
      { title: { ar: 'التوصيل والضريبة', en: 'Shipping, VAT and totals' }, text: { ar: 'راجع كيفية تسجيل تكلفة التوصيل والخصومات والضريبة داخل أودوو. طابق الإجماليات بين الطلب المصدر وأمر البيع والفاتورة الناتجة.', en: 'Review delivery fees, discounts and VAT representation in Odoo. Reconcile the source order total with the resulting sales order and invoice.' } },
      { title: { ar: 'التحقق من فشل العمليات', en: 'Operational visibility' }, text: { ar: 'استخدم سجلات المزامنة والطابور لمعرفة ما نجح وما يحتاج إعادة محاولة أو تعديل إعدادات. وضع قواعد للفشل أهم من مجرد نجاح أول طلب.', en: 'Use synchronization logs and queues to understand successes, retries and mapping failures. Handling failure cases matters as much as a first successful order.' } },
    ],
    preparation: [
      { title: { ar: 'حدد قناة البيع والمستودع', en: 'Pick the sales channel and warehouse' }, text: { ar: 'جهز وصول سلة وأودوو وحدد الشركة والمخزن المقصودين بالربط.', en: 'Prepare the required access for Salla and Odoo and choose the intended Odoo company and warehouse.' } },
      { title: { ar: 'طابق الضرائب والشحن', en: 'Check VAT and shipping rules' }, text: { ar: 'اختبر طلبًا يشمل ضريبة وشحنًا وخصمًا إن وجد لمقارنة المبالغ في النظامين.', en: 'Test an order containing VAT, shipping and a discount where applicable, then compare both systems.' } },
      { title: { ar: 'اختبر تغيير الحالة', en: 'Test status updates' }, text: { ar: 'غيّر حالة طلب تجريبي ثم تحقق مما حدث في الفاتورة والمخزون داخل أودوو.', en: 'Change a sample order status and verify its invoice and stock effects inside Odoo.' } },
    ],
    questions: [
      { question: { ar: 'كيف أربط متجر سلة بنظام أودوو؟', en: 'How can I connect a Salla store to Odoo?' }, answer: { ar: 'ابدأ بتجهيز الصلاحيات، ثم إعداد الربط ومطابقة المنتجات والعملاء وحالات الطلب، وبعدها تحقق من دورة طلب كاملة قبل التشغيل.', en: 'Prepare access, configure matching for products/customers and order statuses, then validate a complete order lifecycle before rollout.' } },
      { question: { ar: 'هل يمكن مزامنة المنتجات والمخزون؟', en: 'Can products and inventory be synchronized?' }, answer: { ar: 'تختلف خيارات النقل والاتجاه بحسب إعدادات التكامل. تحقق من أكواد الأصناف ومصدر المخزون قبل تشغيل تغييرات واسعة النطاق.', en: 'Available directions depend on the chosen integration settings. Validate identifiers and the stock source before making broad updates.' } },
      { question: { ar: 'هل يجب تعديل نظام أودوو نفسه؟', en: 'Do I have to change Odoo itself?' }, answer: { ar: 'تعتمد المتطلبات على إعدادات أودوو والصلاحيات والوظائف المطلوبة. احصر المتطلبات أولًا ولا تفترض أن كل تكامل يحتاج موديولًا جديدًا.', en: 'Requirements depend on Odoo configuration, permissions and desired workflows. Confirm them rather than assuming every connection requires a new Odoo module.' } },
    ],
  },
  shopify: {
    platformName: 'Shopify',
    title: {
      ar: 'ربط شوبيفاي بأودوو Odoo: الطلبات والمنتجات والمخزون',
      en: 'Shopify Odoo Integration: Orders, Products & Inventory',
    },
    summary: {
      ar: 'لمن يدير متجر Shopify ويستخدم أودوو: تعرّف على تدفقات البيانات المطلوبة وصلاحيات التطبيق وأحداث الطلبات وأخطاء المطابقة التي يجب مراقبتها.',
      en: 'For Shopify merchants using Odoo: learn how to plan the data flow, app permissions, order events and inventory matching before enabling sync.',
    },
    audience: {
      ar: 'لمتاجر Shopify التي تحتاج ربط بيانات المنتجات والعملاء والطلبات بنظام أودوو دون فقدان تتبع الأحداث والتغييرات.',
      en: 'For Shopify stores that need traceable product, customer and order flows into Odoo.',
    },
    sections: [
      { title: { ar: 'صلاحيات Shopify وأحداث Webhook', en: 'Shopify permissions and webhooks' }, text: { ar: 'ابدأ بصلاحيات التطبيق اللازمة للوظائف التي ستستخدمها. تحقق من وصول أحداث إنشاء الطلب وتحديثه، ولا تعتبر تثبيت التطبيق وحده دليلًا على نجاح المزامنة.', en: 'Request only the scopes needed by enabled features. Verify order creation and update webhook delivery; installation alone does not prove synchronization works.' } },
      { title: { ar: 'المنتجات والمتغيرات', en: 'Products and variants' }, text: { ar: 'طابق SKU ومعرّف المتغير والكمية وموقع المخزون مع سجلات أودوو. اختبر منتجًا متعدد الخيارات حتى لا تختلط كميات المتغيرات.', en: 'Match SKUs, variant identifiers, stock quantities and locations to Odoo. Test a multi-variant product so quantities do not get mixed.' } },
      { title: { ar: 'المدفوعات والتنفيذ', en: 'Payments and fulfillment' }, text: { ar: 'فرق بين حالة الدفع وحالة التجهيز أو الشحن في Shopify. حدد سلوك أودوو لكل حالة على حدة بدل الربط المباشر بين كل تحديث وفاتورة جديدة.', en: 'Keep Shopify payment status separate from fulfillment status. Map each event to explicit Odoo actions instead of creating a new invoice for every update.' } },
      { title: { ar: 'الإلغاء والمرتجع', en: 'Cancellations and returns' }, text: { ar: 'اختبر إلغاء طلب غير منفذ، ثم استرجاع عنصر من طلب منفذ، وتحقق من أثره على المخزون والقيد المالي وفق قواعد أودوو.', en: 'Test canceling an unfulfilled order and returning one fulfilled item. Verify the inventory and financial outcomes according to your Odoo policies.' } },
    ],
    preparation: [
      { title: { ar: 'راجع صلاحيات التطبيق', en: 'Review access scopes' }, text: { ar: 'تأكد من صلاحيات قراءة الطلبات والمنتجات والعملاء المطلوبة حسب وظائف المتجر.', en: 'Verify the required order, product and customer read permissions for the features in use.' } },
      { title: { ar: 'اربط المتغيرات والمواقع', en: 'Match variants and locations' }, text: { ar: 'راجع SKU والمستودعات ومواقع المخزون قبل أي مزامنة واسعة.', en: 'Check product identifiers and stock locations before bulk synchronization.' } },
      { title: { ar: 'راقب أحداث الطلب', en: 'Observe event handling' }, text: { ar: 'اختبر إنشاء الطلب ثم الدفع ثم الإلغاء أو المرتجع، وتابع النتائج بسجل العمليات.', en: 'Test order creation, payment and cancellation or returns, then inspect the operation logs.' } },
    ],
    questions: [
      { question: { ar: 'هل يكفي تثبيت التطبيق في Shopify لبدء ربط أودوو؟', en: 'Is installing the Shopify app enough to sync with Odoo?' }, answer: { ar: 'لا؛ يلزم ربط أودوو وتحديد الخرائط والصلاحيات واختبار وصول أحداث الطلبات.', en: 'No. You also need an Odoo connection, configured mappings, appropriate scopes and working webhooks.' } },
      { question: { ar: 'كيف أتأكد من عدم تكرار الطلبات؟', en: 'How can I avoid duplicate orders?' }, answer: { ar: 'راجع المعرّف المرجعي للطلب وأعد اختبار وصول نفس الحدث أكثر من مرة، ثم افحص أن سجل أودوو لا يتكرر.', en: 'Validate the source order reference and repeat delivery of a test event, then confirm Odoo does not create duplicates.' } },
      { question: { ar: 'ما الفرق بين حالة الدفع وحالة الشحن؟', en: 'What is the difference between payment and fulfillment status?' }, answer: { ar: 'حالة الدفع تعبر عن تحصيل المبلغ، بينما حالة التنفيذ تتبع تجهيز وتسليم البضاعة؛ ويجب أن تحدد قواعد أودوو لكل منهما.', en: 'Payment status tracks money collected; fulfillment status tracks goods processed or shipped. Configure the corresponding Odoo behavior separately.' } },
    ],
  },
}
