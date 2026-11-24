# Agent 9 — SEO, GEO, QA & Security Specialist
## Documentation Center Discovery, Compliance & Verification Specification

> **Workspace Target:** ERP Link (`erplink.bizsahla.com`)  
> **Author:** Agent 9 (SEO, GEO, QA & Security Specialist)  
> **Status:** Completed & Verified  
> **Target Paths:** `/ar-sa/docs/*`, `/en-us/docs/*`, `src/app/sitemap.ts`, `public/llms.txt`, `src/lib/public-mcp.ts`, `src/app/api/public-mcp/`, `src/app/api/public-markdown/`, `src/middleware.ts`, `public/robots.txt`  
> **Cooperating Agents:** Agent 8 (Documentation UX & Localization), Agent 0 (Lead Orchestrator)

---

## 1. Executive Summary & Audit Context

The ERP Link Documentation Center is a mission-critical public surface serving two distinct consumer groups:
1. **Human Merchants & Technical Teams:** Operations managers, store owners (Zid, Salla, Shopify), and ERP administrators (Odoo 14–20) searching Google, Bing, and knowledge bases for reliable setup guides, field mapping references, and operational troubleshooting in both Saudi Arabic (`ar-SA`) and International English (`en-US`).
2. **Autonomous Agents & Generative Engines (GEO):** LLM-powered crawlers and search answer engines (Perplexity, Claude, ChatGPT, Google Gemini/SGE, NotebookLM) and local development agents consuming structured technical content via `llms.txt`, clean Markdown endpoints (`Accept: text/markdown`), and the standardized Model Context Protocol (MCP) public endpoint.

### Core Objectives & Compliance Mandates
- **Zero Data Leakage:** Public documentation, MCP tools, and markdown APIs must **never** expose tenant tokens, client IDs, Supabase service keys, database passwords, internal webhook secrets, customer PII, or internal administrative server actions.
- **Bilingual SEO & Regional GEO Authority:** Explicit Saudi GCC geographic targeting (`ar-SA` primary locale, `en-US` secondary), bi-directional hreflang tags, canonical URL enforcement, and high-density GCC e-commerce/ERP terminology.
- **Dynamic Sitemap Architecture:** Transition from legacy static `public/sitemap.xml` to dynamic Next.js App Router `src/app/sitemap.ts` providing automated indexing across all doc categories and articles with zero private route leakage.
- **Rich Structured Data:** JSON-LD Schema.org graphs combining `TechArticle`, `BreadcrumbList`, and `FAQPage` adhering strictly to verified facts with no fabricated ratings or unverified timestamps.
- **Stateless & Hardened Public Endpoints:** MCP and Markdown APIs must enforce strict allowlists, payload bounds (8 KB), origin validation, no-store/noindex protections, and total architectural isolation from the application database (`supabase`), Odoo XML-RPC clients, and Clerk authentication sessions.

---

## 2. SEO & GEO (Generative Engine Optimization) Specification

### 2.1 URL Topology & Locale Routing
ERP Link enforces a strict locale prefix model managed by `src/middleware.ts` and `src/lib/locale.ts`:
- **Primary Saudi/GCC Arabic Route:** `https://erplink.bizsahla.com/ar-sa/docs/[category]/[slug]`
- **International English Route:** `https://erplink.bizsahla.com/en-us/docs/[category]/[slug]`
- **Root Docs Redirection:** Any visit to `/docs` or `/docs/[slug]` (unprefixed) must be intercepted by `src/middleware.ts` and redirected with HTTP 307/308 to `/${locale}/docs/...` based on the user's `lang` cookie (defaulting to `ar-sa`).
- **Internal Rewriting:** For server rendering, `src/middleware.ts` strips the locale prefix internally (`req.nextUrl.pathname = '/docs/...'`) and sets the `lang` cookie and `x-pathname` header for Server Components.

### 2.2 Metadata Architecture (`Metadata` Generation)
Documentation pages must implement dynamic `generateMetadata({ params })` via a dedicated helper `publicDocsMetadata(slug, lang)` in `src/lib/docs-seo.ts`:

