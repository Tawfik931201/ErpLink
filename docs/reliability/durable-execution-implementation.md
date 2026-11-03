# Durable webhook execution: implementation and verification

Date: 2026-11-03. This is the functional follow-up authorized after the user confirmed that the Supabase data, ERP connections and stores are test resources. It supersedes the proposal-only status in the initial audit. Application changes remain local until deployed; three migrations were applied to the application's verified Supabase project, `bnzkmoorrvtellesgvbq`. The other configured MCP project's database was not changed.

## Implemented boundaries

- Every normal delivery has its own durable receipt. A transaction locks that receipt, inserts one receipt-owned job and saves its permanent queue ID. The ID remains after successful queue-row deletion, preventing rescue from recreating completed work. New delivery identities remain retained beyond the old seven-day pruning window.
- Accepted business transitions are no longer destructively coalesced. Each job pins the owned ERP connection and credential/configuration generation. The worker revalidates store/workspace/connection relationships before constructing clients. Changed, deleted, disabled, foreign or ambiguous targets fail closed. Legacy unpinned data is retained for controlled recovery, not silently rebound.
- A separate lease token/expiry fences worker completion, failure, retry and heartbeat. Send Now bypasses scheduling delay only. SQL serialization prevents two active jobs for the same scoped entity; admission order prevents later transitions overtaking a pending predecessor. Other tenants/stores/connections stay independent.
- Timeout or expired lease retains the job as an unknown outcome instead of retrying potentially committed external writes. The late completion of an old worker cannot settle a different lease. Exhausted-job archive/replay preserves the original receipt, target and execution identity; ordinary retry cannot clear uncertainty.
- ERP create effects are reserved durably before Odoo/ERPNext creates. A duplicate reservation returns a known persisted ID, or blocks an uncertain/in-progress operation. A lost ERP response or failed result write cannot authorize another speculative create. Stable explicit identities separate product variants. Credential rotation does not reset business effect identity; queued credential generation is still validated separately.
- Connection-aware links/log matching excludes legacy unscoped identities. A workspace resource baseline prevents existing manual numeric mappings being silently applied after changing the ERP server/database/connection. This baseline contains no credentials. It does not retrospectively certify historical mappings.
- Odoo outbound processing verifies the pinned workspace/connection and resolves commerce platform from uniquely owned tokens rather than guessing Zid/Salla from an event name. Unsupported Odoo presets do not construct an Odoo client for ERPNext; custom ERPNext mappings remain supported.
- `withDurableWebhookResponse` wraps all five commerce/Odoo ingress handlers. It bounds the body while preserving the original verifier bytes and writes an encrypted recoverable copy before every 2xx, including disabled/unknown/lifecycle branches. It also captures returned 5xx when storage is available. No authorization headers or URL query credentials are stored. A failed recovery-copy write returns 503. Recovery copies are not automatically executable jobs.
- Zid reconciliation has per-store/connection progress, a persisted fixed window/page cursor, fair oldest-attempt rotation, bounded pages/request budget and no watermark advance on partial enqueue failure. It still covers Zid order snapshots, not every platform event.
- Admin queue health now includes unknown jobs, active leases, uncertain/in-progress ERP effects, durable response copies and schema readiness. No UI was changed. Preparation logs exclude full mapped customer/order values.

## Database changes actually applied

The local filenames match the recorded hosted migration versions:

1. `20261103155209_durable_webhook_execution.sql`: receipt/job targets, receipt-owned atomic dispatch, fenced claim/expiry RPCs, durable effect and encrypted acceptance tables, connection-aware link uniqueness, and private pre-change queue/inbox copies.
2. `20261103155613_durable_recovery_metadata.sql`: preserved dead-letter target identity and ordered scoped entity execution.
3. `20261103155839_erp_destination_baseline.sql`: uniquely selected workspace ERP resource baselines.

Before application, the first complete migration was validated inside a transaction ending in ROLLBACK. Pre-change counts were 5 queue rows and 564 inbox rows. Both counts were retained after migration, with private copies under `reliability_backup`; the 5 unpinned legacy jobs were parked rather than guessed or discarded. New tables/RPCs deny anon/authenticated access and are available to the service role. The actual database grant checks returned false for public dispatch/effect/acceptance access.

