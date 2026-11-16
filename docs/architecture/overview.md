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
    -> sync/webhook.ts: validate target, prepare store payload, find mappings
    -> sync/mappings.ts: dispatch by the pinned ERP connection
    -> odoo/ (XML-RPC) or erpnext/ (REST custom mapping)
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

## Store and ERP execution

Store modules prepare data in `src/lib/zid/`, `src/lib/salla/` and `src/lib/shopify/`. The queue and `sync/webhook.ts` keep the existing workspace and store context. `sync/mappings.ts` applies Standard Mapping and then the matching custom mappings. It calls the executor for the validated connection type. The old `src/lib/sync-engine.ts` import path exports the same entry points.

Odoo owns destination field mapping, record matching and writes. Entity-specific preparation lives in `odoo/{products,categories,customers,order-values}.ts`. Order lines and post-write workflow have dedicated modules. ERPNext owns its REST client, DocType metadata, value mapping and record execution under `erpnext/`. Both destinations receive the prepared source payload with its original fields available to custom mappings.

ERPNext currently executes custom mappings. Its product path is exercised with mocked creation and update requests. Standard Mapping and manual import still use Odoo. The target resolver currently requires a unique active ERP connection per workspace. Workspaces with simultaneous ERP destinations would need explicit configuration and a pinned target per delivery.

The outbound Odoo route still owns `runBackgroundSync`. Odoo-to-store stock uses the existing stock engine. See the [module map](module-map.md) for the location of each inbound operation.

## Limits of this review

The subsequent functional reliability audit is recorded in [webhook-audit.md](../reliability/webhook-audit.md), [tenant-isolation-audit.md](../security/tenant-isolation-audit.md), and [erp-routing-audit.md](../integrations/erp-routing-audit.md). It adds `src/lib/workspace-access.ts` as the current ownership/membership check for persisted active workspace selection, used by auth/user/default workspace resolution and OAuth callbacks. Mapping-specific ERP lookups reassert workspace ownership and reject missing explicit targets. ERPNext matching now receives the resolved platform. Queue deletion is conditional on observed row state; this does not add a durable effect ledger or solve ambiguous remote outcomes. See [final-reliability-report.md](../reliability/final-reliability-report.md) for validation and remaining risks.

Source inspection and mocked tests can establish local behavior and dependency boundaries. They do not establish successful real merchant authentication, token rotation, external delivery, migration state, payment/accounting correctness in a live Odoo instance, or operational readiness. Validation results and remaining deferred work belong in the audit/refactoring reports; no production synchronization or deployment is part of this work.
