import type { GuideCategory, GuideCategorySlug } from './types'

export const guideCategories: Record<GuideCategorySlug, GuideCategory> = {
  'zid-odoo': {
    slug: 'zid-odoo',
    title: { ar: 'ربط زد بأودوو', en: 'Zid + Odoo' },
    description: {
      ar: 'أدلة إعداد وتكامل متجر زد مع أودوو، ومطابقة البيانات وصلاحيات التطبيق واختبار أول طلب.',
      en: 'Comprehensive guides for connecting Zid with Odoo, permissions, data mapping, and test scenarios.',
    },
    iconName: 'ShoppingBag',
  },
  'salla-odoo': {
    slug: 'salla-odoo',
    title: { ar: 'ربط سلة بأودوو', en: 'Salla + Odoo' },
    description: {
      ar: 'إعداد خرائط الطلبات والعملاء والمنتجات لمتجر سلة مع نظام أودوو بدقة وموثوقية.',
      en: 'Setting up order, customer, and product mappings between Salla and Odoo with precision.',
    },
    iconName: 'RefreshCw',
  },
  'shopify-odoo': {
    slug: 'shopify-odoo',
    title: { ar: 'ربط شوبيفاي بأودوو', en: 'Shopify + Odoo' },
    description: {
      ar: 'حل مشاكل Webhooks والاشتراكات في الأحداث ومزامنة الطلبات والمخزون بين Shopify وOdoo.',
      en: 'Troubleshooting webhooks, event subscriptions, and synchronizing orders and inventory.',
    },
    iconName: 'Layers',
  },
  stock: {
    slug: 'stock',
    title: { ar: 'المنتجات والمخزون', en: 'Products & Stock' },
    description: {
      ar: 'مزامنة الكميات بين المستودعات ومطابقة SKU والفرق بين المخزون الفعلي والمتاح للبيع.',
      en: 'Multi-warehouse stock sync, SKU matching, and on-hand vs. forecasted available inventory.',
    },
    iconName: 'Box',
  },
  vat: {
    slug: 'vat',
    title: { ar: 'الضرائب والفواتير', en: 'Taxes & Invoicing' },
    description: {
      ar: 'معالجة ضريبة 15%، والأسعار الشاملة، ومطابقة إجماليات أوامر البيع مع الفواتير المحاسبية.',
      en: 'Managing 15% VAT, tax-inclusive calculations, and reconciling sales orders with accounting invoices.',
    },
    iconName: 'FileText',
  },
  returns: {
    slug: 'returns',
    title: { ar: 'المرتجعات وحل المشكلات', en: 'Returns & Troubleshooting' },
    description: {
      ar: 'إدارة المرتجعات الجزئية والكاملة، والإشعارات الدائنة، وإرجاع المخزون دون تكرار.',
      en: 'Handling partial and full returns, credit notes, stock replenishment, and preventing duplicates.',
    },
    iconName: 'RotateCcw',
  },
}

export const categoryList: GuideCategory[] = Object.values(guideCategories)
