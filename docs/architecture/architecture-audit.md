# ERPlink architecture audit

Reviewed 2026-11-03 against checkpoint `2019abe`, on `codex/architecture-safe-refactor`. The working tree was clean before work. This is a source review and offline validation, not verification against merchant accounts. No dependency, schema, route, UI, or integration policy changes are authorized by this refactor.

## Current system

- Next App Router under `src/app`, TypeScript, React; `package.json` requests Next `^15.5.28`, React `^19.3.0`, Clerk `^6.39.7`. Historical version statements in AGENTS.md are not an installed-version inventory.
- Clerk identifies users; `src/lib/users.ts`, `auth.ts`, and workspace actions resolve access. Supabase REST with service-role credentials is the runtime database path; migrations describe schema. There is no runtime ORM layer to reorganize.
- `src/lib/zid-client.ts`, `salla-client.ts`, `shopify-client.ts`, and `odoo-client.ts` already centralize platform transport. Zid additionally separates config, auth, tokens, registration and webhook credentials under `src/lib/zid/`. Odoo merchant sync uses XML-RPC; `src/lib/odoo.ts` separately provides environment-configured JSON-RPC for contact/helpdesk. These are different consumers, not interchangeable duplicates.
- `src/lib/sync-engine.ts` mixes mapping, enrichment, entity matching, category configuration, product variants/stock/BOM, partner fields, order lines, order state/invoice/delivery and orchestration. `erpnext-engine.ts` is another supported destination; Shopify is also present and must survive a Zid/Salla-focused review.
- Manual import: `src/app/actions/transfers.ts` → platform list clients → mapping/matching → Odoo create/write. Webhook sync: route → durable inbox/queue → worker → `processWebhookEvent` → preset/custom mapping → `executeOdooOperation`. Manual import is a distinct path, not a call through every webhook rule.
- Long-lived Node workers start from `src/instrumentation.ts`. `sync-queue-runner.ts`, `sync-queue.ts`, `webhook-inbox.ts`, `reconciliation.ts`, and Telegram modules own background scheduling and recovery. Cron endpoints are available; they are not proof that external scheduling is configured.
- Billing is manual; affiliate and Stripe flows must not return. Shared types/helpers/runtime and platform field catalogues already have useful boundaries.

## Findings and decisions

Line references below describe the checkpoint, before extraction. Locate functions by name after moves.

| Severity | Evidence | Implication and disposition |
| --- | --- | --- |
| High maintenance risk | `sync-engine.ts`: `buildOrderLineItems` (~1264), `executeOdooOperation` (~7197), `findExistingOdooRecord` (~8826) | Large, interconnected financial and idempotency flow. Keep writes, matching, tax, state and retry order intact; a full split requires mocked orchestration coverage first. Size alone is not evidence of duplicate logic. |
| Medium | `extractGenericVariants` (~824), `injectCustomerCompanyFields` (~7172), `applyCategoryMappingOverrides` (~95), `extractFulfilledItems` (~3795) in the same engine | Bounded domain responsibilities can be extracted verbatim after characterization. No repository class, plugin registry or pass-through service needed. |
| High maintenance risk | `src/lib/sync-queue.ts` dynamically imports `runBackgroundSync` from `src/app/api/webhooks/odoo/route.ts`; route enqueues back into queue | Library depends on a route and outbound business logic lives in handler file. Defer service extraction: trust/readback/delete/retry behavior needs broader mocked tests. |
| Medium | `src/lib/auth.ts` imports Supabase; `src/lib/supabase.ts` imports impersonation guard from auth | Existing circular dependency. Do not change initialization as incidental cleanup. Check newly introduced domain modules for back-imports into engine. |
| Requires separate functional review | `findExistingOdooRecord` sync_logs lookup (~8858) filters workspace/entity/model/status, with optional store, but not platform despite nearby comment | Comment overstates the query guarantee. Permanent `odoo_entity_links` lookup does include platform and store, but runs later. Potential same-workspace cross-platform collision must be assessed separately; no filter is added during behavior-preserving work. |
| Requires separate functional review | `src/app/actions/transfers.ts`, `runTransferInBackground`, `odoo_to_store` branch (~414 onward) | Existing outbound bulk path uses Zid API calls. Do not assume selecting another platform gives symmetric outbound import behavior or silently add Salla/Shopify writes during this refactor. Characterize supported combinations separately. |
| Medium coverage gap | `tests/unit/*` has many source-pin suites for orders, ingress and tenant safety; no complete manual transfer simulation | Passing source scans is not proof that XML-RPC writes are equivalent. Keep transfer and core order code in place. |
| High test-isolation risk | `order-tax-inclusive-sync.test.ts` mocks Odoo but imports engine → `sync-runtime.ts`, whose `supabaseAdmin` is constructed directly | The Supabase alias mapper protects `supabase.ts`, not this second client. The all-line-types baseline test times out even alone under blocked provider transport. Missing `shipping.title` falls back to the shipping object in `resolvePath`, causing a carrier-mapping query. Add a scoped test mock for sync runtime; preserve all financial assertions and production code. A blocked transport prevents actual provider access during this review. |
| Low documentation risk | AGENTS.md contains chronological and sometimes superseded statements about ORM, scheduling, versions and test counts | Preserve historical instructions; add an explicit current navigation section linking checked source and current validation. Do not treat historical production observations as live verification. |

## Behavior that must survive extraction

- Variant precedence uses truthiness for prices/IDs and nullish checks for quantity/weight. Zid never treats option definitions as variants; Salla/Shopify have different option handling.
- Customer injection copies the values object; only undefined target fields are filled. `null`, empty and false mapped targets stay untouched. Sentinel text is case sensitive.
- Category override lookup stays scoped by workspace/platform, uses case-insensitive name matching and per-store/default fallback, and fails softly with the same logging. Preserve numeric/truthiness distinctions.
- Fulfillment extraction returns from the first nonempty candidate array even if every row filters out. The existing nonempty `fulfillments` path shadows nested Shopify parsing; pin this quirk rather than correcting it.
- All route statuses, response bodies, webhook raw-body checks, external IDs, tenant filters, queue receipts, coalescing, retries and environment names remain fixed. See `api-contracts.md` for the ingress inventory.

## Scope and limits

All tracked source/config/test/document paths are inventoried; focused semantic inspection covers integration entrypoints, shared infrastructure and the proposed extraction call graph. This is not a claim of line-by-line proof of every component or all Odoo versions. No unused function is removed without dynamic/job caller proof. UI files remain byte-identical; no browser screenshots or live provider smoke tests are claimed. Baseline/final results and unresolved gates are recorded in `validation.md`.
