# ERP Link agent discovery: deployment and safety

As of 2026-11-23. Implemented only for public marketing content at https://erplink.bizsahla.com.

## 1. Verified public contact identity

The official public email supplied by the business owner is `info@bizsahla.com`.
The public Organization `email` and customer-support ContactPoint, About and Contact pages, footer, public Markdown and browser WebMCP contact tool all present the same contact email and the website's contact page.
Customer enquiries through the public contact form and logged-in support tickets continue to flow through the pre-existing central Odoo support system; no delivery rules, recipient mailboxes or backend integrations were changed.

The only optional business-identity field currently exposed is `sameAs`, sourced from `PUBLIC_BUSINESS_SAME_AS` (owned HTTPS profile URLs only). These must be genuine company profiles on an allowlisted host. Empty values do not appear in JSON-LD.

## 2. Markdown for agents

Request `GET https://erplink.bizsahla.com/ar-sa` (or `/en-us` / listed integration pages) with `Accept: text/markdown`. Only eight public, curated pages are eligible. The response is `text/markdown; charset=utf-8`, includes `Vary: Accept`, and is not a dynamic HTML scraper. Browsers sending `text/html` get the normal site. Pricing, legal agreements, authenticated routes, app/admin routes, OAuth, webhooks and all non-GET methods are excluded.

Test after deployment:
```sh
curl -si -H 'Accept: text/markdown' https://erplink.bizsahla.com/ar-sa | head -25
curl -si -H 'Accept: text/html' https://erplink.bizsahla.com/ar-sa | head -25
curl -si -H 'Accept: text/markdown' https://erplink.bizsahla.com/ar-sa/app/dashboard | head -25
```
The last request must never return private markdown; normal authentication protection remains.

## 3. Browser-native WebMCP

The public layout loads `/agent-tools.js` only on public-site pages. The script feature-detects the modern experimental `document.modelContext` API and registers two read-only tools: find a public integration guide and get the public support contact. No form submission, authentication, browser storage, API fetch, customer record, private resource or billing operation is exposed.

WebMCP API support is experimental; browsers without it behave exactly as before.

## 4. Actual public MCP endpoint and Server Card

- Transport (stateless, JSON-RPC, POST): `https://erplink.bizsahla.com/api/public-mcp`.
- Discovery card: `https://erplink.bizsahla.com/.well-known/mcp/server-card.json`.
- AI Catalog: `https://erplink.bizsahla.com/.well-known/ai-catalog.json`.
- Protocol version: `2025-06-18`. Server name: `com.bizsahla.erplink/public`, version `1.0.0`.
- Methods implemented: `initialize`, `ping`, `tools/list`, `tools/call` and notification acknowledgment.
- Tools implemented: `list_public_integrations`, `read_public_page` (static allowlist).
- HTTP GET to the transport returns 405 (no server-sent events). Calls are stateless: no sessions or writes. Requests reject disallowed Origin and oversized/malformed bodies, and only public content is returned.

```sh
curl -si https://erplink.bizsahla.com/.well-known/mcp/server-card.json
curl -si https://erplink.bizsahla.com/.well-known/ai-catalog.json
curl -si https://erplink.bizsahla.com/api/public-mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
curl -si https://erplink.bizsahla.com/api/public-mcp \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

MCP Server Cards are experimental discovery metadata, not an SEO ranking factor. SEP-2127 supersedes older SEP-1649; the requested legacy well-known URL is provided for scanners, and the AI Catalog implements current discovery. The card must not falsely claim tools, protocols or authenticated capabilities the server does not actually implement.

## 5. Non-goals and safety

- No addition of unverified business phone, postal address, social profiles or claims of partnership.
- No automatic MCP access to Odoo, Zid, Salla, Shopify, Supabase, Clerk, queue, support tickets, user data or private business workflows.
- No Next.js dependencies or scheduled polling. No changes to existing public marketing HTML for ordinary browser requests.
- Do not make private URLs indexable or expand the sitemap to non-marketing routes.
- Deploy from a temporary feature branch via a single squash commit to main after GitHub Actions and a scoped file diff review. Verify live behavior and Hostinger deployment separately.
