# Ingress, infrastructure and dependency audit

Inspected source on 2026-11-03. Read-only analysis; no external or database requests. Severity below expresses refactoring/regression risk and maintenance impact, not an assertion of an exploitable vulnerability.

## Existing system and useful boundaries

- Next App Router handlers receive HTTP traffic; exported async Server Actions implement most browser-driven operations. Clerk supplies the user string. `ADMIN_USER_IDS` is evaluated by `src/lib/auth.ts:11`; active user handles admin impersonation and active workspace resolves `users.active_workspace_id` (`auth.ts:34,59`).
- Supabase JS REST is the runtime database path (`src/lib/supabase.ts`). Production requires service-role key; development may fall back to anon with a warning. The custom fetch rejects mutations during impersonation. Because service-role access bypasses RLS, explicit workspace/store predicates remain application-level boundaries.
- Actual queue: Supabase `sync_queue`/`webhook_inbox`, not Redis/Bull. Durability, coalescing and admission are centralized in `enqueueWebhookEvent` (`src/lib/sync-queue.ts:401`). Partial unique indexes in SQL migrations provide atomic pending-delivery dedup; do not replace them with an in-memory check.
- `src/lib/webhook-inbox.ts:116` rescues pending rows with a known workspace; null-workspace orphans require explicit recovery. Rescue inserts retain retry budget 5; failed receipt draining stops after 10 attempts. Completion and pruning are separate operations.
- `src/instrumentation.ts` starts long-lived Node runners outside production build and Vercel: sync queue, Telegram polling, Telegram outbox. `src/lib/sync-queue-runner.ts` uses guarded intervals: default queue/inbox pass 30s, Zid reconciliation 10min, archive pass 6h. Production queue runner requires `SYNC_QUEUE_SELF_RUNNER=true`. Stop functions are legitimate lifecycle APIs, not dead code.
- Queue controls include concurrency 10, per-workspace 3, batch 50, default 120s item timeout, retry/backoff/jitter, fair fetch, atomic lease, circuit breaker, dead-letter archival (`src/lib/sync-queue.ts:33,654,819,959,1117,1195,1319`). Preserve their relative ordering.
- Odoo workspace XML-RPC belongs in `src/lib/odoo-client.ts`: cached credential-specific UID, HTTP agents, 10s RPC timeout and runtime version discovery. `src/lib/odoo.ts` is a different env-configured JSON-RPC client for helpdesk/support. They are not interchangeable duplicated clients.
- Zid token store/refresh lock in `src/lib/zid/token.ts:42,119,188`; Salla merchant refresh lock and single-use refresh handling in `src/lib/salla-client.ts:33,111`. Keep lock identity, timing, response envelopes and credential storage unchanged.
- Shared ingress helpers are already cohesive: `webhook-secret.ts`, per-platform verifier modules, `webhook-strict.ts`, `ingress-admission.ts`, `ingress-batch.ts`, `webhook-gate.ts`, `webhook-skip-log.ts`. A new generic plugin/interface framework would add little value here.

## Findings with evidence

