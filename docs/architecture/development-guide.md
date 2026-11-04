# Practical development guide

Use this map before changing integration behavior. This refactor freezes UI and external contracts; future functional changes require their own explicit scope. Read repository `AGENTS.md` first, then [overview.md](overview.md), [module-map.md](module-map.md), [api-contracts.md](api-contracts.md) and the relevant tests. No guide command below requires a live sync.

## Where to change a specific operation

### Product synchronization

Start with `src/lib/sync-engine.ts`: `processWebhookEvent` resolves/enriches inbound events; `processSingleMapping` and `executeOdooOperation` execute mappings. Product mode logic remains in `syncAsSeparateProducts`, `syncChildAsSeparateProduct`, `syncAsVariants`, and `syncChildVariantAsVariant`. Payload variant extraction lives in `src/lib/products/variants.ts`; product naming in `src/lib/product-name.ts`. Product BoM creation remains `syncProductBom` in the engine.

For merchant transport inspect `src/lib/zid-client.ts` or `src/lib/salla-client.ts`; for manual mapping CRUD use `src/app/actions/product-mappings.ts`. Stock propagation has its own `src/lib/stock-sync-engine.ts` and `src/app/actions/inventory-sync.ts`. An Odoo-to-store product change currently belongs to `runBackgroundSync` in `src/app/api/webhooks/odoo/route.ts`, not the inbound product helper. Preserve variant-mode distinctions and external-ID fallback ordering.

### Creating a Sales Order or changing order lines in Odoo

The actual Sales Order write path remains in `src/lib/sync-engine.ts`, in `executeOdooOperation`, through `safeCreateOdooRecord`/`safeWriteOdooRecord`. Locate calls using the model and operation branch rather than looking for a hypothetical `OrderRepository`.

`buildOrderLineItems` builds Odoo line commands and resolves products, prices, discount/tax fields and existing mappings. `buildOdooValues` builds mapped fields. `prepareSaleOrderForUpdate` and `normalizeOrderLinesForUpdate` preserve current restrictions on existing/confirmed orders; changing those restrictions is a behavior change. `ensureSaleOrderTaxes`, status/picking/invoice actions and rules also remain in the engine. Fulfilled-item extraction alone moved to `src/lib/orders/fulfillment-items.ts`.

Use `src/lib/zid/order-helpers.ts` for Zid status/shipping/COD normalization; `src/lib/odoo/order-currency.ts`, `order-payment.ts` and `analytic-distribution.ts` for their existing dedicated responsibilities. Returns enter through `src/lib/returns/engine.ts` before ordinary writes. Do not combine order-create and order-update behavior or normalize configured analytic percentages during cleanup.

The order audit adds `src/lib/zid/order-enrichment.ts` for workspace/store token resolution, snapshot validation and fresh payload merging; `src/lib/orders/matching.ts` for checking sale-order link ownership; and `src/lib/odoo/order-invoice.ts` for the public invoice wizard used by Odoo 14–17. The orchestrator still owns status, picking and invoice dispatch. See [zid-orders-standard-mapping-audit.md](../integrations/zid-orders-standard-mapping-audit.md) for changes, version evidence and remaining integration limits.

Order references use `orders/related-matching.ts` to honor saved Customers/Products match fields even when their independent synchronization is disabled. `orders/line-product.ts` supplies scoped, bounded lookup caching. `orders/preflight.ts` validates the assembled Zid SO and batched related IDs before writing; `orders/customer-create.ts` shares a durable customer-create identity across orders. Zid writes do not retry after stripping rejected SO settings. `orders/action-results.ts` checks actual configured workflow outcomes; payment errors are surfaced rather than treated as an entirely successful sync. `processSingleMapping` delegates line preparation to the order executor so currency, VAT, fees and analytics are assembled once.

When an explicitly selected matching key is absent from the order, `zid/order-related-data.ts` reads the customer's/product's details within the store pull budget and deduplicates identical reads per execution client and store. Only matching uses the hydrated source: catalog prices and quantities never replace order line amounts.

### Importing Salla customers

`src/app/actions/transfers.ts`: `startInitialTransfer` validates workspace/ERP/store selection; `runTransferInBackground` paginates `listSallaCustomers` for customer imports. The actual merchant API reader is `listSallaCustomers` in `src/lib/salla-client.ts`, through its token/transport functions. Mapping, metadata and duplicate matching use `buildOdooValues`, `fetchFieldMeta` and `findExistingOdooRecord` from `src/lib/sync-engine.ts`.

Customer company fields now have the focused boundary `src/lib/customers/company-fields.ts`; generic Salla enrichment and `res.partner` relation creation still remain in the engine. Customer webhook processing and bulk import are separate entry paths; test both before assuming a helper affects both. Keep store selection, pagination and workspace predicates intact.

### Category linking

Manual rows and map operations: `src/app/actions/category-mappings.ts` (`getCategoryMappings`, `saveCategoryMapping`, `batchImportCategoryMappings`, `deleteCategoryMapping`, `fetchStoreCategories`). Category-specific execution overrides: `src/lib/categories/mapping-overrides.ts`. Parent-category resolution still lives in `resolveSingleRelationId` in `src/lib/sync-engine.ts`; Salla source numeric IDs are not Odoo category IDs.

The category audit adds `src/lib/categories/odoo-values.ts` for capability-based category value validation, typed matching, operation-local company context and non-destructive archive. Scoped Zid/Salla relations use `resolveStoreCategory` in the engine. Initial category imports share the category executor. See [category-standard-mapping-audit.md](../integrations/category-standard-mapping-audit.md) for behavior changes, version evidence and validation limits.

