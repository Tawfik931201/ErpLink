# Shopify → Odoo readiness audit (2026-11-21)

Scope: Shopify-only integration. Do not modify Zid behavior, tables, credentials, or mappings.

## Verified sources

- Shopify: https://shopify.dev/docs/apps/build/authentication-authorization
- Shopify managed installation: https://shopify.dev/docs/apps/build/authentication-authorization/app-installation
- Shopify token exchange: https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange
- Shopify webhook HMAC, deduplication and 5-second acknowledgement: https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
- Shopify webhook subscription management: https://shopify.dev/docs/apps/build/webhooks/subscribe
- Odoo 14 external RPC: https://www.odoo.com/documentation/14.0/developer/reference/external_api.html
- Odoo 19 external RPC: https://www.odoo.com/documentation/19.0/developer/reference/external_rpc_api.html
- Odoo 20 external API: https://www.odoo.com/documentation/20.0/developer/reference/external_api.html

## Critical blockers / discrepancies

1. **Install/auth mode**: `shopify.app.toml` declares `embedded = true` and `use_legacy_install_flow = false` (Shopify-managed installation). ERP Link currently connects via `/api/shopify/connect` → `/admin/oauth/authorize` → `/api/shopify/callback` (legacy authorization-code flow), and has no embedded App Bridge session-token exchange. Shopify-managed installation can bypass the OAuth callback entirely. Select one supported architecture, implement its complete token acquisition, and deploy a matching Shopify app configuration **before** accepting live stores. Do not switch flags blindly; Shopify recommends managed installation + token exchange for embedded apps.
2. **Published API version drift**: developer dashboard currently shows app webhook API `2025-07`, while checked-in `shopify.app.toml` and `SHOPIFY_API_VERSION` use `2026-10`. Deploy and verify Shopify app version in the Dev Dashboard separately from the Next.js/Hostinger deployment.
3. **No connected Shopify store**: `public.shopify_tokens` contained zero rows at audit time. No authenticated test of Shopify → queue → Odoo was possible. Do not infer success from static source inspection.
4. **Protected customer data**: dashboard access request remains draft; verify `read_customers` grant and delivered events before claiming customers work.
5. **Refunds**: `refunds/create` is listed in the advanced webhook UI but intentionally resolves to no Odoo entity and is skipped by the Shopify ingress. This is **not** an implemented Odoo return/credit-note integration. Do not enable or advertise this as supported until a Shopify-specific idempotent return adapter has been built and tested.
6. **Other advanced topics**: carts, checkouts, and inventory topics are similarly not implemented as Odoo entity operations. A checkbox is not a guarantee of processing.
7. **Webhook resilience**: recent change awaits bounded registration after OAuth and warns if partial, while incoming delivery already validates HMAC and deduplicates. Verify duration against OAuth callback hosting limits; keep the manual subscription reconciliation action.
8. **Database/version detection**: `OdooClient` uses `/xmlrpc/2/common` and `/xmlrpc/2/object` with `execute_kw`, available in Odoo 14 and still deprecated-but-present in 20. Odoo 20 removes the external `db` service; this code does not call it. Odoo 19/20 recommend JSON-2, but migrating the shared connector requires separate cross-platform testing. Never assume all model fields are identical.

## Odoo 14–20 qualification matrix

| Major | Expected transport | Required validation |
| --- | --- | --- |
| 14 | XML-RPC execute_kw | sale.order, sale.order.line, account.move, product.template, res.partner, stock.picking; taxes and UoM field metadata |
| 15 | XML-RPC execute_kw | Same + invoice and refund workflows |
| 16 | XML-RPC execute_kw | analytic_distribution vs legacy analytic fields; invoice workflows |
| 17 | XML-RPC execute_kw | sale.order action_lock, action_cancel behavior; product variants |
| 18 | XML-RPC execute_kw (deprecated timeline) | tax_ids vs tax_id resolved with fields_get |
| 19 | XML-RPC execute_kw deprecated | product_uom_id vs product_uom; data-model capability checks |
| 20 | XML-RPC execute_kw deprecated | no db-service assumptions; locked order constraints, tax_ids and invoice actions |

**These are test targets, not evidence of passing live tests.** The source contains version-dependent branches and runtime `fields_get` guards, but each Odoo major version must be tested against a real instance with Sales, Inventory, and Accounting installed. Verify matched records and stored mapping settings, not just HTTP responses.

## Release acceptance

- Establish a real Shopify installation and durable offline token in the correct workspace.
- Verify current app webhook API version, installed scopes, each required subscription and webhook delivery HMAC.
- Create/update/delete product, collection and customer; create/paid/fulfilled/edited/cancelled order; verify Odoo IDs, amounts, tax, invoices, stock, retry and duplicate idempotency.
- Verify partial/full refund only **after** an explicit Shopify refund adapter exists.
- Run cross-workspace isolation tests; verify no Zid code or settings changed.
- Run unit tests, type checks and live integration test against Odoo 14, 15, 16, 17, 18, 19 and 20 before labeling this release fully compatible.
