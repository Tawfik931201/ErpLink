# Module map

Actual source paths for the bounded refactor. Functions mentioned below can be located by name; line positions will change as modules are extracted. The four domain helpers are small boundaries, not complete domain services.

## Domain responsibilities

| Area | Focused modules | Remaining execution and data access | Main relationships |
| --- | --- | --- | --- |
| Products | `src/lib/products/variants.ts`, `src/lib/product-name.ts` | `src/lib/sync-engine.ts`: `syncAsSeparateProducts`, `syncChildAsSeparateProduct`, `syncAsVariants`, `syncChildVariantAsVariant`, `syncProductBom`, matching and writes. `src/app/actions/product-mappings.ts` handles manual mappings. | Store clients and payloads -> variant normalization -> orchestrator -> Odoo; stock remains a separate execution path. |
| Customers | `src/lib/customers/company-fields.ts`, `src/lib/sync-helpers.ts` customer name helper | `src/lib/sync-engine.ts`: partner relation creation, `buildOdooValues`, `executeOdooOperation`, matching. `src/app/actions/transfers.ts`: bulk customer import. | Platform customer payload -> mapping/company fields -> `res.partner`; identity remains scoped through existing matching/entity-link rules. |
| Categories | `src/lib/categories/mapping-overrides.ts` | `src/app/actions/category-mappings.ts`: fetch/save/delete/import mapping rows and existing best-effort ERP match-field update; `sync-engine.ts`: parent category resolution and category execution. | Saved mapping overrides -> existing fixed/rule values -> `product.category`; per-store precedence retained. |
| Orders | `src/lib/orders/fulfillment-items.ts`, `src/lib/zid/order-helpers.ts`, `src/lib/odoo/order-currency.ts`, `src/lib/odoo/order-payment.ts`, `src/lib/odoo/analytic-distribution.ts` | `src/lib/sync-engine.ts`: `buildOrderLineItems`, `normalizeOrderLinesForUpdate`, `prepareSaleOrderForUpdate`, `ensureSaleOrderTaxes`, `executeOdooOperation`, invoice/picking/status actions. | Enriched order -> line/header mapping -> Sales Order create/update -> status/invoice/delivery actions. No new business rules. |
| Returns | `src/lib/returns/detect.ts`, `settings.ts`, `engine.ts`, `odoo.ts`, `zid.ts` | Existing orchestrator interception before ordinary Odoo writes. | `mode: nothing` remains inert; existing negative-SO and stock/credit-note behavior retained. |
| Inventory | `src/lib/stock-sync-engine.ts`, `src/lib/inventory-sync-settings.ts`, `src/app/actions/inventory-sync.ts` | Odoo stock route and `sync-engine.ts` stock helpers remain. | Read tenant Odoo balance -> resolve mapped product/location -> platform stock update. |

## Platform integrations

| Integration | Actual files | Responsibility |
| --- | --- | --- |
| Zid | `src/lib/zid-client.ts`; `src/lib/zid/{config,auth,token,types,webhooks,webhook-auth,store-identity,subscription-webhook,order-helpers}.ts` | Merchant API requests, OAuth/token store and refresh lock, registration, ingress classification, distinct store/merchant identity, subscription lifecycle, order normalization helpers. |
| Salla | `src/lib/salla-client.ts`, `src/lib/salla/webhook-auth.ts` | API calls, merchant token refresh lock, catalog/customer/category/order reads, webhook event catalogue and registration, native/derived ingress authentication. |
| Odoo workspace integration | `src/lib/odoo-client.ts`, `src/lib/odoo/{version,webhook-secret,order-currency,order-payment,analytic-distribution}.ts`, `src/lib/odoo-webhook.ts` | XML-RPC transport/authentication/version compatibility, scoped ingress credentials, Odoo-specific order/accounting helpers and action registration. Domain writes still primarily in orchestrators. |
| Helpdesk Odoo | `src/lib/odoo.ts`, `src/app/actions/contact.ts`, `src/app/actions/tickets.ts`, `src/app/api/tickets/attachments/route.ts` | Separate env-configured JSON-RPC integration for public contact/support; do not merge blindly into workspace client. |
| Shopify | `src/lib/shopify-client.ts`, `src/lib/shopify-topics.ts`, Shopify HTTP routes | Existing third-platform behavior. Field catalogues, subscribed topics and configuration are deliberately distinct. |
| ERPNext | `src/lib/erpnext-engine.ts`, `src/app/actions/custom-fields-erpnext.ts` | Existing alternative ERP path; not expanded or replaced during Odoo organization. |
| Field catalogues | `src/lib/platforms/{zid,salla,odoo,shopify}/fields.ts`, `src/lib/platform-fields.ts` | Existing field/event metadata and platform external-ID field rules. `mapping-constants.ts` is a compatibility barrel. |

