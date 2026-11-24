import type { GuideContent } from '../types'

export const zidOdooVat15Guide: GuideContent = {
  meta: {
    slug: 'zid-odoo-vat-15',
    title: {
      ar: 'حل اختلاف ضريبة 15% بين زد وأودوو: الأسعار والفواتير',
      en: 'Resolving 15% VAT Differences Between Zid and Odoo: Pricing and Invoicing',
    },
    h1Title: {
      ar: 'حل مشكلة اختلاف ضريبة 15% بين متجر زد ونظام أودوو: دليل احتساب الأسعار والفواتير',
      en: 'Resolving 15% VAT Discrepancies Between Zid and Odoo: E-Invoicing & Rounding Guide',
    },
    description: {
      ar: 'دليل محاسبي وتقني مفصل لحل فوارق الهللات وضريبة 15% بين متجر زد وأودوو: إعداد الأسعار الشاملة، معالجة ضريبة الشحن والخصومات، ومطابقة الفاتورة مع أمر البيع.',
      en: 'A practical accounting guide to resolving 15% VAT discrepancies and rounding differences between Zid and Odoo: tax-inclusive setups, shipping taxes, coupons, and invoice reconciliation.',
    },
    summary: {
      ar: 'يشرح هذا الدليل أسباب ظهور فروقات الهللات بين إجمالي طلب متجر زد وفاتورة أودوو، وطريقة ضبط قواعد التقريب والأسعار الشاملة لضمان التطابق المحاسبي التام.',
      en: 'This guide uncovers why fractional halala rounding variances occur between Zid store checkouts and Odoo invoices, offering exact configuration steps for tax-inclusive parity.',
    },
    category: 'vat',
    primaryKeyword: {
      ar: 'ضريبة زد أودوو',
      en: 'Zid Odoo VAT discrepancy',
    },
    secondaryKeywords: {
      ar: ['ضريبة 15% أودوو', 'السعر شامل الضريبة', 'اختلاف إجمالي فاتورة أودوو', 'فواتير زاتكا زد أودوو'],
      en: ['Saudi 15% VAT Odoo', 'tax-inclusive price calculation', 'Odoo invoice rounding variance', 'ZATCA e-invoicing reconciliation'],
    },
    readingTimeMinutes: 13,
    publishedAt: '2026-11-24',
    updatedAt: '2026-11-24',
    relatedPlatform: 'zid',
    relatedIntegrationPath: '/integrations/zid-odoo',
    relatedGuideSlugs: ['zid-odoo-setup', 'zid-odoo-checklist'],
    featured: true,
  },
  sections: [
    {
      id: 'the-rounding-puzzle',
      title: {
        ar: 'لغز الهللة الواحدة: لماذا يختلف إجمالي الطلب في زد عن فاتورة أودوو؟',
        en: 'The One-Halala Mystery: Why Zid Checkouts and Odoo Invoices Differ',
      },
      paragraphs: [
        {
          ar: 'من أكثر المشكلات المزعجة للمحاسبين ومديري العمليات في المتاجر السعودية هي ظهور فرق هللة واحدة (0.01 ريال) بين إجمالي الطلب المسجل في منصة زد ومجموع الفاتورة الناتجة في نظام أودوو. هذا الفارق البسيط يمنع إقفال الفاتورة آليًا مع قيد الدفع، مما يعطل المطابقة البنكية التلقائية ويستلزم تسويات يدوية مضنية.',
          en: 'A frequent operational headache for e-commerce finance teams in Saudi Arabia is a 0.01 SAR (single halala) discrepancy between the Zid checkout grand total and the generated Odoo customer invoice. This tiny variance halts automated payment reconciliation, creating lingering open balances on customer ledgers and demanding tedious manual adjustments.',
        },
        {
          ar: 'يعود السبب الجوهري لهذا الاختلاف إلى طريقتين مختلفتين في الحساب الرياضي:\n1. التقريب على مستوى كل بند (Round per Line): حيث يتم احتساب السعر الأساسي والضريبة لكل سطر وتقريبها إلى منزلتين عشريتين فورًا، ثم جمع البنود المقربة.\n2. التقريب الإجمالي على مستوى الفاتورة (Round Globally): حيث يتم جمع المبالغ غير المقربة بدقة 4 أو 6 منازل عشرية، ثم تطبيق نسبة 15% على الوعاء الإجمالي وتقريب الناتج في النهاية.\nعندما تتبع منصة التجارة أسلوبًا ويتبع برنامج الـ ERP أسلوبًا آخر، ينشأ فرق الهللة حتمًا.',
          en: 'The underlying reason lies in conflicting mathematical rounding strategies:\n1. Round per Line: The pre-tax unit price and VAT are rounded to two decimal places on each line item before being summed.\n2. Round Globally: Raw sub-totals are computed with 4 to 6 decimal precision, with 15% applied to the cumulative base before final two-decimal rounding.\nWhenever an e-commerce platform and an ERP engine calculate on divergent formulas, a fractional rounding discrepancy inevitably appears.',
        },
      ],
    },
    {
      id: 'tax-inclusive-vs-exclusive',
      title: {
        ar: 'الأسعار الشاملة (Tax-Included) مقابل غير الشاملة: المعادلة الصحيحة',
        en: 'Tax-Inclusive vs. Tax-Exclusive Pricing: The Exact Formula',
      },
      paragraphs: [
        {
          ar: 'في التجارة الإلكترونية الموجهة للأفراد في المملكة العربية السعودية (B2C)، تلزم الأنظمة بعرض الأسعار شاملة لضريبة القيمة المضافة 15%. ومع ذلك، فإن نظام أودوو في أصله المحاسبي يعتمد على "السعر غير شامل الضريبة" كأساس لتسجيل الإيراد في شجرة الحسابات.',
          en: 'In Saudi B2C retail, regulations mandate displaying all customer prices inclusive of 15% VAT. However, ERP backends like Odoo natively record revenue using the pre-tax base amount in general ledger accounts.',
        },
      ],
      table: {
        headers: [
          { ar: 'المتغير المحاسبي', en: 'Accounting Variable' },
          { ar: 'طريقة الحساب الرياضية', en: 'Mathematical Formula' },
          { ar: 'مثال لمنتج سعره 115 ريال بالمتجر', en: 'Example: Product Sold at 115 SAR' },
        ],
        rows: [
          [
            { ar: 'السعر النهائي للعميل (Gross Price)', en: 'Gross Price (Inclusive)' },
            { ar: 'السعر المعروض في متجر زد للمستهلك', en: 'Display price shown on Zid store' },
            { ar: '115.00 ريال', en: '115.00 SAR' },
          ],
          [
            { ar: 'السعر الأساسي غير الشامل (Net Price)', en: 'Net Base Price (Exclusive)' },
            { ar: 'السعر شامل الضريبة ÷ 1.15', en: 'Gross Price ÷ 1.15' },
            { ar: '115.00 ÷ 1.15 = 100.00 ريال', en: '115.00 ÷ 1.15 = 100.00 SAR' },
          ],
          [
            { ar: 'مبلغ ضريبة القيمة المضافة (15% VAT)', en: '15% VAT Amount' },
            { ar: 'السعر الأساسي × 0.15 (أو السعر النهائي - السعر الأساسي)', en: 'Net Price × 0.15 (or Gross - Net)' },
            { ar: '100.00 × 0.15 = 15.00 ريال', en: '100.00 × 0.15 = 15.00 SAR' },
          ],
        ],
      },
      callout: {
        type: 'note',
        title: {
          ar: 'ماذا يحدث مع الأسعار التي لا تقبل القسمة المباشرة؟',
          en: 'What Happens with Numbers That Produce Repeating Decimals?',
        },
        text: {
          ar: 'إذا كان سعر المنتج في زد 50 ريالًا شاملاً الضريبة: 50 ÷ 1.15 = 43.47826... ريال. هنا تظهر أهمية دقة الأرقام العشرية (Decimal Accuracy) في أودوو. إذا تم تقريب السعر فورًا إلى 43.48 ريال، فإن الضريبة تصبح 43.48 × 0.15 = 6.522 (6.52 ريال)، ومجموعهما 43.48 + 6.52 = 50.00 ريال. أما إذا تم ضرب 43.478 في 1.15 فقد ينتج 49.99 ريال!',
          en: 'Consider an item priced at 50 SAR inclusive: 50 ÷ 1.15 = 43.47826... SAR. Here decimal precision is vital. If rounded per line to 43.48 SAR, the tax is 43.48 × 0.15 = 6.52 SAR, summing to 50.00 SAR exactly. If truncated prematurely, the total drops to 49.99 SAR, creating the 1-halala mismatch.',
        },
      },
    },
    {
      id: 'shipping-and-discounts',
      title: {
        ar: 'معالجة ضريبة رسوم الشحن وأكواد الخصم والقسائم',
        en: 'Handling Shipping Fees and Discount Coupon Taxation',
      },
      paragraphs: [
        {
          ar: 'تتعقد حسابات الضريبة عند إضافة رسوم الشحن والخصومات الترويجية للطلب:',
          en: 'Tax reconciliation grows more intricate when factoring delivery charges and promo code discounts:',
        },
      ],
      steps: [
        {
          title: {
            ar: '1. ضريبة رسوم الشحن (Delivery Fees VAT)',
            en: '1. Shipping Fee Taxation',
          },
          text: {
            ar: 'في المملكة العربية السعودية، تخضع خدمات الشحن والتوصيل لضريبة القيمة المضافة بالنسبة الأساسية 15%. إذا دفع العميل 23 ريالاً كرسوم شحن شاملة للضريبة، فإن أودوو يسجل بند الشحن بسعر أساسي 20.00 ريال وضريبة قدرها 3.00 ريال. يتولى ERP Link ربط بند الشحن تلقائيًا بمنتج خدمة مخصص في أودوو مع تطبيق ضريبة 15%.',
            en: 'In Saudi Arabia, domestic delivery fees are subject to standard 15% VAT. If a customer pays 23 SAR for shipping, Odoo registers a shipping service line with 20.00 SAR base and 3.00 SAR VAT. ERP Link automatically links delivery fees to a designated shipping service product with 15% VAT mapped.',
          },
        },
        {
          title: {
            ar: '2. أكواد الخصم والوعاء الضريبي (Discounts & Net Taxable Base)',
            en: '2. Promo Discounts and Net Taxable Base',
          },
          text: {
            ar: 'عند تطبيق كود خصم، يجب أن يخفض الخصم الوعاء الضريبي قبل احتساب الضريبة. على سبيل المثال، إذا كان الطلب بقيمة 100 ريال والخصم 20 ريالاً، فإن الضريبة تحسب على 80 ريالاً فقط. يدعم ERP Link إما توزيع الخصم كنسبة مئوية على بنود الطلب، أو تسجيله كبند خصم مستقل خاضع لنفس المعاملة الضريبية.',
            en: 'When a promo code applies, the discount must reduce the taxable base before tax calculation. For an item originally 100 SAR discounted by 20 SAR, VAT applies strictly to the net 80 SAR. ERP Link supports both proportional line discounting and separate discount lines tied to corresponding tax brackets.',
          },
        },
      ],
    },
    {
      id: 'odoo-tax-configuration',
      title: {
        ar: 'الضبط المحاسبي الصحيح للضرائب في إعدادات أودوو',
        en: 'Optimal Odoo Invoicing & Tax Settings for Complete Alignment',
      },
      paragraphs: [
        {
          ar: 'لتفادي فوارق التقريب بشكل نهائي، قم بضبط إعدادات تطبيق المحاسبة (Invoicing / Accounting) في أودوو وفق التوصيات التالية:',
          en: 'To eliminate rounding discrepancies once and for all, configure Odoo Accounting according to the following recommended standards:',
        },
      ],
      steps: [
        {
          title: {
            ar: 'تفعيل خيار "شامل في السعر" (Included in Price) في تعريف الضريبة',
            en: 'Enable "Included in Price" on Sales Tax Definitions',
          },
          text: {
            ar: 'في أودوو، انتقل إلى المحاسبة > التكوين > الضرائب، وافتح ضريبة المبيعات 15%. تأكد من تفعيل خيار "Included in Price" (مدرج في السعر) إذا كانت أسعار منتجاتك في أودوو مسجلة بالسعر النهائي لمتجر زد.',
            en: 'In Odoo Accounting > Configuration > Taxes, open your standard 15% Sales Tax. Activate "Included in Price" if your catalog unit prices in Odoo represent gross retail prices matching Zid.',
          },
        },
        {
          title: {
            ar: 'ضبط طريقة التقريب في المحاسبة (Rounding Method)',
            en: 'Configure Accounting Rounding Method',
          },
          text: {
            ar: 'في إعدادات المحاسبة، اختر طريقة التقريب المطابقة لمنصتك: "Round Globally" أو "Round per Line". نوصي بمطابقة الطريقة التي يعتمدها متجر زد لمنع تباين هللات المجاميع.',
            en: 'In Accounting Settings, review the Tax Rounding Method: select "Round Globally" or "Round per Line". Aligning this with Zid standard checkout mechanics prevents the fractional edge cases.',
          },
        },
        {
          title: {
            ar: 'حساب تسوية فروق الهللات (Cash Rounding Account)',
            en: 'Establish a Cash Rounding Account for Auto-Writeoff',
          },
          text: {
            ar: 'قم بتفعيل ميزة "تقريب النقد" (Cash Rounding) وربطها بحساب أرباح/خسائر تقريب هللات في شجرة الحسابات. يتيح ذلك لأودوو استيعاب أي فارق يقل عن هللتين تلقائيًا وإقفال الفاتورة دون تدخل يدوي.',
            en: 'Enable "Cash Rounding" and designate a dedicated small-gain/loss rounding account in your General Ledger. This empowers Odoo to absorb any residual fraction under 0.02 SAR automatically, enabling instant invoice settlement.',
          },
        },
      ],
    },
    {
      id: 'pre-deployment-checklist',
      title: {
        ar: 'قائمة التحقق قبل اعتماد الفواتير الإلكترونية',
        en: 'Pre-Deployment Invoicing and VAT Verification Checklist',
      },
      paragraphs: [
        {
          ar: 'قبل تشغيل الفوترة التلقائية، نفّذ طلبات تجريبية بالحالات التالية وتأكد من التطابق التام:',
          en: 'Before switching automated invoicing on, test the following specific scenarios to confirm absolute reconciliation:',
        },
      ],
      steps: [
        {
          title: {
            ar: 'طلب بمنتج فردي بسعر لا يقبل القسمة المباشرة',
            en: 'Single Item with Uneven Fractional Net Price',
          },
          text: {
            ar: 'اختبر شراء منتج بسعر 50 أو 70 ريالاً وتأكد من أن مجموع أمر البيع والفاتورة يطابق 50.00 أو 70.00 ريالاً بالضبط.',
            en: 'Test an order with a price such as 50.00 or 70.00 SAR and verify that both Sales Order and Invoice total exactly 50.00 or 70.00 SAR.',
          },
        },
        {
          title: {
            ar: 'طلب متعدد البنود مع رسوم شحن',
            en: 'Multi-Line Order with Shipping Fees',
          },
          text: {
            ar: 'اختبر طلبًا يحتوي على 3 منتجات مختلفة ورسوم شحن 25 ريالاً، وقارن إجمالي الضريبة المحسوبة في زد مع مجموع الضريبة في أودوو.',
            en: 'Test a 3-item order with a 25 SAR shipping charge, comparing total calculated tax in Zid with the invoice tax summary in Odoo.',
          },
        },
        {
          title: {
            ar: 'طلب بكود خصم مئوي ومبلغ ثابت',
            en: 'Order with Percentage & Fixed Discounts',
          },
          text: {
            ar: 'تأكد من أن الخصم تم طرحه من المبلغ الخاضع للضريبة وليس بعد حساب الضريبة، وأن الإجمالي النهائي يطابق ما دفعه العميل عبر بوابة الدفع.',
            en: 'Verify that promotional discounts reduce the net taxable base correctly and that the final invoiced total mirrors the customer gateway charge.',
          },
        },
      ],
      callout: {
        type: 'warning',
        title: {
          ar: 'تنبيه قانوني وتنظيمي بشأن الاستشارات الضريبية',
          en: 'Legal and Regulatory Tax Advisory Disclaimer',
        },
        text: {
          ar: 'هذا الدليل مقدم لأغراض الإيضاح الفني والتشغيلي لنظام ERP Link فقط. لا يعتبر هذا المحتوى استشارة ضريبية أو قانونية معتمدة. تختلف اللوائح المحاسبية والمواقف الضريبية بين الأنشطة التجارية؛ يرجى دائمًا مراجعة مستشارك المالي المعتمد أو الرجوع إلى الأنظمة الصادرة عن هيئة الزكاة والضريبة والجمارك (ZATCA).',
          en: 'This guide is provided strictly for technical and operational guidance regarding ERP Link software integrations. It does not constitute official accounting, tax, or legal advice. Regulatory obligations vary by entity and industry; always consult your certified tax advisor or ZATCA publications.',
        },
      },
    },
  ],
  faqs: [
    {
      question: {
        ar: 'هل يدعم ERP Link متطلبات الفوترة الإلكترونية للمرحلة الثانية من زاتكا (ZATCA Phase 2)؟',
        en: 'Does ERP Link accommodate ZATCA Phase 2 e-invoicing requirements?',
      },
      answer: {
        ar: 'نعم، يقوم ERP Link بإنشاء مسودات الفواتير أو ترحيلها في أودوو مع كامل البيانات الإلزامية (رقم السجل التجاري، تفاصيل العميل، كود الاستجابة السريعة QR، وتفصيل الضريبة)، مما يتيح لتطبيق الربط المعتمد لزاتكا داخل أودوو توقيع الفاتورة وإرسالها إلكترونيًا بسلاسة.',
        en: 'Yes. ERP Link populates all mandatory structured data on Odoo invoices (buyer VAT IDs, line tax breakouts, reference codes), enabling certified Odoo ZATCA integration modules to seal and report Phase 2 XML/UBL invoices seamlessly.',
      },
    },
    {
      question: {
        ar: 'كيف أتعامل مع المنتجات المعفاة أو الخاضعة لضريبة الصفر (0% VAT)؟',
        en: 'How do we handle zero-rated or tax-exempt catalog items?',
      },
      answer: {
        ar: 'يمكنك تحديد الموقف الضريبي (Fiscal Position) في أودوو أو تعيين كود ضريبة خاص على بطاقة المنتج (مثل 0% Export أو Exempt)، حيث يحترم ERP Link ضريبة كل بند مرسل من متجر زد وينقل كود الإعفاء بدقة.',
        en: 'You can configure Odoo Fiscal Positions or assign custom tax brackets (e.g., 0% Zero-Rated or Exempt) on specific product records. ERP Link preserves the line-level tax classification dispatched by Zid.',
      },
    },
  ],
  summaryKeyTakeaways: {
    ar: [
      'فارق الهللة ينتج عن اختلاف قواعد التقريب بين السطر الإفرادي والتقريب الإجمالي للفاتورة.',
      'تفعيل خيار "شامل في السعر" وتفعيل حساب تقريب النقد في أودوو يحل الفروقات تلقائيًا.',
      'رسوم الشحن تخضع لضريبة 15% ويجب أن ترتبط بمنتج خدمة خاضع للضريبة في أودوو.',
      'راجع دائمًا مستشارك المالي للتحقق من توافق الفواتير الإلكترونية مع اشتراطات هيئة الزكاة والضريبة والجمارك.',
    ],
    en: [
      '1-halala variances stem from contrasting per-line vs. global invoice tax rounding algorithms.',
      'Enabling "Included in Price" and configuring a Cash Rounding account in Odoo automatically settles fractional differences.',
      'Domestic shipping fees are subject to 15% VAT and must link to a taxable service item in Odoo.',
      'Always coordinate with your certified tax accountant to ensure strict adherence to ZATCA e-invoicing standards.',
    ],
  },
  officialDocLinks: [
    {
      label: { ar: 'بوابة هيئة الزكاة والضريبة والجمارك (ZATCA Portal)', en: 'ZATCA Official Portal' },
      url: 'https://zatca.gov.sa',
    },
    {
      label: { ar: 'دليل الضرائب وإعدادات الفوترة في أودوو (Odoo Taxes)', en: 'Odoo Taxes Documentation' },
      url: 'https://www.odoo.com/documentation/17.0/applications/finance/accounting/taxes.html',
    },
  ],
}
