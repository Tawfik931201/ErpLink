import type { GuideContent } from '../types'

export const shopifyOdooWebhooksGuide: GuideContent = {
  meta: {
    slug: 'shopify-odoo-webhooks',
    title: {
      ar: 'حل مشاكل Shopify Webhooks عند الربط بأودوو',
      en: 'Troubleshooting Shopify Webhooks with Odoo Integration',
    },
    h1Title: {
      ar: 'حل مشاكل Shopify Webhooks عند الربط بأودوو (Odoo): الدليل التقني والتشغيلي الشامل',
      en: 'Troubleshooting Shopify Webhooks for Odoo Integration: Real-Time Event Sync Guide',
    },
    description: {
      ar: 'دليل تشخيصي لحل مشاكل إشعارات الويب Webhooks في Shopify عند الربط بأودوو: التحقق من التوقيع، منع مهلة الـ 5 ثوانٍ، وتفادي حذف الاشتراكات وتكرار الطلبات.',
      en: 'Diagnostic guide to fixing Shopify webhook failures with Odoo: verifying HMAC signatures, beating 5-second timeouts with asynchronous queues, and avoiding duplicate orders.',
    },
    summary: {
      ar: 'يوضح هذا الدليل كيفية عمل Webhooks بين Shopify وأودوو، وأسباب توقف وصول الطلبات المفاجئ، وطرق معالجة مهلة الاستجابة وتوثيق التوقيع الرقمي بأمان.',
      en: 'Learn how Shopify webhooks transmit real-time transactions to Odoo, why subscription endpoints fail or drop, and how ERP Link asynchronous architecture ensures zero data loss.',
    },
    category: 'shopify-odoo',
    primaryKeyword: {
      ar: 'Shopify Odoo integration',
      en: 'Shopify Odoo integration',
    },
    secondaryKeywords: {
      ar: ['Shopify webhook not working', 'ربط شوبيفاي بأودوو', 'مشاكل مزامنة طلبات شوبيفاي', 'إشعارات الويب شوبيفاي أودوو'],
      en: ['Shopify webhook failure troubleshooting', 'Odoo Shopify webhook queue', 'Shopify HMAC signature verification', 'prevent duplicate Shopify orders in Odoo'],
    },
    readingTimeMinutes: 13,
    publishedAt: '2026-11-24',
    updatedAt: '2026-11-24',
    relatedPlatform: 'shopify',
    relatedIntegrationPath: '/integrations/shopify-odoo',
    relatedGuideSlugs: ['zid-odoo-setup', 'zid-odoo-stock-sync'],
    featured: true,
  },
  sections: [
    {
      id: 'why-webhooks-matter',
      title: {
        ar: 'ما وظيفة Webhooks ولماذا تعد أفضل من الاستعلام الدوري (Polling)؟',
        en: 'The Vital Role of Webhooks vs. Inefficient Polling in Shopify ERP Sync',
      },
      paragraphs: [
        {
          ar: 'في تكامل المتاجر الإلكترونية مع أنظمة ERP، هناك طريقتان لجلب الطلبات والبيانات:\n1. الاستعلام الدوري المجدول (Polling): يقوم النظام كل 10 أو 15 دقيقة بالاتصال بـ Shopify وسؤالها: "هل توجد طلبات جديدة؟". تؤدي هذه الطريقة إلى تأخر معالجة الطلبات، استهلاك غير مبرر لحدود الـ API، واحتمال بيع بضاعة غير متوفرة خلال فترة الانتظار.\n2. إشعارات الويب الفورية (Webhooks): بمجرد أن يضغط العميل على زر "إتمام الشراء" في متجر شوبيفاي، تقوم المنصة فورًا بإرسال حزمة بيانات الطلب عبر HTTP POST إلى نقطة استقبال ERP Link، ليتم إدخالها في أودوو خلال أجزاء من الثانية.',
          en: 'Integrating Shopify with an ERP system generally follows one of two architectural patterns:\n1. Periodic Polling: Querying the Shopify API every 10 or 15 minutes asking "Are there new orders?". This introduces unpalatable order latency, exhausts API rate limits, and risks overselling stock during the blind window.\n2. Event-Driven Webhooks: The millisecond a customer completes checkout, Shopify dispatches an HTTP POST payload to your integration endpoint. ERP Link ingests the event and confirms the transaction in Odoo instantaneously.',
        },
        {
          ar: 'ومع ذلك، فإن الـ Webhooks في Shopify تتطلب بنية تحتية صارمة للغاية؛ وأي بطء في الاستجابة أو خلل في التحقق من صحة الرسائل يؤدي إلى تعطل الربط وتوقف وصول الطلبات بصمت.',
          en: 'However, Shopify enforces rigid constraints on webhook subscribers. Any latency breach or misconfigured validation handshake results in dropped webhooks and silent order loss.',
        },
      ],
    },
    {
      id: 'app-install-vs-webhook-subscription',
      title: {
        ar: 'الفرق بين تثبيت التطبيق وتفعيل اشتراكات الأحداث الحقيقية',
        en: 'App Installation vs. Registering Active Webhook Event Subscriptions',
      },
      paragraphs: [
        {
          ar: 'من الأخطاء الشائعة اعتقاد أصحاب المتاجر أن مجرد تثبيت التطبيق في متجر Shopify يعني أن إشعارات الويب مفعلة تلقائيًا:',
          en: 'A frequent misconception among merchants is assuming that merely installing an app automatically activates all necessary background event hooks:',
        },
        {
          ar: '1. تثبيت التطبيق ومنح الصلاحيات (OAuth Authorization): يمنح تطبيق ERP Link رمز الوصول (Access Token) والصلاحيات اللازمة (Scopes مثل read_orders, read_products, write_inventory).\n2. تسجيل اشتراكات الأحداث (Webhook Subscriptions): خطوة مستقلة يقوم بها ERP Link برمجيًا عبر واجهة Shopify Admin GraphQL/REST API لتحديد الأحداث المطلوبة (مثل: orders/create, orders/updated, orders/paid, orders/fulfilled, inventory_levels/update) ورابط الاستقبال المخصص ورقم إصدار الـ API المعتمد.',
          en: '1. App Authorization (OAuth): Grants ERP Link valid access tokens and declared API scopes (read_orders, read_products, write_inventory).\n2. Registering Event Subscriptions: An independent programmatic step where ERP Link configures specific webhook topics (orders/create, orders/updated, orders/paid, orders/fulfilled, inventory_levels/update) directed to designated secure ingress endpoints, pinned to stable Shopify API versions.',
        },
      ],
    },
    {
      id: 'top-reasons-webhooks-fail',
      title: {
        ar: 'أبرز 4 أسباب لفشل وصول Shopify Webhooks وكيفية معالجتها',
        en: 'The Top 4 Root Causes of Shopify Webhook Failures and Their Fixes',
      },
      paragraphs: [
        {
          ar: 'إذا توقفت طلبات شوبيفاي عن الوصول إلى نظام أودوو، فإن السبب غالبًا ما ينحصر في أحد العوامل التقنية الأربعة التالية:',
          en: 'When Shopify transactions fail to reach your Odoo database, the root cause almost always traces back to one of the following 4 engineering hurdles:',
        },
      ],
      steps: [
        {
          title: {
            ar: '1. تجاوز مهلة الاستجابة (Shopify 5-Second Timeout Constraint)',
            en: '1. Exceeding the 5-Second Response Timeout',
          },
          text: {
            ar: 'تشترط شوبيفاي أن يرد خادم الاستقبال برمز نجاح (HTTP 200/202) خلال 5 ثوانٍ كحد أقصى. إذا كان نظام الربط يحاول تسجيل العميل، وفحص المخزون، وإنشاء أمر البيع في أودوو أثناء انتظار شوبيفاي على نفس الاتصال، فإن بطء خادم أودوو لبضع ثوانٍ يجعل شوبيفاي تعتبر الطلب فاشلًا وتقطع الاتصال. حل ERP Link: يعتمد نظامنا على الاستقبال غير المتزامن (Asynchronous Ingestion)، حيث يتم حفظ حزمة الطلب فورًا في طابور محمي والرد على شوبيفاي في أقل من 200 مللي ثانية، ثم تتولى المعالجات الخلفية كتابة الطلب في أودوو بأمان.',
            en: 'Shopify mandates that receiver endpoints return an HTTP 200/202 status code within 5 seconds. If an integration tries to contact Odoo, verify stock, and write records while holding the open connection, any transient latency triggers a timeout failure. ERP Link Solution: We employ fully asynchronous queuing, acknowledging Shopify payloads in under 200ms before processing transactions in background worker queues.',
          },
        },
        {
          title: {
            ar: '2. حذف شوبيفاي التلقائي للاشتراك بعد تكرار الفشل (Auto-Deletion)',
            en: '2. Shopify Automatic Webhook Pruning After 19 Failures',
          },
          text: {
            ar: 'وفقًا لتوثيق شوبيفاي الرسمي، إذا فشل رابط الـ Webhook في الاستجابة بنجاح لمدة 19 محاولة متتالية عبر فترات زمنية مختلفة، تقوم شوبيفاي بحذف اشتراك الـ Webhook نهائيًا دون سابق إنذار. حل ERP Link: يقوم فاحص الجاهزية لدينا بمراقبة حالة الاشتراكات دوريًا وإعادة تسجيل أي مسار مفقود تلقائيًا.',
            en: 'Under official Shopify developer policies, if an endpoint fails consecutively across 19 delivery attempts over several hours, Shopify permanently prunes and deletes the subscription. ERP Link Solution: Our health agent continuously audits active webhook registrations, automatically re-subscribing any dropped endpoints.',
          },
        },
        {
          title: {
            ar: '3. فشل التحقق من التوقيع الرقمي (X-Shopify-Hmac-Sha256 Mismatch)',
            en: '3. HMAC Signature Mismatch and Cryptographic Rejection',
          },
          text: {
            ar: 'ترسل شوبيفاي مع كل إشعار ترويسة X-Shopify-Hmac-Sha256 مشفرة بالمفتاح السري للتطبيق (Shared Secret). إذا قام خادم الاستقبال بتعديل المسافات أو قراءة جسم الطلب (Request Body) بعد معالجته أو قبل فحص البايتات الخام، يفشل التوثيق ويرفض الطلب برمز 401/403. يضمن ERP Link فحص البايتات الخام دون أي تعديل ومطابقة التوقيع بدقة متناهية.',
            en: 'Every inbound Shopify notification carries an X-Shopify-Hmac-Sha256 header generated with your app secret. If a server alters whitespace or parses the body as JSON before running HMAC against raw bytes, verification fails with a 401/403. ERP Link strictly verifies raw unmutated request buffers.',
          },
        },
        {
          title: {
            ar: '4. تكرار إرسال الأحداث (At-Least-Once Delivery)',
            en: '4. At-Least-Once Delivery Mechanics Creating Duplicate Orders',
          },
          text: {
            ar: 'تتبع شوبيفاي سياسة "التوصيل مرة واحدة على الأقل" (At-Least-Once Delivery). هذا يعني أنه في حالات عدم استقرار الشبكة، قد ترسل شوبيفاي نفس الطلب مرتين أو ثلاث مرات بفارق دقائق. إذا لم يمتلك النظام آلية حماية، فسيتم إنشاء أوامر بيع وفواتير مكررة في أودوو. يحمي ERP Link قاعدة بياناتك عبر فحص معرف الطلب (Shopify Order ID) ومنع التكرار نهائيًا.',
            en: 'Shopify guarantees at-least-once delivery. On transient network jitter, Shopify retries the same order payload multiple times. Without idempotency guards, duplicate Sales Orders and double invoices populate Odoo. ERP Link validates the platform Order ID to ensure each transaction is booked exactly once.',
          },
        },
      ],
      callout: {
        type: 'warning',
        title: {
          ar: 'تنبيه أمني هام بشأن المفاتيح السرية',
          en: 'Security Safeguards for Application Secrets',
        },
        text: {
          ar: 'لا تقم إطلاقًا بمشاركة الـ Shopify API Secret Key أو تضمينه في كود الواجهة الأمامية. يتم تخزين المفاتيح في ERP Link داخل خوادم مشفرة معزولة بالكامل عن المتصفحات وأدوات التتبع العامة.',
          en: 'Never expose your Shopify API Secret Key in client-side code or public repositories. ERP Link isolates cryptographic signing keys in hardened vault storage with zero browser exposure.',
        },
      },
    },
    {
      id: 'step-by-step-troubleshooting',
      title: {
        ar: 'خطوات عملية لفحص وإصلاح الـ Webhooks وإرسال حدث تجريبي',
        en: 'Step-by-Step Procedure to Test and Verify Webhook Deliveries',
      },
      paragraphs: [
        {
          ar: 'إذا كنت تشك في وجود خلل في وصول طلبات شوبيفاي، اتبع الخطوات التشغيلية التالية لاختبار الاتصال:',
          en: 'Follow this diagnostic workflow to test your webhook pipeline and confirm live delivery:',
        },
      ],
      steps: [
        {
          title: {
            ar: '1. فحص قائمة إشعارات الويب في لوحة تحكم Shopify Admin',
            en: '1. Inspect Webhooks in Shopify Admin',
          },
          text: {
            ar: 'من لوحة تحكم شوبيفاي، انتقل إلى Settings > Notifications، ثم انزل إلى قسم Webhooks. تحقق من وجود الأحداث المسجلة وروابطها والتأكد من أنها لا تظهر باللون الأحمر أو تسجل أخطاء إرسال متكررة.',
            en: 'In your Shopify Admin, navigate to Settings > Notifications, and scroll down to Webhooks. Verify that registered webhooks are active and not flagged with delivery failure badges.',
          },
        },
        {
          title: {
            ar: '2. إرسال إشعار تجريبي (Send Test Webhook)',
            en: '2. Trigger a Sample Webhook Notification',
          },
          text: {
            ar: 'اضغط على زر "Send test notification" بجوار حدث إنشاء الطلب (Order creation). سترسل شوبيفاي طلبًا تجريبيًا فوريًا إلى خوادم ERP Link.',
            en: 'Click "Send test notification" next to the Order creation topic. Shopify dispatches an immediate test payload to the ERP Link endpoint.',
          },
        },
        {
          title: {
            ar: '3. مراجعة سجلات المزامنة في لوحة تحكم ERP Link',
            en: '3. Review Inbound Receipts in ERP Link Sync Logs',
          },
          text: {
            ar: 'افتح صفحة السجلات (Sync Logs) في ERP Link: ستشاهد وصول الحدث التجريبي برمز نجاح 200 مع توثيق صحة التوقيع الرقمي، مما يثبت أن مسار الاتصال مفتوح وجاهز للتشغيل.',
            en: 'Open ERP Link Sync Logs: you will see the inbound test payload logged with HTTP 200 confirmation and verified HMAC signature, proving connectivity is fully operational.',
          },
        },
      ],
    },
  ],
  faqs: [
    {
      question: {
        ar: 'ماذا أفعل إذا توقفت الطلبات عن الوصول فجأة بعد تحديث قالب أو تطبيق في شوبيفاي؟',
        en: 'What if orders suddenly stop syncing after a theme or app update in Shopify?',
      },
      answer: {
        ar: 'ادخل إلى لوحة ERP Link واضغط على "إعادة التحقق من الاتصال" (Refresh Webhooks). سيقوم النظام بفحص صلاحيات الـ OAuth المسجلة وإعادة تثبيت اشتراكات الـ Webhooks فورًا إن كانت قد حُذفت.',
        en: 'Log into your ERP Link dashboard and execute "Refresh Webhooks". The system immediately re-validates OAuth tokens and re-provisions any missing webhook subscriptions with Shopify.',
      },
    },
    {
      question: {
        ar: 'هل يمكن مزامنة أوامر الشحن وتحديث رقم التتبع (Tracking Number) من أودوو إلى شوبيفاي؟',
        en: 'Can tracking numbers and fulfillments sync back from Odoo to Shopify?',
      },
      answer: {
        ar: 'نعم، عندما يقوم فريق المستودع بتأكيد أمر التسليم (stock.picking) في أودوو وإدخال رقم التتبع وشركة الشحن، يقوم ERP Link بإنشاء إشعار Fulfillment تلقائي في شوبيفاي وتغيير حالة الطلب إلى "مشحون" وإرسال رابط التتبع للعميل.',
        en: 'Yes. When warehouse staff validate delivery pickings in Odoo with tracking numbers and carriers, ERP Link calls the Shopify Fulfillment API, updating the order to Fulfilled and triggering the customer tracking email.',
      },
    },
  ],
  summaryKeyTakeaways: {
    ar: [
      'تعتمد موثوقية الـ Webhooks على الاستقبال غير المتزامن لتفادي مهلة الـ 5 ثوانٍ في شوبيفاي.',
      'احذر من التكرار عبر التأكد من وجود نظام حماية معتمد على معرف الطلب الفريد.',
      'تأكد من مطابقة إصدار الـ API المستخدم في شوبيفاي لضمان استقرار بنية البيانات.',
      'راجع سجلات ERP Link دوريًا للتأكد من سلامة وصول الأحداث وسرعة معالجتها في أودوو.',
    ],
    en: [
      'Asynchronous ingestion is essential to comply with Shopify 5-second response deadlines.',
      'Idempotency controls based on unique platform order IDs prevent duplicate Odoo Sales Orders.',
      'Pin webhook subscriptions to stable Shopify API versions to avoid breaking schema changes.',
      'Routinely inspect ERP Link sync logs to audit real-time order delivery and fulfillment states.',
    ],
  },
  officialDocLinks: [
    {
      label: { ar: 'دليل إشعارات الويب في شوبيفاي (Shopify Webhooks Documentation)', en: 'Shopify Webhooks Developer Guide' },
      url: 'https://shopify.dev/docs/apps/build/webhooks',
    },
    {
      label: { ar: 'دليل ربط الأنظمة الخارجية في أودوو (Odoo Web Services API)', en: 'Odoo Web Services Reference' },
      url: 'https://www.odoo.com/documentation/17.0/developer/reference/external_api.html',
    },
  ],
}