Security advisors show informational RLS-with-no-policy notices for service-only tables (intentional denial) and two pre-existing warnings: mutable search path on the unrelated log-search trigger and `pg_trgm` in public. See [Supabase search-path remediation](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) and [extension-schema remediation](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public). No blanket clean security-audit claim follows.

## Evidence

### Actual PostgreSQL tests on synthetic data

Both schema tests below ran successfully, then rolled back every fixture; they do not contact an ERP/store:

- [durable_webhook_execution.sql](../../supabase/tests/durable_webhook_execution.sql): authoritative receipt ownership, forged foreign connection rejection, 1,000 repeated dispatches, cross-tenant independent claims, active-lease protection under force, stale-token settlement refusal, expired-lease quarantine, no resurrection after successful queue deletion, scoped entity serialization and denied public privileges.
- [durable_webhook_load.sql](../../supabase/tests/durable_webhook_load.sql): 1,000 complete receipt/dispatch/claim/fenced-settle/replay cycles across three synthetic tenants; exact 1,000 retained receipts and zero resurrected queue rows.
- Eight concurrent SQL claim requests, through independent connector calls, targeted two jobs for one synthetic scoped entity. Exactly one claim succeeded, seven returned no claim, both rows remained retained and exactly one lease was active. These temporary committed fixtures were explicitly removed afterward; the synthetic user count returned zero. This tests real SQL contention, not a complete multi-process Node/ERP workload.

### Offline application tests

The new suites exercise three-tenant engine credential routing, forged/rotated/disabled targets, workspace access revocation, log scoping, atomic dispatch models, 100/1,000 job scheduling, 10,000-row batch results, explicit unknown-outcome handling, result-persistence failure, duplicate reservations, variant identity, credential rotation, late worker completion, manual recovery ownership, raw-body response fencing and resumable reconciliation. Existing pins were replaced only where the old destructive-coalescing/unfenced behavior was intentionally removed; new pins check receipt identity, token fencing and negative/mutation cases.

Final gates: type-check PASS; lint PASS (existing warnings remain); full Jest PASS, **107 suites / 1,330 tests**, 61.099 seconds; production build PASS, completed at **18:10 Cairo** on 2026-11-03; tracked diff whitespace check PASS. The first broad run during implementation found obsolete source pins and fixtures without the newly mandatory target context; these were corrected with stronger ownership assertions rather than restoring unsafe fallback behavior. Environment files and dependency versions were not changed. Gate processes use temporary placeholders, disabled runners and blocked external provider HTTP/fetch. New tests explicitly mock the separate sync-runtime database client. Raw local logs/results are in `%TEMP%/erplink-reliability-20261103/`; the three hosted migration versions match their local filenames.

## Practical guarantees and remaining limits

After deploying the matching application code and enabling a healthy worker, an HTTP success is fenced by a durable encrypted recovery copy, and ordinary work is receipt-backed. The tested queue cannot steal an active lease, reroute a pinned connection or forget its dispatch marker after queue deletion. These are tested mechanisms, not an unlimited availability or exactly-once claim.

Events that never reach the application, or requests whose database writes cannot commit, remain dependent on source resend/reconciliation. A full network/database outage cannot be solved with an HTTP acknowledgement. Unknown outcomes are intentionally retained and require external readback/operator reconciliation where an unambiguous result cannot be established. They are not reported as successfully synced.

The effect ledger covers trusted queued ERP creates. Related-create replay identity can still depend on lookup sequence; non-create ERP methods, outbound store writes, manual flows without the trusted context, and real provider commit/rollback semantics need further fault coverage. External exactly-once is not established. Successful create replay reuses its result; it does not itself apply changed mapped values. No real merchant order, stock, invoice or payment operation was invoked to claim compatibility.

Automatic recovery of unknown effects is not guessed. Inspect the owned target, worker liveness, effect status/remote ID, source receipt and external stable references before clearing a quarantine. Resource replacement requires explicit mapping reconciliation rather than editing a baseline to bypass the guard. Original retained legacy jobs remain reviewable.

Remaining security work includes complete SSRF/DNS/redirect egress enforcement and broad log redaction. Encrypted recovery data and permanent delivery identities now need a documented retention/export policy. Keep `ENCRYPTION_KEY` stable and backed up; an ephemeral development key cannot provide restart-safe decryption. The deployed scheduler/worker configuration and actual host behavior must be verified after deployment; a local build does not deploy these changes.
