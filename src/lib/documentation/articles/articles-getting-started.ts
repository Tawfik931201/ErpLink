import type { DocArticle } from '../docs-types'

export const articlesGettingStarted: DocArticle[] = [
  {
    slug: 'getting-started',
    category: 'getting-started',
    title: {
      ar: 'نظرة عامة والبدء السريع مع ERP Link',
      en: 'Overview & Quickstart with ERP Link',
    },
    description: {
      ar: 'تعرف على المنصة وكيفية ربط متجرك الإلكتروني (زد، سلة، شوبيفاي) بنظام أودوو Odoo ERP في 4 خطوات عملية سهلة.',
      en: 'Learn how ERP Link connects your e-commerce store (Zid, Salla, Shopify) to Odoo ERP in four practical steps.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 5,
    headings: [
      { id: 'what-is-erplink', text: { ar: 'ما هي منصة ERP Link؟', en: 'What is ERP Link?' }, level: 2 },
      { id: 'core-capabilities', text: { ar: 'المميزات والقدرات الأساسية', en: 'Core Capabilities' }, level: 2 },
      { id: 'quickstart-steps', text: { ar: 'خطوات التشغيل السريع الأربعة', en: 'The 4-Step Quickstart' }, level: 2 },
      { id: 'system-prerequisites', text: { ar: 'المتطلبات المسبقة قبل البدء', en: 'Prerequisites Before You Start' }, level: 2 },
      { id: 'next-steps', text: { ar: 'الخطوات التالية', en: 'Next Steps' }, level: 2 },
    ],
    keywords: ['ERP Link', 'Odoo', 'Zid', 'Salla', 'Shopify', 'Quickstart', 'Integration', 'Sync'],
    content: {
      ar: `## ما هي منصة ERP Link؟ {#what-is-erplink}
منصة **ERP Link** هي بوابة الربط والمزامنة السحابية المصممة خصيصاً لمتاجر الشرق الأوسط والمملكة العربية السعودية، حيث تعمل كجسر ذكي وموثوق يربط منصات التجارة الإلكترونية الكبرى (**زد Zid**، **سلة Salla**، و**شوبيفاي Shopify**) بنظام تخطيط موارد المؤسسات **أودوو Odoo ERP** بمختلف إصداراته (من Odoo 14 حتى Odoo 20).

تقوم المنصة بأتمتة نقل العمليات التشغيلية دون أي تدخل يدوي، مما يقضي تماماً على أخطاء إعادة الإدخال البشري ويوفر ساعات العمل اليومية لفِرق المحاسبة وإدارة المخزون.

:::tip
تعتمد ERP Link على بنية تنفيذ متينة (Durable Execution) تضمن عدم فقدان أي طلب أو دفعة أو تحديث مخزون حتى في حالات انقطاع خادم المتجر أو إعادة تشغيل خادم أودوو.
:::

## المميزات والقدرات الأساسية {#core-capabilities}
* **مزامنة الطلبات الفورية:** استقبال إشعارات الويب (Webhooks) لحظة إنشاء الطلب أو تحديث حالته في المتجر وتحويله فوراً إلى أمر بيع (Sales Order) في أودوو.
* **دقة حسابات الضريبة 15%:** استخراج الأسعار غير الشاملة للضريبة بدقة ومعالجة فروقات الهللات لضمان مطابقة فواتير أودوو لإجمالي سلة الشراء ومتطلبات هيئة الزكاة والضريبة والجمارك (ZATCA).
* **إدارة وتوجيه المخزون:** تحديث الكميات المتوفرة للبيع لحظياً مع دعم تعدد المستودعات وعزل الحركات لمنع التذبذب والبيع الزائد.
* **أتمتة الفواتير وسندات القبض:** إمكانية إصدار الفواتير واعتمادها وربطها بالدفاتر المحاسبية (Journals) بحسب وسيلة الدفع (مدى، تابي، تمارا، الدفع عند الاستلام).
* **معالجة المرتجعات:** تحويل إرجاع الطلبات في المتجر إلى إشعارات دائنة (Credit Notes) وعمليات استرجاع مخزني تلقائية في أودوو.
* **المراقبة والسجلات:** واجهة واضحة لمتابعة سجلات المزامنة (Sync Logs) وطابور العمليات (Queue) مع إمكانية إعادة المحاولة بضغطة زر.

## خطوات التشغيل السريع الأربعة {#quickstart-steps}
للبدء في تشغيل الربط بنجاح، اتبع المسار التالي بالترتيب:

1. **ربط المتجر الإلكتروني:** انتقل إلى شاشة [ربط المتجر](/docs/connect/zid) وقم بتسجيل الدخول والتفويض لمتجرك (زد أو سلة أو شوبيفاي).
2. **الاتصال بنظام أودوو:** انتقل إلى شاشة [الاتصال بأودوو](/docs/connect/odoo) وأدخل رابط الخادم وقاعدة البيانات وبيانات المستخدم وافحص الاتصال.
3. **ضبط المطابقة القياسية (Standard Mapping):** ادخل إلى [مركز الخرائط](/docs/mapping/orders) وحدد المستودع، الدفاتر المحاسبية، وخريطة حالات الطلب.
4. **تنفيذ أول اختبار:** أنشئ طلباً تجريبياً في متجرك، ثم افتح [سجلات المزامنة](/docs/logs) للتأكد من وصول الطلب وتسجيله في أودوو بنجاح.

## المتطلبات المسبقة قبل البدء {#system-prerequisites}
قبل البدء في عملية الربط، تأكد من توفر الآتي:
* حساب نشط في منصة ERP Link (مع تفعيل مساحة العمل الخاصة بك).
* صلاحيات مدير (Admin / Manager) على متجرك الإلكتروني لتثبيت التطبيق ومنح أذونات OAuth.
* نظام أودوو متاح عبر الإنترنت (HTTPS) مع اسم مستخدم ومفتاح API (أو كلمة مرور) يمتلك صلاحيات إدارة المبيعات والحسابات والمخزون.
* توافق رمز المنتج (SKU) أو الباركود بين المتجر وأودوو للمنتجات المراد مزامنتها.

:::important
لا تقم بتفعيل أتمتة الفواتير وتسليم المخزون التلقائي إلا بعد تجربة طلب واحد على الأقل في وضع المسودة (Draft) والتحقق من صحة الأرقام والحسابات.
:::

## الخطوات التالية {#next-steps}
* انتقل إلى [دليل إنشاء الحساب والتجربة المجانية](/docs/create-account) لفهم صلاحيات الحساب.
* أو توجّه مباشرة إلى [دليل ربط متجر زد](/docs/connect/zid) للبدء العملي.`,

      en: `## What is ERP Link? {#what-is-erplink}
**ERP Link** is an enterprise-grade cloud integration platform purpose-built for e-commerce merchants in Saudi Arabia and the MENA region. It serves as a secure bridge connecting major e-commerce platforms (**Zid**, **Salla**, and **Shopify**) with **Odoo ERP** (versions 14 through 20).

The platform fully automates business workflows between your storefront and ERP backend, eliminating manual re-entry errors and saving accounting and fulfillment teams dozens of hours each week.

:::tip
ERP Link utilizes a durable execution architecture that guarantees no order, payment, or inventory adjustment is lost—even during upstream store downtime or ERP server restarts.
:::

## Core Capabilities {#core-capabilities}
* **Real-time Order Sync:** Ingests webhooks the instant an order is placed or updated in your store and creates an authoritative Sales Order in Odoo.
* **15% VAT & Price Parity:** Accurate tax-inclusive pricing extraction that resolves fractional halala rounding variances, ensuring strict alignment with store checkouts and ZATCA tax rules.
* **Inventory Management:** Instant stock quantity updates with multi-warehouse routing and oscillation guards to prevent overselling.
* **Invoices & Payment Allocation:** Automatic invoice generation and validation routed to matching accounting journals by payment method (Mada, Tabby, Tamara, COD).
* **Return Processing:** Automatically translates store returns into Odoo credit notes and return picking operations.
* **Operations & Observability:** High-speed sync logs and processing queues with single-click manual retry and error resolution.

## The 4-Step Quickstart {#quickstart-steps}
To set up your integration successfully, follow these steps in order:

1. **Connect Your Store:** Go to [Store Connection](/docs/connect/zid) and authorize your Zid, Salla, or Shopify store via OAuth.
2. **Connect Odoo ERP:** Navigate to [Connect Odoo](/docs/connect/odoo), input your server URL, database name, and user credentials, and test the connection.
3. **Configure Standard Mapping:** Open the [Mapping Center](/docs/mapping/orders) to configure warehouses, payment journals, and order status mapping.
4. **Run a Test Order:** Place a test order in your store and inspect [Sync Logs](/docs/logs) to verify its creation in Odoo.

## Prerequisites Before You Start {#system-prerequisites}
Before beginning, ensure you have:
* An active ERP Link account with an initialized workspace.
* Admin or store manager permissions on your e-commerce platform.
* An accessible Odoo instance (over HTTPS) with an API user that has Sales, Inventory, and Accounting manager rights.
* Matching SKUs or barcodes between your online store products and Odoo product catalog.

:::important
Do not enable automatic invoice posting or automatic stock delivery until you have tested at least one order in Draft state and verified tax and line totals.
:::

## Next Steps {#next-steps}
* Review [Account Creation & Free Trial](/docs/create-account) to understand workspace access.
* Or jump directly to the [Zid Integration Guide](/docs/connect/zid).`,
    },
  },
  {
    slug: 'create-account',
    category: 'getting-started',
    title: {
      ar: 'إنشاء الحساب وبدء التجربة المجانية 7 أيام',
      en: 'Account Creation & 7-Day Free Trial',
    },
    description: {
      ar: 'شرح طريقة التسجيل عبر Clerk، تفعيل مساحة العمل التلقائية، والاستفادة من التجربة المجانية الكاملة لربط متجرك بأودوو.',
      en: 'Learn how to register with Clerk, activate your automated workspace, and start your 7-day full-featured free trial.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 4,
    headings: [
      { id: 'sign-up-flow', text: { ar: 'خطوات إنشاء الحساب الجديد', en: 'New Account Registration' }, level: 2 },
      { id: 'trial-rules', text: { ar: 'قواعد التجربة المجانية (7 أيام)', en: '7-Day Free Trial Rules' }, level: 2 },
      { id: 'trial-countdown', text: { ar: 'شريط العد التنازلي وحالة الحساب', en: 'Countdown Banner & Account State' }, level: 2 },
      { id: 'trial-expiration', text: { ar: 'ماذا يحدث عند انتهاء التجربة؟', en: 'What Happens When the Trial Ends?' }, level: 2 },
    ],
    keywords: ['Sign Up', 'Clerk', 'Trial', 'Free Trial', '7 Days', 'Account', 'Activation'],
    content: {
      ar: `## خطوات إنشاء الحساب الجديد {#sign-up-flow}
يتيح لك ERP Link بدء تجربة مجانية فورية لمدة 7 أيام دون الحاجة لإدخال أي بطاقة ائتمانية. تتم إدارة المصادقة والأمان عبر خدمة Clerk العالمية المعتمدة:

1. افتح صفحة [إنشاء الحساب الجديد](/sign-up).
2. اختر التسجيل باستخدام بريدك الإلكتروني وكلمة مرور قوية، أو سجل عبر حساب Google بنقرة واحدة.
3. ستصلك رسالة تحقق عبر البريد الإلكتروني تحتوي على رمز التحقق لمرة واحدة (OTP).
4. بعد تأكيد الرمز، يقوم النظام تلقائياً بإنشاء **مساحة عمل افتراضية (Default Workspace)** باسم متجرك، وتوجيهك مباشرة إلى لوحة التحكم الرئيسية (\`/app/dashboard\`).

## قواعد التجربة المجانية (7 أيام) {#trial-rules}
تبدأ فترة التجربة المجانية في اللحظة التي يتم فيها إنشاء مساحة العمل وتستمر لمدة 7 أيام كاملة (168 ساعة):
* **وصول كامل للميزات:** تشمل التجربة جميع إمكانيات المنصة دون أي قيود (ربط المتاجر، ربط أودوو، مركز المطابقة، السجلات، وتنبيهات تليجرام).
* **لا توجد مدفوعات تلقائية:** لا نطلب بيانات فيزا أو ماستركارد عند التسجيل.
* **أمان البيانات:** تبقى جميع خرائطك وسجلاتك وإعداداتك محفوظة بالكامل حتى بعد انتهاء فترة التجربة.

:::tip
حساب مدة التجربة يتم اعتماداً على حقل \`created_at\` لمساحة العمل في قاعدة البيانات (\`src/lib/workspace-trial.ts\`)، وتتيح لك تجربة ربط كامل ودقيق مع متجر حقيقي أو متجر تجريبي (Sandbox).
:::

## شريط العد التنازلي وحالة الحساب {#trial-countdown}
أثناء تصفحك للوحة التحكم، ستلاحظ وجود شريط تنبيهي في أعلى الشاشة يوضح الوقت المتبقي من التجربة:
* يعرض الشريط عداداً تفصيلياً بالأيام والساعات والدقائق (مثال: \`6 أيام و 21:06:56\`).
* عند بقاء أقل من 24 ساعة، يتحول العداد إلى تنسيق الساعات اللحظي لتنبيهك بقرب انتهاء الفترة.
* يحتوي الشريط على زر سريع للتواصل مع فريق الدعم والمبيعات لتفعيل اشتراكك الرسمي عبر التحويل البنكي المباشر.

## ماذا يحدث عند انتهاء التجربة؟ {#trial-expiration}
إذا انتهت فترة الـ 7 أيام دون تفعيل اشتراك مدفوع:
1. يتم إغلاق مساحة العمل مؤقتاً (\`workspaceClosed\`).
2. تظهر شاشة تنبيهية توضح انتهاء فترة التجربة وتوفر رابطاً للتواصل مع الدعم.
3. تتوقف عمليات المزامنة التلقائية والويب هوكس لحماية المتجر.
4. **لا يتم حذف أي بيانات:** بمجرد التواصل مع المبيعات وتأكيد الاشتراك، يتم فك الحظر عن مساحة العمل وتستأنف المزامنة فوراً بكامل إعداداتها السابقة دون الحاجة لإعادة التهيئة.`,

      en: `## New Account Registration {#sign-up-flow}
ERP Link offers an instant 7-day free trial with no credit card required. Authentication is powered by Clerk:

1. Navigate to the [Sign Up page](/sign-up).
2. Enter your work email and a secure password, or sign in with Google with a single click.
3. Enter the one-time verification passcode (OTP) sent to your email.
4. Upon confirmation, the platform automatically provisions a **Default Workspace** and redirects you to the main dashboard (\`/app/dashboard\`).

## 7-Day Free Trial Rules {#trial-rules}
The 7-day trial begins the moment your workspace is created and runs for a full 168 hours:
* **Full Feature Access:** The trial includes every single platform capability with no artificial limits (Store connections, Odoo RPC, Mapping Center, Sync Logs, and Telegram notifications).
* **No Automated Billing:** We do not ask for credit card or payment credentials during trial registration.
* **Data Preservation:** Your configurations, field mappings, and sync logs are safely preserved.

:::tip
Trial duration is mathematically computed against \`workspaces.created_at\` (\`src/lib/workspace-trial.ts\`). You can test with live production stores or sandbox developer environments.
:::

## Countdown Banner & Account State {#trial-countdown}
While browsing your dashboard, a top notification banner displays your exact remaining trial time:
* Displays a live countdown in days, hours, and minutes (e.g., \`6 days and 21:06:56\`).
* When less than 24 hours remain, it automatically switches to a high-visibility urgent clock format.
* Includes a direct link to contact sales and support to activate your permanent subscription via manual bank transfer.

## What Happens When the Trial Ends? {#trial-expiration}
If the 7-day trial expires before activating an official subscription:
1. The workspace enters the gated closed state (\`workspaceClosed\`).
2. An expiration notice is displayed with instructions to contact support.
3. Automatic webhook ingestion pauses to safeguard your store.
4. **No data is lost:** As soon as your subscription payment is verified, your workspace is unlocked immediately and sync resumes with all your existing mappings intact.`,
    },
  },
  {
    slug: 'workspaces',
    category: 'getting-started',
    title: {
      ar: 'إدارة مساحات العمل والعزل متعدد المستأجرين',
      en: 'Workspaces & Multi-Tenant Isolation',
    },
    description: {
      ar: 'كيف تدير عدة متاجر وعدة قواعد بيانات أودوو من حساب واحد مع عزل أمني وقاعدي كامل بين مساحات العمل.',
      en: 'Manage multiple online stores and Odoo instances from a single account with complete tenant isolation.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 5,
    headings: [
      { id: 'workspace-architecture', text: { ar: 'معمارية عزل مساحات العمل', en: 'Workspace Isolation Architecture' }, level: 2 },
      { id: 'create-and-switch', text: { ar: 'إنشاء مساحة عمل والتبديل بينها', en: 'Creating & Switching Workspaces' }, level: 2 },
      { id: 'workspace-settings', text: { ar: 'إعدادات مساحة العمل الحالية', en: 'Current Workspace Settings' }, level: 2 },
      { id: 'security-boundaries', text: { ar: 'ضمانات الأمان وعزل البيانات', en: 'Security Guarantees' }, level: 2 },
    ],
    keywords: ['Workspaces', 'Multi-tenant', 'Switch Workspace', 'Settings', 'Isolation', 'Security'],
    content: {
      ar: `## معمارية عزل مساحات العمل {#workspace-architecture}
تعتمد منصة ERP Link على معمارية العزل التام متعدد المستأجرين (**Multi-Tenant Isolation**). تمثل مساحة العمل (**Workspace**) بيئة تشغيلية مستقلة تماماً تشمل:
* اتصال متجر إلكتروني مستقل (زد، سلة، أو شوبيفاي).
* اتصال خادم أودوو مستقل (رابط، قاعدة بيانات، وبيانات دخول خاصة).
* جداول مطابقة حقول وحالات مستقلة (\`field_mappings\`).
* سجلات عمليات وطابور معالجة منفصل (\`sync_logs\` و \`sync_queue\`).
* إعدادات إشعارات وتذاكر دعم مستقلة.

إذا كنت تمتلك عدة متاجر أو تدير حسابات عملاء متعددين، يمكنك تشغيل كل متجر داخل مساحة عمل منفصلة دون أي تداخل في البيانات.

## إنشاء مساحة عمل والتبديل بينها {#create-and-switch}
### التبديل بين مساحات العمل:
1. انقر على قائمة مساحات العمل الموجودة في الشريط الجانبي أو أعلى لوحة التحكم.
2. ستظهر قائمة بجميع مساحات العمل التي تمتلكها أو تمت دعوتك إليها.
3. انقر على اسم مساحة العمل المطلوبة، وسيتم تحديث الواجهة فوراً لتصفح بيانات المتجر المحدد.

### إنشاء مساحة عمل جديدة:
1. من قائمة مساحات العمل، اختر **إنشاء مساحة عمل جديدة (Create New Workspace)**.
2. أدخل اسم المتجر أو مساحة العمل الجديدة.
3. انقر على **تأكيد الإنشاء**، حيث يتم تهيئة المساحة الجديدة فوراً ببدء فترة تجربة مجانية خاصة بها وإعداداتها الافتراضية.

## إعدادات مساحة العمل الحالية {#workspace-settings}
يمكنك الوصول إلى تفاصيل مساحة العمل الحالية عبر الانتقال إلى:
\`الإعدادات > مساحة العمل\` (\`/app/settings/workspace\`).

تتيح لك هذه الصفحة:
* **تعديل اسم مساحة العمل:** لتسهيل التمييز بين المتاجر عند التبديل.
* **معرفة معرف مساحة العمل (Workspace ID):** وهو الرمز التعريفي الفريد المطلوب عند التواصل مع الدعم الفني لمتابعة التذاكر أو الويب هوكس.
* **تاريخ الإنشاء:** لمعرفة تاريخ بدء البيئة وحالة فترتها التشغيلية.

## ضمانات الأمان وعزل البيانات {#security-boundaries}
* **عزل الاستعلامات:** كل استعلام لقاعدة البيانات مشفر ومحدد بشرط \`workspace_id\` إلزامي، مما يمنع نهائياً أي وصول متقاطع بين الحسابات.
* **مفاتيح التشفير:** يتم توليد رموز التحقق الخاصة بالويب هوكس وتشفير رموز الدخول باستخدام مفتاح التشفير المتقدم (AES-256-GCM) مع اشتقاق خاص بمساحة العمل.
* **الصلاحيات:** يمتلك مالك مساحة العمل (Owner) وحده صلاحية ربط أو فصل المتجر وأودوو وإدارة الاشتراكات، بينما يمكن للأعضاء متابعة السجلات وتعديل الخرائط حسب الصلاحيات الممنوحة لهم.`,

      en: `## Workspace Isolation Architecture {#workspace-architecture}
ERP Link is architected around strict multi-tenant isolation. Each **Workspace** represents a completely isolated operating container comprising:
* An independent store integration (Zid, Salla, or Shopify).
* An independent Odoo ERP connection (URL, database, and credentials).
* Independent field mappings and workflow settings (\`field_mappings\`).
* Isolated operation logs and processing queue (\`sync_logs\` & \`sync_queue\`).
* Dedicated notification channels and support tickets.

Whether you run multiple brand storefronts or manage integration accounts for multiple clients, each store operates in its own workspace with zero cross-tenant contamination.

## Creating & Switching Workspaces {#create-and-switch}
### Switching Workspaces:
1. Click the workspace dropdown selector located in the navigation header or sidebar.
2. A list of all workspaces you own or belong to will appear.
3. Select your desired workspace; the application context updates immediately.

### Creating a New Workspace:
1. In the workspace selector, click **Create New Workspace**.
2. Enter the name of your new store or workspace.
3. Click **Create**; the system initializes the workspace with its own 7-day trial and clean configuration templates.

## Current Workspace Settings {#workspace-settings}
Manage workspace properties by navigating to:
\`Settings > Workspace\` (\`/app/settings/workspace\`).

Available actions include:
* **Rename Workspace:** Update the display name for easy team identification.
* **Inspect Workspace ID:** View the unique UUID required when opening technical support tickets or verifying webhook signatures.
* **Creation Timestamp:** Track the activation date and trial status.

## Security Guarantees {#security-boundaries}
* **Query Scoping:** Every database query is strictly scoped by an immutable \`workspace_id\` filter, preventing cross-tenant leakage.
* **Credential Isolation:** Ingress credentials and store tokens are encrypted with AES-256-GCM using isolated workspace-derived HKDF keys.
* **RBAC Enforcement:** Only the workspace Owner can connect/disconnect stores and manage billing; team members operate under strictly assigned permissions.`,
    },
  },
]
