import { DOCS_SECTIONS } from '@/lib/documentation/docs-navigation'
import { getDocArticleBySlug } from '@/lib/documentation/docs-registry'
import { integrations, type IntegrationPlatform } from '@/lib/integration-content'
import { allGuides, getGuideBySlug, type GuideSlug } from '@/lib/knowledge-center'
import { PUBLIC_CONTACT_EMAIL } from '@/lib/public-contact'

export const PUBLIC_AGENT_PATHS = [
  '/', '/about', '/contact', '/integrations',
  '/integrations/zid-odoo', '/integrations/salla-odoo',
  '/integrations/shopify-odoo', '/guides',
  '/guides/zid-odoo-checklist',
  '/guides/zid-odoo-setup',
  '/guides/zid-odoo-stock-sync',
  '/guides/zid-odoo-vat-15',
  '/guides/zid-odoo-returns',
  '/guides/salla-odoo-order-mapping',
  '/guides/shopify-odoo-webhooks',
  '/docs',
] as const

export type AgentPublicPath = typeof PUBLIC_AGENT_PATHS[number] | string
export type AgentLanguage = 'ar' | 'en'

export function isAgentPublicPath(value: string): boolean {
  if ((PUBLIC_AGENT_PATHS as readonly string[]).includes(value)) return true
  if (value.startsWith('/guides/')) {
    const slug = value.replace('/guides/', '')
    return allGuides.some((g) => g.meta.slug === slug)
  }
  if (value.startsWith('/docs/')) {
    const slug = value.replace('/docs/', '')
    return !!getDocArticleBySlug(slug)
  }
  return false
}

export function agentPageUrl(path: string, lang: AgentLanguage): string {
  const prefix = lang === 'ar' ? 'ar-sa' : 'en-us'
  return `https://erplink.bizsahla.com/${prefix}${path === '/' ? '' : path}`
}

