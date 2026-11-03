# ERPlink reliability review and local fixes

The user subsequently authorized implementation and database migrations against test resources. See [durable-execution-implementation.md](durable-execution-implementation.md) for the applied changes, real SQL tests and current limits. The initial-stage results and open findings below are historical, not the final implementation status.

Date: 2026-11-03. Status: local audit and bounded fixes; the full mission-critical acceptance criteria are **not yet established**. No exactly-once guarantee, production certification, deployment, provider change or applied database migration is claimed.

## Review outputs

- [Webhook lifecycle, queue and recovery](webhook-audit.md)
- [Tenant and credential isolation](../security/tenant-isolation-audit.md)
- [ERP routing and effect safety](../integrations/erp-routing-audit.md)
- [Remaining migration, recovery and rollout plan](recovery-migration-plan.md)

The actual stack is Next.js/TypeScript, Clerk, Supabase REST/service-role clients and in-process Node workers. The workspace is the tenant boundary; users and workspace membership are distinct. No Redis/BullMQ or ORM was introduced. Three independent agents reviewed tenant isolation, queue reliability and ERP routing; the lead reviewed their changes, added batch fault/load tests and ERPNext matching coverage, and ran project gates.

The initial working tree already contained architecture documentation/helper extractions, AGENTS.md updates, a sync-log import reorder and a tax-suite mock change. Those were preserved. Existing architecture validation results are historical; current results below are separate.

## Fixes made

| Defect | Changed files and behavior | Evidence |
| --- | --- | --- |
| Removed member retained active workspace authority | New `src/lib/workspace-access.ts`; `auth.ts`, `users.ts`, `workspace-defaults.ts`, and Zid/Salla/Shopify OAuth callbacks revalidate ownership/current membership. Query errors deny access. | 5 workspace helper, 3 user resolver and 3 actual auth resolver cases; existing OAuth/default-workspace regressions. Request-time checks do not cancel already-running work. |
| Explicit ERP connection could belong to another workspace or silently fall back | `src/lib/sync-engine.ts` and outbound Odoo route add workspace filters; missing explicit targets fail rather than reroute. | Real custom-mapping function with mock DB/decrypt: 2 failures before, all 3 passing after. Preset/outbound filters reviewed; full route execution remains unverified. |
| Existing sync log could be read/overwritten by ID without workspace | `src/lib/sync-runtime.ts` scopes status reads, writes and compatibility writes. | 4 execution tests, including constraint/type fallback paths. |
| Newer payload or revived job could be deleted by stale worker snapshot | `src/lib/sync-queue.ts` conditional version/schedule deletion for success settlement, batch stale rows and dead-letter cleanup. Source pins strengthened. | 5 executable query-model cases covering merge after read, null version, unchanged success, revival and batch mutation. These model query intent, not real database locking. |
| Batch returned one outcome and hung on transport rejection | `src/lib/ingress-batch.ts` waits for every result and returns explicit transport failures on batch/immediate paths. | 18 execution cases; initial 14-case reproduction failed before repair. 100/1,000/10,000 mocked rows per helper, exact counts/order/scoping, no premature resolution, duplicates, fault/recovery and immediate callers. Production queue callers still pass single rows; batching policy unchanged. |
| Odoo settings fallback immediately recreated after ambiguous failure | `safeCreateOdooRecord` now requires an XML-RPC fault for generic settings retry. | 3 transport failures cause exactly one create; 1 confirmed rejection retains fallback. Later queue retries and custom ERP commit semantics still need unknown-outcome recovery. |
| ERPNext Salla matching selected Zid identity first | `erpnext-engine.ts` accepts resolved platform, uses current/legacy fields for that platform; engine passes it. Explicit configured matching remains first. | 2/3 cases failed before, all 3 pass after. Search failures and generic name/SKU collisions remain open. |
| Customer values and silent worker failure | Odoo/ERPNext preparation logs now contain identifiers/count only; queue runner catch emits a static failure marker. | Source reviewed, covered by application gates. Other debug/error paths and durable heartbeat/metrics remain open. |

No UI/JSX/styles, package versions, environment files, billing logic, tax/stock rules, webhook signing/registration strategy or schema was changed by this reliability work. Invalid ownership and ambiguous immediate retries intentionally fail rather than execute against an unintended destination. Existing route response implementations remain in place.

## Verification and bounds

All tests use mocks. The separate sync runtime client is mocked explicitly in new execution suites. Gate processes use temporary nonproduction Supabase/Clerk/encryption placeholders and disabled runners, with outbound HTTP/fetch blocked except local traffic/read-only build fonts. `.env` files were not edited. No admin self-test, refresh, live drain or load-rehearsal endpoint was called.

