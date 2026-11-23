# ERP Link — SEO + GEO growth playbook

Updated: 2026-11-23. Public website: https://erplink.bizsahla.com/

## Objective and constraints
Grow qualified discovery for merchants searching for e-commerce–ERP integration, especially Zid–Odoo, Salla–Odoo, and Shopify–Odoo in Arabic and English. The desired outcome is relevant organic clicks, qualified sign-ups and independent mentions/citations by search and AI experiences—not an unprovable guarantee of #1 placement.

Never expose authenticated routes, integration credentials, customer data, support tickets, webhooks or logs to search engines. No keyword stuffing, fabricated testimonials, invented pricing, unverified performance claims, or mass-generated near-duplicate location pages.

## Verified research and opportunity
- Google Search Central's 2026 generative AI guidance says ordinary search eligibility, indexed public content and valuable first-hand information are foundational for Google AI Overview and AI Mode. It explicitly says Google does not use llms.txt for Search ranking.
  https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- Google prioritizes original, reliable, people-first content rather than scaled SEO-only pages.
  https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Bing provides an AI Performance report for citations and grounding queries; IndexNow can submit changed public URLs when the site is verified and a key is configured.
  https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c
  https://www.bing.com/webmasters/help/indexnow-0z209wby
- A basic public search found other vendors publishing specific Zid–Odoo and Salla–Odoo integration pages, so commercial-intent landing pages are a reasonable initial focus. This does **not** establish search volume or ranking difficulty.

## Target intent map (not search-volume estimates)
| Page | Primary intent | Secondary intent |
| --- | --- | --- |
| /integrations/zid-odoo | ربط زد بأودوو / Zid Odoo integration | زد أودو، ربط طلبات زد بأودوو، مخزون زد أودوو |
| /integrations/salla-odoo | ربط سلة بأودوو / Salla Odoo integration | مزامنة سلة مع Odoo، ربط الطلبات والمخزون |
| /integrations/shopify-odoo | ربط شوبيفاي بأودوو / Shopify Odoo connector | Shopify to Odoo orders, stock, fulfillment |
| /integrations | ربط المتاجر الإلكترونية بأنظمة ERP | ربط زد سلة شوبيفاي بأودوو |
| /guides/zid-odoo-checklist | كيفية ربط زد بأودوو | اختبار ربط زد بأودوو، الضرائب والمرتجعات |

Generic queries like `أودوو`, `Odoo` and `زد` include navigational interest in the platforms themselves; success there is a long-term brand/discovery ambition, not a realistic ranking promise.

## Immediate launch verification (needs domain or Google/Bing account access)
1. Check HTTP 200 and rendered HTML for each localized marketing page; confirm title, description, canonical, hreflang, one human-readable H1 and internal links.
2. Fetch `/robots.txt` and `/sitemap.xml` from production (not just source code), and validate the 22 public URLs. They must not contain app, admin, login, customer, webhook, invoice, or API URLs.
3. In Google Search Console, verify the domain via DNS or another supported ownership method, submit `https://erplink.bizsahla.com/sitemap.xml`, use URL Inspection for the main Arabic page and /ar-sa/integrations/zid-odoo, and review Pages indexing status.
4. In Bing Webmaster Tools, verify ownership, submit the same sitemap and inspect Indexing, Search Performance and AI Performance. Configure IndexNow only if domain/key verification and reliable changed-page submission are available.
5. Run Google Rich Results Test for structured data and check organization/breadcrumb consistency. Do not invent ratings or FAQs to manipulate rich-result eligibility.
6. Run PageSpeed Insights on home and the Zid–Odoo landing page on mobile. Establish Core Web Vitals baselines, fix material user-facing performance issues separately after testing.

## Measurement plan (weekly, in Google Search Console / Bing Webmaster Tools)
- Query: Zid Odoo integration / ربط زد بأودوو, including variants: impressions, clicks, CTR, average position.
- Repeat for Salla Odoo and Shopify Odoo; segment by country, language and landing page where possible.
- Track number of relevant indexed pages, sitemap errors, major mobile vitals regressions, organic contact requests and activated sign-ups.
- Bing AI Performance: pages cited, citation counts, grounding queries/topic clusters (when the report becomes available).
- Monthly review: did the landing page answer the user's actual integration questions? Update based on support discussions and observed friction, not invented trends.

## Evidence-led editorial backlog (requires real product facts, tests and review)
1. Publish a tested, illustrated Zid–Odoo walkthrough with real screenshots and sanitized test data, including the status-mapping screen and expected Odoo result.
2. Explain taxes inclusive/exclusive with real example amounts and matched invoices, without claiming one default works for everyone.
3. Publish a verified partial/full-return troubleshooting guide with observed log categories and resolution examples.
4. Describe deduplication and webhook retries with a reproducible test scenario and honest boundaries.
5. Expand Salla and Shopify pages based on confirmed supported features and relevant integration-specific cases.

## Guardrails
- The public site can explain how an integration is configured; it must not read, store, or expose customers' private data to crawlers.
- robots.txt is only crawl guidance, not authentication or data protection.
- No fake partner certifications, search rankings, reviews, uptime or customer counts.
- Content updates go through a feature branch and a squash merge into main after CI; don't edit main directly.

## Source reference
- https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c
- https://www.bing.com/webmasters/help/indexnow-0z209wby
