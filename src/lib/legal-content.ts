import { PUBLIC_CONTACT_EMAIL } from '@/lib/public-contact'

export const TERMS_LAST_UPDATED = {
  ar: '24 نوفمبر 2026',
  en: 'November 24, 2026',
  iso: '2026-11-24',
} as const

export const PRIVACY_LAST_UPDATED = {
  ar: '24 نوفمبر 2026',
  en: 'November 24, 2026',
  iso: '2026-11-24',
} as const

export interface LegalSection {
  id: string
  number: number
  ar: {
    title: string
    summary?: string
    paragraphs: string[]
    bullets?: string[]
    callout?: string
  }
  en: {
    title: string
    summary?: string
    paragraphs: string[]
    bullets?: string[]
    callout?: string
  }
}

export const termsSections: LegalSection[] = [
  {
    id: 'definitions',
    number: 1,
    ar: {
      title: 'التعريفات والمصطلحات',
      summary: 'توضيح المفاهيم والمصطلحات المستخدمة في هذه الاتفاقية لتفادي أي التباس في تفسير البنود.',
      paragraphs: [
        'يقصد بالكلمات والعبارات التالية حيثما وردت في هذه الشروط والأحكام المعاني الموضحة أمام كل منها:',
      ],
      bullets: [
        'ERP Link ("المنصة" أو "الخدمة" أو "نحن"): منصة برمجيات كخدمة لتكامل البيانات وتسهيل المزامنة الآلية بين المتاجر الإلكترونية وأنظمة إدارة الموارد.',
        'العميل أو التاجر ("أنت"): المنشأة التجارية أو الكيان أو الشخص المفوض الذي يسجل حسابًا في المنصة لربط متاجره وأنظمته.',
        'المستخدم: أي شخص مخول بالوصول إلى مساحة عمل التاجر عبر وسيلة مصادقة صالحة.',
        'الحساب ومساحة العمل (Workspace): البيئة الرقمية المخصصة للمشترك لإدارة تكاملات المتاجر، خرائط الحقول، وتتبع عمليات المزامنة.',
        'المتجر المتصل: المتجر الإلكتروني المسجل عبر منصات مستقلة (مثل زد، سلة، أو شوبيفاي) والذي يمنح التاجر صلاحية ربطه بالمنصة.',
        'نظام الـ ERP: نظام تخطيط وإدارة الموارد الخاص بالعميل (مثل أودو Odoo) والذي يتم ربطه لتبادل البيانات التشغيلية والمحاسبية.',
        'بيانات العميل والمتجر: كافة المعلومات والسجلات والطلبات والمنتجات والعملاء التي يتيحها التاجر لـ ERP Link لمعالجتها ومزامنتها.',
        'خدمات الأطراف الثالثة: الأنظمة والمنصات السحابية المستقلة التي لا تمتلكها المنصة ولا تخضع لإدارتها المباشرة.',
      ],
    },
    en: {
      title: 'Definitions & Interpretation',
      summary: 'Key terms and operational concepts governing these Terms and Conditions.',
      paragraphs: [
        'Throughout these Terms and Conditions, the following capitalized terms shall have the meanings set forth below:',
      ],
      bullets: [
        'ERP Link ("Platform", "Service", "We", "Us"): The software-as-a-service integration platform facilitating automated data synchronization between e-commerce stores and enterprise resource planning (ERP) systems.',
        'Client or Merchant ("You", "Your"): The commercial enterprise, merchant, or authorized legal representative creating an account to integrate stores and ERP environments.',
        'User: Any authorized individual accessing a Merchant Workspace using valid authentication credentials.',
        'Account & Workspace: The dedicated digital environment allocated to the Merchant to manage connections, field mappings, and audit sync activity.',
        'Connected Store: An external e-commerce store operating on an independent platform (e.g., Zid, Salla, or Shopify) linked by the Merchant.',
        'ERP System: The enterprise resource planning software designated by the Merchant (e.g., Odoo) connected to synchronize operational and accounting data.',
        'Customer & Store Data: All data, orders, products, inventory records, and customer details made accessible by the Merchant for processing and synchronization.',
        'Third-Party Services: Independent external platforms, APIs, and cloud services not owned or operated by ERP Link.',
      ],
    },
  },
  {
    id: 'acceptance',
    number: 2,
    ar: {
      title: 'قبول الشروط ونطاق سريانها',
      summary: 'قواعد التزام المشترك بالشروط وأثر استخدام المنصة والخدمات المرتبطة بها.',
      paragraphs: [
        'تحكم هذه الشروط والأحكام وصولك إلى منصة ERP Link واستخدامك لجميع الخدمات والتكاملات وأدوات المزامنة التابعة لها. يشكل إنشاؤك لحساب في المنصة، أو دخولك إلى مساحة العمل، أو ربط أي متجر أو نظام ERP، موافقة تعاقدية ملزمة بهذه الشروط وتعهداً بالامتثال لكافة بنودها.',
        'إذا كنت تستخدم المنصة نيابة عن كيان تجاري أو مؤسسي، فإنك تقر وتضمن بأن لديك الصلاحية القانونية والتوكيل النظامي لإلزام هذا الكيان بهذه الشروط. وفي حال عدم موافقتك على أي بند من هذه الشروط، يتعين عليك الامتناع فوراً عن استخدام الخدمة وإلغاء أي ارتباطات قائمة.',
      ],
    },
    en: {
      title: 'Acceptance of Terms & Scope',
      summary: 'The contractual basis and binding effect of accessing or utilizing ERP Link services.',
      paragraphs: [
        'These Terms and Conditions govern your access to and use of the ERP Link platform, integrations, and related synchronization tools. By creating an account, logging into a workspace, or connecting an e-commerce store or ERP system, you enter into a legally binding agreement and agree to comply with all provisions herein.',
        'If you access or use the Service on behalf of a commercial business entity, you represent and warrant that you possess full legal authorization to bind that entity to these Terms. If you do not accept these Terms in their entirety, you must immediately cease accessing and using the Service.',
      ],
    },
  },
  {
    id: 'services',
    number: 3,
    ar: {
      title: 'وصف الخدمة ونطاق التراخيص',
      summary: 'طبيعة خدمات المنصة كأداة تكامل سحابية ومجال التراخيص التقنية الممنوحة.',
      paragraphs: [
        'تعمل منصة ERP Link كمنصة تكامل برمجية سحابية (iPaaS) توفر للمتاجر الإلكترونية حلول الربط التقني والمزامنة المؤتمتة مع أنظمة إدارة الموارد. وتشمل الخدمة بحسب الإعدادات المفعلة وباقة الاشتراك:',
      ],
      bullets: [
        'مزامنة البيانات التشغيلية: تدفق بيانات الطلبات الجديدة والمحدثة، المنتجات، الفئات، مستويات المخزون، وحسابات العملاء.',
        'مركز تخصيص ومطابقة الحقول (Mapping Center): أدوات متقدمة لتحديد مسارات الحقول، وتعيين مراكز التكلفة، وربط الضرائب وطرق الدفع والشحن.',
        'إدارة الاتصالات والاعتماديات: الربط الآمن عبر واجهات البرمجة التطبيقية (APIs) وتوكنات التفويض وWebhooks الموثقة.',
        'سجلات التشغيل والمراقبة: سجلات تفصيلية لعمليات المزامنة ونتائج المحاولات وأدوات إعادة المعالجة (Retry).',
        'قنوات الإشعارات الفورية: أدوات تنبيهات النظام عبر البريد الإلكتروني أو بوت تيليجرام عند التفعيل.',
      ],
    },
    en: {
      title: 'Service Description & Grant of License',
      summary: 'The technical scope of our cloud integration platform and the operational license provided.',
      paragraphs: [
        'ERP Link operates as an Integration Platform as a Service (iPaaS), enabling automated workflows and data exchange between supported e-commerce platforms and ERP software. Subject to active subscription configurations and plan limits, the Service comprises:',
      ],
      bullets: [
        'Operational Data Synchronization: Automated propagation of orders, order status updates, products, categories, stock levels, and associated customer contact details.',
        'Field Mapping Center: Configurable mapping engines to align accounting rules, tax codes, payment gateways, shipping methods, and analytic distribution accounts.',
        'Connection & Credential Management: Secure API authorization token exchanges, encrypted credential storage, and authenticated webhook receivers.',
        'Operational Audit Logs: Detailed activity logs, status breakdowns (success, pending, failure), and manual or automated retry tools.',
        'Real-Time Notifications: System status alerts delivered via email or an optional merchant-configured Telegram bot.',
      ],
    },
  },
  {
    id: 'accounts',
    number: 4,
    ar: {
      title: 'إدارة الحسابات ومسؤوليات الأمان',
      summary: 'التزامات التاجر في الحفاظ على سرية بيانات تسجيل الدخول وإدارة صلاحيات الفريق.',
      paragraphs: [
        'للوصول إلى المنصة، يتطلب النظام إنشاء حساب موثق وتوفير بيانات دقيقة ومكتملة. تقع على عاتق التاجر المسؤولية الحصرية عن:',
      ],
      bullets: [
        'صحة واكتمال بيانات التسجيل وتحديث البريد الإلكتروني المعتمد لضمان استلام الإشعارات التعاقدية والتشغيلية.',
        'الحفاظ التام على سرية وسائل تسجيل الدخول وبيانات المصادقة ومفاتيح الجلسات الصادرة لحسابه.',
        'إدارة أعضاء مساحة العمل وتحديد صلاحيات الوصول والمسؤولية الكاملة عن كافة الإجراءات والعمليات المنفذة تحت حسابه.',
        'إخطار فريق دعم المنصة فوراً عبر القنوات المعتمدة بمجرد الاشتباه في حدوث أي اختراق أو وصول غير مصرح به للحساب أو مساحة العمل.',
      ],
    },
    en: {
      title: 'Account Administration & Security Obligations',
      summary: 'Merchant responsibilities regarding account accuracy, credential safeguarding, and access control.',
      paragraphs: [
        'Accessing ERP Link requires creating a verified account with accurate and up-to-date business contact information. The Merchant maintains exclusive responsibility for:',
      ],
      bullets: [
        'Ensuring all registration details remain true and that the designated administrative email is continuously monitored for operational notices.',
        'Safeguarding login credentials, multi-factor authentication tokens, and active session tokens against unauthorized exposure.',
        'Administering workspace team access permissions and accepting legal responsibility for all actions performed by authorized users.',
        'Notifying ERP Link support immediately upon discovering or suspecting any unauthorized access, compromised credentials, or security breach.',
      ],
    },
  },
  {
    id: 'third-party',
    number: 5,
    ar: {
      title: 'الاتصال بالمنصات والخدمات الخارجية',
      summary: 'طبيعة الربط المستقل مع أنظمة زد وسلة وشوبيفاي وأودو وحدود المسؤولية عن خدمات الغير.',
      paragraphs: [
        'تعتمد خدمة ERP Link على التفاعل التقني مع أنظمة ومنصات خارجية مستقلة (بما في ذلك Zid، Salla، Shopify، وOdoo). يقر العميل ويتعهد بالآتي:',
      ],
      bullets: [
        'استقلالية الأطراف: منصة ERP Link هي برمجية مستقلة للتكامل، ولا تمثل أو تتبع رسمياً لأي من تلك المنصات ما لم يُنص صراحة على شراكة معتمدة وموثقة.',
        'صلاحيات الربط والاعتماديات: يلتزم التاجر بتوفير وتجديد التوكنات وبيانات الاعتماد (API Keys / OAuth Tokens / Passwords) اللازمة لعمل المزامنة بشكل مستمر.',
        'تأثير انقطاع الطرف الثالث: لا تتحمل ERP Link أي مسؤولية عن تعطل المزامنة أو تأخر البيانات الناتج عن انقطاع خوادم المنصات الخارجية، أو فرض حدود طلبات (Rate Limits)، أو انتهاء صلاحية التوكنات، أو التعديلات المفاجئة في بنية واجهات البرمجة التطبيقية الخاصة بهم.',
        'الامتثال لشروط الغير: يقر التاجر بالتزامه الكامل بجميع الشروط والسياسات المفروضة من مزودي المتاجر الإلكترونية وأنظمة الـ ERP التي يربطها بالمنصة.',
      ],
    },
    en: {
      title: 'Third-Party Services & External Platform Integrations',
      summary: 'The operational independence of connected platforms (Zid, Salla, Shopify, Odoo) and liability boundaries.',
      paragraphs: [
        'ERP Link interoperates with third-party software platforms and API endpoints (including Zid, Salla, Shopify, and Odoo). The Merchant acknowledges and agrees that:',
      ],
      bullets: [
        'Independent Operation: ERP Link is an independent integration service and is not affiliated with, sponsored by, or endorsed by any external platform unless an official partnership agreement is expressly documented.',
        'Credential Management: The Merchant is solely responsible for obtaining, maintaining, and renewing valid administrative credentials and OAuth authorizations required for data exchange.',
        'Third-Party Unavailability: ERP Link is not liable for integration disruptions, synchronization delays, or data drops caused by external platform downtime, API rate limiting, token revocations, or breaking upstream schema modifications.',
        'Compliance with External Terms: The Merchant warrants ongoing compliance with all commercial and operational terms mandated by their connected store and ERP providers.',
      ],
    },
  },
  {
    id: 'synchronization',
    number: 6,
    ar: {
      title: 'إعدادات المزامنة وتدفق البيانات التشغيلية',
      summary: 'اعتماد المزامنة على خرائط التاجر وضرورة فحص ومراجعة العمليات قبل الاعتماد التجاري الحي.',
      paragraphs: [
        'تعمل محركات المزامنة في ERP Link وفقاً للقواعد والخرائط والإعدادات التي يقوم التاجر باختيارها وضبطها يدوياً أو اعتمادها ضمن المنصة (بما في ذلك ربط حالات الطلبات، تحديد المستودعات، مطابقة الأرقام الضريبية، وحسابات التوزيع التحليلي).',
        'نظراً لأن أي خلل في مطابقة الحقول قد ينعكس على إصدار الفواتير أو تقييم المخزون أو مطابقة المبيعات في نظام الـ ERP، فإن التاجر يقر ويلتزم بالآتي:',
      ],
      bullets: [
        'إلزامية الفحص التجريبي: التزام التاجر بإجراء اختبارات تشغيلية ومطابقة عينات من الطلبات والمنتجات في بيئة تجريبية أو على نطاق محدود قبل الاعتماد التشغيلي النهائي.',
        'المراجعة الدورية للسجلات: مسؤولية التاجر عن متابعة شاشة سجلات المزامنة (Sync Logs) في لوحة التحكم للتحقق من سلامة العمليات ومعالجة أي طلبات تظهر بحالة خطأ أو فشل.',
        'الإبلاغ عن المشكلات: إشعار فريق الدعم الفني بالمنصة فور رصد أي سلوك تقني غير معتاد أو تكرار غير مبرر في السجلات، مع تزويد الفريق بالمعلومات التشخيصية اللازمة.',
      ],
    },
    en: {
      title: 'Data Synchronization Rules & Operational Verification',
      summary: 'Dependency of sync logic on Merchant configurations and the duty to verify mappings prior to live production.',
      paragraphs: [
        'Synchronization workflows execute strictly according to the mapping schemas, warehouse assignments, tax codes, and operational status rules configured or approved by the Merchant within the Platform.',
        'Because field mapping decisions directly impact invoice generation, inventory valuations, and financial reconciliations within your ERP, the Merchant acknowledges and covenants to:',
      ],
      bullets: [
        'Pre-Production Testing: Conduct thorough pilot verifications and test order cycles in a staging environment or controlled subset before enabling full-scale automated sync.',
        'Routine Audit Monitoring: Regularly review the Platform Sync Logs to verify data integrity, confirm event completions, and promptly identify any flagged error states.',
        'Prompt Diagnostic Reporting: Report unexplained anomalies, error cascades, or discrepancy patterns to ERP Link support, providing relevant log identifiers for investigation.',
      ],
    },
  },
  {
    id: 'billing',
    number: 7,
    ar: {
      title: 'الاشتراكات والفوترة وطرق الدفع',
      summary: 'تنظيم الخطط، الفترات، فترة التجربة المجانية، وآلية الدفع اليدوي المعتمدة في النظام.',
      paragraphs: [
        'تخضع الاستفادة من خدمات المنصة لخطط الاشتراك والرسوم المعروضة في صفحة الأسعار المعتمدة أو الفواتير الرسمية الصادرة من المنصة وفق الضوابط الآتية:',
      ],
      bullets: [
        'فترة التجربة المجانية: تمنح المنصة فترة تجربة مجانية لمدة سبعة (7) أيام تبدأ من تاريخ إنشاء مساحة العمل لتمكين التاجر من تجربة التكامل وتقييم الميزات قبل الاشتراك المدفوع.',
        'طرق الدفع: يتم سداد الاشتراكات عبر وسائل الدفع اليدوية والتحويل البنكي المعتمد بناءً على فواتير رسمية تصدرها المنصة. نحن لا نطلب ولا نخزن أي بيانات خاصة ببطاقات الائتمان أو وسائل الدفع البنكية الآلية.',
        'دورات الفوترة: تدفع رسوم الخدمة مقدماً على أساس دورات شهرية أو سنوية حسب الخطة المختارة، ويتم تفعيل وتمديد الاشتراك بعد التحقق من استلام الحوالة وتأكيد الفاتورة.',
        'تأخر الدفع وانتهاء الاشتراك: عند انتهاء فترة الاشتراك أو فترة التجربة المجانية دون سداد التجديد، تتوقف عمليات المزامنة فوراً وتنتقل مساحة العمل إلى حالة الأرشفة (Archived) لحين تأكيد السداد.',
        'الإلغاء والاسترداد: يحق للتاجر طلب إلغاء اشتراكه في أي وقت، ويستمر الوصول إلى مساحة العمل حتى نهاية الفترة المدفوعة. الرسوم المدفوعة عن فترات اشتراك سارية غير قابلة للاسترداد، ما لم ينص القانون الإلزامي على خلاف ذلك.',
      ],
    },
    en: {
      title: 'Subscriptions, Billing Cycles & Payment Verification',
      summary: 'Subscription tiers, billing schedules, the 7-day free trial, and manual bank invoice procedures.',
      paragraphs: [
        'Access to ERP Link services is provided based on the subscription tiers and rates detailed on our published pricing page or official invoices, governed by the following commercial terms:',
      ],
      bullets: [
        '7-Day Free Trial: A complimentary seven (7) day evaluation period is provided from the date of workspace creation to enable setup, testing, and feature verification prior to paid enrollment.',
        'Payment Methods: Subscriptions are settled through manual payments and verified bank transfers against official invoices issued by the Platform. We neither request nor store credit card numbers or automated payment instrument details.',
        'Billing Cycles: Fees are payable in advance on a recurring monthly or annual basis. Workspaces are activated or extended upon verification of invoice payment.',
        'Past-Due Accounts & Expiration: If a subscription or free trial expires without verified payment, automated data synchronization halts immediately and the workspace transitions to an archived status until renewed.',
        'Cancellation & Refund Policy: The Merchant may cancel subscription renewal at any time; access remains active through the conclusion of the paid term. Fees paid for active billing periods are strictly non-refundable, except where mandated by applicable consumer protection laws.',
      ],
    },
  },
  {
    id: 'acceptable-use',
    number: 8,
    ar: {
      title: 'قواعد الاستخدام المقبول والمحظورات',
      summary: 'الممارسات الممنوعة لضمان أمن المنصة واستقرار البنية التحتية لجميع المشتركين.',
      paragraphs: [
        'يلتزم التاجر والمستخدمون التابعون له باستخدام المنصة للأغراض التجارية المشروعة فقط ووفقاً للأنظمة السارية. يُحظر حظرًا تامًا ارتكاب أي من الأفعال الآتية:',
      ],
      bullets: [
        'استخدام الخدمة في معالجة أو تداول أي بيانات أو معاملات غير مشروعة أو تنتهك الأنظمة السارية.',
        'محاولة الوصول غير المصرح به إلى خوادم المنصة أو قواعد بياناتها أو حسابات ومساحات عمل المشتركين الآخرين.',
        'محاولة كسر الحماية، أو التحايل على حدود الباقات والحسابات، أو فحص واستغلال أي ثغرات برمجية أو أمنية.',
        'نشر أو تمرير أي برمجيات خبيثة أو فيروسات أو أكواد تجسسية عبر المنصة أو واجهاتها البرمجية.',
        'استخدام مفاتيح أو بيانات اعتماد تخص أطرافاً أخرى دون الحصول على إذن كتابي رسمي وموثق.',
        'إجراء طلبات إغراقية أو أنشطة تشغيلية تهدف إلى تعطيل المنصة أو الإضرار باستقرار بنيتها التحتية السحابية.',
        'انتهاك حقوق الملكية الفكرية أو العلامات التجارية الخاصة بالمنصة أو بأي طرف ثالث.',
      ],
    },
    en: {
      title: 'Acceptable Use Policy & Restricted Conduct',
      summary: 'Prohibited activities to preserve platform security, compliance, and infrastructure stability.',
      paragraphs: [
        'Merchants and authorized users must use ERP Link strictly for legitimate business operations in full compliance with applicable laws. You expressly agree not to engage in any of the following restricted activities:',
      ],
      bullets: [
        'Using the Service to transmit, store, or process fraudulent, infringing, or unlawful transactional data.',
        'Attempting unauthorized access to Platform infrastructure, databases, network assets, or multi-tenant workspaces.',
        'Probing, scanning, reverse engineering, or exploiting system vulnerabilities, or circumventing tier quota boundaries.',
        'Injecting or distributing malicious software, viruses, corrupted payloads, or harmful scripts across integration endpoints.',
        'Utilizing API credentials, tokens, or personal identifiers of third parties without authorized and documented consent.',
        'Conducting denial-of-service attempts or generating abusive request volumes that degrade platform stability.',
        'Infringing upon intellectual property, proprietary software rights, or registered trademarks of ERP Link or third parties.',
      ],
    },
  },
  {
    id: 'intellectual-property',
    number: 9,
    ar: {
      title: 'ملكية البيانات وحقوق الملكية الفكرية',
      summary: 'حقوق ملكية التاجر لبيانات متجره واحتفاظ المنصة بكامل حقوق برمجياتها وتقنياتها.',
      paragraphs: [
        'تنظم هذه المادة حدود الملكية وحقوق التراخيص المتبادلة بين الطرفين:',
      ],
      bullets: [
        'ملكية بيانات التاجر: يحتفظ التاجر بكامل حقوق الملكية الفكرية والقانونية لكافة بيانات متجره، وعملائه، ومنتجاته، ومعاملاته المالية.',
        'ترخيص المعالجة: يمنح التاجر لمنصة ERP Link ترخيصاً تشغيلياً محدوداً وغير حصري بالقدر اللازم حصراً لمعالجة وتمرير وتخزين البيانات لتنفيذ خدمات المزامنة والدعم الفني.',
        'ملكية المنصة: تحتفظ ERP Link بكامل الحقوق والملكية الفكرية في الكود المصدري، والواجهات البرمجية، والتصاميم، والعلامات التجارية، والتوثيقات، والبنية التحتية للمنصة.',
        'ضمان مشروعية البيانات: يضمن التاجر امتلاكه لكافة الحقوق والتفويضات القانونية اللازمة للتعامل مع البيانات والأنظمة التي يربطها بالخدمة دون التعدي على حقوق الغير.',
      ],
    },
    en: {
      title: 'Data Ownership & Intellectual Property Rights',
      summary: 'Client ownership of business data and ERP Link retention of software and platform IP.',
      paragraphs: [
        'The allocation of intellectual property rights and operational licenses between the parties is governed as follows:',
      ],
      bullets: [
        'Customer Data Ownership: The Merchant retains full and exclusive ownership, title, and intellectual property rights in all store records, customer data, and operational assets.',
        'Limited Operational License: The Merchant grants ERP Link a limited, non-exclusive, revocable license to access, process, transmit, and store Customer Data solely as necessary to perform synchronization and support services.',
        'Platform Intellectual Property: ERP Link retains all rights, title, and interest in and to the platform software, source code, UI designs, proprietary algorithms, documentation, and brand marks.',
        'Warranty of Authority: The Merchant warrants that it holds all required legal rights, permissions, and customer consents to process and synchronize the data supplied to the Platform.',
      ],
    },
  },
  {
    id: 'availability',
    number: 10,
    ar: {
      title: 'توفر الخدمة وأعمال الصيانة',
      summary: 'مستوى التوفر المستهدف وإجراءات التحديثات الدورية دون ادعاءات التزام غير واقعية.',
      paragraphs: [
        'تبذل منصة ERP Link العناية المهنية المعقولة تجارياً للحفاظ على جاهزية الخوادم وتوفير الخدمة بشكل مستقر على مدار الساعة. ومع ذلك، يقر التاجر بأن طبيعة الخدمات السحابية وشبكات الإنترنت تنطوي على احتمالات توقف مؤقتة.',
        'تحتفظ المنصة بالحق في إجراء أعمال الصيانة الدورية، التحديثات الأمنية، وتطوير البنية البرمجية، مع السعي للإشعار المسبق بالتحديثات المجدولة كلما أمكن ذلك تجارياً. لا تقدم المنصة تعهدات مطلقة بنسب توفر غير تعاقدية ولا تضمن خلو الخدمة التام من الأخطاء العارضة.',
      ],
    },
    en: {
      title: 'Service Availability, Maintenance & Updates',
      summary: 'Commercially reasonable availability targets, scheduled maintenance, and realistic service baselines.',
      paragraphs: [
        'ERP Link utilizes commercially reasonable efforts to deliver high availability and stable data processing. However, the Merchant recognizes that cloud-based integration services are subject to planned maintenance, network transit delays, and external platform dependencies.',
        'We reserve the right to perform scheduled maintenance, software deployments, and critical security patches, striving to minimize operational impact. ERP Link does not warrant that the Service will operate completely uninterrupted, delay-free, or entirely error-free at all times.',
      ],
    },
  },
  {
    id: 'liability',
    number: 11,
    ar: {
      title: 'تحديد المسؤولية وإخلاء الضمانات',
      summary: 'الحدود القانونية والمالية المتوازنة لمسؤولية المنصة وفق الممارسات المعتمدة في SaaS.',
      paragraphs: [
        'تُقدم منصة ERP Link والخدمات المرتبطة بها وفق مبدأ "كما هي" (As-Is) و"بحسب توفرها" (As-Available)، وتخلي المنصة مسؤوليتها عن كافة الضمانات الضمنية، بما في ذلك ضمانات الصلاحية لغرض معين، بالقدر الذي يجيزه النظام.',
        'في أقصى الحدود المسموح بها قانونًا، لا تتحمل ERP Link أو مشغلوها أي مسؤولية عن أي أضرار غير مباشرة، أو خاصة، أو عرضية، أو تبعية (بما في ذلك خسارة الأرباح، أو توقف الأعمال، أو فقدان الفرص التجارية، أو اضطراب المخزون) الناتجة عن استخدام المنصة، أو أخطاء إعدادات التاجر، أو انقطاع أنظمة الأطراف الثالثة.',
        'في جميع الأحوال، يقتصر سقف المسؤولية المالية الإجمالية للمنصة عن كافة المطالبات الناشئة عن هذه الشروط أو المتصلة بها على إجمالي المبالغ الفعلية التي دفعها التاجر لـ ERP Link خلال الاثني عشر (12) شهرًا السابقة للواقعة المنشئة للمطالبة.',
      ],
    },
    en: {
      title: 'Disclaimer of Warranties & Limitation of Liability',
      summary: 'Standard SaaS liability limitations, disclaimer of consequential damages, and monetary liability caps.',
      paragraphs: [
        'To the maximum extent permitted by applicable law, ERP Link and its services are provided on an "as is" and "as available" basis without express or implied warranties of any kind, including implied warranties of merchantability or fitness for a particular purpose.',
        'Under no circumstances shall ERP Link, its officers, or contractors be liable for any indirect, incidental, special, exemplary, or consequential damages (including lost profits, lost revenues, loss of goodwill, business interruption, or stock discrepancies) arising from use of the Service, Merchant configuration errors, or upstream third-party outages.',
        'In all events, the aggregate liability of ERP Link arising out of or related to these Terms or the Service shall strictly not exceed the total fees actually paid by the Merchant to ERP Link in the twelve (12) months preceding the event giving rise to the claim.',
      ],
    },
  },
  {
    id: 'termination',
    number: 12,
    ar: {
      title: 'تعليق الحساب وإنهاء الخدمة وحذف البيانات',
      summary: 'حالات التعليق والإنهاء، وتوقف المزامنة، وتطهير البيانات التشغيلية عند الحذف.',
      paragraphs: [
        'يجوز للمنصة تعليق وصول التاجر أو إنهاء حسابه فوراً في حالات إساءة الاستخدام، أو انتهاك شروط الاستخدام المقبول، أو التأخر في سداد الاشتراكات، أو عند وجود تهديد أمني وشيك.',
        'يحق للتاجر إنهاء اشتراكه في أي وقت، كما يمكنه طلب حذف مساحة العمل نهائياً من إعدادات الحساب أو عبر التواصل مع الدعم. تترتب على الإنهاء والحذف الآثار الآتية:',
      ],
      bullets: [
        'توقف المزامنة الفوري: تتوقف عمليات تبادل البيانات واستقبال الـ Webhooks فوراً عند انتهاء الاشتراك أو تعليق الحساب أو دخوله مرحلة الأرشفة.',
        'التطهير البرمجي للبيانات (Purge): عند قيام التاجر بحذف مساحة العمل، يقوم النظام برمجياً وبشكل نهائي بحذف كافة التوكنات، وسجلات الربط، وخرائط الحقول، وقوائم المزامنة المؤقتة وسجلات العمليات المرتبطة بالمساحة.',
        'السجلات المستثناة: تحتفظ المنصة بالسجلات المحاسبية والضريبية وسجلات التدقيق الأمني (Audit Logs) التي تفرض الأنظمة المحاسبية والقانونية الاحتفاظ بها لمدد محددة نظاماً.',
        'استمرار البنود الجوهرية: تظل بنود الملكية الفكرية، وتحديد المسؤولية، والسرية سارية المفعول حتى بعد إنهاء هذه الاتفاقية.',
      ],
    },
    en: {
      title: 'Suspension, Termination & Data Purge Protocols',
      summary: 'Grounds for suspension, termination procedures, immediate sync cessation, and automated resource purging.',
      paragraphs: [
        'ERP Link reserves the right to suspend or terminate Merchant workspace access immediately upon material breach of these Terms, security compromises, payment defaults, or abusive usage.',
        'The Merchant may cancel their subscription or initiate permanent deletion of their workspace through account settings or formal support inquiry, which triggers the following protocol:',
      ],
      bullets: [
        'Immediate Sync Cessation: All inbound webhook listeners, queue runners, and API dispatch operations cease functioning immediately, and the workspace transitions to an archived status upon workspace expiration or termination.',
        'Automated Workspace Purge: When a workspace is deleted by the Merchant, the platform executes a comprehensive database purge, permanently eradicating stored tokens, connection secrets, field mapping rules, sync queues, and associated sync logs.',
        'Statutory Retentions: Aggregated invoice ledgers, payment receipts, and system security audit logs are retained strictly in accordance with statutory accounting and tax compliance periods.',
        'Survival: Clauses governing Intellectual Property, Limitation of Liability, Indemnification, and General Provisions shall survive any termination of these Terms.',
      ],
    },
  },
  {
    id: 'modifications',
    number: 13,
    ar: {
      title: 'تعديل الشروط والأحكام',
      summary: 'آلية تحديث الوثيقة وإشعار المشتركين بالتعديلات الجوهرية.',
      paragraphs: [
        'نحتفظ بالحق في تحديث أو تعديل هذه الشروط والأحكام كلما دعت الحاجة لتعكس التطورات التقنية أو التنظيمية أو التشغيلية لخدماتنا. وسيتم نشر تاريخ التحديث الفعلي بصورة واضحة في أعلى هذه الصفحة.',
        'في حال إجراء أي تعديلات جوهرية تمس حقوق المشتركين أو التزاماتهم، سنقوم بإشعارك عبر لوحة التحكم أو عبر بريدك الإلكتروني المسجل قبل سريان التعديلات بمدة معقولة. ويعد استمرارك في استخدام المنصة بعد سريان التعديلات إقراراً وموافقة منك على الشروط المعدلة.',
      ],
    },
    en: {
      title: 'Modifications to Terms & Notification',
      summary: 'Procedures for revising terms, publishing update timestamps, and providing notice of material amendments.',
      paragraphs: [
        'We reserve the right to revise or amend these Terms to reflect technical enhancements, architectural updates, or statutory requirements. The effective last-updated date will be accurately documented at the top of this document.',
        'In the event of material modifications impacting your rights or commercial commitments, we will provide reasonable advance notice via administrative dashboard banners or your registered email address. Your continued use of the Platform following the effective date of revisions constitutes acceptance of the updated Terms.',
      ],
    },
  },
  {
    id: 'general',
    number: 14,
    ar: {
      title: 'الأحكام العامة ووسائل التواصل',
      summary: 'قابلية الفصل، عدم التنازل، الحل الودي للنزاعات، والقنوات الرسمية للاستفسارات.',
      paragraphs: [
        'تخضع هذه الاتفاقية للقواعد والأحكام العامة التالية:',
      ],
      bullets: [
        'قابلية الفصل بين البنود: إذا تبين أن أي بند من هذه الشروط غير صالح أو غير قابل للتنفيذ بموجب أي نظام سارٍ، يُعد ذلك البند مستقلاً ولا يؤثر على صحة ونفاذ باقي البنود.',
        'عدم التنازل: لا يعتبر عدم ممارسة المنصة لأي حق من حقوقها بموجب هذه الشروط تنازلاً عن ذلك الحق أو عن أي حق آخر.',
        'الاتفاق الكامل: تشكل هذه الشروط، بالتكامل مع سياسة الخصوصية، مجمل الاتفاق بينك وبين ERP Link فيما يتعلق باستخدام المنصة، وتلغي أي تفاهمات سابقة.',
        'التسوية الودية: يتفق الطرفان على حل أي خلافات أو مطالبات ناشئة عن استخدام المنصة عبر التفاوض الودي بحسن نية وقنوات الدعم الفني الرسمية.',
        `قنوات التواصل: للاستفسارات القانونية والتعاقدية، يرجى التواصل عبر البريد الإلكتروني الرسمي: ${PUBLIC_CONTACT_EMAIL} أو عبر صفحة التواصل الرسمية للموقع.`,
      ],
    },
    en: {
      title: 'General Provisions, Dispute Resolution & Official Contact',
      summary: 'Severability, non-waiver, amicable dispute resolution, and validated contact channels.',
      paragraphs: [
        'These Terms and Conditions are governed by the following concluding legal standards:',
      ],
      bullets: [
        'Severability: If any provision of these Terms is deemed invalid or unenforceable by competent authority, such provision shall be enforced to the maximum extent permissible, and the remaining provisions shall continue in full force.',
        'No Waiver: Failure by ERP Link to enforce any provision or exercise any contractual right shall not constitute a waiver of that or any subsequent right.',
        'Entire Agreement: These Terms, together with the Privacy Policy, constitute the complete agreement between the parties regarding the Service and supersede prior understandings.',
        'Amicable Resolution: The parties agree to attempt in good faith to resolve any dispute or controversy arising out of this Service amicably through direct consultations and formal support channels.',
        `Official Contact Channel: For legal or contractual inquiries, contact us directly at ${PUBLIC_CONTACT_EMAIL} or via our official website contact page.`,
      ],
    },
  },
]

