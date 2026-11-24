# ERP Link Documentation Center: UI Architecture & UX Specification
**Document ID:** `DOCS-ARCH-AGENT-8`  
**Agent:** Agent 8 — Documentation UX & Localization Specialist  
**Target Routes:** `/ar-sa/docs` & `/en-us/docs` (Next.js 15 App Router)  
**Status:** Approved Technical Architecture Specification  
**Date:** 2026-11-24  

---

## 1. Executive Summary & Core Mission

The ERP Link Documentation Center is the official developer, administrator, and merchant knowledge hub for integrating Saudi and regional e-commerce platforms (Zid, Salla, Shopify) with enterprise ERP backends (Odoo 14–20, ERPNext).

### 1.1 Architectural Pillars
1. **Zero-Polling & Zero-Supabase on Public Paths:** The Documentation Center requires zero Supabase REST or database calls, eliminating token-leak vulnerabilities, database connection exhaustion, and latency spikes. All searching and browsing executes completely client-side against static, pre-compiled JSON indices.
2. **Next.js 15 App Router & URL-Locale Architecture:** Fully integrated with ERP Link's existing middleware (`src/middleware.ts`) and locale utilities (`src/lib/locale.ts`), supporting clean canonical paths at `/ar-sa/docs` and `/en-us/docs` without route duplication or internal redirect loops.
3. **Bilingual Parity & RTL/LTR Fidelity:** Complete Arabic-first (`ar-sa`) and English (`en-us`) design parity using CSS logical properties (`start`/`end`, `ps`/`pe`, `ms`/`me`), correct typographical line-heights for Tajawal (`var(--font-tajawal)`), and directionally aware UI iconography.
4. **Instant Client-Side Search (<5ms):** In-memory tokenized search engine with Arabic morphological normalization (Tashkeel stripping, Hamza unification, Taa Marbuta and Alif Maksura normalization) and keyboard-first accessibility (`Cmd+K` / `Ctrl+K`).
5. **Sub-second Responsive Performance:** 3-column desktop layout (`xl:grid-cols-[280px_1fr_240px]`), collapsible tablet navigation, and touch-optimized mobile drawer sheet with zero layout shift (CLS = 0).

---

## 2. Next.js 15 App Router Architecture & Route Tree

### 2.1 Route Mapping & Middleware Integration

ERP Link's `src/middleware.ts` enforces `SUPPORTED_URL_LOCALES = ['ar-sa', 'en-us']`. When an inbound request arrives:
- A user requesting `/ar-sa/docs/zid-odoo/stock-sync` is evaluated by middleware:
  - `firstSegment` is identified as `ar-sa`.
  - `langFromUrl` is resolved to `ar`.
  - The request is rewritten internally to `/docs/zid-odoo/stock-sync` while setting the `lang=ar` cookie and injecting header `x-pathname: /docs/zid-odoo/stock-sync`.
  - Server components resolve the language asynchronously:
    ```typescript
    import { cookies } from 'next/headers'
    import { resolveLanguage } from '@/lib/translations'

    const cookieStore = await cookies()
    const lang = resolveLanguage(cookieStore.get('lang')?.value)
    ```
- A user requesting `/docs` without a locale prefix is redirected (HTTP 307/308) to `/${urlLocale}/docs` based on their preferred cookie or default fallback (`ar-sa`).

### 2.2 Directory Structure within `src/app`

```
src/app/(public)/
├── layout.tsx                     # Existing public layout (LanguageProvider, ThemeProvider)
└── docs/
    ├── layout.tsx                 # Documentation Root Layout (Sidebar + Topbar + TOC wrapper)
    ├── page.tsx                   # Docs Homepage (Search Hero, Categories Grid, Featured Guides)
    ├── [category]/
    │   ├── page.tsx               # Category Overview Page (e.g. /docs/zid-odoo)
    │   └── [slug]/
    │       ├── page.tsx           # Deep Technical Article Page (e.g. /docs/zid-odoo/stock-sync)
    │       └── opengraph-image.tsx # Dynamic OpenGraph Card Generator
    └── search/
        └── page.tsx               # Dedicated Fallback Search Page for non-JS / search engine crawling
```

