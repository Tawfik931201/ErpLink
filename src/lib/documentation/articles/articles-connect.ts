import type { DocArticle } from '../docs-types'

export const articlesConnect: DocArticle[] = [
  {
    slug: 'connect/zid',
    category: 'connect',
    title: {
      ar: 'ربط متجر زد (Zid) بأودوو Odoo ERP',
      en: 'Connect Zid Store to Odoo ERP',
    },
    description: {
      ar: 'دليل تفصيلي لربط متجر زد عبر OAuth، تسجيل الويب هوكس، تشفير الرموز بـ AES-256، وتشغيل تطبيق زد المدمج داخل لوحة تحكم التاجر.',
      en: 'Comprehensive guide to connecting Zid via OAuth, registering webhooks, encrypting tokens with AES-256, and using the Zid Embedded App.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 7,
    headings: [
      { id: 'zid-oauth-flow', text: { ar: 'خطوات ربط متجر زد عبر OAuth 2.0', en: 'Zid OAuth 2.0 Connection Steps' }, level: 2 },
      { id: 'zid-permissions', text: { ar: 'صلاحيات وأذونات التطبيق المطلوبة', en: 'Required Scopes & Permissions' }, level: 2 },
      { id: 'zid-webhooks', text: { ar: 'استقبال الويب هوكس والتحقق الأمني', en: 'Webhook Ingress & Security' }, level: 2 },
      { id: 'zid-embedded', text: { ar: 'استخدام التطبيق المدمج داخل زد', en: 'Zid Embedded App within Dashboard' }, level: 2 },
      { id: 'zid-common-errors', text: { ar: 'أخطاء الربط الشائعة وطرق حلها', en: 'Common Errors & Troubleshooting' }, level: 2 },
    ],
    keywords: ['Zid', 'OAuth', 'Webhooks', 'Zid App', 'Embedded App', 'Store Connection'],
    content: {
      ar: `## خطوات ربط متجر زد عبر OAuth 2.0 {#zid-oauth-flow}
يدعم ERP Link بروتوكول **OAuth 2.0** الرسمي المعتمد من منصة زد، مما يتيح لك ربط متجرك بضغطة زر واحدة دون الحاجة لنسخ ولصق مفاتيح API يدوياً:

1. افتح لوحة تحكم ERP Link وتأكد من اختيار مساحة العمل الصحيحة.
2. من القائمة الجانبية، انتقل إلى **ربط المتجر (Connect Store)** وافتح تبويب **زد (Zid)** (\`/app/connect-store/zid\`).
3. انقر على زر **ربط متجر زد (Connect Zid Store)**.
4. سيتم تحويلك مباشرة إلى صفحة تسجيل الدخول والموافقة في منصة زد الرسمية (\`oauth.zid.sa\`).
5. راجع الصلاحيات المطلوبة وانقر على **موافقة / تفعيل التطبيق**.
6. يتم إرجاعك تلقائياً إلى منصة ERP Link، حيث يتم تبادل رمز التفويض (\`code\`) برمز وصول (\`access_token\`) ورمز تجديد (\`refresh_token\`).
7. تُحفظ الرموز فوراً في قاعدة البيانات مشفرة باستخدام خوارزمية **AES-256-GCM** (\`src/lib/crypto.ts\`).

:::tip
يقوم النظام تلقائياً بتجديد رمز الوصول عند اقتراب انتهائه دون أي انقطاع في الخدمة أو حاجة لإعادة تسجيل الدخول، مع استخدام قفل مانع للسباق (Mutex) لضمان عدم تجديد الرمز مرتين متزامنتين.
:::

## صلاحيات وأذونات التطبيق المطلوبة {#zid-permissions}
يطلب تطبيق ERP Link الصلاحيات التشغيلية الضرورية فقط لإتمام مهام المزامنة:
* **الطلبات (Orders):** قراءة تفاصيل الطلبات، خطوط المنتجات، العناوين، وحالات الدفع والشحن.
* **المنتجات والمخزون (Products & Inventory):** قراءة تفاصيل المنتجات والباركود والـ SKU وتحديث كميات المخزون المتوفرة للبيع.
* **العملاء (Customers):** قراءة بيانات العميل المسجل ورقم الجوال والبريد لإنشاء جهة الاتصال في أودوو.
* **الويب هوكس (Webhooks):** تسجيل إشعارات التحديث اللحظية للأحداث.

## استقبال الويب هوكس والتحقق الأمني {#zid-webhooks}
عند اكتمال الربط، يقوم ERP Link تلقائياً بالاشتراك في أحداث متجر زد الحيوية:
* \`order.create\` — عند إنشاء طلب جديد.
* \`order.status.update\` — عند تغيير حالة الطلب (مؤكد، قيد التجهيز، تم الشحن، ملغي).
* \`product.create\` / \`product.update\` — عند تعديل بيانات أو كميات المنتجات.

:::important
لحماية متجرك من الهجمات، يتم تأمين مسار استقبال زد (\`/api/webhooks/zid\`) عبر مصادقة **HTTP Basic Auth** مشتقة بمفتاح فريد لكل متجر باستخدام خوارزمية **HKDF-SHA256**. يرفض خادمنا أي طلب ويب هوك لا يحمل التوقيع الصحيح فوراً برمز \`401 Unauthorized\`.
:::

## استخدام التطبيق المدمج داخل زد {#zid-embedded}
إذا كنت تفضل إدارة عمليات المزامنة مباشرة من داخل لوحة تحكم متجر زد:
1. افتح لوحة تحكم زد وانتقل إلى **سوق التطبيقات > تطبيقاتي > ERP Link**.
2. سيتم فتح المنصة تلقائياً داخل إطار مدمج (Embedded Iframe).
3. يقوم النظام بتبادل تذكرة الجلسة المشفرة (\`token\`) وتوجيهك إلى مساحة العمل المرتبطة بمتجرك فوراً دون طلب تسجيل الدخول مجدداً.

## أخطاء الربط الشائعة وطرق حلها {#zid-common-errors}
* **خطأ "Zid Store Disconnected" أو "Invalid Token":**
  * *السبب:* قام التاجر بإلغاء تثبيت التطبيق من لوحة زد، أو انتهت صلاحية رمز التجديد بعد فترة طويلة من عدم النشاط.
  * *الحل:* انقر على زر **إعادة الربط (Reconnect)** في صفحة ربط المتجر لمنح ترخيص جديد.
* **الطلب لا يصل بعد إنشائه في زد:**
  * *الفحص:* افتح شاشة [السجلات](/docs/logs) أو [طابور العمليات](/docs/queue). إذا لم يظهر السجل، تأكد أن متجر زد لم يكن في وضع الصيانة، أو اضغط زر **تحديث الويب هوكس (Refresh Webhooks)** لإعادة الاشتراك.`,

      en: `## Zid OAuth 2.0 Connection Steps {#zid-oauth-flow}
ERP Link supports official **OAuth 2.0** authorization for Zid stores, allowing seamless connection with one click:

1. Open your ERP Link dashboard and verify your active workspace.
2. From the navigation menu, select **Connect Store** and choose the **Zid** tab (\`/app/connect-store/zid\`).
3. Click **Connect Zid Store**.
4. You will be redirected to Zid's official authorization portal (\`oauth.zid.sa\`).
5. Review the requested permissions and click **Authorize / Install App**.
6. You will be redirected back to ERP Link, where the authorization code is securely exchanged for an \`access_token\` and \`refresh_token\`.
7. Tokens are encrypted immediately using **AES-256-GCM** before database storage (\`src/lib/crypto.ts\`).

:::tip
The platform automatically refreshes the access token prior to expiration using a single-flight mutex lock, preventing simultaneous duplicate token refreshes.
:::

## Required Scopes & Permissions {#zid-permissions}
ERP Link requests only necessary operational permissions:
* **Orders:** Read orders, line items, customer shipping addresses, and payment statuses.
* **Products & Inventory:** Read product variants, barcodes, and SKUs; update available quantities.
* **Customers:** Read customer profiles, phone numbers, and emails to map contacts in Odoo.
* **Webhooks:** Register real-time event webhooks.

## Webhook Ingress & Security {#zid-webhooks}
Upon authorization, ERP Link subscribes to key store lifecycle events:
* \`order.create\` — Triggers upon new checkout completion.
* \`order.status.update\` — Triggers upon status transition (Confirmed, Preparing, Shipped, Cancelled).
* \`product.create\` / \`product.update\` — Triggers upon catalog or inventory adjustments.

:::important
To guard against spoofing, the Zid ingress endpoint (\`/api/webhooks/zid\`) is protected by **HTTP Basic Auth** derived via **HKDF-SHA256** per workspace. Unauthenticated deliveries are rejected immediately with \`401 Unauthorized\`.
:::

## Zid Embedded App within Dashboard {#zid-embedded}
You can access ERP Link directly within your Zid merchant admin:
1. Open your Zid Dashboard and navigate to **App Market > Installed Apps > ERP Link**.
2. The platform loads securely inside the admin iframe.
3. A single-use ticket exchange mechanism authenticates your merchant session automatically without re-entering credentials.

## Common Errors & Troubleshooting {#zid-common-errors}
* **"Zid Store Disconnected" or "Invalid Token":**
  * *Cause:* App uninstalled in Zid admin, or refresh token expired after extended downtime.
  * *Resolution:* Click **Reconnect** on the Zid settings page to refresh OAuth permissions.
* **Order not arriving after creation in Zid:**
  * *Check:* Inspect [Sync Logs](/docs/logs) or [Queue](/docs/queue). If absent, verify that webhooks are active or click **Refresh Webhooks** to re-register subscriptions.`,
    },
  },
  {
    slug: 'connect/salla',
    category: 'connect',
    title: {
      ar: 'ربط متجر سلة (Salla) بأودوو Odoo ERP',
      en: 'Connect Salla Store to Odoo ERP',
    },
    description: {
      ar: 'خطوات ربط متجر سلة عبر تطبيق سلة المعتمد، إعداد 29 حدث ويب هوك، مزامنة فروع المخزون، ومعالجة المرتجعات.',
      en: 'Connect Salla store via OAuth, configure 29 webhook event topics, sync branch inventory, and handle refunds.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 7,
    headings: [
      { id: 'salla-oauth-flow', text: { ar: 'خطوات الربط عبر تطبيق سلة الرسمي', en: 'Salla OAuth Connection Steps' }, level: 2 },
      { id: 'salla-scopes', text: { ar: 'أذونات وسياقات سلة', en: 'Salla Scopes & Contexts' }, level: 2 },
      { id: 'salla-webhooks', text: { ar: 'أحداث الويب هوكس الـ 29 والتوثيق المزدوج', en: '29 Subscribed Webhooks & Dual-Path Auth' }, level: 2 },
      { id: 'salla-stock-branches', text: { ar: 'مزامنة المخزون وتعدد الفروع في سلة', en: 'Salla Branch Inventory Sync' }, level: 2 },
      { id: 'salla-troubleshooting', text: { ar: 'استكشاف مشكلات ربط سلة', en: 'Salla Troubleshooting' }, level: 2 },
    ],
    keywords: ['Salla', 'OAuth', 'Webhooks', 'Branch Sync', 'Refunds', 'Store Connection'],
    content: {
      ar: `## خطوات الربط عبر تطبيق سلة الرسمي {#salla-oauth-flow}
يتم ربط متجر سلة عبر بوابة المطورين الرسمية لـ Salla Partners:

1. ادخل إلى لوحة تحكم ERP Link واختر مساحة العمل المطلوبة.
2. انتقل إلى **ربط المتجر (Connect Store)** واختر تبويب **سلة (Salla)** (\`/app/connect-store/salla\`).
3. انقر على زر **ربط متجر سلة (Connect Salla)**.
4. يتم نقلك إلى بوابة تصريح سلة (\`accounts.salla.sa/oauth2/auth\`).
5. قم بتسجيل الدخول بحساب مالك المتجر ووافق على تثبيت التطبيق.
6. يعيدك النظام إلى منصة ERP Link، حيث يتم حفظ رموز الدخول بأمان.

:::tip
تعتمد سلة على رموز تجديد تُستخدم **لمرة واحدة فقط** (\`single-use refresh tokens\`). يقوم محرك ERP Link بقفل العملية تشغيلياً أثناء التجديد لمنع انتهاء الجلسة إذا حدثت طلبات متزامنة في نفس اللحظة.
:::

## أذونات وسياقات سلة {#salla-scopes}
تشمل الصلاحيات الممنوحة من المتجر:
* \`offline_access\` — للسماح بتجديد الرموز في الخلفية أثناء معالجة الطلبات ليلاً.
* \`orders.read_write\` — لقراءة الطلبات وتحديث حالاتها وتتبع الشحنات.
* \`products.read_write\` — لقراءة الكتالوج ومزامنة كميات المخزون بالفروع.
* \`customers.read\` — لمطابقة بيانات العملاء.

## أحداث الويب هوكس الـ 29 والتوثيق المزدوج {#salla-webhooks}
يشترك ERP Link في **29 حدثاً معتمداً** في سلة تغطي:
* إنشاء وتحديث الطلبات (\`order.created\`, \`order.updated\`, \`order.status.updated\`).
* الدفع والشحن (\`order.payment.updated\`, \`order.shipping.address.updated\`).
* المرتجعات واسترداد المبالغ (\`order.refunded\`).
* المنتجات والمخزون (\`product.created\`, \`product.updated\`, \`product.deleted\`).

**التوثيق المزدوج (Dual-Path Auth):**
يتحقق خادمنا من أمان إشعارات سلة عبر مسارين معتمدين:
1. توقيع **HMAC-SHA256** السري الأصلي من سلة.
2. ترويسة المصادقة المشتقة عبر **HKDF** الخاصة بالمتجر (\`X-ERP-Webhook-Secret\`).

## مزامنة المخزون وتعدد الفروع في سلة {#salla-stock-branches}
تتميز منصة سلة بدعم إدارة الفروع المتعددة. عندما تتغير كمية المخزون في مستودع أودوو:
* يقوم ERP Link باستدعاء واجهة الكميات المجمعة (\`quantities/bulk API\`) في سلة.
* يتم تحديث رصيد الفرع المطابق لمستودع أودوو بدقة دون التأثير على أرصدة الفروع الأخرى غير المربوطة.

## استكشاف مشكلات ربط سلة {#salla-troubleshooting}
* **رسالة "invalid_grant" أثناء تجديد الرمز:**
  * *السبب:* تم تثبيت تطبيق آخر أو تمت إعادة المصادقة من متصفح آخر مما ألغى رمز التجديد السابق.
  * *الحل:* انقر على **إعادة الربط (Reconnect)** في شاشة سلة داخل ERP Link.
* **ظهور حالة Skipped للحدث \`app.uninstalled\`:**
  * *التوضيح:* هذا تصرف طبيعي ومحمي في الكود لضمان عدم حذف أي بيانات محاسبية أو سجلات سابقة للمتجر عند إلغاء التثبيت.`,

      en: `## Salla OAuth Connection Steps {#salla-oauth-flow}
Connect your Salla store using the official Salla Partners OAuth authorization flow:

1. Open your ERP Link dashboard and select your target workspace.
2. Go to **Connect Store** and choose the **Salla** tab (\`/app/connect-store/salla\`).
3. Click **Connect Salla**.
4. You are redirected to Salla's authorization portal (\`accounts.salla.sa/oauth2/auth\`).
5. Sign in as store owner and authorize the integration app.
6. The system returns you to ERP Link with encrypted stored credentials.

:::tip
Salla uses **single-use refresh tokens**. ERP Link implements an atomic mutex lock during token exchanges to prevent race conditions during concurrent webhook bursts.
:::

## Salla Scopes & Contexts {#salla-scopes}
Required scopes include:
* \`offline_access\` — Allows background token refresh without requiring manual merchant login.
* \`orders.read_write\` — Read orders and update fulfillment/shipping status.
* \`products.read_write\` — Read catalog and push branch inventory adjustments.
* \`customers.read\` — Resolve customer identities in Odoo.

## 29 Subscribed Webhooks & Dual-Path Auth {#salla-webhooks}
ERP Link registers **29 distinct webhook topics** covering:
* Orders & Status: \`order.created\`, \`order.updated\`, \`order.status.updated\`.
* Payments & Logistics: \`order.payment.updated\`, \`order.shipping.address.updated\`.
* Returns & Refunds: \`order.refunded\`.
* Catalog & Stock: \`product.created\`, \`product.updated\`, \`product.deleted\`.

**Dual-Path Ingress Authentication:**
Our webhook ingress verifies authenticity through two validated strategies:
1. Native Salla **HMAC-SHA256** signature verification.
2. Derived workspace **HKDF** header verification (\`X-ERP-Webhook-Secret\`).

## Salla Branch Inventory Sync {#salla-stock-branches}
Salla supports granular multi-branch stock levels. When inventory moves in Odoo:
* ERP Link calls Salla's bulk quantities API (\`quantities/bulk\`).
* The exact store branch mapped to the source Odoo warehouse is adjusted without disturbing unrelated store locations.

## Salla Troubleshooting {#salla-troubleshooting}
* **"invalid_grant" error during token refresh:**
  * *Cause:* A secondary authorization invalidated the single-use refresh token.
  * *Resolution:* Click **Reconnect** in ERP Link's Salla connection tab.
* **Skipped status on \`app.uninstalled\` event:**
  * *Explanation:* Expected safe behavior. The engine marks this event skipped to protect your historical accounting records.`,
    },
  },
  {
    slug: 'connect/shopify',
    category: 'connect',
    title: {
      ar: 'ربط متجر شوبيفاي (Shopify) بأودوو Odoo ERP',
      en: 'Connect Shopify Store to Odoo ERP',
    },
    description: {
      ar: 'دليل ربط متاجر Shopify عبر OAuth الرسمي، نطاقات التطبيق (App Scopes)، تسجيل Webhooks، وتوضيح السلوك الفعلي للمخزون والمرتجعات.',
      en: 'Connect Shopify stores via official OAuth, app scopes, webhooks, and verified behaviors for orders, stock, and returns.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 6,
    headings: [
      { id: 'shopify-oauth', text: { ar: 'خطوات ربط متجر شوبيفاي عبر OAuth', en: 'Shopify OAuth Connection Steps' }, level: 2 },
      { id: 'shopify-scopes', text: { ar: 'نطاقات التطبيق وحماية بيانات العملاء', en: 'App Scopes & Customer Data Protection' }, level: 2 },
      { id: 'shopify-webhooks', text: { ar: 'إشعارات الويب هوكس والتحقق بـ HMAC', en: 'Webhook Ingress & HMAC Checks' }, level: 2 },
      { id: 'shopify-limitations', text: { ar: 'السلوكيات والحدود المؤكدة في الكود', en: 'Code-Verified Behaviors & Current Scope' }, level: 2 },
      { id: 'shopify-troubleshooting', text: { ar: 'أخطاء شوبيفاي الشائعة', en: 'Shopify Troubleshooting' }, level: 2 },
    ],
    keywords: ['Shopify', 'OAuth', 'HMAC', 'Admin API', 'Store Connection', 'Webhooks'],
    content: {
      ar: `## خطوات ربط متجر شوبيفاي عبر OAuth {#shopify-oauth}
يستخدم ERP Link واجهة **Shopify Admin API (إصدار 2026-10)** الرسمية لربط المتاجر:

1. ادخل إلى لوحة تحكم ERP Link واختر مساحة العمل.
2. انتقل إلى **ربط المتجر (Connect Store)** واختر تبويب **شوبيفاي (Shopify)** (\`/app/connect-store/shopify\`).
3. أدخل نطاق متجرك بصيغة \`your-store.myshopify.com\`.
4. انقر على **تثبيت التطبيق على شوبيفاي (Install on Shopify)**.
5. سيتم تحويلك إلى لوحة إدارة متجرك في شوبيفاي لمراجعة الصلاحيات والموافقة.
6. يقوم خادمنا بالتحقق الصارم من توقيع الاستعلام (\`HMAC query validation\`) ثم حفظ رمز الوصول غير المقيد (\`offline access token\`).

## نطاقات التطبيق وحماية بيانات العملاء {#shopify-scopes}
يطلب تطبيق ERP Link الصلاحيات التالية:
* \`read_orders\`, \`write_orders\` — لقراءة الطلبات وتحديث حالات التنفيذ (Fulfillment).
* \`read_products\`, \`write_products\` — لقراءة الكتالوج والمنتجات والمتغيرات وتحديث الحقول المخصصة.
* \`read_customers\` — لمطابقة العملاء وإنشاء جهة الاتصال في أودوو.
* \`read_inventory\` — لقراءة مواقع المخزون في شوبيفاي.

:::important
وفقاً لسياسات شوبيفاي لحماية بيانات العملاء (Protected Customer Data)، يجب أن تكون بيانات العميل محصورة لأغراض معالجة الطلبات وإصدار الفواتير فقط.
:::

## إشعارات الويب هوكس والتحقق بـ HMAC {#shopify-webhooks}
يسجل النظام تلقائياً اشتراكات Webhooks مع ترويسة التحقق الرسمية \`X-Shopify-Hmac-Sha256\`:
* \`orders/create\` — عند إنشاء الطلب.
* \`orders/updated\` — عند تعديل الطلب.
* \`orders/paid\` — عند اكتمال الدفع.
* \`orders/cancelled\` — عند إلغاء الطلب.
* \`products/create\`, \`products/update\` — لتحديث بيانات المنتجات.

## السلوكيات والحدود المؤكدة في الكود {#shopify-limitations}
بناءً على الفحص الفعلي للكود المصدري للمشروع (\`src/lib/sync/shopify/\`):
* **الطلبات:** يتم مزامنة الطلبات بالكامل مع استخراج الضرائب والشحن والخصومات وأمر البيع في أودوو.
* **المنتجات:** يتم استيراد المنتجات والمتغيرات والـ SKU وربطها بالكتالوج في أودوو.
* **المخزون العكسي (Odoo -> Shopify):** *غير مفعل حالياً في الكود.* تحديث المخزون من أودوو إلى شوبيفاي غير مدعوم في الوقت الراهن مقارنة بزد وسلة.
* **المرتجعات (Returns):** حدث المرتجع \`refunds/create\` يرجع قيمة فارغة (\`null\`) ويتم تخطيه تلقائياً دون إنشاء إشعار دائن في أودوو.

## أخطاء شوبيفاي الشائعة {#shopify-troubleshooting}
* **خطأ "Invalid Shopify Domain":**
  * *الحل:* تأكد من إدخال النطاق الأصلي للمتجر الذي ينتهي بـ \`.myshopify.com\` وليس النطاق المخصص (Custom Domain).
* **خطأ "HMAC verification failed":**
  * *السبب:* تلاعب في معلمات الرابط أو انتهاء صلاحية جلسة التفويض.
  * *الحل:* أعد فتح شاشة الربط واضغط زر التثبيت مجدداً.`,

      en: `## Shopify OAuth Connection Steps {#shopify-oauth}
ERP Link connects to Shopify via the official **Shopify Admin API (2026-10 release)**:

1. Open your ERP Link dashboard and select your workspace.
2. Navigate to **Connect Store** and open the **Shopify** tab (\`/app/connect-store/shopify\`).
3. Enter your store myshopify domain (e.g. \`your-store.myshopify.com\`).
4. Click **Install on Shopify**.
5. You are redirected to your Shopify admin to review permissions and authorize the app.
6. Our backend performs strict query HMAC validation before securely storing the offline access token.

## App Scopes & Customer Data Protection {#shopify-scopes}
Requested scopes include:
* \`read_orders\`, \`write_orders\` — Ingest orders and push fulfillment status.
* \`read_products\`, \`write_products\` — Sync product catalog and variants.
* \`read_customers\` — Map customers to Odoo \`res.partner\` records.
* \`read_inventory\` — Read Shopify location inventory levels.

:::important
In compliance with Shopify's Protected Customer Data requirements, customer details are used strictly for order fulfillment and invoice generation.
:::

## Webhook Ingress & HMAC Checks {#shopify-webhooks}
The engine subscribes to Shopify webhooks verified against \`X-Shopify-Hmac-Sha256\`:
* \`orders/create\` — When a checkout completes.
* \`orders/updated\` — When order properties or status changes.
* \`orders/paid\` — When payment captures successfully.
* \`orders/cancelled\` — When an order is cancelled.
* \`products/create\`, \`products/update\` — For catalog sync.

## Code-Verified Behaviors & Current Scope {#shopify-limitations}
Based on direct source code audit of \`src/lib/sync/shopify/\`:
* **Orders:** Fully supported with tax, discount, shipping line extraction, and Odoo sales orders.
* **Products:** Fully supported with variant resolution, barcode, and SKU alignment.
* **Reverse Stock Sync (Odoo -> Shopify):** *Not currently implemented.* Odoo-to-Shopify live inventory push is not active in the current release.
* **Returns & Refunds:** The \`refunds/create\` webhook handler resolves to \`null\` and is skipped by design.

## Shopify Troubleshooting {#shopify-troubleshooting}
* **"Invalid Shopify Domain":**
  * *Resolution:* Enter your permanent \`*.myshopify.com\` address, not your custom storefront domain.
* **"HMAC verification failed":**
  * *Cause:* Tampered query parameters or expired authorization session.
  * *Resolution:* Restart the installation flow from the ERP Link dashboard.`,
    },
  },
  {
    slug: 'connect/odoo',
    category: 'connect',
    title: {
      ar: 'ربط نظام أودوو Odoo ERP (الإصدارات 14 إلى 20)',
      en: 'Connect Odoo ERP (Versions 14 through 20)',
    },
    description: {
      ar: 'دليل ربط أودوو عبر XML-RPC وJSON-RPC، فحص الاتصال، اختيار قاعدة البيانات والشركة والمستودع، ومصفوفة توافق الإصدارات.',
      en: 'Connect Odoo ERP via XML-RPC and JSON-RPC, test connections, configure multi-company/warehouse settings, and review version compatibility.',
    },
    lastUpdated: '2026-11-24',
    readTimeMinutes: 8,
    headings: [
      { id: 'odoo-credentials', text: { ar: 'بيانات الاتصال المطلوبة وإعداد مستخدم أودوو', en: 'Required Credentials & Odoo User Setup' }, level: 2 },
      { id: 'test-and-select', text: { ar: 'فحص الاتصال واختيار الشركة والمستودع', en: 'Testing Connection & Selecting Company' }, level: 2 },
      { id: 'version-compatibility', text: { ar: 'مصفوفة دعم وتوافق إصدارات أودوو (14-20)', en: 'Odoo Version Compatibility Matrix (14-20)' }, level: 2 },
      { id: 'security-and-ssrf', text: { ar: 'الحماية الأمنية وفحص الروابط (SSRF)', en: 'Security & SSRF URL Validation' }, level: 2 },
      { id: 'odoo-errors', text: { ar: 'أخطاء اتصال أودوو الشائعة', en: 'Common Odoo Connection Errors' }, level: 2 },
    ],
    keywords: ['Odoo', 'XML-RPC', 'JSON-RPC', 'Odoo 17', 'Odoo 18', 'Odoo 19', 'Odoo 20', 'API Key', 'Connection'],
    content: {
      ar: `## بيانات الاتصال المطلوبة وإعداد مستخدم أودوو {#odoo-credentials}
يتصل ERP Link بنظام أودوو باستخدام واجهات النداء الإجرائي عن بُعد (**XML-RPC** و **JSON-RPC**) المدمجة رسمياً في أودوو، مما يعني أنك **لست بحاجة لتثبيت أي موديول خارجي إضافي** في أودوو للبدء.

### تجهيز مستخدم أودوو:
1. ادخل إلى نظام أودوو بصلاحيات مسؤول (Administrator).
2. انتقل إلى \`الإعدادات > المستخدمون والشركات > المستخدمون\`.
3. أنشئ مستخدماً مخصصاً للربط (مثال: \`erplink_sync\`).
4. امنح المستخدم الصلاحيات التالية:
   * **المبيعات (Sales):** مدير (Administrator).
   * **المحاسبة (Accounting):** محاسب أو مدير الفواتير (Accountant / Invoicing Manager).
   * **المخزون (Inventory):** مدير (Administrator).
5. من داخل ملف المستخدم، افتح تبويب **أمان الحساب (Account Security)** وأنشئ **مفتاح API جديد (API Key)** (موصى به بدلاً من كلمة المرور العادية لتعزيز الأمان).

## فحص الاتصال واختيار الشركة والمستودع {#test-and-select}
1. في لوحة تحكم ERP Link، انتقل إلى **الاتصال بأودوو (Connect ERP)** (\`/app/connect-odoo\`).
2. أدخل بيانات الخادم:
   * **رابط خادم أودوو (URL):** رابط الخادم الآمن يبدأ بـ \`https://\` (مثال: \`https://mycompany.odoo.com\`).
   * **اسم قاعدة البيانات (Database):** اسم قاعدة البيانات في خادمك.
   * **اسم المستخدم (Username):** البريد الإلكتروني لمستخدم الربط.
   * **مفتاح API / كلمة المرور (API Key / Password):** المفتاح الذي قمت بإنشائه.
3. انقر على زر **فحص الاتصال (Test Connection)**.
4. يتصل خادمنا بأودوو، ويتحقق من المصادقة، ويكتشف رقم إصدار أودوو الدقيق تلقائياً.
5. بعد نجاح الفحص، تظهر قوائم منسدلة ديناميكية تم جلبها مباشرة من خادمك:
   * **الشركة (Company):** اختر الشركة التابعة للمتجر (في حال تفعيل نظام الشركات المتعددة).
   * **المستودع الافتراضي (Default Warehouse):** اختر المستودع الذي ستصدر منه أذونات تسليم الطلبات.
6. انقر على **حفظ الإعدادات (Save Connection)**.

## مصفوفة دعم وتوافق إصدارات أودوو (14-20) {#version-compatibility}
تم فحص واختبار توافق محرك ERP Link مع مختلف إصدارات أودوو عبر 187 حزمة اختبار تشمل أكثر من 2,354 اختباراً معتمداً:

| إصدار Odoo | دعم الاتصال | التوزيع التحليلي | حقل الجوال في العملاء | قيود المخزون والاستلام |
|---|---|---|---|---|
| **Odoo 14** | مدعوم بالكامل | \`analytic_account_id\` | مدعوم (\`mobile\`) | القيود القياسية |
| **Odoo 15** | مدعوم بالكامل | \`analytic_account_id\` | مدعوم (\`mobile\`) | القيود القياسية |
| **Odoo 16** | مدعوم بالكامل | \`analytic_account_id\` | مدعوم (\`mobile\`) | القيود القياسية |
| **Odoo 17** | مدعوم بالكامل | \`analytic_distribution\` (JSON) | مدعوم (\`mobile\`) | دعم شجرة التوزيع الحديثة |
| **Odoo 18** | مدعوم بالكامل | \`analytic_distribution\` (JSON) | مدعوم (\`mobile\`) | دعم شجرة التوزيع الحديثة |
| **Odoo 19** | مدعوم بالكامل | \`analytic_distribution\` (JSON) | تم حذفه في أودوو 19 (يتخطاه محركنا تلقائياً) | واجهة تسليم حديثة |
| **Odoo 20** | مدعوم بالكامل | \`analytic_distribution\` (JSON) | فحص حقول الآباء والأبناء في جهات الاتصال | اعتماد إشعارات الدائن ومرتجع الشحنات المتطورة |

:::tip
يتعرف المحرك تلقائياً على رقم إصدار أودوو (\`parseOdooVersionInfo\`) ويتعامل مع الفروقات البرمجية في الحقول دون أي تدخل منك.
:::

## الحماية الأمنية وفحص الروابط (SSRF) {#security-and-ssrf}
لحماية البنية التحتية من هجمات تزوير الطلبات من جانب الخادم (SSRF):
* يرفض النظام تماماً أي روابط تشير إلى عناوين محلية أو داخلية مثل \`localhost\`، \`127.0.0.1\`، أو نطاقات شبكات الشركات الخاصة \`192.168.x.x\` و \`10.x.x.x\`.
* يجب أن يكون خادم أودوو متاحاً عبر نطاق عام وشهادة أمان HTTPS صالحة.

## أخطاء اتصال أودوو الشائعة {#odoo-errors}
* **خطأ "Access Denied" أو فشل المصادقة:**
  * *السبب:* اسم المستخدم أو مفتاح API غير صحيح، أو قاعدة البيانات غير مطابقة.
  * *الحل:* تأكد من نسخ مفتاح API كاملاً، وتحقق من اسم قاعدة البيانات كما يظهر في شاشة \`/web/database/selector\`.
* **خطأ "Cannot connect to server" أو Timeout:**
  * *السبب:* جدار الحماية (Firewall) في خادم أودوو يحظر الاتصالات الخارجية، أو الخادم متوقف.
  * *الحل:* تأكد أن خادم أودوو متاح عبر المتصفح من شبكة خارجية وتأكد من فتح منفذ HTTPS (443).`,

      en: `## Required Credentials & Odoo User Setup {#odoo-credentials}
ERP Link connects to Odoo via native **XML-RPC** and **JSON-RPC** protocols, meaning **no custom third-party modules or apps are required** inside your Odoo instance.

### Setting Up the Odoo Integration User:
1. Sign in to your Odoo instance as an Administrator.
2. Navigate to \`Settings > Users & Companies > Users\`.
3. Create a dedicated integration user (e.g., \`erplink_sync\`).
4. Assign the following access rights:
   * **Sales:** Administrator.
   * **Accounting:** Accountant or Invoicing Manager.
   * **Inventory:** Administrator.
5. In the user form, open the **Account Security** tab and generate a new **API Key** (strongly recommended over plain passwords).

## Testing Connection & Selecting Company {#test-and-select}
1. In your ERP Link dashboard, navigate to **Connect Odoo** (\`/app/connect-odoo\`).
2. Input your connection parameters:
   * **Odoo URL:** Your secure HTTPS instance address (e.g., \`https://mycompany.odoo.com\`).
   * **Database Name:** Exact database name.
   * **Username:** Email address of your integration user.
   * **API Key / Password:** The API key generated above.
3. Click **Test Connection**.
4. Our server initiates an XML-RPC handshake, authenticates the session, and auto-detects the exact Odoo version.
5. Upon success, dynamic dropdowns populate from your live ERP:
   * **Company:** Choose the operating company matching this store.
   * **Default Warehouse:** Choose the warehouse from which stock pickings originate.
6. Click **Save Connection**.

## Odoo Version Compatibility Matrix (14-20) {#version-compatibility}
ERP Link's Odoo engine is thoroughly verified across Odoo releases via 187 test suites (2,354 unit tests):

| Odoo Version | Connection Status | Analytic Distribution | Partner Mobile Field | Delivery & Picking Rules |
|---|---|---|---|---|
| **Odoo 14** | Fully Supported | \`analytic_account_id\` | Supported (\`mobile\`) | Standard pickings |
| **Odoo 15** | Fully Supported | \`analytic_account_id\` | Supported (\`mobile\`) | Standard pickings |
| **Odoo 16** | Fully Supported | \`analytic_account_id\` | Supported (\`mobile\`) | Standard pickings |
| **Odoo 17** | Fully Supported | \`analytic_distribution\` (JSON) | Supported (\`mobile\`) | Modern analytic multi-plan model |
| **Odoo 18** | Fully Supported | \`analytic_distribution\` (JSON) | Supported (\`mobile\`) | Modern analytic multi-plan model |
| **Odoo 19** | Fully Supported | \`analytic_distribution\` (JSON) | Removed in Odoo 19 (Auto-omitted by engine) | Modern delivery validation |
| **Odoo 20** | Fully Supported | \`analytic_distribution\` (JSON) | Guarded child/parent contact schemas | Advanced reversal pickings & credit notes |

:::tip
Our engine automatically parses server version details (\`parseOdooVersionInfo\`) and adapts RPC payloads dynamically without manual adjustments.
:::

## Security & SSRF URL Validation {#security-and-ssrf}
To safeguard against Server-Side Request Forgery (SSRF):
* Connection attempts to internal IP addresses (\`localhost\`, \`127.0.0.1\`, \`192.168.x.x\`, \`10.x.x.x\`) are strictly blocked.
* Odoo servers must be publicly reachable over valid HTTPS certificates.

## Common Odoo Connection Errors {#odoo-errors}
* **"Access Denied" or Authentication Failure:**
  * *Cause:* Incorrect username, API key, or database name.
  * *Resolution:* Re-verify database name via \`/web/database/selector\` and ensure API key is copied accurately.
* **"Cannot connect to server" or Request Timeout:**
  * *Cause:* Odoo firewall or hosting provider blocking inbound XML-RPC requests.
  * *Resolution:* Ensure port 443 (HTTPS) is accessible externally.`,
    },
  },
]
