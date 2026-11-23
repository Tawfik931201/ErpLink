import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import { getUrlLocaleFromLanguage } from '@/lib/locale'
import { resolveLanguage } from '@/lib/translations'

// SEO is intentionally limited to publicly accessible marketing pages.
// Never generate indexable metadata for app, admin, OAuth or API routes.
export const PUBLIC_SITE_URL = 'https://erplink.bizsahla.com'
export type PublicPagePath = '/' | '/about' | '/pricing' | '/contact' | '/privacy' | '/terms'

const copy: Record<PublicPagePath, { ar: { title: string; description: string }; en: { title: string; description: string } }> = {
  '/': {
    ar: { title: 'ERP Link | اربط متجرك الإلكتروني بنظام ERP', description: 'اربط متجرك على زد أو سلة أو شوبيفاي بأنظمة ERP، ونسّق الطلبات والمنتجات والعملاء والمخزون من مكان واحد.' },
    en: { title: 'ERP Link | Connect your online store to ERP', description: 'Connect Zid, Salla or Shopify with your ERP system. Synchronize orders, products, customers and inventory.' },
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

// Published public company and software facts; no unverified social profile URLs.
export const homepageStructuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${PUBLIC_SITE_URL}/#organization`,
      name: 'ERP Link',
      url: PUBLIC_SITE_URL,
      logo: `${PUBLIC_SITE_URL}/logo.png`,
      email: 'support@erplinks.com',
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: 'support@erplinks.com',
        url: `${PUBLIC_SITE_URL}/ar-sa/contact`,
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${PUBLIC_SITE_URL}/#website`,
      name: 'ERP Link',
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