### 2.3 Server Component vs. Client Component Boundaries

To maximize Core Web Vitals (FCP, LCP, TTFB), rendering responsibilities are strictly demarcated:

| Component | Execution Tier | Responsibilities |
| :--- | :--- | :--- |
| `src/app/(public)/docs/layout.tsx` | **Server Component** | Static shell, reading cookie, fetching static category trees, injecting metadata. |
| `src/app/(public)/docs/[category]/[slug]/page.tsx` | **Server Component** | Markdown/content compilation, JSON-LD structured data injection, SEO headers. |
| `src/components/docs/docs-sidebar.tsx` | **Client Component** (`'use client'`) | Accordion collapse/expand state, active item highlighting via `usePathname()`, scroll persistence. |
| `src/components/docs/docs-search-modal.tsx` | **Client Component** (`'use client'`) | In-memory search querying, `Cmd+K` keyboard intercept, focus management. |
| `src/components/docs/docs-toc.tsx` | **Client Component** (`'use client'`) | `IntersectionObserver` active heading scroll spy, smooth scroll click handling. |
| `src/components/docs/docs-callout.tsx` | **Client/Server Hybrid** | Static styling wrapper with client-side copy snippets and foldable disclosure. |
| `src/components/docs/docs-code-block.tsx` | **Client Component** (`'use client'`) | Multi-tab language switcher (cURL / Python / Node / JSON), clipboard copy feedback. |

---

## 3. Sidebar Navigation Architecture

### 3.1 Design Specifications & Visual Hierarchy

The documentation sidebar is modeled after high-density developer portals (Stripe Docs, Next.js, Cloudflare), adapted to ERP Link’s light/dark brand tokens:
- **Width:** Fixed `w-72` (288px) on desktop, sticky below the `56px` global header (`top-14`).
- **Scroll Container:** `h-[calc(100vh-3.5rem)] overflow-y-auto overscroll-contain` with thin customized scrollbars (`scrollbar-thin`).
- **Typography:** `text-xs font-medium` for sub-items; `text-[11px] font-bold uppercase tracking-wider text-muted-foreground` for category group headers.
- **RTL/LTR Positioning:**
  - Arabic (`ar-sa`): Positioned at the right edge (`border-s border-border`), text aligned to the right (`text-start`), chevrons rotated left.
  - English (`en-us`): Positioned at the left edge (`border-e border-border`), text aligned to the left (`text-start`), chevrons rotated right.

### 3.2 Category & Navigation Taxonomy

```typescript
export interface DocNavItem {
  id: string
  title: { ar: string; en: string }
  href: string
  badge?: {
    text: { ar: string; en: string }
    variant: 'brand' | 'success' | 'warning' | 'neutral'
  }
  isNew?: boolean
  items?: DocNavItem[]
}

export interface DocNavCategory {
  id: string
  title: { ar: string; en: string }
  iconName: string
  defaultOpen?: boolean
  items: DocNavItem[]
}
```

#### Official ERP Link Information Architecture:
1. **Getting Started (البداية والتشغيل السريع)**
   - Overview & Architecture (`/docs/getting-started/overview`)
   - Quickstart Guide (`/docs/getting-started/quickstart`)
   - Platform & ERP Matrix (`/docs/getting-started/compatibility-matrix`)
2. **Zid + Odoo Integration (ربط متجر زد بأودوو)**
   - App Installation & OAuth Credentials (`/docs/zid-odoo/installation`)
   - Order Synchronization Lifecycle (`/docs/zid-odoo/orders`)
   - Multi-Warehouse Stock Sync (`/docs/zid-odoo/stock-sync`)
   - 15% VAT & Tax-Inclusive Pricing (`/docs/zid-odoo/vat-15`)
   - Returns, Reversals & Credit Notes (`/docs/zid-odoo/returns`)
   - Production Verification Checklist (`/docs/zid-odoo/checklist`)
