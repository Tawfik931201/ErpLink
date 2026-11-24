import type { DocArticle } from '../docs-types'

export const articlesOperations: DocArticle[] = [
  {
    slug: 'logs',
    category: 'operations',
    title: {
      ar: 'سجلات المزامنة وتفاصيل الأخطاء والحل اليدوي',
      en: 'Sync Logs, Error Inspection & Manual Resolution',
    },
    description: {
      ar: 'كيفية مراجعة سجلات المزامنة، التمييز بين Success و Failed و Skipped، قراءة تفاصيل الأخطاء، وإعادة المحاولة بضغطة زر.',
      en: 'Inspect sync logs, understand Success vs. Failed vs. Skipped states, read JSON error traces, and retry operations.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 7,
    headings: [
      { id: 'logs-overview', text: { ar: 'واجهة سجلات المزامنة وتصميمها السريع', en: 'Sync Logs UI Architecture' }, level: 2 },
      { id: 'log-statuses', text: { ar: 'معاني حالات السجل (Success / Failed / Skipped)', en: 'Log Status Definitions' }, level: 2 },
      { id: 'detail-modal', text: { ar: 'نافذة تفاصيل السجل وحمولة البيانات (JSON)', en: 'Log Detail Modal & Payload Viewer' }, level: 2 },
      { id: 'retry-and-resolve', text: { ar: 'إعادة المحاولة والحل اليدوي (Resolve Manually)', en: 'Manual Retry & Resolve Actions' }, level: 2 },
    ],
    keywords: ['Sync Logs', 'Failed', 'Skipped', 'Retry', 'Payload', 'Resolve Manually', 'Error Trace'],
    content: {
      ar: `## واجهة سجلات المزامنة وتصميمها السريع {#logs-overview}
توفر شاشة **سجلات المزامنة (Sync Logs)** (\`/app/logs\`) سجلاً تدقيقياً كاملاً وفورياً لجميع العمليات المتبادلة بين متجرك ونظام أودوو.

صُممت واجهة السجلات لتكون فائقة السرعة والخفة:
* **عرض أودوو المدمج (Odoo-Style List):** يعرض الأعمدة الأساسية فقط (الوقت، المنصة، نوع العملية، معرف السجل، والحالة).
* **استبعاد الحمولات الثقيلة:** تستبعد القائمة الرئيسية حمولات البيانات الضخمة ونصوص الأخطاء الطويلة، حيث تُجلب فقط عند النقر على السجل لعرض تفاصيله (\`getSyncLogById\`)، مما يحافظ على سرعة استجابة الصفحة حتى مع وجود مئات آلاف السجلات.

## معاني حالات السجل (Success / Failed / Skipped) {#log-statuses}
* **ناجحة (Success - أخضر):** تمت معالجة العملية بنجاح في أودوو (تم إنشاء أو تعديل أمر البيع، إذن التسليم، أو الفاتورة).
* **فاشلة (Failed - أحمر):** حدث خطأ أثناء المعالجة (مثل: فشل الاتصال بأودوو، عدم توفر المنتج في أودوو، أو خطأ محاسبي). تتطلب هذه الحالة مراجعة سبب الخطأ ثم إعادة المحاولة.
* **تم التخطي (Skipped - رمادي / أصفر):** لم يقم النظام بأي تعديل في أودوو عمداً بناءً على قواعد العمل (مثل: وصول حدث غير مفعّل في الإعدادات، أو طلب مكرر تم حمايته بمفتاح منع التكرار).

## نافذة تفاصيل السجل وحمولة البيانات (JSON) {#detail-modal}
عند النقر على أي سطر في جدول السجلات:
1. تفتح نافذة تفاصيل منبثقة أو صفحة تفصيلية (\`/app/logs/[id]\`).
2. **معلومات العملية:** المنصة، الحدث، معرف مساحة العمل، وتاريخ التنفيذ الدقيق.
3. **تفاصيل السجل المنشأ:** يعرض رقم أمر البيع أو الفاتورة في أودوو (مع رابط مباشر عند توفره).
4. **رسالة الخطأ ومسار التتبع (Error Stack Trace):** في العمليات الفاشلة، يُعرض نص الخطأ التقني الدقيق الصادر من أودوو أو المتجر لتسهيل تشخيصه.
5. **حمولة الويب هوك الأصلية (Raw Payload JSON):** عارض بيانات منسق يمكنك من نسخ حزمة البيانات الكاملة التي أرسلها المتجر لأغراض الفحص والتدقيق.

## إعادة المحاولة والحل اليدوي (Resolve Manually) {#retry-and-resolve}
عند ظهور سجل فاشل (Failed)، توفر الواجهة خيارين تنفيذيين:

### 1. إعادة المحاولة الفورية (Retry Sync):
* اضغط على زر **إعادة المحاولة (Retry)**.
* يقوم الخادم بإعادة إرسال نفس حمولة البيانات الأصلية عبر محرك المزامنة وتنفيذها مجدداً في أودوو.
* يُستخدم هذا الخيار بعد قيامك بحل سبب المشكلة في أودوو (مثل: إضافة الـ SKU الناقص، أو إصلاح خادم أودوو).

### 2. الحل اليدوي (Resolve Manually):
* اضغط على زر **تم الحل يدوياً (Mark as Resolved)**.
* يُستخدم هذا الخيار إذا قمت بإدخال الطلب يدوياً في أودوو وترغب في إزالة التنبيه من السجلات لمنع تكرار معالجته لاحقاً.`,

      en: `## Sync Logs UI Architecture {#logs-overview}
The **Sync Logs** view (\`/app/logs\`) provides an auditable, real-time ledger of every operation processed between your store and Odoo.

Designed for ultra-fast, lightweight performance:
* **Odoo-Style Borderless Table:** Displays core columns (Timestamp, Platform, Operation, Entity ID, and Status).
* **Lean List Fetch:** Multi-kilobyte JSON payloads and detailed stack traces are omitted from the list view query (\`getSyncLogs({ lean: true })\`) and fetched strictly upon clicking a record (\`getSyncLogById\`), keeping the UI lightning fast even with hundreds of thousands of records.

## Log Status Definitions {#log-statuses}
* **Success (Green):** Successfully committed in Odoo (Sales order created, stock delivery validated, or invoice posted).
* **Failed (Red):** Processing interrupted by an error (e.g. Odoo RPC timeout, missing SKU, or tax mismatch). Requires inspection and retry.
* **Skipped (Gray / Amber):** Operation was intentionally bypassed per configuration rules (e.g. an unmapped event topic, or an already-synced duplicate idempotently ignored).

## Log Detail Modal & Payload Viewer {#detail-modal}
Clicking any log row opens a dedicated detail view (\`/app/logs/[id]\`):
1. **Transaction Metadata:** Platform, trigger event, workspace ID, and exact timestamp.
2. **Linked ERP Records:** Direct display of the created Odoo Sales Order or Invoice ID.
3. **Error Stack Trace:** For failed logs, presents the exact technical error message returned by Odoo RPC.
4. **Raw JSON Payload Viewer:** A formatted JSON inspector allowing you to inspect or copy the exact webhook payload dispatched by your storefront.

## Manual Retry & Resolve Actions {#retry-and-resolve}
For failed operations, two primary recovery actions are available:

### 1. Instant Retry (Retry Sync):
* Click **Retry Sync**.
* The server pushes the original payload through the sync engine for re-execution in Odoo.
* Use this after resolving the underlying condition in Odoo (e.g. adding the missing SKU to the catalog).

### 2. Resolve Manually (Mark as Resolved):
* Click **Mark as Resolved**.
* Use this if you manually booked the transaction inside Odoo and wish to clear the alert state without re-running automated execution.`,
    },
  },
  {
    slug: 'queue',
    category: 'operations',
    title: {
      ar: 'طابور العمليات والجدولة الذكية وإعادة المحاولة',
      en: 'Processing Queue, Fair Scheduling & Retries',
    },
    description: {
      ar: 'فهم طابور العمليات (Queue): مراحل التنفيذ، آلية القفل الذري، العزل العادل بين المتاجر، والحجر الصحي للعمليات غير المؤكدة.',
      en: 'Understand the Processing Queue: execution stages, atomic wave claiming, fair-share round robin, and dead-letter quarantine.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 7,
    headings: [
      { id: 'why-queue', text: { ar: 'لماذا نستخدم طابور العمليات (Durable Queue)؟', en: 'Why Use a Durable Queue?' }, level: 2 },
      { id: 'queue-tabs', text: { ar: 'تبويبات وحالات عناصر الطابور', en: 'Queue Tabs & Lifecycle States' }, level: 2 },
      { id: 'wave-claiming', text: { ar: 'المعالجة المتوازية والقفل الذري العادل', en: 'Atomic Wave Claiming & Fair-Share' }, level: 2 },
      { id: 'quarantine-and-circuit', text: { ar: 'الحجر الصحي وقاطع الدائرة عند تعطل الخوادم', en: 'Quarantine & Circuit Breakers' }, level: 2 },
    ],
    keywords: ['Queue', 'Pending', 'Frozen', 'Wave Claiming', 'Retry Backoff', 'Circuit Breaker', 'Dead Letter'],
    content: {
      ar: `## لماذا نستخدم طابور العمليات (Durable Queue)؟ {#why-queue}
في مواسم التخفيضات الكبرى (مثل يوم التأسيس أو الجمعة البيضاء)، قد يستقبل متجرك مئات الطلبات في الدقيقة الواحدة. إذا حاول النظام إرسال مئات الطلبات متزامنة إلى خادم أودوو في نفس الثانية، فقد ينهار خادم أودوو بسبب نفاد الذاكرة.

لحل هذه المشكلة، يستقبل ERP Link جميع الويب هوكس ويحفظها في **طابور عمليات متين (Durable Queue)** (\`/app/queue\`)، ثم يقوم بجدولة ومعالجة الطلبات بتدفق متوازن ومحمي دون فقدان أي طلب.

## تبويبات وحالات عناصر الطابور {#queue-tabs}
تحتوي شاشة الطابور على 4 تبويبات رئيسية:
* **قيد الانتظار (Pending):** العمليات الجاهزة للتنفيذ والتي تنتظر دورها في المعالجة.
* **قيد المعالجة (Processing):** العمليات التي تم قفلها حالياً وجارٍ تنفيذ نداءات XML-RPC الخاصة بها في أودوو.
* **المتجمدة / المعلقة (Frozen / Failed):** العمليات التي واجهت خطأ مؤقتاً (مثل انقطاع شبكة أودوو)، وتنتظر انتهاء فترة التهدئة (Backoff) قبل إعادة المحاولة التلقائية.
* **الأيتام / المنتهية (Orphans / Dead Letter):** العمليات التي استنفدت كامل محاولات الإعادة المسموحة، أو العمليات غير مؤكدة النتيجة، حيث يتم حجرها لحين مراجعتها بأمان من قبل المسؤول.

## المعالجة المتوازية والقفل الذري العادل {#wave-claiming}
يعتمد محرك الطابور على آليات حماية متقدمة (\`src/lib/queue/\`):
* **القفل الذري (Atomic Wave Claiming):** تمنع قفل نفس السجل من قبل معالجين اثنين في نفس الوقت.
* **العدالة في التوزيع (Fair-Share Round Robin):** إذا كان لدى متجر 10,000 طلب معلق، ومتجر آخر لديه طلب واحد فقط، يضمن النظام معالجة طلب المتجر الثاني دون الحاجة لانتظار انتهاء الـ 10,000 طلب كاملة.

## الحجر الصحي وقاطع الدائرة عند تعطل الخوادم {#quarantine-and-circuit}
* **قاطع الدائرة (Circuit Breaker):** إذا تكرر فشل الاتصال بخادم أودوو 5 مرات متتالية بسبب توقف الخادم، يقوم النظام تلقائياً بتجميد سحب طلبات هذا المتجر مؤقتاً لمنع إرهاق خادمك، ويرسل لك تنبيهاً فورياً.
* **حجر العمليات غير المؤكدة:** إذا أرسل النظام أمراً إلى أودوو ولكن انقطع الاتصال قبل استلام الرد، لا يقوم النظام بإعادة الإرسال عشوائياً، بل يحجر العملية حتى يتأكد أولاً من عدم إنشاء الطلب في أودوو منعاً للتكرار.`,

      en: `## Why Use a Durable Queue? {#why-queue}
During flash sales and holiday shopping peaks, stores often process hundreds of orders per minute. Blasting these orders simultaneously into an Odoo instance would overwhelm Odoo server memory and trigger gateway timeouts.

To prevent outages, ERP Link immediately admits webhooks into a **Durable Queue** (\`/app/queue\`), metering execution with regulated concurrency and anti-starvation guarantees.

## Queue Tabs & Lifecycle States {#queue-tabs}
The queue UI features 4 primary tabs:
* **Pending:** Tasks queued and awaiting execution slots.
* **Processing:** Tasks currently leased and actively executing RPC calls against Odoo.
* **Frozen / Failed:** Tasks that encountered transient errors, staged in an exponential backoff cooling period prior to automated retry.
* **Orphans / Dead Letter:** Tasks that exhausted their retry budget or produced ambiguous outcomes, quarantined safely for manual operator review.

## Atomic Wave Claiming & Fair-Share {#wave-claiming}
The queue engine enforces advanced worker safety (\`src/lib/queue/\`):
* **Atomic Wave Claiming:** Guarantees that individual queue tasks are claimed atomically by exactly one worker thread.
* **Fair-Share Round Robin:** Prevents a single high-volume store with 10,000 queued items from starving an adjacent store with a single priority order.

## Quarantine & Circuit Breakers {#quarantine-and-circuit}
* **Circuit Breakers:** If 5 consecutive RPC operations fail against an Odoo instance, execution leases for that tenant pause temporarily to prevent database hammering, dispatching an immediate admin alert.
* **Quarantining Ambiguous Outcomes:** If a socket disconnects before Odoo confirms a sales order write, the task is quarantined until read-back verification proves whether the record was persisted, eliminating duplicate invoice risks.`,
    },
  },
  {
    slug: 'initial-transfer',
    category: 'operations',
    title: {
      ar: 'النقل الأولي للبيانات والمنتجات والعملاء',
      en: 'Initial Catalog, Customer & Category Transfer',
    },
    description: {
      ar: 'كيفية استيراد المنتجات والعملاء والتصنيفات القائمة مسبقاً في متجرك إلى أودوو بضغطة زر وبمعالجة متوازية آمنة.',
      en: 'Bulk import existing storefront products, customers, and categories into Odoo with throttled parallel workers.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 5,
    headings: [
      { id: 'when-to-use', text: { ar: 'متى تحتاج إلى النقل الأولي؟', en: 'When to Use Initial Transfer' }, level: 2 },
      { id: 'transfer-steps', text: { ar: 'خطوات تشغيل النقل الأولي', en: 'Step-by-Step Transfer Execution' }, level: 2 },
      { id: 'throttling-and-dedup', text: { ar: 'تحديد السرعة (5 خيوط) ومنع التكرار', en: 'Concurrency Throttling & Deduplication' }, level: 2 },
      { id: 'transfer-monitoring', text: { ar: 'متابعة شريط التقدم والنتائج', en: 'Monitoring Progress & Results' }, level: 2 },
    ],
    keywords: ['Initial Transfer', 'Catalog Import', 'Bulk Sync', 'Products Import', 'Customers Import'],
    content: {
      ar: `## متى تحتاج إلى النقل الأولي؟ {#when-to-use}
تقوم الويب هوكس بنقل البيانات المستقبلية فور حدوثها. ولكن ماذا عن مئات المنتجات والعملاء والتصنيفات **الموجودة بالفعل في متجرك قبل اشتراكك في ERP Link**؟

شاشة **النقل الأولي (Initial Transfer)** (\`/app/initial-transfer\`) مخصصة لجلب بيانات متجرك التاريخية وتهيئة الكتالوج وجهات الاتصال داخل نظام أودوو بضغطة زر واحدة قبل بدء المبيعات.

## خطوات تشغيل النقل الأولي {#transfer-steps}
1. تأكد أولاً من اكتمال [ربط المتجر](/docs/connect/zid) و[ربط أودوو](/docs/connect/odoo) بنجاح.
2. انتقل إلى شاشة **النقل الأولي (Initial Transfer)** في القائمة الجانبية.
3. حدد البيانات التي ترغب في نقلها عبر تحديد المربعات:
   * **التصنيفات (Categories):** لاستيراد شجرة أقسام المتجر.
   * **المنتجات (Products):** لاستيراد المنتجات والأسعار والمتغيرات والأوزان والـ SKU.
   * **العملاء (Customers):** لاستيراد قاعدة العملاء المسجلين وأرقام هواتفهم.
4. انقر على زر **بدء النقل الأولي (Start Initial Transfer)**.

## تحديد السرعة (5 خيوط) ومنع التكرار {#throttling-and-dedup}
* **تنظيم تدفق الطلبات (Throttling):** لتفادي إرهاق خادم أودوو أو تجاوز حدود معدل استدعاء واجهات المتجر (Rate Limits)، يعمل محرك النقل الأولي بحد أقصى **5 خيوط معالجة متوازية (5 Concurrency Workers)**.
* **منع التكرار التلقائي (Smart Deduplication):** يفحص المحرك سجلات أودوو قبل إنشاء أي صنف. إذا كان المنتج أو العميل موجوداً مسبقاً، يتم ربطه وتحديثه فقط دون إنشاء سجل مكرر.

## متابعة شريط التقدم والنتائج {#transfer-monitoring}
* أثناء النقل، يعرض النظام شريط تقدم تفاعلي حي يوضح عدد السجلات المنقولة والنسبة المئوية المكتملة.
* يمكنك مواصلة تصفح النظام بحرية، حيث تتم العملية بالكامل في الخلفية.
* بعد اكتمال النقل، تظهر بطاقة ملخص توضح عدد السجلات الناجحة وتلك التي تم تخطيها.`,

      en: `## When to Use Initial Transfer {#when-to-use}
Webhooks ingest future real-time transactions as they happen. However, what about the catalog of products, categories, and existing customers **already present in your store before setting up ERP Link**?

The **Initial Transfer** utility (\`/app/initial-transfer\`) is designed to bulk-import your historical storefront catalog and contact base into Odoo before launching live synchronization.

## Step-by-Step Transfer Execution {#transfer-steps}
1. Ensure both your [Store](/docs/connect/zid) and [Odoo ERP](/docs/connect/odoo) connections are active.
2. Navigate to **Initial Transfer** in the sidebar.
3. Select the entities you wish to import:
   * **Categories:** Imports the full catalog taxonomy.
   * **Products:** Imports products, variants, SKUs, barcodes, and prices.
   * **Customers:** Imports registered customers and phone numbers.
4. Click **Start Initial Transfer**.

## Concurrency Throttling & Deduplication {#throttling-and-dedup}
* **Concurrency Throttling:** To protect your Odoo server from resource starvation and stay within upstream API rate limits, execution is metered at a safe ceiling of **5 parallel worker threads**.
* **Smart Deduplication:** The engine validates whether an item or partner already exists in Odoo before inserting. Existing records are matched and updated rather than duplicated.

## Monitoring Progress & Results {#transfer-monitoring}
* A live progress bar visualizes processed item counts and completion percentages.
* The transfer executes asynchronously in the background, allowing you to navigate other sections safely.
* Upon completion, a summary card reports total imported and skipped items.`,
    },
  },
  {
    slug: 'notifications',
    category: 'operations',
    title: {
      ar: 'الإشعارات وتنبيهات المتصفح وبوت تليجرام',
      en: 'In-App, Push & Telegram Notifications',
    },
    description: {
      ar: 'إعداد قنوات الإشعارات الفورية: التنبيهات داخل التطبيق (SSE)، إشعارات المتصفح (Web Push)، وربط بوت تليجرام الرسمي.',
      en: 'Configure instant alert channels: real-time in-app SSE notifications, browser Web Push, and the official Telegram alert bot.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 6,
    headings: [
      { id: 'notification-channels', text: { ar: 'قنوات الإشعارات الثلاث المتاحة', en: 'Available Alert Channels' }, level: 2 },
      { id: 'telegram-bot-setup', text: { ar: 'خطوات ربط بوت تليجرام الرسمي', en: 'Official Telegram Bot Setup' }, level: 2 },
      { id: 'web-push-setup', text: { ar: 'تفعيل إشعارات المتصفح المباشرة', en: 'Enabling Browser Web Push' }, level: 2 },
      { id: 'alert-rules-and-throttles', text: { ar: 'أنواع التنبيهات وقواعد منع الإزعاج', en: 'Alert Types & Throttling Rules' }, level: 2 },
    ],
    keywords: ['Notifications', 'Telegram Bot', 'Web Push', 'In-App Alerts', 'SSE', 'Error Alerts'],
    content: {
      ar: `## قنوات الإشعارات الثلاث المتاحة {#notification-channels}
يضمن ERP Link بقاءك على اطلاع فوري بكل ما يحدث في متجرك من خلال 3 قنوات تنبيهية متكاملة:
1. **التنبيهات الحية داخل لوحة التحكم (In-App SSE):** أيقونة الجرس في أعلى الشاشة توضح التحديثات اللحظية وعدد التنبيهات غير المقروءة.
2. **إشعارات المتصفح (Web Push):** تنبيهات تظهر على شاشة جهازك المكتبي أو هاتفك المحمول حتى في حال كان المتصفح مغلقاً.
3. **بوت تليجرام الرسمي (@ERP_Link_bot):** تنبيهات فورية ورسائل دورية يومية تصل مباشرة إلى تطبيق تليجرام الخاص بك أو مجموعة العمل.

## خطوات ربط بوت تليجرام الرسمي {#telegram-bot-setup}
لربط حسابك أو مجموعة فريقك ببوت التنبيهات:
1. افتح شاشة \`الإعدادات > الإشعارات\` (\`/app/settings/notifications\`).
2. ستجد قسماً مخصصاً لـ **بوت تليجرام (Telegram Alert Bot)**.
3. انقر على زر **ربط تليجرام (Connect Telegram)**.
4. سيتم فتح محادثة مع البوت الرسمي عبر الرابط الآمن الحامل لرمز الربط الفريد الخاص بمساحة عملك:
   \`https://t.me/ERP_Link_bot?start=<code>\`
5. انقر على زر **Start** في تليجرام.
6. يقوم خادمنا بالتحقق من صحة الرمز المكون من 6 خانات وربط معرف محادثتك (\`chat_id\`) بمساحة العمل فوراً.
7. اضغط على زر **إرسال تنبيه تجريبي (Send Test Alert)** للتأكد من وصول الرسائل بنجاح.

## تفعيل إشعارات المتصفح المباشرة {#web-push-setup}
1. في شاشة الإشعارات (\`/app/settings/notifications\`)، فعّل خيار **إشعارات المتصفح (Browser Push Notifications)**.
2. ستظهر نافذة منبثقة من متصفحك تطلب الإذن بعرض الإشعارات.
3. انقر على **سماح (Allow)**.
4. يتم تسجيل مفتاح الاشتراك الآمن (VAPID) في الخادم، وستصلك الإشعارات عند حدوث أي خطأ في المزامنة.

## أنواع التنبيهات وقواعد منع الإزعاج {#alert-rules-and-throttles}
* **تنبيهات الأخطاء الحرجة:** إشعار فوري عند فشل معالجة طلب في أودوو أو انتهاء صلاحية مفتاح الربط.
* **تنبيهات قرب انتهاء التجربة:** رسالة تنبيهية عند اقتراب انتهاء الـ 7 أيام لتفادي توقف الخدمة.
* **منع الإزعاج والتكرار (Throttling):** إذا حدث عطل متكرر لنفس المشكلة 50 مرة متتالية، يرسل البوت تنبيهاً واحداً جامعاً ويمنع إغراق المحادثة بمئات الرسائل المتطابقة.`,

      en: `## Available Alert Channels {#notification-channels}
ERP Link delivers operational visibility through three integrated alert channels:
1. **In-App Real-Time Notifications (SSE):** Bell icon in the navigation header displaying live updates and unread counters.
2. **Browser Web Push Notifications:** System push alerts delivered to desktop and mobile devices even when the tab is closed.
3. **Official Telegram Alert Bot (@ERP_Link_bot):** Instant alerts and daily operational digests delivered directly to your Telegram chat or team channel.

## Official Telegram Bot Setup {#telegram-bot-setup}
To link your Telegram account or operational channel:
1. Open \`Settings > Notifications\` (\`/app/settings/notifications\`).
2. Locate the **Telegram Alert Bot** section.
3. Click **Connect Telegram**.
4. The system opens a chat with the official bot carrying your workspace's secure link token:
   \`https://t.me/ERP_Link_bot?start=<code>\`
5. Click **Start** in Telegram.
6. Our backend validates the 6-character link token and maps your \`chat_id\` to your workspace.
7. Click **Send Test Alert** in the ERP Link dashboard to confirm connectivity.

## Enabling Browser Web Push {#web-push-setup}
1. In the Notifications settings screen, toggle **Browser Push Notifications**.
2. When prompted by your browser, click **Allow**.
3. Your secure VAPID subscription token registers with our server to receive critical push dispatches.

## Alert Types & Throttling Rules {#alert-rules-and-throttles}
* **Critical Error Alerts:** Dispatched immediately upon order processing failures or connection invalidations.
* **Trial Expiration Warnings:** Alerts sent prior to trial completion to ensure uninterrupted continuity.
* **Anti-Spam Throttling:** If a recurring error triggers 50 times in rapid succession, the alert engine coalesces notifications to prevent chat flooding.`,
    },
  },
]
