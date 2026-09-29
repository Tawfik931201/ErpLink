import { Shield, ArrowLeft } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { resolveLanguage, translations, type Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

function t(lang: Language, key: string): string {
  const dict = translations[lang] as Record<string, string>
  if (dict && dict[key]) return dict[key]
  const fallbackDict = translations['ar'] as Record<string, string>
  if (fallbackDict && fallbackDict[key]) return fallbackDict[key]
  return key
}

const sections = [
  {
    key: 'introduction',
    ar: {
      title: 'المقدمة والقبول',
      body: `باستخدامك لخدمة ERP Link ("الخدمة")، فإنك توافق على الالتزام بهذه الشروط والأحكام ("الشروط"). إذا كنت لا توافق على أي جزء من هذه الشروط، يجب عليك عدم استخدام الخدمة.

نحن نحتفظ بالحق في تعديل هذه الشروط في أي وقت. سيتم إخطارك بالتغييرات الجوهرية عبر البريد الإلكتروني أو من خلال لوحة التحكم. استمرارك في استخدام الخدمة بعد التعديلات يعتبر قبولاً منها.`,
    },
    en: {
      title: 'Introduction & Acceptance',
      body: `By using ERP Link ("the Service"), you agree to be bound by these Terms and Conditions ("Terms"). If you do not agree to any part of these Terms, you must not use the Service.

We reserve the right to modify these Terms at any time. Material changes will be notified via email or through the dashboard. Your continued use of the Service after modifications constitutes acceptance.`,
    },
  },
  {
    key: 'service',
    ar: {
      title: 'وصف الخدمة',
      body: `ERP Link هي منصة ربط (Integration Platform as a Service) تتيح مزامنة البيانات بين المتاجر الإلكترونية (مثل زد، سلة، وشوبيفاي) وأنظمة تخطيط الموارد (ERP) مثل أودو.

الخدمة تشمل:
- مزامنة فورية للطلبات، المنتجات، المخزون، والعملاء
- مركز ربط الحقول لتخصيص تدفق البيانات
- نقل البيانات الأولي (Historical Transfer)
- إشعارات تيليجرام فورية
- سجل عمليات وتدقيق`,
    },
    en: {
      title: 'Service Description',
      body: `ERP Link is an Integration Platform as a Service (iPaaS) that enables data synchronization between e-commerce stores (such as Zid, Salla, and Shopify) and ERP systems like Odoo.

The Service includes:
- Real-time sync of orders, products, inventory, and customers
- Field Mapping Center to customize data flow
- Historical data transfer
- Instant Telegram notifications
- Audit logs`,
    },
  },
  {
    key: 'accounts',
    ar: {
      title: 'الحسابات والتسجيل',
      body: `- يجب أن تكون على الأقل ١٨ عاماً لاستخدام الخدمة
- أنت مسؤول عن الحفاظ على سرية بيانات حسابك
- أنت مسؤول عن جميع الأنشطة التي تحدث تحت حسابك
- يجب عليك إعلامنا فوراً بأي استخدام غير مصرح به لحسابك
- نحتفظ بالحق في تعليق أو إنهاء حسابك في حالة انتهاك هذه الشروط`,
    },
    en: {
      title: 'Accounts & Registration',
      body: `- You must be at least 18 years old to use the Service
- You are responsible for maintaining the confidentiality of your account credentials
- You are responsible for all activities that occur under your account
- You must notify us immediately of any unauthorized use of your account
- We reserve the right to suspend or terminate your account for breach of these Terms`,
    },
  },
  {
    key: 'subscription',
    ar: {
      title: 'الاشتراك والفوترة',
      body: `- الخطط والأسعار موضحة في صفحة الأسعار وقد تتغير من وقت لآخر
- يتم الدفع مقدماً على أساس شهري أو سنوي حسب الخطة المختارة
- الإلغاء: يمكنك إلغاء اشتراكك في أي وقت. يستمر الوصول حتى نهاية فترة الفوترة الحالية
- المبالغ المدفوعة غير قابلة للاسترداد ما لم ينص القانون على خلاف ذلك
- نحن لا نخزن معلومات الدفع الخاصة بك — جميع المدفوعات تتم عبر معالج دفع خارجي آمن`,
    },
    en: {
      title: 'Subscription & Billing',
      body: `- Plans and pricing are listed on the pricing page and may change from time to time
- Payment is due in advance on a monthly or yearly basis depending on the chosen plan
- Cancellation: you may cancel your subscription at any time. Access continues until the end of the current billing period
- Paid amounts are non-refundable unless otherwise required by law
- We do not store your payment information — all payments are processed through a secure third-party payment processor`,
    },
  },
  {
    key: 'usage',
    ar: {
      title: 'قواعد الاستخدام',
      body: `أنت توافق على عدم:

- استخدام الخدمة لأي غرض غير قانوني
- محاولة الوصول غير المصرح به إلى أنظمتنا أو حسابات المستخدمين الآخرين
- استخدام الخدمة لإرسال برامج ضارة أو فيروسات
- انتهاك حقوق الملكية الفكرية للغير
- تجاوز حدود الاستخدام المحددة في خطتك
- استخدام الخدمة بطريقة قد تعطل أو تثقل كاهل البنية التحتية للمنصة`,
    },
    en: {
      title: 'Acceptable Use',
      body: `You agree not to:

- Use the Service for any unlawful purpose
- Attempt unauthorized access to our systems or other users' accounts
- Use the Service to distribute malware or viruses
- Infringe upon the intellectual property rights of others
- Exceed the usage limits specified in your plan
- Use the Service in any manner that could disrupt or overburden the platform infrastructure`,
    },
  },
  {
    key: 'data',
    ar: {
      title: 'البيانات والملكية الفكرية',
      body: `- نحن لا نملك بيانات متجرك أو نظام ERP الخاص بك
- أنت تحتفظ بجميع حقوق الملكية الفكرية لبياناتك
- نحن نملك المنصة والبنية التحتية والبرمجيات
- تمنحنا ترخيصاً لمعالجة بياناتك لغرض تقديم الخدمة فقط
- نحن نحمي بياناتك وفقاً لسياسة الخصوصية`,
    },
    en: {
      title: 'Data & Intellectual Property',
      body: `- We do not own your store or ERP data
- You retain all intellectual property rights to your data
- We own the platform, infrastructure, and software
- You grant us a license to process your data solely for the purpose of providing the Service
- We protect your data in accordance with the Privacy Policy`,
    },
  },
  {
    key: 'limitation',
    ar: {
      title: 'حدود المسؤولية',
      body: `- الخدمة مقدمة "كما هي" بدون ضمانات من أي نوع
- نحن لسنا مسؤولين عن أي أضرار غير مباشرة أو تبعية أو خاصة ناتجة عن استخدام الخدمة
- مسؤوليتنا الإجمالية تقتصر على المبلغ المدفوع للخدمة خلال الـ ١٢ شهراً السابقة للمطالبة
- لا نتحمل مسؤولية انقطاع الخدمة الناتج عن مزودي الطرف الثالث (زد، سلة، شوبيفاي، أودو)
- لا نضمن أن الخدمة ستكون خالية من الأخطاء أو متاحة بشكل متواصل`,
    },
    en: {
      title: 'Limitation of Liability',
      body: `- The Service is provided "as is" without warranties of any kind
- We shall not be liable for any indirect, incidental, special, or consequential damages arising from the use of the Service
- Our total liability is limited to the amount paid for the Service in the 12 months preceding the claim
- We are not responsible for service interruptions caused by third-party providers (Zid, Salla, Shopify, Odoo)
- We do not guarantee that the Service will be error-free or continuously available`,
    },
  },
  {
    key: 'termination',
    ar: {
      title: 'الإنهاء',
      body: `- يمكنك إنهاء حسابك في أي وقت من خلال لوحة التحكم
- نحن نحتفظ بالحق في تعليق أو إنهاء الوصول للخدمة في حالة انتهاك هذه الشروط
- بعد الإنهاء، ستتوقف المزامنة وستحتفظ ببياناتك لمدة ٣٠ يوماً للتصدير
- المواد المتعلقة بهذه الشروط المتعلقة بالملكية الفكرية وحدود المسؤولية والسرية ستبقى سارية بعد الإنهاء`,
    },
    en: {
      title: 'Termination',
      body: `- You may terminate your account at any time through the dashboard
- We reserve the right to suspend or terminate access to the Service for violation of these Terms
- Upon termination, sync will stop and we will retain your data for 30 days for export
- Provisions related to intellectual property, limitation of liability, and confidentiality will survive termination`,
    },
  },
  {
    key: 'governing',
    ar: {
      title: 'القانون المطبق',
      body: `تخضع هذه الشروط وتُفسر وفقاً لقوانين المملكة العربية السعودية. أي نزاعات تنشأ عن هذه الشروط ستتم تسويتها في محاكم المملكة العربية السعودية.`,
    },
    en: {
      title: 'Governing Law',
      body: `These Terms shall be governed by and construed in accordance with the laws of the Kingdom of Saudi Arabia. Any disputes arising from these Terms shall be resolved in the courts of the Kingdom of Saudi Arabia.`,
    },
  },
  {
    key: 'contact',
    ar: {
      title: 'اتصل بنا',
      body: `للاستفسارات المتعلقة بهذه الشروط، يرجى التواصل معنا:

- عبر نموذج الاتصال: erplinks.com/contact
- عبر البريد الإلكتروني: support@erplinks.com`,
    },
    en: {
      title: 'Contact Us',
      body: `For inquiries regarding these Terms, please contact us:

- Through the contact form: erplinks.com/contact
- By email: support@erplinks.com`,
    },
  },
]

export default function TermsPage() {
  const cookieStore = cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div
      className="flex min-h-screen flex-col bg-background text-foreground font-sans overflow-x-hidden"
      dir={dir}
    >
      <PublicSiteHeader lang={lang} />

      <main className="flex-1">
        <section className="pt-20 pb-16 px-6 md:px-12 relative overflow-hidden bg-secondary/20">
          <div className="absolute top-[-80px] right-[-80px] w-[400px] h-[400px] rounded-full bg-foreground/[0.03] blur-3xl pointer-events-none" />
          <div className="absolute bottom-[-80px] left-[-80px] w-[350px] h-[350px] rounded-full bg-foreground/[0.02] blur-3xl pointer-events-none" />

          <div className="max-w-3xl mx-auto flex flex-col items-center text-center gap-6 relative">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold">
              <Shield className="h-3.5 w-3.5" />
              <span>{t(lang, 'terms.badge')}</span>
            </div>

            <h1 className="text-4xl md:text-5xl font-black text-foreground leading-[1.15] tracking-tight">
              {t(lang, 'terms.pageTitle')}
            </h1>

            <p className="text-sm text-muted-foreground">
              {t(lang, 'privacy.lastUpdated')}
            </p>

            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className={cn('h-3.5 w-3.5', lang === 'ar' ? 'rotate-180' : '')} />
              <span>{lang === 'ar' ? 'العودة إلى الرئيسية' : 'Back to Home'}</span>
            </Link>
          </div>
        </section>

        <section className="py-16 px-6 md:px-12">
          <div className="max-w-3xl mx-auto space-y-6">
            {sections.map((section) => {
              const content = lang === 'ar' ? section.ar : section.en
              return (
                <div
                  key={section.key}
                  className="bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm"
                >
                  <div className="flex items-start gap-4 mb-4">
                    <span className="flex h-6 w-1 rounded-full bg-foreground shrink-0 mt-1.5" />
                    <h2 className="text-xl md:text-2xl font-bold tracking-tight">
                      {content.title}
                    </h2>
                  </div>
                  <div className="text-sm md:text-base text-muted-foreground leading-[1.8] whitespace-pre-line">
                    {content.body}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </main>

      <PublicSiteFooter lang={lang} />
    </div>
  )
}