3. **Salla + Odoo Integration (ربط متجر سلة بأودوو)**
   - Webhooks & App Scopes Setup (`/docs/salla-odoo/webhooks`)
   - Order & Payment Status Mapping (`/docs/salla-odoo/order-mapping`)
   - Customer Matching & Deduplication (`/docs/salla-odoo/customers`)
   - Product SKU & Variant Sync (`/docs/salla-odoo/products`)
4. **Shopify + Odoo Integration (ربط شوبيفاي بأودوو)**
   - Custom App Credentials & API Access (`/docs/shopify-odoo/credentials`)
   - Webhook Ingress & Verification (`/docs/shopify-odoo/webhooks`)
   - Fulfillment & Tracking Sync (`/docs/shopify-odoo/fulfillment`)
5. **Mapping Center & Standard Rules (مركز المطابقة وتوجيه البيانات)**
   - Standard Mapping System (`/docs/mapping-center/standard-mapping`)
   - Order Status Routing (`/docs/mapping-center/order-status`)
   - Payment Method & Fee Mapping (`/docs/mapping-center/payment-methods`)
   - Analytic Accounts & Cost Distribution (`/docs/mapping-center/analytic-accounts`)
   - Custom Fields Engine (`/docs/mapping-center/custom-fields`)
6. **Operations, Queue & Reliability (المراقبة والموثوقية)**
   - Sync Logs & Error Codes (`/docs/operations/sync-logs`)
   - Queue Admission & Retries (`/docs/operations/queue`)
   - Manual Resolution & Conflict Recovery (`/docs/operations/manual-resolution`)
   - Telegram & In-App Alerting (`/docs/operations/alerts`)
7. **Accounts, Workspaces & Manual Billing (الحسابات وبيئات العمل)**
   - Workspace Creation & Multi-Tenant Isolation (`/docs/accounts/workspaces`)
   - Team Roles & Access Controls (`/docs/accounts/roles`)
   - Free Trial Rules & Expiry (`/docs/accounts/trials`)
   - Manual Subscriptions & Bank Transfers (`/docs/accounts/billing`)
8. **Public MCP Server & Developer API (الواجهات وخوادم الذكاء الاصطناعي)**
   - Public MCP Architecture (`/docs/developer/public-mcp`)
   - Read-Only Tool Specifications (`/docs/developer/mcp-tools`)
   - Webhook Signature Verification (`/docs/developer/webhook-verification`)

### 3.3 State Management & Collapsible Interaction
- **Persistent State:** Uses `localStorage` key `erplink_docs_sidebar_state` storing an array of open category IDs.
- **Path Auto-Expansion:** On initial load or client-side navigation, the component checks `usePathname()`. If the active article belongs to a collapsed category, that category automatically expands to maintain user orientation.
- **Accordion Animation:** Framer Motion or pure Tailwind transition utilizing `transition-[max-height,opacity] duration-200 ease-in-out` to guarantee 0 cumulative layout shift.

---

## 4. Fast Client-Side Search Architecture (Zero Supabase / Zero Polling)

### 4.1 Search Engine Principles
Traditional server-side search creates severe database bottlenecks during traffic spikes and risks exposing backend database schemas. The ERP Link Documentation Center uses a fully pre-indexed client-side search engine with sub-5 millisecond response times.

### 4.2 Static Search Index Structure
Generated at static build time (`npm run build`) and served as immutable static assets:
- `public/search-index-ar.json` (~60KB gzipped)
- `public/search-index-en.json` (~50KB gzipped)

```typescript
export interface SearchIndexRecord {
  id: string              // e.g. "zid-odoo-stock-sync#warehouse-matching"
  slug: string            // e.g. "/docs/zid-odoo/stock-sync"
  anchor?: string         // e.g. "#warehouse-matching"
  category: string        // e.g. "zid-odoo"
  categoryTitle: string   // e.g. "ربط زد بأودوو"
  title: string           // e.g. "مزامنة المخزون متعدد المستودعات"
  heading?: string        // e.g. "ربط مستودع زد بموقع التخزين في أودوو"
  content: string         // Normalized search excerpt (150-200 chars)
  keywords: string[]      // Targeted keywords (e.g. ["stock.quant", "SKU", "virtual_available"])
}
```