Read the current per-store/default settings in `src/lib/mapping-settings.ts` and category settings use sites before changing precedence. Saving a manual map already performs a best-effort Odoo match-field write; do not accidentally remove it when reorganizing persistence. Salla publishes category create/update, not a category deletion subscription.

### Webhook handling and retries

Transport/authentication/HTTP output starts in `src/app/api/webhooks/<platform>/route.ts`; stock uses `src/app/api/webhooks/odoo/stock/route.ts`. Platform verification lives in `src/lib/zid/webhook-auth.ts`, `src/lib/salla/webhook-auth.ts`, `src/lib/odoo/webhook-secret.ts`, or Shopify's existing route/client logic. `src/lib/event-operation.ts` classifies operations; `webhook-gate.ts` checks current mapping settings.

Durability/retry changes belong in `src/lib/sync-queue.ts` and `webhook-inbox.ts`; admission and batched persistence already have `ingress-admission.ts`/`ingress-batch.ts`. Enrichment and writes belong downstream in `processWebhookEvent` or the existing Odoo workers. Preserve authentication-before-lookup, durable receipt-before-acknowledgement, delivery-based dedup, mapping-aware coalescing, tenant scoping, retry budgets and exact error/status distinctions. See [api-contracts.md](api-contracts.md).

### Adding a future commerce platform

This is a new feature, outside the current refactor. Follow the actual existing boundaries: a dedicated transport/token client; OAuth entry/callback routes; authenticated ingress route; platform verifier; field/event catalogues under `src/lib/platforms/`; external-ID rules in `platform-fields.ts`; event classification in `event-operation.ts`; supported settings and queue/platform unions. Then integrate normalization and domain execution at their real engine call sites with explicit tests.

Adding one table row in `platform-fields.ts` alone does not add a working integration. Zid/Salla/Shopify have deliberately different identity, authentication, topics and payloads; do not generate a universal adapter that silently erases those differences. Avoid importing `sync-engine.ts` from newly extracted domain modules.

## Verification by change area

Run tests with mocks only. `jest.config.js` must continue routing every Supabase import form to `tests/mocks/supabase.ts`; use mock call/filter assertions, not customer data. New tests invoking transport or SDK methods must mock them explicitly. Do not invoke webhook refresh, pipeline self-test, load rehearsal/drain, manual transfer or cron against a real account as a substitute for unit tests.

| Area | Existing tests to inspect/run |
| --- | --- |
| Products/variants | `tests/unit/product-variants.test.ts`, `odoo-product-registration-versions.test.ts`, `platform-fields.test.ts`, `stock-sync-engine.test.ts`, `entity-links.test.ts`. Full product-create RPC coverage remains incomplete. |
| Customer values/import | `tests/unit/customer-company-fields.test.ts`, `build-odoo-values-mobile.test.ts`, `build-odoo-values-datetime.test.ts`, `shopify-customer-name.test.ts`, `sync-workspace-scoping.test.ts`. Full transfer pagination/duplicate-write characterization still needed before moving the bulk service. |
| Categories | `tests/unit/category-overrides.test.ts`, `salla-category-parent.test.ts`, `mapping-settings.test.ts`, `sync-workspace-scoping.test.ts`. |
| Orders | `tests/unit/zid-order-helpers.test.ts`, `odoo-order-payment.test.ts`, `order-multi-currency.test.ts`, `order-tax-inclusive-sync.test.ts`, `order-line-discount.test.ts`, `order-line-id.test.ts`, `order-vat-country-rules.test.ts`, `order-status-actions.test.ts`, `order-warehouse-location.test.ts`, `odoo-order-update-pricelist.test.ts`, `odoo-confirmed-order-pricelist.test.ts`, `analytic-distribution.test.ts`, `analytic-line-injection.test.ts`, return suites and focused fulfillment tests. |
| Ingress/queue/auth | `tests/unit/zid-webhook-auth.test.ts`, `salla-webhook-auth.test.ts`, `odoo-webhook-auth.test.ts`, `odoo-webhook-trust.test.ts`, `ingress-admission.test.ts`, `ingress-batch.test.ts`, `ingress-durability.test.ts`, `sync-queue-dedup.test.ts`, `sync-queue-races.test.ts`, `no-loss-regression.test.ts`, `webhook-terminal-receipts.test.ts`, `oauth-unauth-redirect.test.ts`, `api-hardening.test.ts`. |

The focused fulfillment suite is `tests/unit/order-fulfillment-items.test.ts`. Run a domain subset with `npm test -- --runInBand --testPathPattern=order`, or pass exact test paths to `--runTestsByPath`.

Required project gates after a stage:

```powershell
npm run type-check
npm run lint
npm test -- --runInBand
npm run build
git diff --check
```

The four npm gates are blocking CI jobs. Record actual results, separate pre-existing failures from new regressions, and do not claim real Odoo compatibility from build success. Some suites inspect source paths and regexes: a move may require updating the target path while preserving each invariant and its negative/self-check. Do not merely weaken a source assertion to make a move pass.

## Editing discipline

Keep existing `'use server'` modules as async public action boundaries; pure helpers belong in ordinary `src/lib/` modules. Keep established action names and response unions. Preserve source logic mechanically before considering any functional improvement. Do not move all engine responsibilities in one change, introduce pass-through repositories, alter schema/environment variables/dependency versions, or reformat the full tree. UI markup and styles are unchanged by this work; screenshots are not a claim of verification unless actually captured.

Before a future high-risk extraction, add executable mocks for complete create/update/delete and failure branches, including outbound payloads and side effects. The Sales Order orchestrator and Odoo outbound worker remain explicitly deferred for that reason.
