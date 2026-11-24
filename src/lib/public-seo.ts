import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import { getUrlLocaleFromLanguage } from '@/lib/locale'
import { publicBusinessProfile } from '@/lib/public-business-profile'
import { PUBLIC_CONTACT_EMAIL } from '@/lib/public-contact'
import { resolveLanguage } from '@/lib/translations'

// SEO is intentionally limited to publicly accessible marketing pages.
// Never generate indexable metadata for app, admin, OAuth or API routes.
export const PUBLIC_SITE_URL = 'https://erplink.bizsahla.com'
export type PublicPagePath =
  | '/'
  | '/about'
  | '/pricing'
  | '/contact'
  | '/privacy'
  | '/terms'
  | '/integrations'
  | '/integrations/zid-odoo'
  | '/integrations/salla-odoo'
  | '/integrations/shopify-odoo'
  | '/guides'
  | '/guides/zid-odoo-checklist'
  | '/guides/zid-odoo-setup'
  | '/guides/zid-odoo-stock-sync'
  | '/guides/zid-odoo-vat-15'
  | '/guides/zid-odoo-returns'
  | '/guides/salla-odoo-order-mapping'
  | '/guides/shopify-odoo-webhooks'

const copy: Record<PublicPagePath, { ar: { title: string; description: string }; en: { title: string; description: string } }> = {
  '/': {
    ar: { title: 'ERP Link (إي آر بي لينك) | ربط زد وسلة وشوبيفاي بأودوو', description: 'ERP Link منصة ربط المتاجر الإلكترونية بأودوو Odoo؛ اربط زد أو سلة أو شوبيفاي، ونسّق الطلبات والمنتجات والعملاء والمخزون وفق إعدادات متجرك.' },
    en: { title: 'ERP Link (ErpLink) | Zid, Salla & Shopify Odoo Integration', description: 'Connect your Zid, Salla or Shopify store to Odoo with ERP Link. Configure order, product, customer and inventory synchronization for your business.' },
  },
  '/integrations': {
    ar: { title: 'ربط المتاجر الإلكترونية بأودوو | تكاملات ERP Link', description: 'دليلك لربط زد وسلة وشوبيفاي بأودوو Odoo: مزامنة الطلبات والمنتجات والمخزون والعملاء، وإعداد الخرائط وحالات الطلب.' },
    en: { title: 'E-commerce & Odoo Integrations | ERP Link', description: 'Explore Zid, Salla and Shopify Odoo integration guides for orders, inventory, products, customers and mapping.' },
  },
  '/integrations/zid-odoo': {
    ar: { title: 'ربط زد بأودوو Odoo | الطلبات والمخزون | ERP Link', description: 'كيف تربط متجر زد مع أودوو Odoo؟ تعرف على إعداد مزامنة الطلبات والمخزون والعملاء والمرتجعات والضريبة واختبار التكامل.' },
    en: { title: 'Zid Odoo Integration | Orders & Inventory | ERP Link', description: 'Connect Zid with Odoo. Understand orders, stock, customer matching, taxes, returns and testing your ERP integration.' },
  },
  '/integrations/salla-odoo': {
    ar: { title: 'ربط سلة بأودوو Odoo | مزامنة الطلبات | ERP Link', description: 'ربط متجر سلة مع أودوو: إعداد المنتجات والمخزون والعملاء والضرائب وحالات الطلب، وخطوات الفحص قبل التشغيل.' },
    en: { title: 'Salla Odoo Integration | Store Sync | ERP Link', description: 'Explore Salla Odoo integration for orders, products, customers, stock, tax mapping and order status testing.' },
  },
  '/integrations/shopify-odoo': {
    ar: { title: 'ربط شوبيفاي بأودوو Odoo | Shopify | ERP Link', description: 'دليل تكامل Shopify مع Odoo: Webhooks والمنتجات والطلبات والمخزون وحالات الدفع والشحن والمرتجعات.' },
    en: { title: 'Shopify Odoo Integration | Orders & Stock | ERP Link', description: 'Plan Shopify Odoo integration including webhooks, variants, orders, inventory, payment and fulfillment workflows.' },
  },
  '/guides': {
    ar: { title: 'مركز المعرفة | أدلة ربط المتاجر بأنظمة ERP | ERP Link', description: 'مركز معرفة ERP Link: أدلة عملية وشروحات تطبيقية لربط متاجر زد وسلة وشوبيفاي بنظام أودوو ومزامنة الطلبات والمخزون والضرائب.' },
    en: { title: 'Knowledge | E-Commerce & ERP Integration Guides | ERP Link', description: 'ERP Link Knowledge: in-depth technical guides for connecting Zid, Salla, and Shopify stores with Odoo ERP, stock sync, and VAT.' },
  },
  '/guides/zid-odoo-checklist': {
    ar: { title: 'كيفية ربط زد بأودوو: دليل الاختبار | ERP Link', description: 'قائمة عملية لتجهيز وربط زد مع أودوو: خريطة البيانات والضرائب والشحن والطلبات والمرتجعات والتأكد من عدم التكرار.' },
    en: { title: 'Zid Odoo Setup & Testing Checklist | ERP Link', description: 'A practical Zid Odoo integration checklist for product matching, taxes, shipping, returns, order events and test scenarios.' },
  },
  '/guides/zid-odoo-setup': {
    ar: { title: 'كيفية ربط زد بأودوو خطوة بخطوة | ERP Link', description: 'دليل شامل يوضح خطوات ربط متجر زد بنظام أودوو Odoo من الصلاحيات ومطابقة SKU والعملاء إلى إنشاء أول طلب وتتبع السجلات.' },
    en: { title: 'Connect Zid to Odoo Step by Step | ERP Link Guide', description: 'A complete step-by-step walkthrough to connect Zid store with Odoo ERP: credentials, SKU & customer matching, and first order test.' },
  },
  '/guides/zid-odoo-stock-sync': {
    ar: { title: 'مزامنة المخزون بين زد وأودوو: المستودعات وSKU | ERP Link', description: 'تعلم كيفية إعداد مزامنة المخزون بين متجر زد ونظام أودوو بدقة: الكمية المتاحة للبيع، تعدد المستودعات، ومنع البيع الزائد.' },
    en: { title: 'Zid Odoo Stock Sync: Warehouses & SKUs | ERP Link', description: 'Learn how to synchronize inventory between Zid and Odoo: on-hand vs. available stock, warehouse routing, and overselling prevention.' },
  },
  '/guides/zid-odoo-vat-15': {
    ar: { title: 'حل اختلاف ضريبة 15% بين زد وأودوو: الفواتير والأسعار | ERP Link', description: 'دليل محاسبي لحل فوارق الهللات وضريبة 15% بين زد وأودوو: الأسعار الشاملة، معالجة ضريبة الشحن والخصومات، ومطابقة الفواتير.' },
    en: { title: 'Resolving 15% VAT Differences in Zid & Odoo | ERP Link', description: 'Practical guide to resolving fractional halala rounding variances and 15% VAT differences between Zid checkouts and Odoo invoices.' },
  },
  '/guides/zid-odoo-returns': {
    ar: { title: 'إدارة مرتجعات زد في أودوو: المرتجع الجزئي والكامل | ERP Link', description: 'دليل إدارة مرتجعات متجر زد في أودوو: الفرق بين الإلغاء والمرتجع، إنشاء الإشعارات الدائنة، وإرجاع المخزون السليم دون تكرار.' },
    en: { title: 'Managing Zid Returns in Odoo: Partial & Full | ERP Link', description: 'Manage Zid store returns in Odoo: order cancellation vs. sales returns, automated credit notes, stock replenishment, and idempotency.' },
  },
  '/guides/salla-odoo-order-mapping': {
    ar: { title: 'ربط سلة بأودوو: خرائط الطلبات والعملاء والمنتجات | ERP Link', description: 'دليل تطبيقي لإعداد خرائط البيانات بين متجر سلة ونظام أودوو: مطابقة المنتجات والـ SKU، مزامنة جهات الاتصال، ومراحل الطلبات.' },
    en: { title: 'Connect Salla to Odoo: Order & Product Mapping | ERP Link', description: 'Practical guide to configuring field mappings between Salla and Odoo: SKU alignment, customer deduplication, and order lifecycles.' },
  },
  '/guides/shopify-odoo-webhooks': {
    ar: { title: 'حل مشاكل Shopify Webhooks عند الربط بأودوو | ERP Link', description: 'دليل تشخيصي لحل مشاكل إشعارات الويب Webhooks في Shopify عند الربط بأودوو: التحقق من التوقيع، منع مهلة الـ 5 ثوانٍ، وتفادي التكرار.' },
    en: { title: 'Troubleshooting Shopify Webhooks with Odoo | ERP Link', description: 'Diagnostic guide to fixing Shopify webhook sync issues with Odoo: HMAC signature checks, beating 5s timeouts, and duplicate prevention.' },
  },
  '/about': {
    ar: { title: 'عن ERP Link | منصة ربط المتاجر بأنظمة ERP', description: 'تعرف على ERP Link، منصة تكامل المتاجر الإلكترونية مع أنظمة إدارة الأعمال ومزامنة العمليات والبيانات.' },
    en: { title: 'About ERP Link | E-commerce and ERP integration', description: 'Learn about ERP Link, a platform for connecting e-commerce stores with ERP systems and synchronizing business data.' },
  },
  '/pricing': {
    ar: { title: 'الأسعار والخطط | ERP Link', description: 'استكشف خطط ERP Link لربط متجرك الإلكتروني بنظام ERP واختر الخطة المناسبة لنشاطك.' },
    en: { title: 'Pricing and plans | ERP Link', description: 'Explore ERP Link plans for connecting your online store with ERP software.' },
  },
  '/contact': {
    ar: { title: 'تواصل معنا | دعم ERP Link', description: 'تواصل مع فريق ERP Link للاستفسار عن الربط والمزامنة والاشتراكات والدعم الفني.' },
    en: { title: 'Contact us | ERP Link support', description: 'Contact the ERP Link team for questions about integrations, synchronization, subscriptions and support.' },
  },
  '/privacy': {
    ar: { title: 'سياسة الخصوصية | ERP Link', description: 'اطّلع على سياسة خصوصية ERP Link وكيفية التعامل مع بيانات المستخدمين.' },
    en: { title: 'Privacy policy | ERP Link', description: 'Read the ERP Link privacy policy and learn how user information is handled.' },
  },
  '/terms': {
    ar: { title: 'شروط الاستخدام | ERP Link', description: 'اقرأ شروط وأحكام استخدام منصة ERP Link لربط المتاجر الإلكترونية بأنظمة ERP.' },
    en: { title: 'Terms of service | ERP Link', description: 'Review the ERP Link terms of service for connecting online stores with ERP systems.' },
  },
}