### 4.3 Arabic Natural Language Normalization Pipeline
Arabic search requires linguistic normalization to avoid missed matches due to spelling variations, prefixes, or diacritics:

```typescript
export function normalizeArabicSearchText(input: string): string {
  if (!input) return ''
  return input
    .trim()
    .toLowerCase()
    // 1. Remove Tashkeel (harakat: fathah, dammah, kasrah, sukun, tanween, shaddah)
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // 2. Normalize Alif variants (أ, إ, آ -> ا)
    .replace(/[أإآ]/g, 'ا')
    // 3. Normalize Taa Marbuta (ة -> ه)
    .replace(/ة/g, 'ه')
    // 4. Normalize Yaa / Alif Maksura (ى -> ي)
    .replace(/ى/g, 'ي')
    // 5. Normalize Persian / Urdu kaf/gaf if present
    .replace(/ك/g, 'ك')
    // 6. Strip punctuation and excessive whitespace
    .replace(/[^\w\s\u0600-\u06FF]/gi, ' ')
    .replace(/\s+/g, ' ')
}
```

### 4.4 Search Modal UI (`Cmd+K` / `Ctrl+K`)
- **Keyboard Trigger:** Global listener for `e.metaKey && e.key === 'k'` or `e.ctrlKey && e.key === 'k'`.
- **Search Dialog:** Implemented using Radix Dialog (`@radix-ui/react-dialog`) with backdrop blur (`backdrop-blur-md bg-background/80`).
- **Scoring & Ranking Algorithm:**
  1. Exact Title Match: Weight 100
  2. Exact Keyword Match: Weight 80
  3. Heading Match: Weight 50
  4. Content Body Match: Weight 20
  5. Prefix/Fuzzy Substring: Weight 10
- **Keyboard Navigation:** `ArrowDown` / `ArrowUp` cycle through results; `Enter` navigates; `Escape` closes.
- **Query Highlighting:** Matched substrings wrapped in `<mark className="bg-primary/20 text-primary font-semibold rounded px-0.5">`.

---

## 5. Table of Contents (TOC) with Active Heading Tracking

### 5.1 Geometry & Placement
- **Desktop (`xl` breakpoint, >= 1280px):** Displayed in the 3rd column (`w-60` to `w-64`), sticky at `top-20`, with a max-height of `calc(100vh - 6rem)`.
- **Directional Anchoring:**
  - Arabic (`ar-sa`): Positioned on the left side of the screen (in RTL, content flows right-to-left; TOC sits at `start` or left flank).
  - English (`en-us`): Positioned on the right side of the screen (`end`).
- **Mobile/Tablet:** Rendered as a collapsible disclosure card at the top of the article body:
  `"In this article" / "محتويات هذا الدليل"` with chevron toggle.

### 5.2 Active Heading Detection via `IntersectionObserver`
Scroll events can cause frame drops. Active headings are tracked using an `IntersectionObserver`:

```typescript
'use client'

import { useEffect, useState } from 'react'

export function useActiveHeading(headingIds: string[]) {
  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    if (headingIds.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        })
      },
      {
        // Heading is active when it crosses the upper third of the viewport
        rootMargin: '-80px 0px -65% 0px',
        threshold: 0.1,
      }
    )

    headingIds.forEach((id) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [headingIds])

  return activeId
}
```

### 5.3 Visual Feedback & Smooth Scrolling
- **Active State:** The active item receives `text-primary font-bold` and an indicator bar:
  - RTL: `border-e-2 border-primary pe-3`
  - LTR: `border-s-2 border-primary ps-3`
