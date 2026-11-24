import type { DocNavSection } from './docs-types'

export const DOCS_SECTIONS: DocNavSection[] = [
  {
    category: 'getting-started',
    title: {
      ar: 'البداية والتشغيل السريع',
      en: 'Getting Started',
    },
    iconName: 'Rocket',
    items: [
      {
        slug: 'getting-started',
        href: '/docs/getting-started',
        title: {
          ar: 'نظرة عامة والبدء السريع',
          en: 'Overview & Quickstart',
        },
      },
      {
        slug: 'create-account',
        href: '/docs/create-account',
        title: {
          ar: 'إنشاء الحساب والتجربة المجانية',
          en: 'Account Creation & Free Trial',
        },
      },
      {
        slug: 'workspaces',
        href: '/docs/workspaces',
        title: {
          ar: 'إدارة مساحات العمل والعزل',
          en: 'Workspaces & Tenant Isolation',
        },
      },
    ],
  },
  {
    category: 'connect',
    title: {
      ar: 'ربط المتاجر وأنظمة ERP',
      en: 'Store & ERP Connections',
    },
    iconName: 'Link2',
    items: [
      {
        slug: 'connect/zid',
        href: '/docs/connect/zid',
        title: {
          ar: 'ربط متجر زد (Zid)',
          en: 'Connect Zid Store',
        },
        badge: {
          text: { ar: 'مكتمل', en: 'Verified' },
          variant: 'success',
        },
      },
      {
        slug: 'connect/salla',
        href: '/docs/connect/salla',
        title: {
          ar: 'ربط متجر سلة (Salla)',
          en: 'Connect Salla Store',
        },
        badge: {
          text: { ar: 'مكتمل', en: 'Verified' },
          variant: 'success',
        },
      },
      {
        slug: 'connect/shopify',
        href: '/docs/connect/shopify',
        title: {
          ar: 'ربط متجر شوبيفاي (Shopify)',
          en: 'Connect Shopify Store',
        },
      },
      {
        slug: 'connect/odoo',
        href: '/docs/connect/odoo',
        title: {
          ar: 'ربط نظام أودوو (Odoo 14–20)',
          en: 'Connect Odoo ERP (14–20)',
        },
        badge: {
          text: { ar: 'الكل', en: 'All Versions' },
          variant: 'brand',
        },
      },
    ],
  },
  {
    category: 'mapping',
    title: {
      ar: 'مركز الخرائط والمطابقة',
      en: 'Mapping Center',
    },
    iconName: 'GitBranch',
    items: [
      {
        slug: 'mapping/overview',
        href: '/docs/mapping/overview',
        title: {
          ar: 'دليل مركز المطابقة القياسية',
          en: 'Standard Mapping Overview',
        },
      },
      {
        slug: 'mapping/orders',
        href: '/docs/mapping/orders',
        title: {
          ar: 'مطابقة الطلبات والحالات والدفع',
          en: 'Orders & Status Mapping',
        },
      },
      {
        slug: 'mapping/products',
        href: '/docs/mapping/products',
        title: {
          ar: 'مطابقة المنتجات والباركود وSKU',
          en: 'Products & SKU Mapping',
        },
      },
      {
        slug: 'mapping/customers',
        href: '/docs/mapping/customers',
        title: {
          ar: 'مطابقة العملاء وجهات الاتصال',
          en: 'Customers & Contact Matching',
        },
      },
      {
        slug: 'mapping/categories',
        href: '/docs/mapping/categories',
        title: {
          ar: 'مطابقة التصنيفات والفئات',
          en: 'Categories Mapping',
        },
      },
      {
        slug: 'mapping/custom-fields',
        href: '/docs/mapping/custom-fields',
        title: {
          ar: 'الحقول المخصصة واستوديو أودوو',
          en: 'Custom Fields & Studio',
        },
      },
    ],
  },
  {
    category: 'orders',
    title: {
      ar: 'الطلبات والمخزون والفواتير',
      en: 'Orders, Inventory & VAT',
    },
    iconName: 'ShoppingCart',
    items: [
      {
        slug: 'orders',
        href: '/docs/orders',
        title: {
          ar: 'دورة مزامنة الطلب في أودوو',
          en: 'Order Synchronization Lifecycle',
        },
      },
      {
        slug: 'inventory',
        href: '/docs/inventory',
        title: {
          ar: 'مزامنة المخزون وتعدد المستودعات',
          en: 'Inventory & Multi-Warehouse Sync',
        },
      },
      {
        slug: 'taxes',
        href: '/docs/taxes',
        title: {
          ar: 'الضريبة 15% وفوارق الأسعار الشاملة',
          en: '15% VAT & Price Parity',
        },
      },
      {
        slug: 'returns',
        href: '/docs/returns',
        title: {
          ar: 'المرتجعات والإشعارات الدائنة',
          en: 'Returns & Credit Notes',
        },
      },
    ],
  },
  {
    category: 'operations',
    title: {
      ar: 'المراقبة والموثوقية والتشغيل',
      en: 'Operations & Reliability',
    },
    iconName: 'Activity',
    items: [
      {
        slug: 'logs',
        href: '/docs/logs',
        title: {
          ar: 'سجلات المزامنة والحل اليدوي',
          en: 'Sync Logs & Manual Resolution',
        },
      },
      {
        slug: 'queue',
        href: '/docs/queue',
        title: {
          ar: 'طابور المعالجة وإعادة المحاولة',
          en: 'Processing Queue & Retries',
        },
      },
      {
        slug: 'initial-transfer',
        href: '/docs/initial-transfer',
        title: {
          ar: 'النقل الأولي للبيانات والمنتجات',
          en: 'Initial Catalog Transfer',
        },
      },
      {
        slug: 'notifications',
        href: '/docs/notifications',
        title: {
          ar: 'إشعارات المتصفح وبوت تليجرام',
          en: 'Push & Telegram Notifications',
        },
      },
    ],
  },
  {
    category: 'accounts',
    title: {
      ar: 'إدارة الفريق والاشتراكات والدعم',
      en: 'Team, Billing & Support',
    },
    iconName: 'Users',
    items: [
      {
        slug: 'team',
        href: '/docs/team',
        title: {
          ar: 'إدارة الفريق وصلاحيات الأعضاء',
          en: 'Team Management & RBAC Roles',
        },
      },
      {
        slug: 'billing',
        href: '/docs/billing',
        title: {
          ar: 'الاشتراكات والتجديد اليدوي',
          en: 'Subscriptions & Manual Billing',
        },
      },
      {
        slug: 'support',
        href: '/docs/support',
        title: {
          ar: 'تذاكر الدعم والمحادثة المباشرة',
          en: 'Support Tickets & Helpdesk',
        },
      },
    ],
  },
  {
    category: 'troubleshooting',
    title: {
      ar: 'استكشاف الأخطاء والأسئلة الشائعة',
      en: 'Troubleshooting & FAQ',
    },
    iconName: 'LifeBuoy',
    items: [
      {
        slug: 'troubleshooting',
        href: '/docs/troubleshooting',
        title: {
          ar: 'دليل حل المشكلات التشغيلية الشائعة',
          en: 'Common Operational Diagnostics',
        },
      },
      {
        slug: 'faq',
        href: '/docs/faq',
        title: {
          ar: 'الأسئلة الأكثر تكراراً والأمان',
          en: 'Frequently Asked Questions',
        },
      },
    ],
  },
]

export function getAllDocSlugs(): string[] {
  return DOCS_SECTIONS.flatMap((section) => section.items.map((item) => item.slug))
}

export function findAdjacentArticles(currentSlug: string) {
  const allItems = DOCS_SECTIONS.flatMap((section) => section.items)
  const currentIndex = allItems.findIndex((item) => item.slug === currentSlug)
  if (currentIndex === -1) return { prev: null, next: null }
  return {
    prev: currentIndex > 0 ? allItems[currentIndex - 1] : null,
    next: currentIndex < allItems.length - 1 ? allItems[currentIndex + 1] : null,
  }
}