| Severity | Finding | Evidence and disposition |
| --- | --- | --- |
| High | Background Odoo product synchronization is owned by an HTTP route and imported back by queue infrastructure. | `src/app/api/webhooks/odoo/route.ts:222` exports `runBackgroundSync`; `src/lib/sync-queue.ts:1049` imports that route; route `:185` imports queue. This creates a runtime dynamic dependency cycle and ties transport to external-write business logic. Valuable future extraction to an Odoo/domain service, but not a safe blind move: characterize read-success/read-empty/read-error, authenticated deletion, all platform create/update/removal branches, skip logs and worker outcomes first. |
| Medium | Existing static auth/database dependency cycle. | `src/lib/auth.ts:5` imports Supabase; `src/lib/supabase.ts:3` imports `checkImpersonationWriteBlock` from auth. Initialization currently works through deferred use, but moving imports/functions can alter it. Document; do not silently rewrite impersonation semantics. |
| Medium | Zid route mixes transport, lifecycle subscription/token handling, tenant resolution and five entity handlers. | `src/app/api/webhooks/zid/route.ts:64` POST; handlers at `:777,835,893,951,1019`; token resolution `:737,757`. The repeated gate/enqueue pattern is not mechanically identical: order arrival notifications and category identity handling differ. Keep these differences; extract only under route characterization. |
| Medium | Important tests inspect source strings/paths rather than execute complete handlers. | `tests/unit/odoo-webhook-trust.test.ts`, `odoo-webhook-auth.test.ts`, `ingress-batch.test.ts`, `sync-queue-races.test.ts` use `readFileSync`/regex. These pin useful invariants but do not prove serialized HTTP output, SDK call order under faults, concurrent behavior or complete outbound payload parity. Moving code requires retargeting each pin and preserving its self-check, plus executable mocked coverage. |
| Medium | Documentation contains historical contradictions and overbroad comments. | `AGENTS.md` says auth NextAuth shim deleted, while `src/app/api/auth/[...nextauth]/route.ts` exists and returns 404. It both says Prisma removed and later says it remains; current `package.json` has no Prisma. Early affiliate columns claims are superseded by later purge sections. Broad cron/reconciliation comments exceed actual Zid-only implementation. Treat inspected source/SQL as current evidence; retain historical instructions rather than rewriting unrelated history. |
| Medium | Migration fallbacks and distributed transaction boundaries matter. | `src/lib/sync-queue.ts:605` and `src/lib/webhook-inbox.ts:186` support absent dedup columns; receipt/queue/receipt completion are separate REST operations, not one DB transaction. Do not claim a new transaction abstraction preserves behavior without fault-injection tests. No migration completeness was checked against a live DB. |
| Low | Stale trust comments describe retired shared-secret risks after per-scope auth was introduced. | Odoo stock route introductory comment still mentions a shared secret, while actual `authorizeOdooWebhook` uses `odooStockSecretScope(workspaceId)` before DB lookup (`src/app/api/webhooks/odoo/stock/route.ts:98`). Generic Odoo worker comments mention skipping a redundant read while current code always reads. Documentation should describe execution, not repeat stale comments as facts. |

## Behavior that must remain deliberate

1. Odoo body is a trigger. `runBackgroundSync` reads mapped values from the tenant's ERP. Read failure returns retryable failure; successful empty read permits removal only when `authStatus === 'ok'`, with match-field-only body use. Existing record means body deletion signals are ignored. Stock quantities are also reread from Odoo.
2. `isWebhookEventEnabled` accepts only Zid/Salla/Shopify; adding a pretend Odoo call would not implement a real business gate. Generic and stock Odoo routes have different execution/drain behavior; do not unify during cleanup.
3. Per-store settings take precedence over platform defaults. `webhook-gate.ts` caches for 30s and keys by workspace/platform/store/entity. Preserve cache scope and invalidation behavior.
4. Legacy verification acceptance is migration compatibility; destructive unauthenticated uninstall/deletion branches remain guarded. Rejecting all legacy deliveries is a separate deployment/product change.
5. Durable receipt precedes queue insert; HTTP status distinctions and known invalid/sentinel branches remain as documented in [api-contracts.md](api-contracts.md). Store enrichment stays in the worker.
6. Odoo registrations are create-before-delete; Zid delete-before-create; Salla subscribe/upsert. These reflect actual platform differences, not inconsistent style.
7. Authenticated ingress is not blanket rate-limited at 120/min. Anonymous bucket, per-workspace overflow lane, global overload 503, fairness and worker concurrency are separate controls.
8. Reconciliation currently heals Zid orders only. No new Salla/product reconciliation belongs in a behavior-preserving refactor.

## Verification required before future moves

- Mock request/response characterization for each platform's authenticated, invalid, legacy, malformed, disabled, stale, unlinked, duplicate/coalesced and storage-error branches, including exact status/body keys.
- Mock queue concurrency tests for lease competition, merge-during-processing, timeout, retry increment compare-and-set, circuit breaker and settlement. Current source assertions are not a substitute for execution.
- Mock complete Odoo outbound worker tests with `OdooClient`, Zid/Salla/Shopify clients and the existing Supabase mock; prove no external call happens in read-error/unauthenticated-removal branches and prove logs/outcomes agree.
- Mock OAuth tests proving session/workspace resolution occurs before token exchange, state cookies remain exact, multi-store linking is preserved and all existing JSON/redirect branches remain compatible.
- Run targeted tests plus whole-project type-check/lint/test/build after a move. Build should not boot runners (`NEXT_PHASE` guards). Do not run admin self-tests, rehearsal drains, webhook refresh or live sync against production during this task.

`jest.config.js` maps all Supabase alias/relative-depth forms to `tests/mocks/supabase.ts`; retain these rules. Tests that start showing Postgres errors or network latency may have escaped the mock and must be stopped and investigated.

No live tenant isolation, production migrations, token expiry/refresh, external webhook delivery, deployed runner health or Odoo compatibility was validated by this audit.