- **Heading Scroll Margin:** All article headings (`h2`, `h3`, `h4`) define `scroll-mt-20 md:scroll-mt-24` in Tailwind so that clicking a TOC anchor does not conceal the heading under the sticky top navbar.
- **Back to Top:** Sticky footer link in TOC (`ArrowUp` icon) with `window.scrollTo({ top: 0, behavior: 'smooth' })`.

---

## 6. Breadcrumbs Architecture

### 6.1 Path Structure & Directional Behavior
Every documentation page renders breadcrumbs above the H1 title:
- **Arabic Path:** `الرئيسية` `←` `مركز التوثيق` `←` `ربط زد بأودوو` `←` `مزامنة المخزون`
- **English Path:** `Home` `→` `Docs` `→` `Zid + Odoo` `→` `Stock Sync`
- **Directional Chevrons:** Dynamically resolved based on language:
  ```typescript
  const Chevron = isAr ? ChevronLeft : ChevronRight
  ```
- **Responsive Overflow:** Mobile viewports truncate intermediate paths, showing `...` or keeping only Category `→` Page title to prevent line wraps.

### 6.2 Schema.org `BreadcrumbList` Structured Data
Integrated into the page `<head>` as JSON-LD for search engine rich results:

```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "ERP Link",
      "item": "https://erplink.sa/ar-sa"
    },
    {
      "@type": "ListItem",
      "position": 2,
      "name": "مركز التوثيق",
      "item": "https://erplink.sa/ar-sa/docs"
    },
    {
      "@type": "ListItem",
      "position": 3,
      "name": "ربط زد بأودوو",
      "item": "https://erplink.sa/ar-sa/docs/zid-odoo"
    },
    {
      "@type": "ListItem",
      "position": 4,
      "name": "مزامنة المخزون",
      "item": "https://erplink.sa/ar-sa/docs/zid-odoo/stock-sync"
    }
  ]
}
```

---

## 7. Callout System Specification

Technical documentation requires visual callouts for architectural caveats, data-safety alerts, and version prerequisites.

### 7.1 Visual Palette & Semantic Classes

| Callout Type | Semantic Intent | Light Mode Theme | Dark Mode Theme | Primary Icon |
| :--- | :--- | :--- | :--- | :--- |
| **Note** (`ملاحظة`) | Background context, version requirements | `bg-blue-50/70 border-blue-200 text-blue-950` | `bg-blue-950/20 border-blue-800/40 text-blue-200` | `Info` |
| **Tip** (`نصيحة`) | Performance optimization, best practices | `bg-emerald-50/70 border-emerald-200 text-emerald-950` | `bg-emerald-950/20 border-emerald-800/40 text-emerald-200` | `Lightbulb` |
| **Warning** (`تحذير`) | Potential sync failures, mapping mismatches | `bg-amber-50/70 border-amber-200 text-amber-950` | `bg-amber-950/20 border-amber-800/40 text-amber-200` | `AlertTriangle` |
| **Caution** (`خطر / تنبيه هـام`) | Breaking changes, double invoicing, data loss | `bg-destructive/10 border-destructive/30 text-destructive` | `bg-destructive/15 border-destructive/40 text-red-300` | `AlertOctagon` |
| **Best Practice** (`أفضل الممارسات`) | Recommended ERP accounting setups | `bg-violet-50/70 border-violet-200 text-violet-950` | `bg-violet-950/20 border-violet-800/40 text-violet-200` | `CheckCircle2` |

### 7.2 Callout Component Interface

```tsx
interface DocsCalloutProps {
  type: 'note' | 'tip' | 'warning' | 'caution' | 'best-practice'
  title?: string
  children: React.ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
}
```

**Styling Rules:**
- Border thickness: `border ps-4 pe-4 py-3.5 rounded-xl` with an accent stroke on the leading edge:
  `border-s-4` matching the variant color token.
- Typographic scale: Title at `text-xs font-bold font-sans tracking-wide`; body text at `text-xs leading-relaxed opacity-90`.
- Dark mode readability: Contrast strictly exceeds WCAG AA (>= 4.5:1).

---

## 8. Previous / Next Pagination (Sequential Reading)