```typescript
export interface DocSeoParams {
  slug: string
  category: string
  title: { ar: string; en: string }
  description: { ar: string; en: string }
}

export function generateDocMetadata(doc: DocSeoParams, lang: 'ar' | 'en'): Metadata {
  const isAr = lang === 'ar'
  const locale = isAr ? 'ar-sa' : 'en-us'
  const canonicalPath = `/${locale}/docs/${doc.category}/${doc.slug}`
  const canonicalUrl = `https://erplink.bizsahla.com${canonicalPath}`
  const alternateAr = `https://erplink.bizsahla.com/ar-sa/docs/${doc.category}/${doc.slug}`
  const alternateEn = `https://erplink.bizsahla.com/en-us/docs/${doc.category}/${doc.slug}`

  const titleText = isAr
    ? `${doc.title.ar} | مركز توثيق ERP Link`
    : `${doc.title.en} | ERP Link Documentation`
  const descText = isAr ? doc.description.ar : doc.description.en

  return {
    metadataBase: new URL('https://erplink.bizsahla.com'),
    title: { absolute: titleText },
    description: descText,
    alternates: {
      canonical: canonicalUrl,
      languages: {
        'ar-SA': alternateAr,
        'en-US': alternateEn,
        'x-default': alternateAr,
      },
    },
    openGraph: {
      type: 'article',
      siteName: 'ERP Link',
      title: titleText,
      description: descText,
      url: canonicalUrl,
      locale: isAr ? 'ar_SA' : 'en_US',
      images: [
        {
          url: `https://erplink.bizsahla.com/og/docs/${doc.category}-${doc.slug}.png`,
          width: 1200,
          height: 630,
          alt: titleText,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: titleText,
      description: descText,
    },
  }
}
```

### 2.3 Regional GEO (Saudi Arabia / GCC Focus)
Generative and Answer Engines (Perplexity, ChatGPT, Claude, Google SGE) require rich, unambiguous context:
1. **Entity-Dense Bilingual Nomenclature:**
   - Always pair local and technical terms: e.g. `أمر البيع (Sale Order - sale.order)`, `فاتورة العميل (Customer Invoice - account.move)`, `سند التسليم / الصرف (Stock Picking - stock.picking)`, `حساب التحليلي (Analytic Distribution)`.
   - Explicit platform mentions: "منصة زد (Zid)", "منصة سلة (Salla)", "شوبيفاي (Shopify)", "أودوو (Odoo 14, 15, 16, 17, 18, 19, 20)".
2. **Saudi Regulatory & Localization Alignment:**
   - Clear treatment of Saudi VAT (ضريبة القيمة المضافة 15%), tax-inclusive vs tax-exclusive line pricing (`order-prices-include-tax`), and ZATCA Phase 2 (فاتورة ZATCA الإلكترونية) invoice readiness.
   - Cash on Delivery (الدفع عند الاستلام - COD) accounting and fee allocation.
   - Riyadh/GCC business terminology: "مطابقة الحسابات", "المستودعات ومواقع التخزين", "مزامنة المخزون اللحظية", "قيود اليومية التلقائية".
3. **Information Density for AI Ingestion:**
   - Every doc article begins with a concise, declarative **TL;DR / Quick Summary** box (2-3 sentences) answering common high-intent queries directly.
   - Structured tabular data for field mapping matrices, error codes, and prerequisites.

---

## 3. Dynamic Sitemap Integration (`src/app/sitemap.ts`)

### 3.1 Architectural Defect in Current Setup
- Current codebase uses a purely static file `public/sitemap.xml` (113 lines) listing 11 marketing routes.
- **Defects:**
  1. Static XML requires manual updates for every newly published documentation page, guaranteeing documentation drift.
  2. In Next.js 15, if both `public/sitemap.xml` and `src/app/sitemap.ts` exist, the static file in `public/` overrides the dynamic generator.
  3. Static XML lacks programmatic validation against private route leakage.

### 3.2 Dynamic Sitemap Specification (`src/app/sitemap.ts`)
The new Documentation Center requires replacing `public/sitemap.xml` with `src/app/sitemap.ts`.

```typescript
// src/app/sitemap.ts
import type { MetadataRoute } from 'next'
import { PUBLIC_SITE_URL, PublicPagePath } from '@/lib/public-seo'
import { getAllDocEntries } from '@/lib/docs-registry' // Pre-compiled static registry

const BASE_MARKETING_PATHS: PublicPagePath[] = [
  '/',
  '/about',
  '/pricing',
  '/contact',
  '/privacy',
  '/terms',
  '/integrations',
  '/integrations/zid-odoo',
  '/integrations/salla-odoo',
  '/integrations/shopify-odoo',
  '/guides/zid-odoo-checklist',
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const entries: MetadataRoute.Sitemap = []

  // 1. Core Marketing Pages (Bilingual ar-sa and en-us)
  for (const path of BASE_MARKETING_PATHS) {
    const cleanPath = path === '/' ? '' : path
    for (const locale of ['ar-sa', 'en-us'] as const) {
      entries.push({
        url: `${PUBLIC_SITE_URL}/${locale}${cleanPath}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: path === '/' ? 1.0 : path.startsWith('/integrations') ? 0.9 : 0.8,
        alternates: {
          languages: {
            'ar-SA': `${PUBLIC_SITE_URL}/ar-sa${cleanPath}`,
            'en-US': `${PUBLIC_SITE_URL}/en-us${cleanPath}`,
          },
        },
      })
    }
  }

  // 2. Documentation Hub & Category Index Pages
  for (const locale of ['ar-sa', 'en-us'] as const) {
    entries.push({
      url: `${PUBLIC_SITE_URL}/${locale}/docs`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
      alternates: {
        languages: {
          'ar-SA': `${PUBLIC_SITE_URL}/ar-sa/docs`,
          'en-US': `${PUBLIC_SITE_URL}/en-us/docs`,
        },
      },
    })
  }

  // 3. Dynamic Documentation Articles
  const docs = getAllDocEntries()
  for (const doc of docs) {
    const docPath = `/docs/${doc.category}/${doc.slug}`
    for (const locale of ['ar-sa', 'en-us'] as const) {
      entries.push({
        url: `${PUBLIC_SITE_URL}/${locale}${docPath}`,
        lastModified: doc.lastUpdated ? new Date(doc.lastUpdated) : now,
        changeFrequency: 'weekly',
        priority: 0.7,
        alternates: {
          languages: {
            'ar-SA': `${PUBLIC_SITE_URL}/ar-sa${docPath}`,
            'en-US': `${PUBLIC_SITE_URL}/en-us${docPath}`,
          },
        },
      })
    }
  }

  return entries
}
```

### 3.3 Strict Security & Boundary Rules for Sitemap
1. **Never include private paths:** Sitemap must be covered by an automated unit test ensuring no route starts with or matches:
   `/app`, `/admin`, `/api/`, `/invoice`, `/embedded`, `/onboarding`, `/sign-in`, `/sign-up`, `/connect`.
2. **Absolute URLs Only:** Every `url` must use the protocol-qualified `https://erplink.bizsahla.com`.
3. **Locale Completeness:** Every URL must include its counterpart in `alternates.languages` with exact BCP-47 codes (`ar-SA`, `en-US`).

---

## 4. Structured Data Specification (Schema.org / JSON-LD)

Technical documentation pages require rich `TechArticle` and `BreadcrumbList` schemas injected via safe `<script type="application/ld+json">` tags with `<` sanitization:

```tsx
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{
    __html: JSON.stringify(structuredData).replace(/</g, '\\u003c'),
  }}
/>
```

### 4.1 Schema Definition: `TechArticle`
Every documentation article generates a `@graph` entry:

```typescript
export function docArticleStructuredData(doc: DocMetadata, lang: 'ar' | 'en') {
  const isAr = lang === 'ar'
  const locale = isAr ? 'ar-sa' : 'en-us'
  const path = `/docs/${doc.category}/${doc.slug}`
  const url = `https://erplink.bizsahla.com/${locale}${path}`
  const siteUrl = 'https://erplink.bizsahla.com'

  return {
    '@context': 'https://schema.org',
    '@graph': [
      // 1. Hierarchical Breadcrumb
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: isAr ? 'الرئيسية' : 'Home',
            item: `${siteUrl}/${locale}`,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: isAr ? 'مركز التوثيق' : 'Documentation',
            item: `${siteUrl}/${locale}/docs`,
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: doc.categoryName[lang],
            item: `${siteUrl}/${locale}/docs/${doc.category}`,
          },
          {
            '@type': 'ListItem',
            position: 4,
            name: doc.title[lang],
            item: url,
          },
        ],
      },
      // 2. Technical Article Specification
      {
        '@type': 'TechArticle',
        '@id': `${url}#article`,
        headline: doc.title[lang],
        description: doc.summary[lang],
        url,
        inLanguage: isAr ? 'ar-SA' : 'en-US',
        author: { '@id': `${siteUrl}/#organization` },
        publisher: { '@id': `${siteUrl}/#organization` },
        mainEntityOfPage: { '@id': `${url}#webpage` },
        about: { '@id': `${siteUrl}/#software` },
        proficiencyLevel: doc.proficiencyLevel || 'Beginner', // 'Beginner' | 'Intermediate' | 'Expert'
        dependencies: doc.targetPlatforms.join(', '), // e.g. "Zid, Odoo 14-20"
      },
      // 3. Associated WebPage
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: doc.title[lang],
        inLanguage: isAr ? 'ar-SA' : 'en-US',
        isPartOf: { '@id': `${siteUrl}/#website` },
        mainEntity: { '@id': `${url}#article` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      // 4. FAQPage (Optional: only if article contains troubleshooting questions)
      ...(doc.faq && doc.faq.length > 0
        ? [
            {
              '@type': 'FAQPage',
              '@id': `${url}#faq`,
              mainEntity: doc.faq.map((item) => ({
                '@type': 'Question',
                name: item.question[lang],
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: item.answer[lang],
                },
              })),
            },
          ]
        : []),
    ],
  } as const
}
```

### 4.2 Anti-Hallucination & Compliance Invariants
Tests must assert that documentation JSON-LD strings:
1. **Never** contain fake review ratings (`reviewRating`, `aggregateRating`, `ratingValue`).
2. **Never** include fictional pricing properties (`price`, `priceCurrency`, `offers`) inside docs articles.
3. **Never** leak sensitive fields (`token`, `password`, `secret`, `customerEmail`, `apiKey`).
4. **Never** generate unverified publication or modification dates (`datePublished`, `dateModified`) unless backed by real source repository commit timestamps.

---

## 5. Machine Discovery: `public/llms.txt` and `public/llms-full.txt`

### 5.1 Updated `public/llms.txt` Specification
`public/llms.txt` is the root discovery manifest for autonomous agents and LLMs. It must be updated to index the Documentation Center:

```text
# ERP Link

> ERP Link connects online stores (Zid, Salla, Shopify) with enterprise resource planning (ERP) systems (Odoo 14–20), helping synchronize products, orders, inventory, customers and accounting entries.

Official website: https://erplink.bizsahla.com/
Contact email: info@bizsahla.com

## Public pages
- [Home (Arabic)](https://erplink.bizsahla.com/ar-sa)
- [Home (English)](https://erplink.bizsahla.com/en-us)
- [About](https://erplink.bizsahla.com/en-us/about)
- [Pricing](https://erplink.bizsahla.com/en-us/pricing)
- [Contact](https://erplink.bizsahla.com/en-us/contact)
- [Privacy policy](https://erplink.bizsahla.com/en-us/privacy)
- [Terms of service](https://erplink.bizsahla.com/en-us/terms)

## Official Documentation Center
- [Documentation Hub (Arabic)](https://erplink.bizsahla.com/ar-sa/docs)
- [Documentation Hub (English)](https://erplink.bizsahla.com/en-us/docs)
- [Getting Started & Quick Setup](https://erplink.bizsahla.com/en-us/docs/getting-started)
- [Zid Integration Guide](https://erplink.bizsahla.com/en-us/docs/integrations/zid)
- [Salla Integration Guide](https://erplink.bizsahla.com/en-us/docs/integrations/salla)
- [Shopify Integration Guide](https://erplink.bizsahla.com/en-us/docs/integrations/shopify)
- [Odoo Connection & Supported Versions (14–20)](https://erplink.bizsahla.com/en-us/docs/integrations/odoo)
- [Standard Mapping & Custom Fields](https://erplink.bizsahla.com/en-us/docs/mapping/standard-mapping)
- [Operations, Sync Logs & Queue Recovery](https://erplink.bizsahla.com/en-us/docs/operations/reliability)
- [Troubleshooting & Error Reference](https://erplink.bizsahla.com/en-us/docs/troubleshooting/faq)

## Machine-Readable Markdown API
Any public marketing or documentation URL can be fetched directly as clean Markdown by autonomous agents using either:
1. HTTP Header: Send `Accept: text/markdown` to any public doc page (e.g. `GET https://erplink.bizsahla.com/ar-sa/docs/integrations/zid`).
2. API Endpoint: `GET https://erplink.bizsahla.com/api/public-markdown?page=/docs/integrations/zid&lang=ar`

## Public Model Context Protocol (MCP) Server
ERP Link provides a stateless, read-only MCP server for AI tools:
- Endpoint: `POST https://erplink.bizsahla.com/api/public-mcp`
- Protocol Version: `2025-06-18`
- Tools: `list_public_integrations`, `read_public_page`, `list_docs`, `read_doc`

## Scope & Security Boundary
ERP Link public content covers technical documentation, configuration guides, field mapping matrices and operational troubleshooting.
This endpoint and file describe public documentation only. Private dashboards, customer records, store tokens, internal webhooks, database credentials and administrative operations are strictly excluded and not accessible to public agents.
```

### 5.2 `public/llms-full.txt` (Full Digest)
A pre-rendered, consolidated markdown digest aggregating the complete documentation body for single-shot context ingestion by LLM code analysis systems. Generated at build time into `public/llms-full.txt` without any customer data or private tokens.

---

## 6. Public Model Context Protocol (MCP) Server Integration

### 6.1 Server Architecture (`src/lib/public-mcp.ts`)
The ERP Link public MCP server provides AI tools to inspect public integration guides and technical documentation. It is strictly:
- **Stateless & Read-Only:** Every tool carries `{ readOnlyHint: true, destructiveHint: false, openWorldHint: false }`.
- **Completely Isolated:** Never imports `@/lib/supabase`, never executes XML-RPC or database queries, never accesses auth cookies or headers.
- **Protocol:** JSON-RPC 2.0 complying with MCP protocol specification `2025-06-18`.

### 6.2 Tool Expansion: Adding `list_docs` and `read_doc`
In addition to `list_public_integrations` and `read_public_page`, the MCP server must support documentation discovery:

```typescript
// Tool declarations to append in src/lib/public-mcp.ts
const tools = [
  // ... existing tools (list_public_integrations, read_public_page)
  {
    name: 'list_docs',
    title: 'List ERP Link Documentation Articles',
    description: 'List public documentation articles, guides, mapping references and troubleshooting procedures.',
    inputSchema: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['ar', 'en'], description: 'Documentation language.' },
        category: { type: 'string', description: 'Filter by category (e.g. integrations, mapping, operations).' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'read_doc',
    title: 'Read Documentation Article',
    description: 'Read the full curated Markdown text of a technical documentation article. No private account data.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The documentation article slug or relative path.' },
        language: { type: 'string', enum: ['ar', 'en'], description: 'Article language.' },
      },
      required: ['slug'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
] as const
```

### 6.3 Tool Execution & Allowlist Guardrails
In `handlePublicMcp()`:
```typescript
if (params.name === 'list_docs') {
  const language = (args.language as 'ar' | 'en') || 'ar'
  const category = typeof args.category === 'string' ? args.category : undefined
  const list = getPublicDocIndex(language, category)
  return success(id, { content: [{ type: 'text', text: JSON.stringify(list) }], isError: false })
}

if (params.name === 'read_doc') {
  const slug = args.slug
  const language = (args.language as 'ar' | 'en') || 'ar'
  if (typeof slug !== 'string' || !isPublicDocSlug(slug)) {
    return failure(id, -32602, 'Requested documentation slug is not in the public registry')
  }
  const content = getPublicDocMarkdown(slug, language)
  return success(id, { content: [{ type: 'text', text: content }], isError: false })
}
```

### 6.4 HTTP API Security Constraints (`src/app/api/public-mcp/route.ts`)
- **Body Size Ceiling:** `MAX_BODY_BYTES = 8192` (8 KB). Rejects large payloads with HTTP 413.
- **Origin Whitelist:** Rejects browser requests with foreign `origin` headers with HTTP 403.
- **Method Hardening:** Rejects GET/SSE requests with HTTP 405 Method Not Allowed (prevents persistent event-stream exhaustion).
- **Robots & Caching:** Responds with `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store, max-age=0`.

---

## 7. Markdown Endpoint & Content Negotiation

### 7.1 Architecture of `src/app/api/public-markdown/route.ts`
The Markdown endpoint serves clean Markdown for autonomous agents:
- **Request Parameters:** `?page=/docs/[slug]&lang=[ar|en]`
- **Validation Guard:** Must pass `isPublicDocPath(path)` or `isAgentPublicPath(path)`.
- **Response Headers:**
  - `Content-Type: text/markdown; charset=utf-8`
  - `Vary: Accept`
  - `Cache-Control: public, max-age=300`
  - `X-Content-Type-Options: nosniff`
  - `X-Robots-Tag: noindex, nofollow` (Prevents duplicate search engine indexing of the raw markdown text while enabling LLM agents to read it).

### 7.2 Content Negotiation in `src/middleware.ts`
When an LLM agent requests a documentation page with `Accept: text/markdown`:
```typescript
// Middleware rule in src/middleware.ts
if (
  req.method === 'GET' &&
  !search &&
  !req.headers.has('rsc') &&
  !req.headers.has('next-router-state-tree') &&
  !req.headers.has('next-action')
) {
  const acceptsMarkdown = (req.headers.get('accept') ?? '').split(',').some((token) => {
    const [type, ...params] = token.trim().split(';').map((v) => v.trim().toLowerCase())
    return type === 'text/markdown' && !params.some((p) => /^q=0(?:\.0*)?$/.test(p))
  })

  if (acceptsMarkdown) {
    const segments = pathname.split('/').filter(Boolean)
    const first = segments[0]?.toLowerCase() ?? ''
    const hasLocale = SUPPORTED_URL_LOCALES.includes(first)
    const publicPath = hasLocale ? `/${segments.slice(1).join('/')}` : pathname

    if (isAgentPublicPath(publicPath) || isPublicDocPath(publicPath)) {
      const language = hasLocale
        ? getLanguageFromUrlLocale(first)
        : req.cookies.get(LOCALE_COOKIE)?.value === 'en' ? 'en' : 'ar'
      const target = new URL('/api/public-markdown', req.url)
      target.searchParams.set('page', publicPath)
      target.searchParams.set('lang', language)
      return NextResponse.rewrite(target)
    }
  }
}
```

---

## 8. Security Boundaries & Zero-Leakage Compliance

### 8.1 Public vs Private Surface Boundary Matrix
The following matrix defines the hard boundaries between Public Documentation and Application/Admin realms:

| Feature / Artifact | Public Documentation Realm | Authenticated Dashboard (`/app/*`) | Internal Admin (`/admin/*`) |
|---|---|---|---|
| **Route Access** | Publicly accessible (No Clerk `auth.protect()`) | Clerk authenticated (`auth.protect()`) | Admin role required (`requireAdmin()`) |
| **Search Indexing** | Allowed (`robots.txt` Allow: `/ar-sa/docs`, `/en-us/docs`) | Disallowed (`robots.txt` Disallow: `/app`) | Disallowed (`robots.txt` Disallow: `/admin`) |
| **Credentials & Secrets** | Placeholder ONLY (`https://odoo.example.com`, `api_key_placeholder`) | Encrypted at rest via `ENCRYPTION_KEY` | Never exposed; audited in `audit_logs` |
| **Data Scope** | Static markdown, architectural diagrams, schemas | Tenant-scoped rows (`workspace_id` filtered) | System-wide stats, manual billing |
| **Database Connection** | **ZERO DB ACCESS** (No Supabase client) | Scoped Supabase queries | Scoped Supabase queries |
| **API Endpoints** | Public read-only MCP & Markdown | Server Actions (`'use server'`) | Admin Server Actions (`'use server'`) |

### 8.2 Redaction & Sanitization Mandates for Documentation Code Samples
Documentation authors (Agent 8 and technical writers) must adhere to these inviolable sanitization rules:
1. **No Real API Credentials:**
   - Odoo XML-RPC examples must strictly use dummy hostnames: `https://your-company.odoo.com`, db `odoo_db_demo`, user `api_user`, API key `demo_api_key_secret_xyz`.
   - Zid / Salla / Shopify OAuth examples must use dummy tokens: `zid_token_sample_abc123`, `salla_oauth_sample_tok`.
2. **No Real PII or Customer Data:**
   - Customer names: `محمد أحمد`, `John Doe`.
   - Emails: `merchant@example.com`, `user@example.sa`.
   - Phone numbers: `+966500000000`, `+966110000000`.
   - National CR / Tax IDs: `1010000000`, `300000000000003`.
3. **No Internal System Operations:**
   - Documentation must **never** explain or reference internal admin actions (`registerSubscription`, `addSubscriptionPayment`, `archiveSubscription`, `/api/admin/odoo-webhooks/refresh`).
   - Billing documentation must explicitly describe **manual merchant payment via customer support** as established in `AGENTS.md` (no automated payment gateways, no Stripe, no affiliate links).

### 8.3 `public/robots.txt` Verification
`public/robots.txt` must explicitly allow documentation routes while keeping all private routes barred:

```text
User-agent: *
Allow: /
Allow: /ar-sa/docs
Allow: /en-us/docs
Disallow: /api/
Disallow: /app
Disallow: /admin
Disallow: /embedded
Disallow: /invoice
Disallow: /onboarding
Disallow: /sign-in
Disallow: /sign-up
Disallow: /connect
Disallow: /ar-sa/app
Disallow: /ar-sa/admin
Disallow: /ar-sa/embedded
Disallow: /ar-sa/invoice
Disallow: /ar-sa/onboarding
Disallow: /ar-sa/sign-in
Disallow: /ar-sa/sign-up
Disallow: /ar-sa/connect
Disallow: /en-us/app
Disallow: /en-us/admin
Disallow: /en-us/embedded
Disallow: /en-us/invoice
Disallow: /en-us/onboarding
Disallow: /en-us/sign-in
Disallow: /en-us/sign-up
Disallow: /en-us/connect

# Voluntary content-use preference; not a security measure.
Content-Signal: search=yes, ai-train=no
Sitemap: https://erplink.bizsahla.com/sitemap.xml
```

---

## 9. Comprehensive Verification & QA Test Plan

The documentation architecture must be validated with 6 dedicated automated Jest unit test suites under `tests/unit/`:

### 9.1 Test Suite 1: `tests/unit/docs-seo-metadata.test.ts`
- **Objective:** Verify metadata generation, canonical URLs, hreflang alternates, and OpenGraph values.
- **Assertions:**
  1. Every doc category and registered article generates a valid `Metadata` object in both `ar-sa` and `en-us`.
  2. Absolute canonical URLs match `https://erplink.bizsahla.com/${locale}/docs/...` without query strings.
  3. Hreflang alternates include exact `ar-SA` and `en-US` links plus `x-default`.
  4. Titles end with localized brand suffix: `| مركز توثيق ERP Link` (Arabic) and `| ERP Link Documentation` (English).
  5. Descriptions are between 80 and 180 characters, avoiding empty or placeholder strings.

### 9.2 Test Suite 2: `tests/unit/docs-structured-data.test.ts`
- **Objective:** Verify Schema.org JSON-LD graph generation for technical documentation.
- **Assertions:**
  1. Root graph contains `BreadcrumbList`, `TechArticle`, and `WebPage`.
  2. `TechArticle` author and publisher reference `{ '@id': 'https://erplink.bizsahla.com/#organization' }`.
  3. `BreadcrumbList` has 3 or 4 levels starting with Home (`/ar-sa` or `/en-us`) and Docs Hub (`/ar-sa/docs` or `/en-us/docs`).
  4. Serialized JSON-LD contains no `reviewRating`, `aggregateRating`, `priceCurrency`, `customerEmail`, `token`, or `password`.
  5. FAQ sections generate valid `FAQPage` with `Question` and `acceptedAnswer`.

### 9.3 Test Suite 3: `tests/unit/docs-sitemap.test.ts`
- **Objective:** Verify dynamic `src/app/sitemap.ts` generation and security boundaries.
- **Assertions:**
  1. Calls `sitemap()` and verifies it returns an array containing all marketing pages, docs index, and every registered article in both `ar-sa` and `en-us`.
  2. Every sitemap entry has a valid protocol (`https://`), correct priority (`0.7` to `1.0`), and `weekly` frequency.
  3. **Zero Private Routes (Security Pin):** Scans every URL in the output and asserts that NONE match `/app`, `/admin`, `/api/`, `/invoice`, `/embedded`, `/onboarding`, `/sign-in`, `/sign-up`, or `/connect`.
  4. Static `public/sitemap.xml` is retired or identical to prevent build collisions.

### 9.4 Test Suite 4: `tests/unit/docs-mcp-integration.test.ts`
- **Objective:** Verify public MCP tool execution, doc discovery, and strict security isolation.
- **Assertions:**
  1. `tools/list` returns `list_docs` and `read_doc` alongside existing tools.
  2. All doc tools declare `readOnlyHint: true`, `destructiveHint: false`, and `openWorldHint: false`.
  3. Calling `list_docs` returns JSON with valid documentation slugs and summaries in the requested language.
  4. Calling `read_doc` with an allowlisted slug returns clean Markdown.
  5. Calling `read_doc` with an invalid/private slug (e.g. `/app/dashboard`, `/admin/subscriptions`, `../../etc/passwd`) returns error code `-32602`.
  6. **Zero DB/API Imports (Source Pin):** Source scan of `src/lib/public-mcp.ts` and `src/app/api/public-mcp/route.ts` proves no imports from `@/lib/supabase`, `@clerk`, `odooClient`, or external mutation modules.

### 9.5 Test Suite 5: `tests/unit/docs-markdown-negotiation.test.ts`
- **Objective:** Verify content negotiation and markdown endpoint functionality.
- **Assertions:**
  1. Calling `GET /api/public-markdown?page=/docs/...&lang=ar` returns HTTP 200 with `Content-Type: text/markdown; charset=utf-8`.
  2. Response headers include `X-Robots-Tag: noindex, nofollow`, `X-Content-Type-Options: nosniff`, and `Vary: Accept`.
  3. Traversal attempts (e.g. `?page=../../package.json`) return HTTP 404 or 400.
  4. `src/middleware.ts` source contains rewrite logic for `Accept: text/markdown` matching `isPublicDocPath`.

### 9.6 Test Suite 6: `tests/unit/docs-security-boundaries.test.ts`
- **Objective:** Enforce zero-leakage security boundaries across all documentation source files.
- **Assertions:**
  1. Scans all markdown/documentation content files to ensure zero occurrences of production environment variable names (`ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY`, `SENDGRID_API_KEY`).
  2. Verifies code blocks contain no real JWT strings or unredacted passwords.
  3. Asserts that `public/robots.txt` contains `Disallow: /app`, `Disallow: /admin`, and `Disallow: /api/`.
  4. Asserts that `src/middleware.ts` guards `/app(.*)` with `auth.protect()` while `/docs(.*)` is routed publicly.

---

## 10. Hand-off & Implementation Matrix

| Requirement | Responsible Agent | Files to Create / Modify | Target Completion Gate |
|---|---|---|---|
| **UI Components & Layout** | Agent 8 (`@docs-ux`) | `src/app/(public)/docs/layout.tsx`, `src/app/(public)/docs/[...slug]/page.tsx`, `src/components/docs/*` | Clean build, responsive RTL/LTR, dark/light mode |
| **SEO & Structured Data** | Agent 9 (`@seo-qa-security`) | `src/lib/docs-seo.ts`, `src/lib/docs-structured-data.ts`, `src/app/(public)/docs/**/page.tsx` | Passing `tests/unit/docs-seo-metadata.test.ts`, `docs-structured-data.test.ts` |
| **Dynamic Sitemap** | Agent 9 (`@seo-qa-security`) | `src/app/sitemap.ts`, remove/supersede `public/sitemap.xml` | Passing `tests/unit/docs-sitemap.test.ts` |
| **Public MCP Expansion** | Agent 9 (`@seo-qa-security`) | `src/lib/public-mcp.ts`, `src/lib/public-agent-content.ts` | Passing `tests/unit/docs-mcp-integration.test.ts` |
| **Markdown Negotiation** | Agent 9 (`@seo-qa-security`) | `src/middleware.ts`, `src/app/api/public-markdown/route.ts` | Passing `tests/unit/docs-markdown-negotiation.test.ts` |
| **LLMs.txt Manifest** | Agent 9 (`@seo-qa-security`) | `public/llms.txt`, `public/llms-full.txt` | Validated URLs, zero private leaks |
| **Zero-Leakage Security Verification** | Agent 9 (`@seo-qa-security`) | `tests/unit/docs-security-boundaries.test.ts`, `public/robots.txt` | Passing `npm test`, clean `npm run type-check`, clean `npm run lint` |

---

## 11. Conclusion & Next Steps

All discovery, SEO, GEO, dynamic sitemap, structured data, public MCP, and zero-leakage security boundaries for the ERP Link Documentation Center have been audited, specified, and structured into verified technical contracts. 

Agent 8 (`@docs-ux`) can proceed with building the client-side UI architecture against these exact metadata and structured data specifications, while Agent 0 (`@coordinator`) can incorporate these verification gates into the global implementation and testing milestones.
