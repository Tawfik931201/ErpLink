# ERP Link search visibility: first indexing and keyword checkpoint

Updated 2026-11-24. Official site: https://erplink.bizsahla.com/

## Why a fresh site might not show up
Discovered in a sitemap != indexed != ranking well. Google Search Console accepted a request to index the Zid–Odoo page on 2026-11-23; its live test reported page fetch successful and indexing allowed. Those facts do not prove the Google index has included it. Search Console's Pages and URL Inspection **Google index** tab are authoritative for the actual status. A live URL test is not an indexing status.

The site has 22 canonical Arabic/English marketing URLs in /sitemap.xml, not 22 confirmed indexed URLs. There is no authorized real-time rank or impressions measurement at this moment; do not report invented rank, CTR, impressions, backlinks or SEO outcomes.

## Priority keywords / query intent
| Intent | Suggested real-world query | Relevant canonical page |
| --- | --- | --- |
| Branded (highest initial diagnostic priority) | ERP Link, ErpLink, ERPLink, إي آر بي لينك | /ar-sa, /en-us |
| Integration | ربط زد بأودوو, برنامج ربط زد بأودوو | /ar-sa/integrations/zid-odoo |
| Integration | ربط سلة بأودوو, مزامنة سلة مع أودوو | /ar-sa/integrations/salla-odoo |
| Integration | ربط شوبيفاي بأودوو, Shopify Odoo integration | /ar-sa/integrations/shopify-odoo |
| Discovery | ربط المتاجر الإلكترونية بأودوو, ربط المتجر بنظام ERP | /ar-sa/integrations |
| How-to | كيفية ربط زد بأودوو, اختبار مرتجع زد أودوو | /ar-sa/guides/zid-odoo-checklist |

These are relevance targets, **not** proven search volume data. Broad standalone keywords مثل «أودوو» or «ربط» are informational/competitive, not suitable early-ranking goals.

## Implemented page-quality improvements
- Product name and key search intent appear naturally and visibly in the homepage main heading and readable introduction, Arabic and English.
- Descriptive internal link texts point to the three specialized existing integration pages.
- Homepage metadata titles/descriptions match real product and target use cases; Organization and WebSite structured data include documented brand spellings as alternateName.
- No new indexable private routes, location pages, keyword stuffing, fake reviews or manipulated meta keywords.

## Verification protocol (current access allows code and CI only)
1. Hostinger deployment: verify merged main commit deployed and publicly responds 200.
2. Google Search Console → Indexing → Pages: observe **Indexed** vs **Not indexed** counts and reasons.
3. URL Inspection → check **Google index** result for /ar-sa and /ar-sa/integrations/zid-odoo; use Test live URL only for fetch diagnosis. Request indexing sparingly if appropriate.
4. Performance → Search results → 28 days → Queries; monitor brand and long-tail phrases (nonzero impressions first, then clicks and average position). The brand query is the simplest diagnostic; once indexing has happened, gradually improve commercial-intent pages through relevant references and genuinely useful content.
5. After deployment, confirm the rendered HTML shows correct <title>, H1, canonical and hreflang (and the page is not blocked by robots or noindex).
6. Don't buy or automate spammy backlinks, fake profile accounts or bulk duplicate pages. Real public business listings, platform marketplaces, developer docs and third-party editorial links are useful only when accurate and appropriate.

## Reference guidance
- https://developers.google.com/search/help/crawling-index-faq
- https://developers.google.com/search/docs/appearance/site-names
- https://developers.google.com/search/docs/appearance/title-link
- https://developers.google.com/search/docs/essentials