### 8.1 Pager Navigation Design
At the end of every article, a dual-card pagination strip guides the reader to the logical next or previous topic in the integration sequence.

### 8.2 Layout & Arrow Directionality
```
┌───────────────────────────────┐   ┌───────────────────────────────┐
│ [←] السابق                     │   │                        التالي [→] │
│ تثبيت تطبيق زد وصلاحيات OAuth │   │ مزامنة المخزون متعدد المستودعات │
└───────────────────────────────┘   └───────────────────────────────┘
```
- In Arabic RTL:
  - "Previous" card arrow points right (`ArrowRight` or `ChevronRight`).
  - "Next" card arrow points left (`ArrowLeft` or `ChevronLeft`).
- In English LTR:
  - "Previous" card arrow points left (`ArrowLeft`).
  - "Next" card arrow points right (`ArrowRight`).
- **Category Transitions:** If an article is the last item in "Zid + Odoo", the "Next" card automatically links to the first item in "Salla + Odoo" (or "Standard Mapping"), ensuring uninterrupted sequential reading.

---

## 9. Dark/Light Mode & RTL/LTR Parity Standards

### 9.1 Color Token Mapping
The Documentation Center reuses the brand-aligned HSL color tokens established in `src/app/globals.css`:

```css
/* Light Mode */
--background: 0 0% 97%;       /* #F7F7F7 */
--card: 0 0% 100%;             /* #FFFFFF */
--foreground: 220 25% 10%;     /* #111827 */
--primary: 217 85% 50%;        /* #1366EC - Brand Logo Blue */
--border: 216 18% 89%;

/* Dark Mode */
--background: 218 30% 7%;      /* #0D1319 - Deep Blue Tinted Dark */
--card: 218 22% 11%;           /* #16202B */
--foreground: 213 25% 96%;     /* #F1F5F9 */
--primary: 216 92% 66%;        /* #5695FA - High Contrast Light Brand Blue */
--border: 217 16% 18%;         /* #1F2A36 */
```

### 9.2 RTL/LTR Layout Rules
1. **Logical Properties Only:** All padding, margins, borders, and positioning use CSS Logical Properties:
   - `ps-4` / `pe-4` (not `pl-4` / `pr-4`)
   - `ms-auto` / `me-2` (not `ml-auto` / `mr-2`)
   - `start-0` / `end-0` (not `left-0` / `right-0`)
   - `text-start` / `text-end` (not `text-left` / `text-right`)
2. **Code Blocks Isolation:** Technical code snippets (JSON, Python XML-RPC, cURL, SQL, TS) MUST remain strictly in LTR mode even in Arabic viewports:
   ```tsx
   <div dir="ltr" className="text-start font-mono text-xs">
     <pre>{code}</pre>
   </div>
   ```
3. **Arabic Typography Optimization:**
   - Font: Tajawal (`var(--font-tajawal)`) via Next.js Google Fonts.
   - Heading line-height: `leading-normal` or `leading-relaxed` (not `leading-tight`) to prevent clipping of Arabic diacritics and letters (`ي`, `ق`, `ل`).

---

## 10. Responsive Layout Grid Architecture

```
Desktop (xl >= 1280px): 3 Columns
┌──────────────┬────────────────────────────────────────┬──────────────┐
│   Sidebar    │           Main Content Body            │     TOC      │
│    (280px)   │        (max-w-3xl, centered)           │   (240px)    │
│    Sticky    │ Breadcrumbs > Header > Article > Pager │    Sticky    │
└──────────────┴────────────────────────────────────────┴──────────────┘

Tablet (md to lg, 768px - 1279px): 2 Columns
┌──────────────┬───────────────────────────────────────────────────────┐
│   Sidebar    │                   Main Content Body                   │
│    (260px)   │       Inline Collapsible TOC > Article > Pager        │
└──────────────┴───────────────────────────────────────────────────────┘

Mobile (< 768px): Single Column Fluid
┌──────────────────────────────────────────────────────────────────────┐
│ [☰ Menu]  ERP Link Docs  [🔍 Search]  [🌐 Lang]  [🌙 Theme]          │
├──────────────────────────────────────────────────────────────────────┤
│ Breadcrumbs                                                          │
│ Article Title (H1) & Metadata Pill                                   │
│ ▼ In This Guide (Collapsible Drawer Accordion)                       │
│ Content Body & Callouts                                              │
│ Previous / Next Pager Cards (Stacked)                                │
│ Footer                                                               │
└──────────────────────────────────────────────────────────────────────┘
```

