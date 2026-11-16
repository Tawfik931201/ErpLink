# Module map

The paths below are relative to `src/lib/` unless otherwise stated. `sync-engine.ts` and `erpnext-engine.ts` preserve existing imports.

## Inbound sync responsibilities

| Area | Store data | Destination execution |
| --- | --- | --- |
| Dispatch | `sync/webhook.ts` applies the store's enrichment before mapping. | `sync/mappings.ts` selects the existing mapping and dispatches with the validated ERP connection. |
| Products | `zid/products.ts`, `salla/products.ts`, `shopify/products.ts` and the shared variant shape in `products/variants.ts`. | `odoo/products.ts` prepares values. `odoo/product-native-variants.ts`, `odoo/product-separate-variants.ts`, `odoo/product-stock.ts` and `odoo/product-bom.ts` handle the corresponding writes. ERPNext `erpnext/products.ts` supplies Item creation defaults. |
| Customers | `zid/customers.ts` and `salla/customers.ts` fetch details. `shopify/customers.ts` composes the customer name. | `odoo/customers.ts` prepares the partner values and `odoo/relations.ts` resolves linked records. ERPNext uses its custom DocType mapping. |
| Categories | `zid/categories.ts` and `salla/categories.ts` read category details. | `odoo/relations.ts` resolves parents, `odoo/categories.ts` prepares values and `categories/odoo-values.ts` checks Odoo capabilities. ERPNext uses its custom DocType mapping. |
| Orders | `zid/orders.ts` and `salla/orders.ts` hydrate store orders. `zid/order-helpers.ts` and `salla/order-amounts.ts` handle store-specific values. | `odoo/order-values.ts` prepares the order, `odoo/order-lines.ts` builds lines and `odoo/order-workflow.ts` handles status, invoice and picking. The executor intercepts returns before ordinary order preparation. |
| Record writes | Original payload fields remain available to custom mappings. | `odoo/execute-operation.ts` and `odoo/records.ts` run Odoo writes. `erpnext/mappings.ts`, `erpnext/values.ts` and `erpnext/records.ts` process the existing ERPNext custom mappings. |
| Outbound inventory | `stock-sync-engine.ts` sends the authoritative Odoo balance to the store. | The app's Odoo webhook route owns the outbound record worker. |

Manual imports and mapping CRUD remain in `src/app/actions/`. The workspace ERP transport lives in `odoo-client.ts` or `erpnext/client.ts`.

## Platform integrations

| Integration | Actual files | Responsibility |
| --- | --- | --- |
| Zid | `src/lib/zid-client.ts`; `src/lib/zid/{config,auth,token,types,webhooks,webhook-auth,store-identity,subscription-webhook,order-helpers}.ts` | Merchant API requests, OAuth/token store and refresh lock, registration, ingress classification, distinct store/merchant identity, subscription lifecycle, order normalization helpers. |
| Salla | `src/lib/salla-client.ts`, `src/lib/salla/webhook-auth.ts` | API calls, merchant token refresh lock, catalog/customer/category/order reads, webhook event catalogue and registration, native/derived ingress authentication. |
| Odoo workspace integration | `src/lib/odoo-client.ts`, `src/lib/odoo/{version,webhook-secret,order-currency,order-payment,analytic-distribution}.ts`, `src/lib/odoo-webhook.ts` | XML-RPC transport/authentication/version compatibility, scoped ingress credentials, Odoo-specific order/accounting helpers and action registration. Domain execution lives in the Odoo modules listed above. |
| Helpdesk Odoo | `src/lib/odoo.ts`, `src/app/actions/contact.ts`, `src/app/actions/tickets.ts`, `src/app/api/tickets/attachments/route.ts` | Separate env-configured JSON-RPC integration for public contact/support; do not merge blindly into workspace client. |
| Shopify | `src/lib/shopify-client.ts`, `src/lib/shopify-topics.ts`, Shopify HTTP routes | Existing third-platform behavior. Field catalogues, subscribed topics and configuration are deliberately distinct. |
| ERPNext | `src/lib/erpnext-engine.ts`, `src/app/actions/custom-fields-erpnext.ts` | REST transport and custom DocType mapping under `src/lib/erpnext/`. |
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

Store modules and destination modules depend on focused helpers and shared types. The Odoo relation and bill-of-materials code receive their orchestration callbacks from the composition root in `sync/mappings.ts`. `sync-runtime.ts` owns shared logging and database access.