function localizedUrl(locale: 'ar-sa' | 'en-us', path: PublicPagePath): string {
  return `${PUBLIC_SITE_URL}/${locale}${path === '/' ? '' : path}`
}

export async function publicPageMetadata(path: PublicPagePath): Promise<Metadata> {
  const cookieStore = await cookies()
  // The existing locale middleware sets this cookie from /ar-sa or /en-us.
  const language = resolveLanguage(cookieStore.get('lang')?.value)
  const locale = getUrlLocaleFromLanguage(language) as 'ar-sa' | 'en-us'
  const page = copy[path][language]
  const canonical = localizedUrl(locale, path)

  return {
    metadataBase: new URL(PUBLIC_SITE_URL),
    title: { absolute: page.title },
    description: page.description,
    alternates: {
      canonical,
      languages: {
        'ar-SA': localizedUrl('ar-sa', path),
        'en-US': localizedUrl('en-us', path),
      },
    },
    openGraph: {
      type: 'website',
      siteName: 'ERP Link',
      title: page.title,
      description: page.description,
      url: canonical,
      locale: language === 'ar' ? 'ar_SA' : 'en_US',
    },
  }
}

// The core entity identity is public and known. Optional fields only appear
// when the owner configures verified business facts in Hostinger.
const business = publicBusinessProfile()

