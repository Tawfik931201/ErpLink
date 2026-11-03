---
name: erplink-architecture
description: Navigate the actual ERPlink codebase, locate domain and platform responsibilities, and plan or perform behavior-preserving refactoring with relevant tests. Use for ERPlink integration development, architecture questions, and maintenance; not for unrelated Next.js projects.
---

# ERPlink Architecture

Find the existing execution path before proposing a change. This is a repository-local guide; it grants no permission to mutate provider accounts, deploy, or expand the user's task. All code paths below are relative to the repository root. Verify symbols in current source rather than relying on fixed line numbers or historical test counts.

## Establish context

Locate the repository root and read applicable [AGENTS.md](../../../AGENTS.md) instructions. Confirm this is ERPlink using `package.json`, `src/lib/sync-engine.ts`, and the domain paths below. If paths have moved, search their symbols with `rg` and update the task's map; do not create replacement files merely to match this guide.

Read [overview.md](../../../docs/architecture/overview.md) for the runtime/data flow and the relevant section of [development-guide.md](../../../docs/architecture/development-guide.md) for the task. Use [module-map.md](../../../docs/architecture/module-map.md) for additional responsibilities. Load other documents only when needed:

- HTTP/webhook/OAuth changes: [api-contracts.md](../../../docs/architecture/api-contracts.md).
- Refactoring a coupled flow: [architecture-audit.md](../../../docs/architecture/architecture-audit.md), [ingress-audit.md](../../../docs/architecture/ingress-audit.md), and [refactoring-plan.md](../../../docs/architecture/refactoring-plan.md).
- Previous checks and their limits: [validation.md](../../../docs/architecture/validation.md). These are historical results, not evidence that the current working tree passes.

ERPlink uses Next.js App Router, TypeScript, Clerk user IDs and Supabase REST. `src/app/actions/` contains Server Actions; `src/app/api/` contains HTTP handlers. Schema history belongs to `supabase/migrations/`. Inspect current manifests for versions; do not infer an ORM, Redis/Bull queue, or additional services from architectural conventions.

## Locate the responsibility

The four extracted domain helpers are bounded functions. Most domain writes still live in `src/lib/sync-engine.ts`; do not assume complete domain services or repositories exist.

| Task | Start here; then trace callers |
| --- | --- |
| Product payload variants | `src/lib/products/variants.ts`: `extractGenericVariants`; original export remains available from `src/lib/sync-engine.ts`. |
| Odoo product creation/update, variants, BoM | `src/lib/sync-engine.ts`: `executeOdooOperation`, `syncAsSeparateProducts`, `syncChildAsSeparateProduct`, `syncAsVariants`, `syncChildVariantAsVariant`, `syncProductBom`. Manual mapping CRUD: `src/app/actions/product-mappings.ts`. |
| Customer company/tax fields | `src/lib/customers/company-fields.ts`: `injectCustomerCompanyFields`. Partner mapping, relation creation and matching remain in the engine: `buildOdooValues`, `resolveSingleRelationId`, `findExistingOdooRecord`, `executeOdooOperation`. |
| Bulk customer/product/category import | `src/app/actions/transfers.ts`: `startInitialTransfer` → `runTransferInBackground`. Salla customer pagination calls `listSallaCustomers` in `src/lib/salla-client.ts`; `src/app/actions/salla.ts` handles locations/payment methods instead. Bulk import and webhook processing are separate paths. |
| Category mappings and parents | `src/app/actions/category-mappings.ts` handles mapping CRUD/import; `src/lib/categories/mapping-overrides.ts`: `applyCategoryMappingOverrides` reads overrides. Parent resolution stays in engine `resolveSingleRelationId`. |
| Sales Order creation/update | Engine `executeOdooOperation` → `safeCreateOdooRecord` / `safeWriteOdooRecord`. Lines: `buildOrderLineItems`; existing-order guards: `prepareSaleOrderForUpdate`, `normalizeOrderLinesForUpdate`; taxes: `ensureSaleOrderTaxes`. |
| Order fulfillment/payment/currency/returns | `src/lib/orders/fulfillment-items.ts`: `extractFulfilledItems`; `src/lib/zid/order-helpers.ts`; `src/lib/odoo/order-payment.ts`, `order-currency.ts`, `analytic-distribution.ts`; `src/lib/returns/engine.ts`. Status/invoice/picking orchestration remains in the engine. |
| Inbound store sync | Platform webhook route → `src/lib/sync-queue.ts` → engine `processWebhookEvent` → preset or `processSingleMapping` → Odoo execution. Inspect enrichment and custom/preset callers before changing shared helpers. |
| Odoo → store products/stock | `runBackgroundSync` in `src/app/api/webhooks/odoo/route.ts`; stock execution in `src/lib/stock-sync-engine.ts`, stock ingress in `src/app/api/webhooks/odoo/stock/route.ts`. |

## Platform and infrastructure boundaries

