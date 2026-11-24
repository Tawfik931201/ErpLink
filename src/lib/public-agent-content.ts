import { integrations, type IntegrationPlatform } from '@/lib/integration-content'
import { PUBLIC_CONTACT_EMAIL } from '@/lib/public-contact'

export const PUBLIC_AGENT_PATHS = [
  '/', '/about', '/contact', '/integrations',
  '/integrations/zid-odoo', '/integrations/salla-odoo',
  '/integrations/shopify-odoo', '/guides/zid-odoo-checklist',
] as const

export type AgentPublicPath = typeof PUBLIC_AGENT_PATHS[number]
export type AgentLanguage = 'ar' | 'en'

export function isAgentPublicPath(value: string): value is AgentPublicPath {
  return (PUBLIC_AGENT_PATHS as readonly string[]).includes(value)
}

export function agentPageUrl(path: AgentPublicPath, lang: AgentLanguage): string {
  const prefix = lang === 'ar' ? 'ar-sa' : 'en-us'
  return `https://erplink.bizsahla.com/${prefix}${path === '/' ? '' : path}`
}

const platformPaths: Record<IntegrationPlatform, AgentPublicPath> = {
  zid: '/integrations/zid-odoo',
  salla: '/integrations/salla-odoo',
  shopify: '/integrations/shopify-odoo',
}

export function agentIntegrationList(lang: AgentLanguage) {
  return (Object.keys(platformPaths) as IntegrationPlatform[]).map((platform) => ({
    platform,
    title: integrations[platform].title[lang],
    description: integrations[platform].summary[lang],
    url: agentPageUrl(platformPaths[platform], lang),
  }))
}

/**
 * Curated public-only representation of marketing and integration copy.
 * Deliberately excludes pricing figures, legal terms, private dashboards,
 * auth tokens, tickets, orders, invoices, webhooks, and connected accounts.
 */
export function publicMarkdown(path: AgentPublicPath, lang: AgentLanguage): string {
  const isAr = lang === 'ar'
  const url = agentPageUrl(path, lang)
  const links = agentIntegrationList(lang)
  const contact = isAr
    ? `للتواصل مع فريق ERP Link: ${PUBLIC_CONTACT_EMAIL} أو صفحة التواصل.`
    : `Contact ERP Link at ${PUBLIC_CONTACT_EMAIL} or through the contact page.`
  const footer = `\n\n---\n\n[ERP Link](${agentPageUrl('/', lang)}) · [${isAr ? 'التكاملات' : 'Integrations'}](${agentPageUrl('/integrations', lang)}) · [${isAr ? 'تواصل' : 'Contact'}](${agentPageUrl('/contact', lang)})\nSource: ${url}\n`

  const integrationPath = (Object.keys(platformPaths) as IntegrationPlatform[])
    .find((platform) => platformPaths[platform] === path)
  if (integrationPath) {
    const info = integrations[integrationPath]
    const sections = info.sections
      .map((section) => `## ${section.title[lang]}\n\n${section.text[lang]}`)
      .join('\n\n')
    const preparation = info.preparation
      .map((item, index) => `${index + 1}. **${item.title[lang]}:** ${item.text[lang]}`)
      .join('\n')
    const faqs = info.questions
      .map((item) => `### ${item.question[lang]}\n\n${item.answer[lang]}`)
      .join('\n\n')
    return `# ${info.title[lang]}\n\n${info.summary[lang]}\n\n${info.audience[lang]}\n\n${sections}\n\n## ${isAr ? 'قبل التشغيل' : 'Before you go live'}\n\n${preparation}\n\n## ${isAr ? 'الأسئلة الشائعة' : 'Frequently asked questions'}\n\n${faqs}\n\n${contact}${footer}`
  }

  if (path === '/integrations') {
    const items = links.map((item) => `- [${item.title}](${item.url}) — ${item.description}`).join('\n')
    return `# ${isAr ? 'ربط المتاجر الإلكترونية بأودوو' : 'E-commerce and Odoo integrations'}\n\n${isAr ? 'دليل ربط متاجر زد وسلة وشوبيفاي مع أودوو، مع شرح إعداد الطلبات والمخزون والعملاء.' : 'Practical guides to connect Zid, Salla and Shopify stores with Odoo: orders, inventory and customers.'}\n\n${items}\n\n${contact}${footer}`
  }

  if (path === '/guides/zid-odoo-checklist') {
    const checklist = isAr ? [
      'تحديد مصدر الطلبات والكمية والمخزن قبل الربط.',
      'مطابقة SKU والمتغيرات والعملاء.',
      'مراجعة الضريبة والشحن والخصومات وحالات الطلب.',
      'اختبار طلب جديد وإكماله ومقارنة أمر البيع بالفاتورة.',
      'اختبار المرتجع الجزئي والكامل وكميات المخزون.',
      'التأكد من عدم إنشاء طلبات أو فواتير مكررة عند إعادة إرسال الحدث.',
      'فحص نجاح السجلات والفشل والتخطي والطابور قبل التشغيل.',
    ] : [
      'Decide the source for orders, stock and warehouses before connection.',
      'Match SKUs, variants and customers.',
      'Review VAT, shipping, discounts and order status mappings.',
      'Test a new order and completion, reconciling sales orders with invoices.',
      'Test partial/full returns and inventory quantities.',
      'Ensure retried events never create duplicate orders or invoices.',
      'Review successful, failed and skipped logs and queue entries before launch.',
    ]
    return `# ${isAr ? 'دليل تجهيز واختبار ربط زد بأودوو' : 'Zid–Odoo setup and testing checklist'}\n\n${checklist.map((item,i)=>`${i+1}. ${item}`).join('\n')}\n\n[Zid + Odoo](${agentPageUrl('/integrations/zid-odoo',lang)})${footer}`
  }

  const basic: Record<'/' | '/about' | '/contact', { ar: [string,string]; en: [string,string] }> = {
    '/': {
      ar: ['ERP Link — ربط زد وسلة وشوبيفاي مع أودوو', 'منصة لربط المتاجر الإلكترونية بأنظمة ERP ومزامنة الطلبات والمنتجات والمخزون والعملاء.'],
      en: ['ERP Link — Zid, Salla and Shopify with Odoo', 'An e-commerce and ERP integration platform to synchronize orders, products, stock and customers.'],
    },
    '/about': {
      ar: ['عن ERP Link', 'ERP Link منصة لربط المتاجر الإلكترونية بأنظمة ERP وتقليل إدخال البيانات يدويًا مع إعدادات لمطابقة الحقول وسجلات للعمليات.'],
      en: ['About ERP Link', 'ERP Link connects online stores to ERP systems to reduce manual re-entry, with field mapping and operation logs.'],
    },
    '/contact': {
      ar: ['تواصل مع ERP Link', 'تواصل بخصوص ربط المتاجر الإلكترونية أو الاستفسارات عن المنتجات والمزامنة والاشتراكات.'],
      en: ['Contact ERP Link', 'Contact the team about store integration, products, synchronization or subscriptions.'],
    },
  }
  const entry=basic[path as '/'|'/about'|'/contact']
  return `# ${entry[lang][0]}\n\n${entry[lang][1]}\n\n${links.map(item=>`- [${item.title}](${item.url})`).join('\n')}\n\n${contact}${footer}`
}