export const privacySections: LegalSection[] = [
  {
    id: 'scope',
    number: 1,
    ar: {
      title: 'مقدمة ونطاق سياسة الخصوصية',
      summary: 'التزام المنصة بحماية البيانات وتحديد نطاق تطبيق السياسة وتمييز أدوار المعالجة.',
      paragraphs: [
        'نلتزم في منصة ERP Link ("المنصة" أو "نحن") باحترام خصوصيتك وحماية أمن بياناتك ومعلومات متاجرك وعملائك. توضح سياسة الخصوصية هذه ("السياسة") القواعد والممارسات التي نتبعها في جمع واستخدام وتخزين ومعالجة البيانات الشخصية والتشغيلية عند استخدامك لخدماتنا وموقعنا الإلكتروني.',
        'من المهم التمييز بين دورين رئيسيين في معالجة البيانات داخل المنصة:',
      ],
      bullets: [
        'ERP Link كمتحكم في البيانات (Data Controller): تنطبق صفتنا كمتحكم حصراً فيما يتعلق ببيانات حساب التاجر المباشرة (مثل بيانات الدخول، معلومات الاتصال، وسجلات الفوترة والاشتراك) اللازمة لإدارة العلاقة التعاقدية مع المشترك.',
        'ERP Link كمعالج بيانات (Data Processor): نعمل كمعالج للبيانات نيابة عن التاجر فيما يخص بيانات متجره وعملائه النهائيين وطلباته ومخزونه التي يتم استرجاعها ومزامنتها بين متاجره وأنظمة الـ ERP الخاصة به، حيث يظل التاجر هو "المتحكم في البيانات" الحصري لها.',
      ],
    },
    en: {
      title: 'Introduction, Scope & Processing Roles',
      summary: 'Our commitment to data privacy, platform scope, and the distinction between Controller and Processor roles.',
      paragraphs: [
        'At ERP Link ("Platform", "We", "Us"), we take the privacy and confidentiality of your personal and commercial data with utmost seriousness. This Privacy Policy outlines our standards and methodologies regarding the collection, handling, storage, and processing of data when you utilize our website and integration services.',
        'We clearly differentiate between two fundamental data processing roles under this Policy:',
      ],
      bullets: [
        'ERP Link as a Data Controller: We act as a Data Controller exclusively with respect to Merchant Account Data (such as administrative user profiles, contact credentials, and billing ledgers) required to manage our commercial relationship with the Merchant.',
        'ERP Link as a Data Processor: We operate strictly as a Data Processor on behalf of the Merchant regarding the store customer data, order line items, catalog data, and inventory records synchronized between connected e-commerce platforms and ERP systems. The Merchant remains the sole Data Controller of such business data.',
      ],
    },
  },
  {
    id: 'categories',
    number: 2,
    ar: {
      title: 'فئات البيانات التي نتعامل معها',
      summary: 'حصر دقيق لكافة فئات البيانات المجمعة والمولدة والمزامنة عبر المنصة.',
      paragraphs: [
        'تقتصر البيانات التي نتعامل معها على الفئات الضرورية اللازمة لتقديم وتشغيل خدمة التكامل التقني بكفاءة وأمان:',
      ],
      bullets: [
        'بيانات الحساب والمشترك: الاسم، عنوان البريد الإلكتروني، اسم المتجر أو المنشأة، وأي بيانات اتصال يقدمها المشترك عند إنشاء مساحة العمل.',
        'بيانات المتاجر والطلبات المتزامنة: معرّفات الطلبات، تفاصيل المنتجات والكميات، قيم الفواتير والضرائب، وعناوين الشحن وأرقام التواصل الضرورية المضمنة في الطلب لتنفيذ المزامنة وتوليد الفواتير في الـ ERP.',
        'بيانات الاعتماد والربط التقني: مفاتيح التوثيق وتوكنات الوصول (OAuth Tokens) الخاصة بمتاجر زد وسلة وشوبيفاي، وبيانات اعتماد الاتصال بنظام أودو (مثل عنوان الخادم وقاعدة البيانات وبيانات الدخول المشفرة).',
        'سجلات التشغيل والمزامنة (Sync Logs): سجلات تشخيصية تشمل معرّف المعاملة، وتاريخ ووقت المزامنة، وحالة العملية (ناجح/فاشل)، ورسائل الأخطاء التقنية لتصحيح المسارات.',
        'بيانات الاشتراك والفوترة: سجل باقة الاشتراك، تاريخ البدء والانتهاء، وأرقام الفواتير وسجلات التحويل البنكي اليدوي (ولا نطلب أو نخزن أي بيانات لبطاقات الدفع البنكية).',
        'البيانات التقنية وسجلات الوصول: عنوان بروتوكول الإنترنت (IP)، نوع المتصفح، ونظام التشغيل لأغراض التحقق من أمن الجلسات ومكافحة التهديدات.',
        'بيانات الدعم والتواصل: الرسائل والاستفسارات الواردة عبر نموذج الاتصال الرسمي أو تذاكر الدعم الفني.',
      ],
    },
    en: {
      title: 'Categories of Data We Process',
      summary: 'A comprehensive inventory of data processed, collected, or generated across our integration pipeline.',
      paragraphs: [
        'We strictly limit data collection to the categories necessary to deliver, execute, and secure our integration workflows:',
      ],
      bullets: [
        'Merchant Account Profile: Name, business email address, company or store name, and administrative identifiers supplied during workspace setup.',
        'Store Synchronization Data: Order reference IDs, line item details, SKU codes, pricing, tax calculations, and fulfillment addresses transmitted to complete ERP synchronization.',
        'Integration Credentials & Authorization Tokens: OAuth 2.0 access and refresh tokens for connected stores (Zid, Salla, Shopify) and encrypted XML-RPC connection parameters for the connected Odoo instance.',
        'Operational Sync Logs: Telemetry records detailing event triggers, timestamps, execution statuses (success, failed, pending), and technical error traces used for diagnostics.',
        'Subscription & Payment Ledgers: Plan records, renewal dates, official invoice numbers, and verified bank transfer confirmations (no payment card data is collected or stored).',
        'Technical & Session Diagnostics: Originating IP addresses, browser types, and device telemetry logged to protect session integrity and prevent brute-force attacks.',
        'Support Inquiries: Communication histories submitted via our official website contact form or help desk tickets.',
      ],
    },
  },
  {
    id: 'purposes',
    number: 3,
    ar: {
      title: 'أغراض استخدام ومعالجة البيانات',
      summary: 'الأهداف التشغيلية المشروعة لمعالجة البيانات لتقديم الخدمة.',
      paragraphs: [
        'نستخدم البيانات التي نتعامل معها حصراً للأغراض التشغيلية والخدمية التالية:',
      ],
      bullets: [
        'إنشاء مساحة العمل وإدارة المصادقة وحماية أمان الجلسات.',
        'تنفيذ عمليات المزامنة الآلية ونقل البيانات بين المتاجر الإلكترونية وأنظمة الـ ERP وفق الخرائط المعتمدة من التاجر.',
        'تشخيص أخطاء المزامنة ومعالجة السجلات وتوفير أدوات إعادة المحاولة وإصلاح الاختلالات.',
        'إدارة دورات الاشتراكات وإصدار الفواتير ومتابعة حالة مساحات العمل وتنبيهات التجديد.',
        'تقديم الدعم الفني والاستجابة لاستفسارات التجار ومساعدتهم في إعدادات الربط.',
        'حماية أمن البنية التحتية، ومنع الأنشطة الاحتيالية، والتصدي للهجمات البرمجية ومحاولات الاختراق.',
        'الامتثال للالتزامات المحاسبية والضريبية والأنظمة السارية ذات العلاقة.',
      ],
    },
    en: {
      title: 'Purposes of Data Processing',
      summary: 'Legitimate operational objectives governing how and why your information is handled.',
      paragraphs: [
        'Data handled by ERP Link is processed exclusively for explicit, legitimate business operations:',
      ],
      bullets: [
        'Administering user authentication, workspace provisioning, and session authorization.',
        'Executing automated bidirectional synchronization between connected e-commerce storefronts and ERP databases according to Merchant configurations.',
        'Troubleshooting sync discrepancies, parsing system logs, and facilitating automated or manual retry mechanisms.',
        'Administering subscription lifecycles, issuing manual billing invoices, and monitoring workspace trial states.',
        'Delivering dedicated technical support and resolving merchant integration questions.',
        'Safeguarding cloud infrastructure, preventing malicious exploitation, and thwarting unauthorized access attempts.',
        'Fulfilling statutory accounting, tax reporting, and audit requirements.',
      ],
    },
  },
  {
    id: 'legal-basis',
    number: 4,
    ar: {
      title: 'الأساس القانوني للمعالجة',
      summary: 'الأسس النظامية المعتمدة التي تبرر عمليات معالجة البيانات وفق المعايير الدولية.',
      paragraphs: [
        'تستند عمليات معالجة البيانات في المنصة إلى أسس نظامية ومشروعة واضحة:',
      ],
      bullets: [
        'تنفيذ الالتزام التعاقدي: معالجة بيانات الحساب ومزامنة بيانات المتاجر تعد ضرورة تعاقدية لتقديم خدمات التكامل المتفق عليها في شروط الاستخدام.',
        'المصالح المشروعة: معالجة سجلات الوصول والبيانات التشخيصية وأمن الشبكات تهدف إلى حماية استقرار الخدمة وتأمين بيانات كافة المشتركين.',
        'الالتزام النظامي والقانوني: الاحتفاظ بسجلات الفواتير والعمليات المحاسبية امتثالاً للأنظمة واللوائح الضريبية والمالية.',
        'الموافقة الصريحة: عند قيام المشترك باختيار تفعيل خدمات إضافية اختيارية، مثل ربط بوت تيليجرام لتلقي إشعارات المزامنة.',
      ],
    },
    en: {
      title: 'Legal Basis for Processing',
      summary: 'Recognized legal justifications governing data processing activities.',
      paragraphs: [
        'All data processing activities conducted by ERP Link rely upon recognized, verifiable legal grounds:',
      ],
      bullets: [
        'Contractual Performance: Processing workspace settings, tokens, and store data is strictly required to execute the integration agreement embodied in our Terms.',
        'Legitimate Interests: Maintaining system diagnostic logs, monitoring malicious traffic, and securing server resources support our legitimate interest in platform stability.',
        'Legal & Statutory Compliance: Retaining verified payment transactions and invoice ledgers satisfies statutory fiscal and accounting obligations.',
        'Explicit Consent: Where you elect to activate optional features, such as connecting a custom Telegram bot for sync dispatch alerts.',
      ],
    },
  },
  {
    id: 'sharing',
    number: 5,
    ar: {
      title: 'مشاركة البيانات ومزودو الخدمات من الأطراف الثالثة',
      summary: 'عدم بيع البيانات إطلاقاً، وتحديد مزودي البنية التحتية والأنظمة المتصلة المعتمدة.',
      paragraphs: [
        'نحن لا نبيع ولا نؤجر ولا نسوق بياناتك أو بيانات متجرك لأي طرف ثالث لأغراض إعلانية أو تجارية بأي شكل من الأشكال. تقتصر مشاركة البيانات ونقلها على الجهات المعتمدة التالية وبالقدر الضروري فقط لأداء الخدمة:',
      ],
      bullets: [
        'مزود المصادقة (Clerk): لإدارة جلسات تسجيل الدخول والتحقق الآمن من هويات المستخدمين.',
        'مزود قاعدة البيانات السحابية (Supabase): لتخزين البيانات التشغيلية وسجلات مساحات العمل في بيئة سحابية آمنة.',
        'خدمات البريد الإلكتروني (SendGrid / خوادم SMTP): لإرسال الإشعارات التشغيلية وتأكيدات التسجيل والفوترة.',
        'المنصات والمتاجر المتصلة: قراءة بيانات الطلبات والمنتجات والمخزون من منصاتك المربوطة (زد، سلة، شوبيفاي) عبر واجهاتها الرسمية.',
        'نظام الـ ERP المتصل: كتابة وتحديث المنتجات والطلبات والفواتير والمخزون في خادم الـ ERP (أودو) المحدد من قِبلك.',
        'واجهة Telegram Bot API: في حال تفعيلك الاختياري لبوت تيليجرام، يتم إرسال ملخصات نتائج المزامنة والتنبيهات المحددة.',
        'الامتثال القانوني الإلزامي: لا يتم الإفصاح عن أي بيانات إلا عند استلام طلب قانوني رسمي ملزم صادر من جهة قضائية أو حكومية مختصة وفق الأنظمة.',
      ],
    },
    en: {
      title: 'Data Sharing & Essential Sub-Processors',
      summary: 'Strict non-monetization policy and disclosure of necessary technical infrastructure partners.',
      paragraphs: [
        'We do not sell, rent, lease, or monetize your personal or commercial data to any third party for marketing or advertising purposes. Data transfers occur strictly with verified sub-processors and connected systems solely to the extent required to deliver the Service:',
      ],
      bullets: [
        'Authentication Infrastructure (Clerk): Manages user identity verification, secure sessions, and administrative account access.',
        'Cloud Database Infrastructure (Supabase): Provides secure, enterprise-grade cloud database hosting for operational workspaces and logs.',
        'Transactional Email (SendGrid / SMTP): Dispatches operational account emails, subscription notices, and verification links.',
        'Merchant Connected Storefronts: Directly interacting with merchant stores (Zid, Salla, Shopify) via authenticated endpoints to retrieve orders and catalog items.',
        'Designated ERP Destination: Writing synchronized orders, contacts, products, and inventory updates directly to the customer-configured Odoo server.',
        'Telegram Bot API: Dispatches operational sync summaries strictly when configured and authorized by the Merchant.',
        'Compulsory Legal Disclosures: Data is disclosed only when required by enforceable judicial warrants or statutory mandates issued by competent legal authorities.',
      ],
    },
  },
  {
    id: 'security',
    number: 6,
    ar: {
      title: 'التدابير الأمنية وحماية البيانات',
      summary: 'إجراءات التشفير والتحكم في الصلاحيات وعزل مساحات العمل وتفادي الادعاءات الوهمية.',
      paragraphs: [
        'نطبق تدابير تقنية وتنظيمية متقدمة وموثقة لحماية البيانات من الوصول غير المصرح به أو التغيير أو الفقدان:',
      ],
      bullets: [
        'تشفير البيانات أثناء النقل: حماية كافة الاتصالات بين متصفح المستخدم، وخوادم المنصة، والـ APIs الخارجية باستخدام بروتوكولات التشفير القياسية TLS/SSL (HTTPS).',
        'التشفير المتماثل الموثق في السكون: تشفير كافة المفاتيح الحساسة وتوكنات الربط (OAuth Tokens) وبيانات اعتماد خوادم الـ ERP في قاعدة البيانات باستخدام خوارزمية التشفير المتماثل الموثق AES-256-GCM مع مفاتيح بيئية مشددة الحماية.',
        'اشتقاق المفاتيح الآمن (HKDF): توليد أسرار تحقق منفصلة للـ Webhooks وتكاملات أودو عبر دالة HKDF-SHA256 دون تعريض مفتاح التشفير الرئيسي.',
        'عزل مساحات العمل وصلاحيات الوصول (RBAC): تطبيق رقابة صارمة على مستوى الجداول تضمن عزل مساحات العمل تماماً ومنع أي وصول متداخل بين المشتركين.',
        'سجلات التدقيق الأمني (Audit Logs): تدوين سجلات أمنية غير قابلة للتعديل لمتابعة العمليات الإدارية الحساسة ومكافحة الانتحال.',
        'الواقعية والشفافية الأمنية: نطبق أفضل المعايير الهندسية والتقنية المعترف بها لحماية المنصة، مع الإقرار بالشفافية والمسؤولية بأنه لا توجد بيئة رقمية متصلة بالإنترنت منيعة بشكل مطلق من كافة المخاطر.',
      ],
    },
    en: {
      title: 'Data Security Measures & Technical Safeguards',
      summary: 'Verified encryption protocols, role-based access controls, workspace isolation, and realistic assurances.',
      paragraphs: [
        'We implement rigorous, industry-aligned administrative and technical safeguards to protect information against accidental destruction, unauthorized disclosure, or unlawful modification:',
      ],
      bullets: [
        'Transit Encryption: Comprehensive TLS/SSL encryption for all web sessions, API calls, and external store/ERP transfers.',
        'Authenticated Symmetric Encryption at Rest: Sensitive tokens, passwords, and ERP API keys are stored encrypted utilizing authenticated AES-256-GCM algorithms governed by secure environment key management.',
        'Cryptographic Key Derivation (HKDF): Distinct webhook validation secrets are generated via HKDF-SHA256, eliminating shared master key exposures across external systems.',
        'Strict Multi-Tenant Isolation & RBAC: Multi-tenant database controls and role-based permissions enforce strict workspace isolation, preventing cross-tenant leakage.',
        'Security Audit Trails: Immutable operational audit logging recording critical administrative actions, credential updates, and workspace configuration changes.',
        'Objective Security Posture: We maintain proactive, industry-standard defenses with full operational transparency that no connected digital environment can be considered absolutely invulnerable to all theoretical risks.',
      ],
    },
  },
  {
    id: 'retention',
    number: 7,
    ar: {
      title: 'قواعد الاحتفاظ بالبيانات وحذفها وتطهيرها',
      summary: 'ضوابط بقاء البيانات خلال الاشتراك، وتوقف المزامنة، وتطهير الموارد فور حذف مساحة العمل.',
      paragraphs: [
        'نحتفظ بالبيانات فقط للمدة اللازمة لتحقيق الأغراض التشغيلية والتعاقدية التي جُمعت من أجلها:',
      ],
      bullets: [
        'أثناء سريان الاشتراك أو التجربة: تبقى البيانات وإعدادات الربط وسجلات المزامنة متاحة في مساحة العمل لتمكين المشترك من تشغيل المزامنة وتدقيق العمليات.',
        'عند انتهاء الاشتراك أو التجربة: تتوقف عمليات المزامنة فوراً، وتنتقل مساحة العمل إلى حالة الأرشفة (Archived) مع إيقاف استقبال الـ Webhooks.',
        'الحذف الفوري لمساحة العمل (Workspace Purge): يملك المشترك صلاحية حذف مساحة عمله نهائياً من إعدادات الحساب. عند تنفيذ الحذف، يقوم النظام برمجياً وفورياً بحذف شامل لكافة توكنات الربط، واعتماديات الـ ERP، وخرائط الحقول، وطوابير المزامنة، وسجلات العمليات المرتبطة بالمساحة دون إبقاء أي سجلات معلقة في قاعدة البيانات.',
        'طلبات حذف الحساب: يمكن للمشترك طلب حذف حسابه بالكامل عبر البريد المعتمد، ويتم تأكيد الطلب وتنفيذه برمجياً.',
        'الاحتفاظ المحاسبي والنظامي: تُستثنى السجلات المحاسبية والضريبية وسجلات التدقيق الأمني العامة، حيث يُحتفظ بها للمدد الإلزامية التي تقرها الأنظمة واللوائح ذات العلاقة.',
      ],
    },
    en: {
      title: 'Data Retention, Erasure & Workspace Purge Protocols',
      summary: 'Data lifecycles, immediate sync halts on expiration, and systematic database purges upon deletion.',
      paragraphs: [
        'Personal and operational data is retained only for the duration necessary to satisfy the commercial and contractual purposes for which it was gathered:',
      ],
      bullets: [
        'Active Subscriptions & Trials: Configurations, active credentials, mapping rules, and recent sync telemetry remain accessible to provide continuous synchronization and auditing.',
        'Upon Plan Expiration: Synchronization halts immediately; webhook receivers refuse new traffic, and the workspace enters an inactive archived status.',
        'Automated Workspace Purge: Merchants may delete their workspace directly from settings. This triggers an automated database cascade that permanently purges all merchant tokens, ERP connection credentials, mapping definitions, queued payloads, and synchronization logs.',
        'Account Erasure Inquiries: Complete account deletion requests submitted via our official contact channel are processed promptly following administrative verification.',
        'Fiscal & Audit Retentions: Historical invoice ledgers, payment settlement records, and immutable system audit logs are retained strictly in accordance with statutory accounting and tax compliance requirements.',
      ],
    },
  },
  {
    id: 'rights',
    number: 8,
    ar: {
      title: 'حقوق أصحاب البيانات وآلية ممارستها',
      summary: 'حقوق الوصول، التصحيح، الحذف، ونقل البيانات، والتعامل مع طلبات عملاء المتاجر النهائيين.',
      paragraphs: [
        'يحق للمشتركين وأصحاب البيانات ممارسة حقوقهم القانونية المرتبطة ببياناتهم الشخصية، والتي تشمل:',
      ],
      bullets: [
        'حق الوصول والاطلاع: الحصول على تأكيد حول معالجة بياناتك والاطلاع على تفاصيلها وسجلات المزامنة المسجلة في حسابك.',
        'حق التصحيح والتحديث: تعديل وتحديث أي بيانات غير مكتملة أو غير دقيقة من خلال لوحة التحكم أو بمساعدة الدعم.',
        'حق الحذف والمسح: طلب حذف البيانات الشخصية وحذف مساحات العمل عند انتهاء الغرض من المعالجة أو إنهاء الاشتراك.',
        'حق تقييد المعالجة أو الاعتراض: طلب تقييد المزامنة أو الاعتراض على معالجة محددة لبياناتك في الحالات النظامية المعتمدة.',
        'حق نقل البيانات: إمكانية استخراج وتصدير تقارير السجلات والبيانات عبر واجهات المنصة.',
        'إجراءات التحقق: لحماية أمن وسرية البيانات، قد نطلب من المشترك التحقق من هويته وصلاحياته الإدارية قبل تنفيذ أي طلب لحذف أو تعديل البيانات الحساسة.',
        'طلبات عملاء المتجر النهائيين: نظراً لأن التاجر هو "المتحكم في البيانات" لعملائه النهائيين، يتعين على عملاء المتاجر توجيه أي طلبات تخص بياناتهم مباشرة إلى التاجر، وتقدم المنصة الأدوات التقنية اللازمة لتمكين التاجر من الاستجابة لتلك الطلبات.',
      ],
    },
    en: {
      title: 'Data Subject Rights & Request Procedures',
      summary: 'Rights of access, rectification, erasure, and portability, plus instructions for end-consumer requests.',
      paragraphs: [
        'Subject to applicable data protection regulations, Merchants and individuals have specific enforceable rights regarding their personal data:',
      ],
      bullets: [
        'Right of Access & Inspection: Request confirmation and review the categories of personal and operational records stored within your account.',
        'Right of Rectification: Correct inaccurate or incomplete business profile information via the workspace settings dashboard.',
        'Right to Erasure ("Right to be Forgotten"): Request permanent deletion of account credentials and workspace resources subject to legal retention constraints.',
        'Right to Restrict or Object: Request cessation of non-essential processing activities where legally permissible.',
        'Right to Data Portability: Export operational mapping tables and sync logs via platform interfaces.',
        'Identity Verification Safeguards: To protect sensitive business credentials, identity verification and administrative validation are required prior to executing deletion or export requests.',
        'End-Consumer Requests: Because the Merchant acts as the Data Controller for its store customers, consumers must direct privacy requests to the Merchant directly; ERP Link provides technical features allowing Merchants to fulfill consumer erasure or rectification duties.',
      ],
    },
  },
  {
    id: 'cookies',
    number: 9,
    ar: {
      title: 'ملفات تعريف الارتباط (Cookies) والتخزين المحلي',
      summary: 'التقنيات المستخدمة فعلياً: كوكيز المصادقة واللغة والمظهر، وتأكيد خلو المنصة من كوكيز التتبع الإعلاني.',
      paragraphs: [
        'نستخدم ملفات تعريف الارتباط وتقنيات التخزين المحلي الضرورية فقط لتمكين تشغيل المنصة وحفظ تفضيلاتك الأساسية:',
      ],
      bullets: [
        'ملفات تعريف الارتباط الضرورية للمصادقة: يديرها مزود المصادقة Clerk (مثل __session و __client_uat) للحفاظ على تسجيل دخولك الآمن والتحقق من صلاحية الجلسة.',
        'كوكي تفضيل اللغة: كوكي محلي باسم (lang) لحفظ خيار اللغة المفضل لديك (العربية أو الإنجليزية) لعرض الواجهات العامة.',
        'التخزين المحلي للمظهر (Local Storage): تقنية في المتصفح لحفظ تفضيل مظهر الواجهة (الوضع الداكن Dark Mode أو الفاتح Light Mode).',
        'عدم وجود تتبع إعلاني: نحن لا نستخدم إطلاقاً أي ملفات تعريف ارتباط لتتبع الإعلانات أو الاستهداف التسويقي من أطراف ثالثة.',
        'إدارة المتصفح: يمكنك التحكم في ملفات تعريف الارتباط عبر إعدادات متصفحك، مع الإحاطة بأن تعطيل كوكيز المصادقة الأساسية سيمنع تسجيل الدخول واستخدام الخدمة.',
      ],
    },
    en: {
      title: 'Cookies & Local Storage Technologies',
      summary: 'Operational authentication and preference cookies; explicit confirmation of zero third-party ad tracking.',
      paragraphs: [
        'We utilize strictly necessary cookies and local storage tokens required to provide platform security and maintain user preferences:',
      ],
      bullets: [
        'Essential Authentication Cookies: Managed by our authentication provider Clerk (e.g., __session, __client_uat) to validate authorized access and protect session security.',
        'Language Preference Cookie: A functional first-party cookie named (lang) storing your interface localization selection (Arabic or English).',
        'Theme Local Storage: Browser-based local storage retaining UI visual preferences (Dark Mode or Light Mode).',
        'Zero Advertising Trackers: We deploy no third-party behavioral profiling, advertising trackers, or remarketing pixels.',
        'Browser Cookie Controls: You may configure your browser to decline cookies; however, disabling essential authentication cookies will prevent access to the dashboard and services.',
      ],
    },
  },
  {
    id: 'transfers',
    number: 10,
    ar: {
      title: 'معالجة البيانات والخدمات السحابية الدولية',
      summary: 'طبيعة الاستضافة والبنية التحتية السحابية المطبقة لحماية البيانات.',
      paragraphs: [
        'تتم استضافة ومعالجة بيانات المنصة عبر بنية تحتية سحابية متقدمة ومحمية تديرها جهات رائدة عالمياً (بما في ذلك Supabase وClerk).',
        'نحرص على أن تتم كافة عمليات المعالجة وتدفق البيانات عبر اتفاقيات معالجة بيانات صارمة (Data Processing Agreements) وضمانات فنية وتعاقدية تضمن تطبيق معايير خصوصية وحماية عالية للبيانات تتماشى مع أفضل الممارسات المعتمدة.',
      ],
    },
    en: {
      title: 'International Cloud Processing & Sub-Processor Safeguards',
      summary: 'Enterprise cloud hosting parameters and strict contractual data transfer safeguards.',
      paragraphs: [
        'ERP Link data processing workflows utilize advanced, globally distributed cloud infrastructure managed by enterprise providers (including Supabase and Clerk).',
        'We mandate rigorous Data Processing Agreements and standard technical safeguards across all infrastructure partners, ensuring that data handling complies with recognized security and confidentiality baselines.',
      ],
    },
  },
  {
    id: 'third-party-policies',
    number: 11,
    ar: {
      title: 'بيانات وسياسات المنصات الخارجية المتكاملة',
      summary: 'ارتباط البيانات المستلمة من زد وسلة وشوبيفاي وأودو بسياسات وشروط تلك المنصات.',
      paragraphs: [
        'يرتبط استخدام المنصة بتبادل البيانات مع أنظمة ومتاجر خارجية يمتلكها أو يديرها المشترك على منصات مستقلة (مثل زد، سلة، شوبيفاي، وأودو).',
        'تخضع كافة البيانات المستلمة أو المرسلة إلى تلك الأنظمة لسياسات الخصوصية وشروط الاستخدام وتراخيص الـ APIs المعمول بها لدى تلك المنصات المستقلة. ونوصي بمراجعة سياسات تلك المنصات للتأكد من توافق أنشطتك مع متطلباتها.',
      ],
    },
    en: {
      title: 'Integrated Third-Party Platform Policies',
      summary: 'Applicability of independent terms governing data exchanged with Zid, Salla, Shopify, and Odoo.',
      paragraphs: [
        'ERP Link functions by orchestrating data between third-party storefronts and ERP environments designated and operated by the Merchant (including Zid, Salla, Shopify, and Odoo).',
        'All data retrieved from or dispatched to these endpoints remains subject to the respective privacy policies, developer covenants, and API terms of those independent providers. Merchants are advised to review external platform terms regularly.',
      ],
    },
  },
  {
    id: 'updates',
    number: 12,
    ar: {
      title: 'تحديثات سياسة الخصوصية والإشعار بها',
      summary: 'مراجعة السياسة دورياً وإشعار المشتركين بالتحسينات والتغييرات الجوهرية.',
      paragraphs: [
        'يجوز لنا مراجعة وتحديث سياسة الخصوصية هذه من وقت لآخر لمواكبة التحديثات التقنية في المنصة أو المتطلبات النظامية والتنظيمية. وسيتم إبراز تاريخ التحديث الأخير بشكل موثق في بداية هذه الصفحة.',
        'في حال إجراء أي تعديلات جوهرية تؤثر على كيفية معالجة بياناتك، سنقوم بنشر إشعار واضح في لوحة التحكم أو إرسال إشعار عبر البريد الإلكتروني المعتمد قبل سريان التغييرات بمدة كافية.',
      ],
    },
    en: {
      title: 'Policy Updates & Version Transparency',
      summary: 'Periodic reviews, timestamp transparency, and advance notice of material modifications.',
      paragraphs: [
        'We periodically review and update this Privacy Policy to ensure alignment with platform enhancements and regulatory developments. The effective update timestamp is prominently documented at the beginning of this policy.',
        'Whenever material changes alter how personal data is handled, we will post a conspicuous notification on the dashboard or notify registered account holders via email prior to the changes taking effect.',
      ],
    },
  },
  {
    id: 'contact',
    number: 13,
    ar: {
      title: 'التواصل ومسؤول الخصوصية',
      summary: 'القنوات الرسمية المعتمدة لتقديم الاستفسارات والطلبات المتعلقة بالخصوصية.',
      paragraphs: [
        'إذا كان لديك أي أسئلة أو ملاحظات أو استفسارات حول سياسة الخصوصية، أو إذا كنت ترغب في ممارسة أي من حقوقك المتعلقة ببياناتك، يسعدنا تواصلك معنا عبر القنوات الرسمية المعتمدة:',
      ],
      bullets: [
        `البريد الإلكتروني الرسمي المعتمد: ${PUBLIC_CONTACT_EMAIL}`,
        'نموذج التواصل الرسمي المباشر: عبر زيارة صفحة اتصل بنا في الموقع الإلكتروني.',
      ],
    },
    en: {
      title: 'Contact Information & Privacy Inquiries',
      summary: 'Official communication endpoints for privacy questions, data requests, and administrative notifications.',
      paragraphs: [
        'If you have questions, regulatory feedback, or inquiries concerning this Privacy Policy, or if you wish to exercise your data protection rights, please contact us through our official channels:',
      ],
      bullets: [
        `Official Administrative Email: ${PUBLIC_CONTACT_EMAIL}`,
        'Direct Website Contact Form: Accessible via our official Contact Us page.',
      ],
    },
  },
]