const platformPaths: Record<IntegrationPlatform, string> = {
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

export function agentGuideList(lang: AgentLanguage) {
  return allGuides.map((g) => ({
    slug: g.meta.slug,
    title: g.meta.h1Title[lang],
    summary: g.meta.summary[lang],
    category: g.meta.category,
    readingTimeMinutes: g.meta.readingTimeMinutes,
    url: agentPageUrl(`/guides/${g.meta.slug}`, lang),
  }))
}

export function agentDocsList(lang: AgentLanguage) {
  return DOCS_SECTIONS.map((sec) => ({
    category: sec.category,
    categoryTitle: sec.title[lang],
    articles: sec.items.map((item) => ({
      title: item.title[lang],
      url: agentPageUrl(item.href, lang),
    })),
  }))
}

/**
 * Curated public-only representation of marketing, documentation, guides and integration copy.
 * Deliberately excludes pricing figures, legal terms, private dashboards,
 * auth tokens, tickets, orders, invoices, webhooks, and connected accounts.
 */
export function publicMarkdown(path: string, lang: AgentLanguage): string {
  const isAr = lang === 'ar'
  const url = agentPageUrl(path, lang)
  const links = agentIntegrationList(lang)
  const contact = isAr
    ? `للتواصل مع فريق ERP Link: ${PUBLIC_CONTACT_EMAIL} أو صفحة التواصل.`
    : `Contact ERP Link at ${PUBLIC_CONTACT_EMAIL} or through the contact page.`
  const footer = `\n\n---\n\n[ERP Link](${agentPageUrl('/', lang)}) · [${isAr ? 'التكاملات' : 'Integrations'}](${agentPageUrl('/integrations', lang)}) · [${isAr ? 'التوثيق' : 'Docs'}](${agentPageUrl('/docs', lang)}) · [${isAr ? 'مركز المعرفة' : 'Knowledge Center'}](${agentPageUrl('/guides', lang)}) · [${isAr ? 'تواصل' : 'Contact'}](${agentPageUrl('/contact', lang)})\nSource: ${url}\n`

  // 1. Documentation individual article
  if (path.startsWith('/docs/')) {
    const slug = path.replace('/docs/', '')
    const doc = getDocArticleBySlug(slug)
    if (doc) {
      return `# ${doc.title[lang]}\n\n${doc.description[lang]}\n\n${doc.content[lang]}\n\n${contact}${footer}`
    }
  }

  // 2. Documentation index
  if (path === '/docs') {
    const sectionsText = DOCS_SECTIONS.map((sec) => {
      const itemsList = sec.items.map((item) => `- [${item.title[lang]}](${agentPageUrl(item.href, lang)})`).join('\n')
      return `## ${sec.title[lang]}\n\n${itemsList}`
    }).join('\n\n')

    return `# ${isAr ? 'مركز التوثيق الرسمي — ERP Link' : 'Official ERP Link Documentation & User Guide'}\n\n${
      isAr
        ? 'أدلة الاستخدام والتشغيل الكاملة لربط متاجر زد وسلة وشوبيفاي بنظام أودوو Odoo ERP.'
        : 'Official user guides and documentation for connecting Zid, Salla, and Shopify with Odoo ERP.'
    }\n\n${sectionsText}\n\n${contact}${footer}`
  }

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

  if (path === '/guides') {
    const guideLinks = allGuides
      .map((g) => `- [${g.meta.h1Title[lang]}](${agentPageUrl(`/guides/${g.meta.slug}`, lang)}) — ${g.meta.summary[lang]}`)
      .join('\n')
    return `# ${isAr ? 'مركز معرفة ERP Link' : 'ERP Link Knowledge Center'}\n\n${
      isAr
        ? 'أدلة إرشادية وتطبيقية متقدمة لربط المتاجر الإلكترونية (زد، سلة، شوبيفاي) بنظام أودوو Odoo ERP، مع شروحات عملية للمخزون والضرائب والمرتجعات.'
        : 'In-depth practical guides for connecting Zid, Salla, and Shopify stores with Odoo ERP: inventory sync, VAT compliance, and returns.'
    }\n\n${guideLinks}\n\n${contact}${footer}`
  }

  if (path.startsWith('/guides/')) {
    const slug = path.replace('/guides/', '') as GuideSlug
    const guide = getGuideBySlug(slug)
    if (guide) {
      const sections = guide.sections
        .map((s) => {
          let text = `## ${s.title[lang]}`
          if (s.subsections?.length) {
            text += `\n\n${s.subsections
              .map((sub) => {
                let subText = `### ${sub.title[lang]}`
                if (sub.paragraphs?.length) {
                  subText += `\n\n${sub.paragraphs.map((p) => p[lang]).join('\n\n')}`
                }
                if (sub.steps?.length) {
                  subText += `\n\n${sub.steps.map((st, i) => `${i + 1}. **${st.title[lang]}:** ${st.text[lang]}`).join('\n')}`
                }
                if (sub.bullets?.length) {
                  subText += `\n\n${sub.bullets.map((b) => `- ${b[lang]}`).join('\n')}`
                }
                if (sub.table) {
                  const th = `| ${sub.table.headers.map((h) => h[lang]).join(' | ')} |`
                  const sep = `| ${sub.table.headers.map(() => '---').join(' | ')} |`
                  const rows = sub.table.rows.map((r) => `| ${r.map((c) => c[lang]).join(' | ')} |`).join('\n')
                  subText += `\n\n${th}\n${sep}\n${rows}`
                }
                if (sub.callout) {
                  subText += `\n\n> **${sub.callout.title[lang]}:** ${sub.callout.text[lang]}`
                }
                return subText
              })
              .join('\n\n')}`
          }
          return text
        })
        .join('\n\n')

      const takeaways = guide.summaryKeyTakeaways
        ? `\n\n## ${isAr ? 'أهم النقاط المستفادة' : 'Key Practical Takeaways'}\n\n${guide.summaryKeyTakeaways[lang].map((item) => `- ${item}`).join('\n')}`
        : ''

      const faqs = guide.faqs.length
        ? `\n\n## ${isAr ? 'الأسئلة الشائعة' : 'Frequently Asked Questions'}\n\n${guide.faqs.map((f) => `### ${f.question[lang]}\n\n${f.answer[lang]}`).join('\n\n')}`
        : ''

      return `# ${guide.meta.h1Title[lang]}\n\n${guide.meta.summary[lang]}\n\n${sections}${takeaways}${faqs}\n\n${contact}${footer}`
    }
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
  const entry = basic[path as '/' | '/about' | '/contact']
  if (entry) {
    return `# ${entry[lang][0]}\n\n${entry[lang][1]}\n\n${links.map((item) => `- [${item.title}](${item.url})`).join('\n')}\n\n${contact}${footer}`
  }
  return `# ERP Link\n\n${contact}${footer}`
}