export const homepageStructuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${PUBLIC_SITE_URL}/#organization`,
      name: 'ERP Link',
      alternateName: ['ErpLink', 'ERPLink', 'إي آر بي لينك'],
      url: PUBLIC_SITE_URL,
      logo: `${PUBLIC_SITE_URL}/logo.png`,
      description: 'ERP Link connects Zid, Salla and Shopify stores to enterprise resource planning systems such as Odoo.',
      email: PUBLIC_CONTACT_EMAIL,
      ...(business.sameAs.length ? { sameAs: business.sameAs } : {}),
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: PUBLIC_CONTACT_EMAIL,
        url: `${PUBLIC_SITE_URL}/ar-sa/contact`,
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${PUBLIC_SITE_URL}/#website`,
      name: 'ERP Link',
      alternateName: ['ErpLink', 'إي آر بي لينك'],
      url: PUBLIC_SITE_URL,
      publisher: { '@id': `${PUBLIC_SITE_URL}/#organization` },
      inLanguage: ['ar-SA', 'en-US'],
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${PUBLIC_SITE_URL}/#software`,
      name: 'ERP Link',
      url: PUBLIC_SITE_URL,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: 'E-commerce integration platform for synchronizing stores and ERP systems.',
      publisher: { '@id': `${PUBLIC_SITE_URL}/#organization` },
    },
  ],
} as const
