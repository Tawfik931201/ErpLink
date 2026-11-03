# ERPlink architecture overview

Reviewed locally on 2026-11-03. This describes source structure, not a live deployment verification. See [architecture-audit.md](architecture-audit.md), [refactoring-plan.md](refactoring-plan.md), [module-map.md](module-map.md), and [api-contracts.md](api-contracts.md).

## Runtime and boundaries

ERPlink is a Next.js App Router application written primarily in TypeScript, with React pages/components, Server Actions under `src/app/actions/`, and HTTP handlers under `src/app/api/`. The actual dependency versions are in `package.json` and `package-lock.json`; this work does not upgrade them. Zid and Salla are the main commerce integrations; Shopify and an ERPNext execution path also exist and must retain their current behavior.

Clerk provides authentication. `src/lib/auth.ts` resolves active user/workspace and admin impersonation; the application applies its own admin and tenant checks. Runtime database access is Supabase JS REST with service-role credentials. Schema definitions and migrations are in `supabase/migrations/`; no ORM repository layer is introduced here. `src/lib/sync-runtime.ts` separately owns the sync service-role client and `logSync`, while `src/lib/supabase.ts` provides the application client with its impersonation write guard. Their different behavior is retained.

The UI is frozen for this refactor: page markup, labels, CSS, routes, component APIs and response shapes remain unchanged. Manual subscription billing is independent of integration processing; affiliate/commission/Stripe flows must not be reintroduced.

## Data flow

```text
Zid / Salla / Shopify
    -> platform webhook route: verify, classify, resolve store/workspace, settings gate
    -> durable webhook_inbox receipt
    -> atomic receipt-to-job dispatch: pinned ERP target and permanent receipt marker
    -> sync_queue: distinct deliveries, fenced leases, retries / unknown-outcome quarantine
    -> background worker
    -> sync-engine.ts: enrich payload, resolve mapping, map values, execute Odoo operation
    -> OdooClient XML-RPC
    -> sync_logs + durable entity links; Telegram notifications via outbox

Odoo automated actions
    -> /api/webhooks/odoo or /api/webhooks/odoo/stock
    -> scoped verification, durable receipt and queue
    -> record worker in Odoo route / stock-sync-engine.ts
    -> reread authoritative values from tenant Odoo
    -> platform API product/stock operations

Browser manual import
    -> Server Action startInitialTransfer in transfers.ts
    -> paginated platform client reads
    -> existing mapping / matching / Odoo writes
    -> data_transfers and notification results
```

`src/instrumentation.ts` boots the queue runner, Telegram poller and Telegram outbox runner for a long-lived Node runtime outside build/Vercel. The queue runner drains inbox before processing queue jobs. New durable receipts pin the ERP connection and credential generation; atomic SQL dispatch links each to one job. Renewable lease tokens fence settlement/retries, expired leases are quarantined, and Send Now cannot steal a lease. Distinct accepted deliveries are retained rather than entity-coalesced. See `docs/reliability/webhook-audit.md` and migration `20261103155209_durable_webhook_execution.sql` for rollout and recovery limits. Production requires `SYNC_QUEUE_SELF_RUNNER=true`; cron HTTP handlers remain available as separate operational entry points. Reconciliation currently polls Zid orders only. Store routes generally trigger immediate development-only drains; Odoo stock retains a production fire-and-forget drain. These differences are intentional preservation points.

Unlinked store deliveries are stored as orphan receipts rather than guessed into another workspace. The normal inbox drain excludes null-workspace rows; admin recovery is explicit. Verified bodies are not interchangeable with authoritative ERP reads: Odoo record/stock pushes reread Odoo values, and deletion requires the existing authentication conditions.

## Domain organization after bounded extraction

This is an incremental organization step, not completion of a full domain architecture. Four focused responsibilities now have direct destination files:

| Domain | Focused file | Boundary |
| --- | --- | --- |
| Products | `src/lib/products/variants.ts` | Existing cross-platform variant payload normalization. |
| Customers | `src/lib/customers/company-fields.ts` | Existing customer company-field derivation/injection. |
| Categories | `src/lib/categories/mapping-overrides.ts` | Existing category-specific mapping override lookup and merge behavior. |
| Orders | `src/lib/orders/fulfillment-items.ts` | Existing fulfilled-item extraction from payload shapes. |

These helpers do not import `sync-engine.ts`. Existing public exports/import paths are preserved where required. They do not introduce generic repositories, a new integration protocol, or a plugin system.

`src/lib/sync-engine.ts` remains the large orchestrator and still owns important product, partner, category and Sales Order operations. In particular, `buildOrderLineItems`, `buildOdooValues`, `processWebhookEvent`, `processSingleMapping` and `executeOdooOperation` remain there. The generic Odoo route still owns the outbound `runBackgroundSync` worker. Moving these coupled writes requires executable characterization of their error, fallback and side-effect ordering before a later stage.

Existing cohesive modules stay in place: `returns/`, `odoo/order-currency.ts`, `odoo/order-payment.ts`, `odoo/analytic-distribution.ts`, per-platform webhook verifiers, field catalogues, mapping settings, entity links and queue infrastructure. More folders alone would not improve their separation.

## Limits of this review

The subsequent functional reliability audit is recorded in [webhook-audit.md](../reliability/webhook-audit.md), [tenant-isolation-audit.md](../security/tenant-isolation-audit.md), and [erp-routing-audit.md](../integrations/erp-routing-audit.md). It adds `src/lib/workspace-access.ts` as the current ownership/membership check for persisted active workspace selection, used by auth/user/default workspace resolution and OAuth callbacks. Mapping-specific ERP lookups reassert workspace ownership and reject missing explicit targets. ERPNext matching now receives the resolved platform. Queue deletion is conditional on observed row state; this does not add a durable effect ledger or solve ambiguous remote outcomes. See [final-reliability-report.md](../reliability/final-reliability-report.md) for validation and remaining risks.

Source inspection and mocked tests can establish local behavior and dependency boundaries. They do not establish successful real merchant authentication, token rotation, external delivery, migration state, payment/accounting correctness in a live Odoo instance, or operational readiness. Validation results and remaining deferred work belong in the audit/refactoring reports; no production synchronization or deployment is part of this work.