| Check | Current result |
| --- | --- |
| `npm run type-check` | PASS, exit 0 after source fixes. |
| `npm run lint` | PASS, exit 0; existing warnings remain (test lint reports 39 warnings). Initial new import-order/type-import errors were repaired. |
| `npm test -- --ci --runInBand` | PASS: 98 suites / 1,287 tests, 55.181 seconds (50 new cases across 10 suites relative to the initial working tree). Final Odoo preparation-log redaction was added afterward; the engine routing subset passed again (3 cases), and the final build checks that source state. |
| `npm run build` | PASS, exit 0; completed at 17:36 Cairo on 2026-11-03. Compiled, type checked, generated pages and emitted final route table. App-route keys match the pre-task architecture checkpoint manifest. |
| `git diff --check` | PASS for tracked diff; relative links in all five new audit/report/plan documents also pass. |

Raw local evidence is under `%TEMP%/erplink-reliability-20261103/` (`*-before.log`, gate logs and result JSON). The first attempted full suite overlapped active edits and hit a source pin that still expected the old unconditional deletion; it is not a clean baseline. New defects have targeted before/after evidence where stated. A passing source-pin or mocked query test does not establish live schema/ERP behavior.

`erp-client-concurrency.test.ts` separately interleaves 100/1,000 Odoo A, Odoo B and ERPNext C client calls and asserts destination/credential arguments on every response. This is client separation evidence, **not** a three-tenant end-to-end webhook routing test. Batch 10,000-row tests run with fake timers/in-memory storage, so no production throughput/latency claim follows.

## Unresolved high risks and acceptance status

| Acceptance area | Evidence and outstanding gap |
| --- | --- |
| Tenant/store/ERP isolation | Proven boundaries repaired locally; not a proof of every action/query/RLS relationship. SSRF egress gaps remain; private ERP connectivity policy is required. |
| Correct routing | Explicit ownership guarded; no universal versioned store-to-connection binding. Mapping/connection replacement while queued remains ambiguous. Multiple ERP connections per workspace are not consistently supported. |
| Durable accepted work | Normal work path awaits durable receipt; terminal skip logging can fail yet return 2xx. No blanket every-2xx durability guarantee. Applied indexes/database durability/sender retry policy unverified. |
| Idempotent business effects | Delivery dedup and local links are insufficient for concurrent remote creates or commit-then-lost-response. Connection-aware effect ledger, stable external identity and explicit unknown-outcome handling remain required. |
| Recovery | Lease expiry/inbox rescue/retries exist; crash between queue insert and receipt settlement can replay after queue deletion. Send Now can steal active leases because scheduling/lease share one field. Timeout does not cancel remote execution. |
| Reconciliation | Zid order snapshots only; global progress/page/request-budget defects can miss coverage. No equivalent general Salla/product recovery. |
| No leakage in tested cases | New ownership/log/client tests pass; full adversarial matrix and real process/database concurrency remain unverified. |
| Load/concurrency | Mock component tests up to 10,000 rows and client interleaving up to 1,000 calls; no full intake-worker-ERP load benchmark or real restart recovery rehearsal. |
| UI/business preservation | No UI or financial/stock rule changes in this reliability diff; full mocked regression/build gates required. No live merchant compatibility assertion. |
| Monitoring | Existing queue health/admin alerts plus failure marker; durable heartbeat, correlation across receipt/job/effect and complete scoped latency/outcome metrics remain incomplete. |

No Critical exploit was established by these local reviews. Several High risks remain; severity is based on the concrete scenarios in the companion audits, not a claim that production exploitation occurred. The system should not be described as meeting all requested acceptance criteria yet.

## Operational and next-stage requirements

Verify actual migrations/indexes and long-lived runner/scheduler configuration, alert delivery, retention and orphan recovery procedures before rollout. The local fixes need ordinary deployment validation; this task did not deploy them. Pending inconsistent mappings now fail visibly and need ownership repair rather than credential fallback.

The [recovery migration plan](recovery-migration-plan.md) specifies target binding, durable effect/unknown states, distinct lease tokens, connection-aware identity, recoverable dispatch and per-store reconciliation, plus preflight, isolated two-worker fault/load rehearsal, backup and rollback. No high-risk schema/data operation is ready to execute without reviewed SQL, deployment evidence and the explicit approval required by the user's task. Do not compensate ERP business records or guess historical destination identity as part of a backfill.
