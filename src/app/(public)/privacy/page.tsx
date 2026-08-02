import { Lock, ArrowLeft } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { type Language, translations } from '@/lib/translations'
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
      title: 'المقدمة',
      body: `نحن في ERP Link ("نحن"، "لنا" أو "المنصة") نأخذ خصوصيتك على محمل الجد. توضح سياسة الخصوصية هذه ("السياسة") كيفية جمع واستخدام وحماية معلوماتك الشخصية عندما تستخدم خدمتنا.

باستخدامك للخدمة، فإنك توافق على جمع واستخدام المعلومات وفقاً لهذه السياسة.`,
    },
    en: {
      title: 'Introduction',
      body: `At ERP Link ("we", "us" or "the Platform"), we take your privacy seriously. This Privacy Policy ("Policy") explains how we collect, use, and protect your personal information when you use our Service.

By using the Service, you consent to the collection and use of information in accordance with this Policy.`,
    },
  },
  {
    key: 'collect',
    ar: {
      title: 'البيانات التي نجمعها',
      body: `قد نجمع الأنواع التالية من المعلومات:

المعلومات التي تقدمها لنا:
- معلومات الحساب: الاسم، البريد الإلكتروني، رقم الهاتف، اسم المتجر
- معلومات الدفع: يتم معالجتها عبر مزود دفع خارجي (نحن لا نخزنها)
- بيانات المتجر: معلومات المنتجات، الطلبات، العملاء، والفئات لغرض المزامنة

المعلومات التي نجمعها تلقائياً:
- بيانات الاستخدام: الصفحات التي تزورها، الإجراءات التي تتخذها في الخدمة
- معلومات الجهاز: عنوان IP، نوع المتصفح، نظام التشغيل
- ملفات تعريف الارتباط (Cookies): لتحسين تجربة المستخدم`,
    },
    en: {
      title: 'Information We Collect',
      body: `We may collect the following types of information:

Information You Provide:
- Account information: name, email, phone number, store name
- Payment information: processed through a third-party payment provider (we do not store it)
- Store data: product information, orders, customers, and categories for synchronization purposes

Information We Collect Automatically:
- Usage data: pages you visit, actions you take within the Service
- Device information: IP address, browser type, operating system
- Cookies: to improve user experience`,
    },
  },
  {
    key: 'use',
    ar: {
      title: 'كيف نستخدم بياناتك',
      body: `نستخدم المعلومات التي نجمعها للأغراض التالية:

- تقديم الخدمة وصيانتها وتحسينها
- مزامنة البيانات بين متجرك ونظام الـ ERP
- معالجة المعاملات وإرسال الإشعارات المتعلقة بالخدمة
- التواصل معك بشأن حسابك أو التحديثات أو الدعم الفني
- كشف ومنع الاحتيال وإساءة الاستخدام
- الامتثال للالتزامات القانونية`,
    },
    en: {
      title: 'How We Use Your Data',
      body: `We use the information we collect for the following purposes:

- To provide, maintain, and improve the Service
- To synchronize data between your store and ERP system
- To process transactions and send service-related notifications
- To communicate with you about your account, updates, or technical support
- To detect and prevent fraud and abuse
- To comply with legal obligations`,
    },
  },
  {
    key: 'share',
    ar: {
      title: 'مشاركة البيانات',
      body: `لا نبيع معلوماتك الشخصية لأطراف ثالثة. قد نشارك معلوماتك في الحالات التالية:

- مع مزودي الخدمة الذين يساعدوننا في تشغيل المنصة (مثل: Clerk للمصادقة، Supabase لتخزين البيانات، Resend للبريد الإلكتروني)
- عند اقتضاء القانون ذلك أو للاستجابة لطلبات قانونية سارية
- في حالة الاندماج أو الاستحواذ أو بيع الأصول
- بموافقتك الصريحة`,
    },
    en: {
      title: 'Data Sharing',
      body: `We do not sell your personal information to third parties. We may share your information in the following cases:

- With service providers who help us operate the platform (e.g., Clerk for authentication, Supabase for data storage, Resend for email)
- When required by law or to respond to valid legal requests
- In the event of a merger, acquisition, or sale of assets
- With your explicit consent`,
    },
  },
  {
    key: 'security',
    ar: {
      title: 'الأمان',
      body: `نتخذ إجراءات أمنية مناسبة لحماية معلوماتك:

- تشفير جميع البيانات أثناء النقل باستخدام TLS/SSL
- تشفير مفاتيح API والتوكنات الحساسة باستخدام AES-256-CBC
- التحكم في الوصول على مستوى الصفحات والصلاحيات (RBAC)
- المراجعة الدورية للإجراءات الأمنية
- نسخ احتياطي منتظم للبيانات`,
    },
    en: {
      title: 'Security',
      body: `We implement appropriate security measures to protect your information:

- Encryption of all data in transit using TLS/SSL
- Encryption of API keys and sensitive tokens using AES-256-CBC
- Page-level access control and permissions (RBAC)
- Regular review of security procedures
- Regular data backups`,
    },
  },
  {
    key: 'retention',
    ar: {
      title: 'الاحتفاظ بالبيانات',
      body: `نحتفظ ببياناتك طوال فترة استخدامك للخدمة. عند حذف حسابك:

- يتم حذف بيانات المتجر والمزامنة خلال 30 يوماً
- قد نحتفظ ببعض المعلومات للامتثال للالتزامات القانونية (مثل سجلات الفواتير)
- يمكنك طلب تصدير بياناتك في أي وقت من خلال لوحة التحكم`,
    },
    en: {
      title: 'Data Retention',
      body: `We retain your data for as long as you use the Service. When you delete your account:

- Store and sync data is deleted within 30 days
- We may retain certain information for legal compliance (e.g., invoice records)
- You can request a data export at any time through the dashboard`,
    },
  },
  {
    key: 'rights',
    ar: {
      title: 'حقوقك',
      body: `لديك الحقوق التالية بخصوص معلوماتك الشخصية:

- الحق في الوصول إلى بياناتك
- الحق في تصحيح أو تحديث بياناتك
- الحق في حذف بياناتك ("الحق في النسيان")
- الحق في تقييد معالجة بياناتك
- الحق في نقل بياناتك
- الحق في الاعتراض على معالجة بياناتك

لممارسة هذه الحقوق، يمكنك التواصل معنا عبر قسم الإعدادات في لوحة التحكم أو عبر نموذج الاتصال.`,
    },
    en: {
      title: 'Your Rights',
      body: `You have the following rights regarding your personal information:

- The right to access your data
- The right to correct or update your data
- The right to delete your data ("right to be forgotten")
- The right to restrict processing of your data
- The right to data portability
- The right to object to processing of your data

To exercise these rights, you can contact us through the settings section in the dashboard or via the contact form.`,
    },
  },
  {
    key: 'cookies',
    ar: {
      title: 'ملفات تعريف الارتباط (Cookies)',
      body: `نستخدم ملفات تعريف الارتباط (Cookies) وتقنيات مماثلة لتحسين تجربتك. أنواع الكوكيز التي نستخدمها:

- الكوكيز الأساسية: ضرورية لعمل المنصة (مصادقة Clerk، تفضيلات اللغة)
- كوكيز الأداء: تساعدنا في فهم كيفية استخدام المنصة وتحسينها
- كوكيز الوظائف: تذكر تفضيلاتك (اللغة، السمة)

يمكنك التحكم في إعدادات الكوكيز من خلال متصفحك.`,
    },
    en: {
      title: 'Cookies',
      body: `We use cookies and similar tracking technologies to enhance your experience. Types of cookies we use:

- Essential cookies: necessary for the platform to function (Clerk authentication, language preferences)
- Performance cookies: help us understand how the platform is used and improve it
- Functional cookies: remember your preferences (language, theme)

You can control cookie settings through your browser.`,
    },
  },
  {
    key: 'changes',
    ar: {
      title: 'التغييرات على السياسة',
      body: `قد نقوم بتحديث سياسة الخصوصية هذه من وقت لآخر. سنقوم بإخطارك بأي تغييرات جوهرية عبر البريد الإلكتروني أو من خلال لوحة التحكم. نشجعك على مراجعة هذه الصفحة بشكل دوري للاطلاع على آخر التحديثات.

آخر تحديث: يوليو ٢٠٢٤`,
    },
    en: {
      title: 'Changes to This Policy',
      body: `We may update this Privacy Policy from time to time. We will notify you of any material changes via email or through the dashboard. We encourage you to review this page periodically for the latest updates.

Last updated: July 2024`,
    },
  },
  {
    key: 'contact',
    ar: {
      title: 'اتصل بنا',
      body: `إذا كان لديك أي أسئلة أو استفسارات حول سياسة الخصوصية هذه، يرجى التواصل معنا:

- عبر نموذج الاتصال: erplinks.com/contact
- عبر البريد الإلكتروني: support@erplinks.com

أو من خلال قسم الإعدادات في لوحة التحكم.`,
    },
    en: {
      title: 'Contact Us',
      body: `If you have any questions or concerns about this Privacy Policy, please contact us:

- Through the contact form: erplinks.com/contact
- By email: support@erplinks.com

Or through the settings section in the dashboard.`,
    },
  },
]

export default function PrivacyPage() {
  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
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
              <Lock className="h-3.5 w-3.5" />
              <span>{t(lang, 'privacy.badge')}</span>
            </div>

            <h1 className="text-4xl md:text-5xl font-black text-foreground leading-[1.15] tracking-tight">
              {t(lang, 'privacy.pageTitle')}
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