## Shared infrastructure and application boundaries

| Area | Files |
| --- | --- |
| HTTP ingress | `src/app/api/webhooks/{zid,salla,shopify,odoo,clerk}/route.ts`, `src/app/api/webhooks/odoo/stock/route.ts` |
| OAuth routes | `src/app/api/{zid,salla,shopify}/{connect,callback}/route.ts`; legacy Zid forwarding under `src/app/api/auth/zid/` |
| Queue/admission/durability | `src/lib/sync-queue.ts`, `sync-queue-runner.ts`, `webhook-inbox.ts`, `ingress-admission.ts`, `ingress-batch.ts`, `queue-item.ts`, `queue-archive.ts`, `queue-archive-prune.ts` |
| Boot and reconciliation | `src/instrumentation.ts`, `src/lib/reconciliation.ts`, `src/lib/store-pull-budget.ts`, `src/app/api/cron/{sync-queue,reconcile}/route.ts` |
| Mapping configuration and rules | `src/lib/mapping-settings.ts`, `event-operation.ts`, `webhook-gate.ts`, `field-utils.ts`, `sync-helpers.ts`, `sync-types.ts`; actions `standard-mapping.ts`, `field-mappings.ts`, `static-mappings.ts` |
| Database/logging/identity | `src/lib/supabase.ts`, `sync-runtime.ts`, `entity-links.ts`, `audit-logs.ts`, `webhook-skip-log.ts`; `supabase/migrations/` |
| Auth/workspaces | `src/lib/auth.ts`, `users.ts`, `workspace-defaults.ts`, `workspace-trial.ts`, `workspace-archive.ts`, `workspace-purge.ts`; workspace/member actions |
| Crypto/validation | `src/lib/crypto.ts`, `webhook-secret.ts`, `webhook-strict.ts`, `platform-validation.ts`, `custom-field-validation.ts` |
| Notifications | `src/lib/telegram-notifier.ts`, `telegram-outbox.ts`, `telegram-long-poller.ts`, `telegram/link-code.ts`, `admin-alerts.ts`, `email.ts`, `email-templates.ts` |
| Manual billing | `src/app/actions/subscription-actions.ts`, `src/lib/subscription-{utils,dates,countdown}.ts` |
| Diagnostics | `src/lib/pipeline-selftest.ts`, `src/app/api/admin/queue-health/route.ts`, admin self-test/rehearsal/refresh/replay endpoints; these can mutate state and are not offline test commands |
| Tests | `tests/unit/`, `tests/mocks/supabase.ts`, `jest.config.js`, `jest.setup.ts` |

## Dependency constraints

The source dependency inventory covered 304 files before extraction and found two existing strongly connected groups: `auth.ts`/`supabase.ts`, and the Odoo route/stock engine/sync engine/queue/Telegram notifier/skip-log group. This is an inventory of source imports, not a proof of every possible dynamic runtime path. See [ingress-audit.md](ingress-audit.md) for concrete cycle edges and risk.

New focused domain modules must not import `sync-engine.ts` back. Type-only imports belong in `sync-types.ts`; existing shared runtime stays in `sync-runtime.ts`. Do not move application auth into pure payload helpers or import route handlers into new domain code. Existing cycles are documented and deferred, not claimed resolved.