- **Zid:** `src/lib/zid-client.ts`; `src/lib/zid/auth.ts`, `token.ts`, `config.ts`, `webhooks.ts`, `webhook-auth.ts`. Preserve the two-header merchant credentials, refresh locking and Basic webhook verification already implemented there.
- **Salla:** `src/lib/salla-client.ts` owns transport, token refresh, entity reads and registration; `src/lib/salla/webhook-auth.ts` owns native/derived ingress checks. Keep raw-body verification and the published event catalogue; do not borrow Zid's payload/auth rules.
- **Odoo:** `src/lib/odoo-client.ts` is the workspace XML-RPC client. `src/lib/odoo.ts` is a separate environment-configured JSON-RPC client for support/helpdesk. Do not merge them as duplicates. Scoped ingress checks live in `src/lib/odoo/webhook-secret.ts`; registration in `src/lib/odoo-webhook.ts`.
- OAuth routes are under `src/app/api/zid/`, `src/app/api/salla/`, `src/app/api/shopify/`; ingress routes are under `src/app/api/webhooks/`. Keep existing URLs and response branches during internal moves.
- Queue durability/retry: `src/lib/sync-queue.ts`, `webhook-inbox.ts`, `ingress-admission.ts`, `ingress-batch.ts`. Boot: `src/instrumentation.ts`; scheduling: `src/lib/sync-queue-runner.ts`; reconciliation: `src/lib/reconciliation.ts`. Do not assume external cron replaces the in-process worker.
- Mapping settings/events/IDs: `src/lib/mapping-settings.ts`, `event-operation.ts`, `webhook-gate.ts`, `platform-fields.ts`. Preserve per-store/default precedence and workspace/platform/store scope.
- Existing Shopify and ERPNext support must survive Zid/Salla/Odoo maintenance. Shared sync types/helpers/runtime already live in `src/lib/sync-types.ts`, `sync-helpers.ts`, `sync-runtime.ts`. New domain helpers must not import the engine back. Existing dependency cycles are documented in the audit; do not add cycles or silently rewrite auth initialization.

## Safe change workflow

Check `git status` and the current diff first. Preserve pre-existing work and identify a checkpoint; use an isolated branch when suitable. Trace entrypoint → mapper/matching → external operation → persistence/logging, including webhook, job, manual and dynamic callers. Do not delete a function based only on an ordinary import search.

For internal refactoring, preserve UI/JSX/styles/text, component APIs, routes, request/response shapes, schema, environment names, dependency versions and business behavior. A future task may explicitly authorize a functional change; keep it scoped and distinguish it from a move. Manual billing remains separate; do not reintroduce affiliate/Stripe flows.

Before moving sensitive logic, run relevant baseline tests and add fixture/mock characterization where coverage is insufficient. Source-pin suites inspect exact files and strings: follow their referenced code, preserve negative/self-checks, and add execution coverage rather than weakening pins to accommodate a move. Keep public imports compatible and compare moved implementations and call arguments. Review new dependency edges, then validate each bounded stage before proceeding.

Preserve Odoo version/field probes, exception-driven legacy fallbacks, explicit mappings, platform IDs, tax/currency/discount calculations, stock authority, tenant filters, dedup and retry ordering. Odoo webhook bodies are triggers; retain the authoritative ERP readback and authenticated removal rules. Keep durable receipt-before-acknowledgement and existing platform-specific registration strategies.

Full Sales Order and outbound Odoo worker extraction remains a separate high-risk migration requiring mocked RPC call-sequence and failure coverage. If a portion cannot be verified, stop that portion, document the gap, and continue independent safe work. Do not correct historical matching, fulfillment, billing-date or auth quirks incidentally. Obtain approval before an unapproved high-risk or irreversible step; this skill adds no approval requirement for ordinary reversible work already authorized by the user.

## Select and run checks

Use the actual test files under `tests/unit/`. The following are starting subsets; add tests for other reachable responsibilities. The development guide has the broader matrix.

| Changed area | Starting test files |
| --- | --- |
| Products/variants | `product-variants.test.ts`, `odoo-product-registration-versions.test.ts`, `platform-fields.test.ts`; stock changes: `stock-sync-engine.test.ts`. |
| Customer values/import | `customer-company-fields.test.ts`, `build-odoo-values-mobile.test.ts`, `build-odoo-values-datetime.test.ts`, `sync-workspace-scoping.test.ts`. Full bulk-import behavior still needs dedicated coverage before extraction. |
| Categories | `category-overrides.test.ts`, `salla-category-parent.test.ts`, `mapping-settings.test.ts`, `sync-workspace-scoping.test.ts`. |
| Orders | `order-fulfillment-items.test.ts`, `order-tax-inclusive-sync.test.ts`, `order-multi-currency.test.ts`, `odoo-order-payment.test.ts`, `order-status-actions.test.ts`; extend with tax/discount/pricelist/analytics/return suites for the touched path. |
| Ingress/queue | `zid-webhook-auth.test.ts`, `salla-webhook-auth.test.ts`, `odoo-webhook-auth.test.ts`, `odoo-webhook-trust.test.ts`, `ingress-durability.test.ts`, `sync-queue-dedup.test.ts`, `sync-queue-races.test.ts`, `no-loss-regression.test.ts`. |

Run a selected suite with `npm test -- --runInBand --runTestsByPath tests/unit/product-variants.test.ts`, substituting verified paths. Required code-refactoring stage gates are:

```sh
npm run type-check
npm run lint
npm test -- --ci --runInBand
npm run build
git diff --check
```

Run heavy gates sequentially when local resources are limited. For documentation/skill-only work, check links, paths and the relevant format validator; do not claim application gates were rerun.

Never test using production data or live provider writes. `jest.config.js` maps `src/lib/supabase.ts` imports to `tests/mocks/supabase.ts`, but `src/lib/sync-runtime.ts` constructs a **separate** `supabaseAdmin` client. Explicitly mock that module when exercising its DB paths; `tests/unit/order-tax-inclusive-sync.test.ts` shows the existing pattern and scoped query assertions. Mock external clients too. Investigate unexpected Postgres errors, retries or timeouts before rerunning; do not merely increase timeouts. Build with process-local non-production placeholders and ensure runners/provider traffic cannot mutate real state; keep `.env` files intact. Admin pipeline self-tests, webhook refresh, queue drains and live sync are not offline validation commands.

Report changed files and purpose, actual checks/results, baseline failures, and unverified integration behavior. Update the relevant architecture document when responsibility moves. Passing build or historical test counts do not establish real merchant/Odoo compatibility.
