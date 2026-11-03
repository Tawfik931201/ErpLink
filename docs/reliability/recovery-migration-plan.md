# Remaining reliability work: reviewable implementation plan

Prepared 2026-11-03. Proposal only: no SQL was applied, no live data was read, and no deployment is authorized by this document. This plan addresses the high-risk gaps identified in the three audits; local fixes do not establish these guarantees.

## Decisions and preflight before schema work

1. Define the queued-event target: preserve the connection selected at receipt, or intentionally use the current connection at execution. Proposed default: pin connection ID and a configuration generation, verify tenant/store ownership at execution, and park mismatches for explicit recovery. Never silently switch targets.
2. Define which private ERP networks are intentional. Proposed default for a public SaaS host: public HTTPS destinations only, with explicitly provisioned private connectivity as an exception. Enforce resolution/redirect/connected-address checks in both transports and network egress policy. A lexical hostname block alone is insufficient.
3. Specify the policy for ambiguous writes. Proposed default: record `unknown_outcome` and reconcile by a verified stable external reference; if no reliable reference exists, require operator resolution. Never automatically issue another create merely because local result storage is missing.
4. In an isolated restored snapshot, inventory connection counts per workspace, orphan/foreign mappings, duplicate source identity keys, legacy receipts, missing queue columns/indexes, and links whose destination changed. Record counts, redact sample identifiers, and verify ownership without decrypting/exporting keys.

## Proposed additive persistence changes

Assess actual deployed schema before writing a migration. Use additive nullable columns/tables first; retain all old rows and current indexes until verified backfill and compatibility are established.

- Versioned processing target: receipt/job references to connection ID and generation, with verified workspace/store binding. A foreign key to connection ID alone does not establish tenant equality; composite ownership constraints must match existing relationships.
- Durable execution/effect record: scope by workspace, platform, store, ERP connection/generation, entity model/type and source identity. Separate delivery identity from business effect identity and desired source version. States include reserved, running, succeeded, failed and unknown outcome, with correlation ID, remote reference, attempt history and timestamps.
- Lease ownership: distinct owner token, lease expiry and next retry time. Claims and settlement must assert the token atomically. Send Now may bypass retry delay but must never bypass an active lease. A token guards local state; it cannot undo an external write that continues after timeout.
- Connection-aware entity links: preserve the existing key during dual-read/write transition, add verified destination identity and quarantine ambiguous historical links. Do not infer the destination solely from the ERP's numeric record ID.
- Receipt/execution linkage: transactional dispatch where supported by a narrowly scoped DB function, or idempotent recoverable dispatch against a durable execution key that survives queue row deletion. A pending-only unique queue index is insufficient.
- Per-store reconciliation progress: platform/store/connection-scoped cursor, bounded pagination, overlap window and progress update only after the covered interval is durable. Stop/resume on request budget or failure without advancing past unread data.

## Offline evidence required before rollout

Use a disposable database restored with synthetic or approved sanitized data, never production credentials. Run two independent worker processes and inject failures at receipt commit, dispatch, claim, remote commit, local result commit and settlement. Use mocked ERP servers that can commit then disconnect. Verify current-member/removed-member access, three-tenant route-to-worker credential selection, multiple stores, mapping replacement and credential generation changes. Assert accepted, persisted, pending, completed, failed and unknown counts; assert no unauthorized credential access. Duplicate external creates after ambiguous outcomes must be prevented or explicitly parked, not hidden by a local unique key.

Run 100/1,000/10,000 events with measured latency/lag, memory, DB operations and exact counts. The existing in-memory 10,000-row test is a component regression test and does not replace this rehearsal. Test real schema constraints/transactions separately from fluent-query mocks.

## Backup, deployment and rollback

Before any live migration, obtain explicit approval for the reviewed SQL and rollout window, verify a restorable backup/PITR point, rehearse restore, and record row counts and index creation/locking costs. Deploy additive compatibility code, dry-run the backfill, quarantine ambiguous rows, then enable new reads/claims gradually per workspace. Observe pending age, unknown outcomes, rejected target bindings, DB errors and duplicate-reference detections before expanding.

Rollback must preserve new effect records, unknown outcomes and pinned targets. Do not revert to blindly recreating ambiguous operations or drop new tables during rollback. Stop dispatch for affected scopes, retain durable receipts, disable new routing reads if safe, and repair under the reviewed recovery procedure. Reverting code cannot reverse remote ERP effects; any compensation requires a separate approved business operation.

## Operations needed without a new dashboard

Monitor runner startup/heartbeat, oldest pending receipt/job age, dispatch failure, frozen/dead/unknown counts, scoped ERP latency and authentication failures. Alert on meaningful state changes and actionable thresholds. Keep correlation between receipt, execution, connection generation and remote identity in structured metadata; exclude credentials and raw customer payloads. Document retention and manual recovery for orphan/stale/failed receipts. Verify the actual scheduler and applied migrations on the deployment before asserting operational readiness.
