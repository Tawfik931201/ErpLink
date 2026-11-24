import type { DocArticle } from '../docs-types'

export const articlesAccounts: DocArticle[] = [
  {
    slug: 'team',
    category: 'accounts',
    title: {
      ar: 'إدارة الفريق والأدوار والصلاحيات (RBAC)',
      en: 'Team Management, Roles & Permissions (RBAC)',
    },
    description: {
      ar: 'شرح دعوة أعضاء الفريق، التمييز بين المالك والمدير والمحاسب، والصلاحيات العشر التفصيلية لحماية إعدادات المتجر.',
      en: 'Invite team members, distinguish between Owner and Member roles, and configure 10 granular permissions to safeguard store settings.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 5,
    headings: [
      { id: 'roles-overview', text: { ar: 'الأدوار الرئيسية في مساحة العمل (Owner vs Member)', en: 'Workspace Roles: Owner vs. Member' }, level: 2 },
      { id: 'granular-permissions', text: { ar: 'الصلاحيات العشر التفصيلية في المنصة', en: 'The 10 Granular Permissions' }, level: 2 },
      { id: 'inviting-members', text: { ar: 'خطوات دعوة عضو جديد وإدارة الصلاحيات', en: 'Inviting & Managing Members' }, level: 2 },
      { id: 'security-best-practices', text: { ar: 'إرشادات الأمان وصلاحيات الفريق', en: 'Security Best Practices' }, level: 2 },
    ],
    keywords: ['Team Management', 'RBAC', 'Roles', 'Permissions', 'Owner', 'Member', 'Invite'],
    content: {
      ar: `## الأدوار الرئيسية في مساحة العمل (Owner vs Member) {#roles-overview}
تعتمد منصة ERP Link على نظام التحكم بالوصول المستند إلى الأدوار (**Role-Based Access Control - RBAC**):

* **المالك (Owner):** يمتلك الصلاحية المطلقة على مساحة العمل؛ يحق له وحده ربط أو فصل المتجر وأودوو، إدارة الاشتراكات والفوترة، دعوة أو حذف أعضاء الفريق، وتعديل اسم مساحة العمل.
* **العضو (Member):** موظف في الفريق يمتلك فقط الصلاحيات المحددة التي يمنحها له المالك (مثل الاطلاع على السجلات، أو تعديل مركز الخرائط دون القدرة على فصل الاتصالات أو الاطلاع على الفواتير).

## الصلاحيات العشر التفصيلية في المنصة {#granular-permissions}
يمكن للمالك تفعيل أو تعطيل 10 صلاحيات دقيقة لكل عضو في الفريق:

| الصلاحية في الواجهة | الوظيفة المسموح بها |
|---|---|
| **ربط المتجر** (\`store-connection\`) | إمكانية بدء تفويض المتجر أو فصله أو تعديل إعدادات الويب هوكس |
| **ربط نظام أودوو** (\`odoo-connection\`) | إمكانية تعديل بيانات خادم أودوو والمستودع الافتراضي |
| **مركز الخرائط** (\`mapping-center\`) | إمكانية الوصول إلى شاشات المطابقة وتعديل حالات الطلبات والحسابات |
| **سجلات المزامنة** (\`sync-logs\`) | تصفح سجلات العمليات، رؤية حمولة الويب هوك، وإعادة محاولة العمليات |
| **طابور العمليات** (\`queue\`) | تصفح طابور المعالجة وإعادة محاولة المهام المتجمدة |
| **النقل الأولي** (\`initial-transfer\`) | إمكانية تشغيل عمليات الاستيراد الضخمة للكتالوج والمنتجات |
| **تذاكر الدعم** (\`support-tickets\`) | فتح تذاكر دعم جديدة ومراسلة الفريق الفني |
| **إدارة الاشتراكات** (\`billing\`) | الاطلاع على حالة الاشتراك وتاريخ الفواتير والمدفوعات |
| **إدارة الإشعارات** (\`notifications\`) | إعداد بوت تليجرام وإشعارات المتصفح |
| **إدارة الفريق** (\`team-management\`) | دعوة أعضاء جدد وتعديل صلاحياتهم |

## خطوات دعوة عضو جديد وإدارة الصلاحيات {#inviting-members}
1. ادخل إلى \`الإعدادات > الفريق\` (\`/app/settings/team\`).
2. انقر على زر **دعوة عضو جديد (Invite Member)**.
3. أدخل البريد الإلكتروني للموظف.
4. حدد الصلاحيات المطلوبة عبر تحديد مربعات الاختيار المناسبة لمسؤولياته.
5. انقر على **إرسال الدعوة**. يتلقى الموظف رابطاً للانضمام ببريده الإلكتروني مباشرة.

## إرشادات الأمان وصلاحيات الفريق {#security-best-practices}
:::important
* لا تمنح صلاحيتي \`store-connection\` و \`odoo-connection\` إلا للمدير التقني الموثوق.
* يُفضل قصر صلاحيات موظفي خدمة العملاء والمستودع على \`sync-logs\` و \`support-tickets\` فقط لتسهيل متابعة الطلبات دون المخاطرة بتعديل الحسابات المحاسبية.
:::`,

      en: `## Workspace Roles: Owner vs. Member {#roles-overview}
ERP Link enforces a rigorous **Role-Based Access Control (RBAC)** architecture:

* **Owner:** Full authoritative control over the workspace; solely authorized to connect/disconnect stores and Odoo, manage billing subscriptions, invite/remove team members, and modify workspace configurations.
* **Member:** Team operator restricted strictly to granular functional permissions granted by the Owner.

## The 10 Granular Permissions {#granular-permissions}
The Owner can toggle 10 granular permissions per team member:

| UI Permission Name | Authorized Function |
|---|---|
| **Store Connection** (\`store-connection\`) | Authorize/disconnect stores and manage webhook subscriptions |
| **Odoo Connection** (\`odoo-connection\`) | Edit ERP credentials and warehouse assignments |
| **Mapping Center** (\`mapping-center\`) | Modify field mappings, journals, and status rules |
| **Sync Logs** (\`sync-logs\`) | View logs, payloads, and execute manual retries |
| **Queue** (\`queue\`) | View processing queues and retry frozen tasks |
| **Initial Transfer** (\`initial-transfer\`) | Execute bulk catalog and partner imports |
| **Support Tickets** (\`support-tickets\`) | Submit tickets and engage in support chats |
| **Billing & Plans** (\`billing\`) | View subscription countdown and payment histories |
| **Notifications** (\`notifications\`) | Configure Telegram bots and browser push |
| **Team Management** (\`team-management\`) | Invite members and adjust permissions |

## Inviting & Managing Members {#inviting-members}
1. Navigate to \`Settings > Team\` (\`/app/settings/team\`).
2. Click **Invite Member**.
3. Enter the operator's corporate email address.
4. Check the appropriate permission toggles corresponding to their duties.
5. Click **Send Invitation**. The user accepts via Clerk authentication.

## Security Best Practices {#security-best-practices}
:::important
* Restrict \`store-connection\` and \`odoo-connection\` exclusively to senior technical managers.
* Operational support and logistics teams should be granted only \`sync-logs\` and \`support-tickets\` to troubleshoot deliveries safely.
:::`,
    },
  },
  {
    slug: 'billing',
    category: 'accounts',
    title: {
      ar: 'الاشتراكات والفوترة والدفع بالتحويل البنكي',
      en: 'Subscriptions, Manual Billing & Bank Transfers',
    },
    description: {
      ar: 'نظام الفوترة اليدوي في ERP Link، كيفية طلب تمديد الاشتراك، إرسال إيصالات التحويل البنكي، وشروط التجديد المعتمدة.',
      en: 'Manual billing system in ERP Link: requesting extensions, submitting bank transfer receipts, and renewal policies.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 5,
    headings: [
      { id: 'billing-model', text: { ar: 'نموذج الفوترة المعتمد (دفع يدوي بدون سحب تلقائي)', en: 'Manual Billing Model (No Auto-Charges)' }, level: 2 },
      { id: 'subscription-status-card', text: { ar: 'بطاقة حالة الاشتراك والعد التنازلي', en: 'Subscription Status & Expiry Countdown' }, level: 2 },
      { id: 'renewal-and-payment', text: { ar: 'خطوات تجديد الاشتراك والتحويل البنكي', en: 'Subscription Renewal & Bank Transfer' }, level: 2 },
      { id: 'invoices-and-statements', text: { ar: 'كشف الحساب والفواتير الضريبية', en: 'Account Statements & Tax Invoices' }, level: 2 },
    ],
    keywords: ['Billing', 'Subscriptions', 'Bank Transfer', 'Manual Billing', 'Invoices', 'Payment', 'Renewal'],
    content: {
      ar: `## نموذج الفوترة المعتمد (دفع يدوي بدون سحب تلقائي) {#billing-model}
بناءً على التوجه الإداري المعتمد في منصة ERP Link:
* **لا يوجد سحب بنكي تلقائي:** لا نستخدم بوابات السحب المتكرر (مثل Stripe أو البطاقات المحفوظة). لن يتم سحب أي مبالغ من حسابك البنكي تلقائياً دون إرادتك.
* **المدفوعات يدوية بالكامل:** يتم سداد الاشتراكات عبر **التحويل البنكي المباشر (Bank Transfer)** لحساب الشركة الرسمي في المملكة العربية السعودية، أو عبر فواتير سداد المعتمدة.
* **إلغاء نظام العمولات والإحالات نهائياً:** جميع الاشتراكات مباشرة وخاصة بين التاجر وإدارة المنصة دون أي وسطاء.

## بطاقة حالة الاشتراك والعد التنازلي {#subscription-status-card}
عند فتح شاشة \`الإعدادات > الاشتراكات والفوترة\` (\`/app/settings/billing\`):
* **حالة الاشتراك الحالية:** (نشط Active / تجربة مجانية Trial / ينتهي قريباً Expiring Soon / منتهي Expired).
* **تاريخ بدء ونهاية الاشتراك:** يوضح تاريخ اليوم وتاريخ نهاية الفترة التعاقدية بدقة.
* **العداد التنازلي:** يوضح عدد الأيام المتبقية على التجديد لضمان استمرارية الربط دون انقطاع.

## خطوات تجديد الاشتراك والتحويل البنكي {#renewal-and-payment}
لتجديد أو تمديد اشتراك مساحة العمل الخاصة بك:
1. انقر على زر **طلب تمديد الاشتراك (Extend Subscription)** في صفحة الاشتراكات أو تواصل عبر البريد: \`info@bizsahla.com\`.
2. يزودك فريق المبيعات بالفاتورة الضريبية الرسمية وتفاصيل الحساب البنكي المعتمد (IBAN).
3. بعد إتمام الحوالة، قم بإرفاق إيصال التحويل عبر تذكرة دعم أو عبر البريد.
4. يقوم المشرف فوراً باعتماد الدفعة في النظام وتمديد تاريخ نهاية الاشتراك، وتصلك رسالة تأكيد إلكترونية رسمية.

## كشف الحساب والفواتير الضريبية {#invoices-and-statements}
* يعرض جدول المدفوعات في أسفل صفحة الفوترة سجل جميع الدفعات السابقة المعتمدة.
* يمكنك تحميل الفواتير الضريبية المعتمدة الصادرة من المنصة بصيغة متوافقة مع متطلبات المحاسبة وهيئة الزكاة.`,

      en: `## Manual Billing Model (No Auto-Charges) {#billing-model}
ERP Link operates on an enterprise manual billing architecture:
* **No Automated Recurring Charges:** We do not store credit card tokens or execute unexpected recurring charges.
* **Direct Bank Transfers:** Subscriptions are settled exclusively via direct commercial bank transfer (IBAN) to our official corporate account in Saudi Arabia.
* **Zero Intermediaries:** Direct contractual relationships between your business and ERP Link.

## Subscription Status & Expiry Countdown {#subscription-status-card}
Navigating to \`Settings > Billing\` (\`/app/settings/billing\`) displays:
* **Current Subscription State:** (Active, Free Trial, Expiring Soon, Expired).
* **Term Dates:** Exact contract start and expiration milestones.
* **Live Countdown Clock:** Shows remaining days and hours to ensure smooth operational planning.

## Subscription Renewal & Bank Transfer {#renewal-and-payment}
To renew or extend your workspace subscription:
1. Click **Extend Subscription** in the billing view or email \`info@bizsahla.com\`.
2. Our sales desk provides a verified corporate tax invoice containing official IBAN banking details.
3. Complete the transfer and submit the remittance receipt via [Support Tickets](/docs/support).
4. Our administration registers the payment, extending your active term immediately with automated email confirmation.

## Account Statements & Tax Invoices {#invoices-and-statements}
* The payment ledger at the bottom of the billing screen lists historical settled terms.
* Downloadable tax invoices are provided for corporate accounting and tax filing.`,
    },
  },
  {
    slug: 'support',
    category: 'accounts',
    title: {
      ar: 'الدعم الفني وتذاكر المساعدة والمحادثة الحية',
      en: 'Support Tickets & Helpdesk Chat in Odoo',
    },
    description: {
      ar: 'كيفية فتح تذاكر الدعم الفني من داخل التطبيق، متابعة ردود الفريق في محادثة مباشرة، وربطها بنظام Odoo Helpdesk.',
      en: 'Open technical support tickets directly from the dashboard, engage in live messaging, and sync with Odoo Helpdesk.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 5,
    headings: [
      { id: 'tickets-interface', text: { ar: 'واجهة تذاكر الدعم ونظام المحادثة المباشرة', en: 'Support Tickets UI & Live Chat' }, level: 2 },
      { id: 'create-ticket', text: { ar: 'خطوات فتح تذكرة دعم فني جديدة', en: 'Opening a New Support Ticket' }, level: 2 },
      { id: 'attachments-and-images', text: { ar: 'إرفاق لقطات الشاشة والصور المضغوطة', en: 'Image & Screenshot Attachments' }, level: 2 },
      { id: 'odoo-helpdesk-integration', text: { ar: 'ربط التذاكر بنظام أودوو هيلب ديسك الداخلي', en: 'Internal Odoo Helpdesk Synchronization' }, level: 2 },
    ],
    keywords: ['Support Tickets', 'Helpdesk', 'Live Chat', 'Attachments', 'Ticket Status', 'Customer Service'],
    content: {
      ar: `## واجهة تذاكر الدعم ونظام المحادثة المباشرة {#tickets-interface}
يوفر ERP Link مركز دعم فني متكامل مدمج داخل التطبيق (\`/app/tickets\`)، يتيح لك التواصل المباشر مع مهندسي الربط دون الحاجة لمغادرة لوحة التحكم:
* **واجهة محادثة عصرية (Live Messenger UI):** تتيح لك إرسال واستقبال الردود والتحديثات الفورية في تسلسل محادثة واضح.
* **حالات التذكرة:** (مفتوحة Open / قيد المراجعة In Progress / بانتظار العميل Waiting / مغلقة Closed).
* **إشعارات القراءة:** يوضح النظام ما إذا كانت رسالتك قد تمت قراءتها من قِبل المهندس المختص.

## خطوات فتح تذكرة دعم فني جديدة {#create-ticket}
1. انتقل إلى **الدعم الفني (Support Tickets)** في القائمة الجانبية (\`/app/tickets\`).
2. انقر على زر **تذكرة جديدة (New Ticket)**.
3. أدخل البيانات المطلوبة:
   * **موضوع التذكرة:** عنوان واضح يصف المشكلة (مثال: \`عدم تطابق ضريبة طلب #1042\`).
   * **نوع المشكلة (Category):** (ربط المتجر، ربط أودوو، مركز الخرائط، المخزون، أو الفوترة).
   * **مستوى الأولوية (Priority):** (عادي، مرتفع، أو عاجل للطلبات المتوقفة).
   * **تفاصيل المشكلة:** اشرح ما حدث مع ذكر أرقام الطلبات أو الـ SKU المعنية.
4. انقر على **إرسال التذكرة**.

## إرفاق لقطات الشاشة والصور المضغوطة {#attachments-and-images}
* يمكنك إرفاق لقطات الشاشة ورسائل الخطأ وصور شاشات أودوو مباشرة داخل التذكرة.
* يقوم النظام بضغط الصور وتحسين حجمها تلقائياً (\`ticket-chat-compact-images\`) لمنع استهلاك باقات البيانات وتسريع التحميل.
* يتم تأمين وفحص جميع المرفقات لمنع رفع أي ملفات مشبوهة أو تنفيذية.

## ربط التذاكر بنظام أودوو هيلب ديسك الداخلي {#odoo-helpdesk-integration}
تتميز تذاكر ERP Link بالربط الآلي مع نظام خدمة العملاء في أودوو (**Odoo Helpdesk**):
* بمجرد إرسال التذكرة، يتم فتح بطاقة (\`helpdesk.ticket\`) فوراً في نظام فريق الدعم مع إرفاق معرف مساحة العمل.
* أي رد يكتبه مهندس الدعم داخل أودوو يظهر لك فوراً داخل محادثة التطبيق دون أي تأخير.`,

      en: `## Support Tickets UI & Live Chat {#tickets-interface}
ERP Link features an integrated, real-time Helpdesk client directly within the dashboard (\`/app/tickets\`), connecting you to integration engineers without leaving your workspace:
* **Modern Chat Messenger Interface:** Send and receive real-time messages in a clean chronological thread.
* **Ticket Statuses:** (Open, In Progress, Waiting for Client, Closed).
* **Read Receipts:** Track when technical staff have inspected your message.

## Opening a New Support Ticket {#create-ticket}
1. Navigate to **Support Tickets** (\`/app/tickets\`) in the navigation bar.
2. Click **New Ticket**.
3. Fill out the submission form:
   * **Subject:** Concise summary (e.g. \`VAT discrepancy on Order #1042\`).
   * **Category:** (Store Connection, Odoo ERP, Mapping Center, Inventory, Billing).
   * **Priority:** (Low, Medium, High, Critical).
   * **Description:** Detail the observed behavior including order numbers and SKUs.
4. Click **Submit Ticket**.

## Image & Screenshot Attachments {#attachments-and-images}
* Attach error dialogs and Odoo UI screenshots directly in the message thread.
* Images are automatically compressed and optimized on upload (\`ticket-chat-compact-images\`) for rapid delivery.
* Secure attachment validation blocks untrusted binary file formats.

## Internal Odoo Helpdesk Synchronization {#odoo-helpdesk-integration}
Support tickets sync bi-directionally with our internal **Odoo Helpdesk**:
* Ticket creation provisions an authoritative \`helpdesk.ticket\` record tagged with your workspace ID.
* Engineer responses dispatched from Odoo stream live into your dashboard view without polling delays.`,
    },
  },
]
