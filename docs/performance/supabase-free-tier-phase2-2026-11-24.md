# Supabase Free-tier Phase 2 — 2026-11-24

## Live baseline (UTC 07:40, before Phase 2)
- Base main: `80e56dd2d0c8aa03dd8ed20957613c7a2b25347e`.
- DB footprint: 68,471,955 bytes (65.3 MiB). No active sync_queue rows; 31 historical dead-letter rows; 1,542 inbox rows.
- Prior rolling-24h Supabase log samples: 32,005 Edge Logs and 18,892 PostgreSQL Logs. These event counts are **not** metered Logs Ingest GB.
- Most active API endpoints, rolling 24h: merchant_tokens GET 7,005; sync_queue GET 4,830; standard_mapping_settings GET 2,323; erp_connections GET 2,170; erp_workspace_bindings GET 2,061; sync_reconcile_state GET+POST 3,234; expire_sync_job_leases RPC 1,532.
- PostgreSQL has `log_connections=on`, `log_disconnections=on`, `log_min_duration_statement=1000`, `log_statement=ddl`. No PostgreSQL logging settings changed (security/logging requires a separately validated plan).
- High background reconciliation frequency may reflect multiple processes or cron. Application-level distributed slot reduces duplicate concurrent cycles without removing reconciliation, lease recovery, inbox durability, queue or tenant scoping.

## Changes
- Fix implicit-workspace Zid token in-flight promise keying so different workspaces cannot coalesce the same credential request.
- Keep failed lease-recovery RPCs fail-closed on the next queue cycle (never set successful-recovery throttle on error).
- Use service-role-only atomic maintenance slots for independent order and category reconciliation across Node workers. Cron manual explicit-window calls remain available. Transport/migration failures fall back to previous recovery behavior rather than silently dropping events.
- Stamp a unique release marker for post-merge Hostinger verification.
- Tests cover concurrent token contexts, retry after lease recovery failure, slot separation and fallback.

## Required release order
1. Run the **additive** migration `20261124075500_maintenance_reconcile_claim.sql` in Supabase before deploying code. No destructive operations.
2. Verify RPC is only executable with `service_role`, RLS is enabled, and a single slot claim excludes a second claim inside the same interval. A failed claim never changes Odoo.
3. Run TypeScript/Jest/lint/build/security on the feature branch. Do a staged Zid→Odoo integration smoke if test stores are available.
4. Squash merge **once** into main, verify Hostinger `/api/health/live` returns `erplink-supabase-capacity-20261124-r2`, and check both live queue and Supabase logs.
5. Retain old main SHA for immediate Git rollback. The additive table is harmless if code is rolled back; do not delete it during recovery.

## Measurement honesty
Only event counts and database bytes are observed here. True monthly Logs Ingest, Database Egress and per-order incremental costs need Usage Dashboard or event-correlated tracing; no extrapolation from REST request count to billing bytes is defensible. The 20 E2E scenarios require actual store+Odoo results, not only Jest.
