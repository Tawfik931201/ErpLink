import { Lock, ArrowLeft } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { publicPageMetadata } from '@/lib/public-seo'
import { resolveLanguage, translations, type Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

export const generateMetadata = () => publicPageMetadata('/privacy')

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
- بيانات الاشتراك: الباقة المدفوعة وتواريخها وسجل الدفعات (الدفع يدوي عبر التحويل البنكي، ولا نطلب ولا نخزّن بيانات بطاقة أو وسيلة دفع)
- بيانات المتجر: معلومات المنتجات، الطلبات، العملاء، والفئات لغرض المزامنة
- بيانات الربط: توكنات OAuth لمتجرك وبيانات اعتماد نظام الـ ERP، وتُخزَّن مشفّرة (انظر قسم الأمان)

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
- Subscription data: the plan you purchased, its dates, and a payment history (payment is made by manual bank transfer; we never ask for or store card or payment-instrument details)
- Store data: product information, orders, customers, and categories for synchronization purposes
- Connection credentials: your store OAuth tokens and your ERP credentials, stored encrypted (see the Security section)

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
      body: `لا نبيع معلوماتك الشخصية لأطراف ثالثة. تشارك بياناتك مع الجهات التالية فقط، وبالقدر اللازم لأداء الخدمة:

- مزودو الخدمات الذين يديرون المنصة: Clerk للمصادقة، Supabase لتخزين البيانات، وSendGrid أو خادم SMTP لإرسال البريد الإلكتروني
- منصات المتاجر التي تربطها بحسابك (زد، سلة، Shopify): تُقرأ منها بيانات المنتجات والطلبات والعملاء والفئات عبر واجهاتها البرمجية لأغراض المزامنة فقط
- نظام الـ ERP الذي تربطه بحسابك (Odoo أو ERPNext): تُكتب إليه المنتجات والطلبات وكميات المخزون
- واجهة Telegram Bot API، إذا ربطت حسابك ببوت لاستقبال إشعارات المزامنة (نستخدم توكن البوت الذي تزودنا به)
- عند اقتضاء القانون ذلك أو للاستجابة لطلبات قانونية سارية
- في حالة الاندماج أو الاستحواذ أو بيع الأصول
- بموافقتك الصريحة`,
    },
    en: {
      title: 'Data Sharing',
      body: `We do not sell your personal information to third parties. Your data is shared only with the following, and only to the extent needed to run the Service:

- Service providers that run the platform: Clerk for authentication, Supabase for data storage, and SendGrid or an SMTP server for email delivery
- The store platforms you link to your account (Zid, Salla, Shopify): product, order, customer, and category data is read from them through their APIs for synchronization only
- The ERP you link to your account (Odoo or ERPNext): products, orders, and stock quantities are written to it
- The Telegram Bot API, if you link an account bot to receive sync notifications (we use the bot token you supply)
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
- تشفير مفاتيح API والتوكنات الحساسة (توكنات المتاجر، بيانات اعتماد الـ ERP، توكن بوت تيليجرام) باستخدام AES-256-CBC قبل تخزينها
- التحكم في الوصول على مستوى الصفحات والصلاحيات (RBAC)
- التحقق من ملكية كل مورد قبل السماح بالقراءة أو التعديل
- المراجعة الدورية للإجراءات الأمنية`,
    },
    en: {
      title: 'Security',
      body: `We implement appropriate security measures to protect your information:

- Encryption of all data in transit using TLS/SSL
- Encryption of API keys and sensitive tokens (store tokens, ERP credentials, Telegram bot tokens) using AES-256-CBC before they are stored
- Page-level access control and permissions (RBAC)
- Ownership checks on every workspace, ticket, and store-scoped resource before it is read or modified
- Regular review of security procedures`,
    },
  },
  {
    key: 'retention',
    ar: {
      title: 'الاحتفاظ بالبيانات',
      body: `نحتفظ ببياناتك طوال فترة استخدامك للخدمة. عند إنهاء اشتراكك أو طلب حذف حسابك:

- نوقف المزامنة فوراً، وتبقى بياناتك في النظام إلى أن تُحذف بناءً على طلبك عبر الدعم
- قد نحتفظ بسجلات الاشتراك والفواتير للمدة التي تفرضها الالتزامات المحاسبية والضريبية
- لتصدير بياناتك أو حذفها، تواصل معنا عبر نموذج الاتصال أو البريد الإلكتروني أدناه، ونؤكد الطلب بالرد عليه`,
    },
    en: {
      title: 'Data Retention',
      body: `We retain your data for as long as you use the Service. When you end your subscription or ask us to delete your account:

- Syncing stops immediately; your data stays in the system until you request its deletion through support
- We may retain subscription and invoice records for as long as accounting and tax obligations require
- To export or delete your data, contact us via the form or email address below and we will confirm the request in writing`,
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

لممارسة هذه الحقوق، تواصل معنا عبر نموذج الاتصال أو البريد الإلكتروني في نهاية هذه السياسة. قد نطلب منك التحقق من هويتك قبل التنفيذ.`,
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

To exercise these rights, contact us via the form or email address at the end of this Policy. We may ask you to verify your identity before carrying out the request.`,
    },
  },
  {
    key: 'cookies',
    ar: {
      title: 'ملفات تعريف الارتباط (Cookies)',
      body: `نستخدم ملفات تعريف الارتباط (Cookies) لتقليل الحاجة إلى تسجيل الدخول وحفظ تفضيلاتك. الأنواع المستخدمة:

- كوكيز المصادقة الأساسية: تديرها Clerk وهي ضرورية لتسجيل الدخول
- كوكيز تفضيل اللغة: تحفظ اللغة المختارة للواجهة العامة
- كوكيز إدارية مؤقتة: مثل جلسة انتحال الشخصية التي ينشئها المسؤول وينتهي تلقائياً

لا نستخدم كوكيز تتبّع أو إعلانات من طرف ثالث. يمكنك التحكم في الكوكيز من إعدادات متصفحك، لكن تعطيل كوكيز المصادقة سيمنع تسجيل الدخول.`,
    },
    en: {
      title: 'Cookies',
      body: `We use cookies to keep you signed in and to remember your preferences. The types in use:

- Essential authentication cookies: managed by Clerk, required to sign in
- Language preference cookie: remembers the interface language you chose
- Temporary admin cookies: e.g. the admin impersonation session, which expires automatically

We do not use third-party tracking or advertising cookies. You can manage cookies in your browser, but disabling authentication cookies will prevent you from signing in.`,
    },
  },
  {
    key: 'changes',
    ar: {
      title: 'التغييرات على السياسة',
      body: `قد نقوم بتحديث سياسة الخصوصية هذه من وقت لآخر. سنقوم بإخطارك بأي تغييرات جوهرية عبر البريد الإلكتروني أو من خلال لوحة التحكم. نشجعك على مراجعة هذه الصفحة بشكل دوري للاطلاع على آخر التحديثات.`,
    },
    en: {
      title: 'Changes to This Policy',
      body: `We may update this Privacy Policy from time to time. We will notify you of any material changes via email or through the dashboard. We encourage you to review this page periodically for the latest updates.`,
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

export default async function PrivacyPage() {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div
      className="flex min-h-screen flex-col overflow-x-clip bg-background text-foreground font-sans"
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