### 10.1 Viewport Breakpoints & Containers
- Container: `mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8`
- Header: `sticky top-0 z-40 h-14 w-full border-b border-border bg-background/80 backdrop-blur-md`
- Mobile Off-Canvas Navigation: Implemented with Radix Sheet (`@radix-ui/react-dialog`) with smooth entry animations from right in RTL, left in LTR.

---

## 11. Developer Artifacts: Code Blocks & Copy Utilities

### 11.1 Features
1. **Language Badge:** Pill displaying `JSON`, `Python`, `TypeScript`, `cURL`, or `Bash`.
2. **Copy Button:** Client button with `navigator.clipboard.writeText`, providing visual feedback (`Check` icon with "تم النسخ!" / "Copied!" tooltip for 2 seconds).
3. **Multi-Tab Code Groups:** Tabbed code component for comparing integration variants (e.g. Zid Webhook Payload vs. Salla Webhook Payload vs. Shopify Webhook Payload).
4. **File Path Header:** Optional top strip displaying the file target (e.g. `src/lib/sync/zid/orders.ts`).

---

## 12. Implementation File Map

All new Documentation Center components are organized under `src/components/docs/`:

| Component File | Role |
| :--- | :--- |
| `src/components/docs/docs-sidebar.tsx` | Desktop & Tablet collapsible category tree with path detection. |
| `src/components/docs/docs-mobile-nav.tsx` | Mobile slide-out drawer sheet with full category navigation. |
| `src/components/docs/docs-toc.tsx` | Sticky Table of Contents with `IntersectionObserver` heading tracking. |
| `src/components/docs/docs-breadcrumbs.tsx` | Direction-aware breadcrumbs with Schema.org JSON-LD generator. |
| `src/components/docs/docs-search-modal.tsx` | Fast client search dialog with Arabic normalization and shortcut hooks. |
| `src/components/docs/docs-search-trigger.tsx`| Topbar search button showing `⌘K` or `Ctrl+K`. |
| `src/components/docs/docs-callout.tsx` | Semantic alert banners (Note, Tip, Warning, Caution, Best Practice). |
| `src/components/docs/docs-pager.tsx` | Previous / Next bottom navigation cards with category crossing. |
| `src/components/docs/docs-code-block.tsx` | Syntax-styled code container with copy button and LTR isolation. |
| `src/components/docs/docs-tabs.tsx` | Multi-platform or multi-language code switcher tabs. |
| `src/lib/docs/search-index.ts` | Static search index loader and Arabic text normalization engine. |
| `src/lib/docs/navigation-data.ts` | Single source of truth for documentation categories, articles, and paths. |

---

## 13. Quality Assurance & Verification Criteria

1. **Zero Database Ingress:** Verify via network inspection that loading `/ar-sa/docs` or executing a search makes 0 queries to Supabase.
2. **RTL/LTR Visual Audit:** Inspect all 8 components in both `dir="rtl"` and `dir="ltr"`. Chevrons, padding, indicators, and alignments must flip symmetrically.
3. **Dark/Light Mode Contrast:** Measure text contrast ratios against background tokens to ensure WCAG AA (>= 4.5:1) compliance for all callout variants and code blocks.
4. **Keyboard Accessibility:** Complete an entire search and navigation flow using only `Tab`, `ArrowDown`, `ArrowUp`, `Enter`, and `Escape`.
5. **No Next.js 15 Async Cookie Warnings:** Confirm that all server components await `cookies()` before reading locale values.
