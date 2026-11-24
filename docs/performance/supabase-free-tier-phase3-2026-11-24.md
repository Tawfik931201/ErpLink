# Phase 3: Cross-process idle queue safety-net coalescing — 2026-11-24

## Why the phase 2 idle budget remained above target
Actual Supabase gateway-log count in equal 20-minute samples:
- Before phase 2, 07:40–08:00 UTC: **128 REST/RPC calls (6.4/min)**, one admitted webhook. Periodic reconciliation causes large bursts.
- After phase 2 and live QA, 08:16–08:36 UTC: **150 calls (7.5/min)** including 42 sync_queue GETs, 20 lease-expiry RPCs, 20 inbox GETs, and two duplicate-webhook HTTP409 responses. The live QA changed the Zid order repeatedly, so the phase-2 sample is **not** an otherwise identical, controlled idle comparison.
- Multiple Node processes schedule a recovery scan every 120 s independently. The existing reconciliation slot gates Zid audits but not the queue's idle safety-net scans.

## Change and hard reliability rules
- Extend existing service-role-only `claim_erp_maintenance_slot` for `queue_idle_drain_v1`, preserving existing Zid order/category names.
- Only periodic scheduled IDLE scans are guarded. The first scheduled scan, startup recovery after 5 s, event-driven wake after a durable receipt, retries and manual cron **remain ungated**. Sub-60-second custom idle windows also bypass the gate.
- Failed/unavailable/malformed Supabase lease response fails OPEN; the original scan executes, never suppressing webhook recovery.
- Do not change receipt durability, queue claiming, outcome-unknown blocking, tenant isolation or drop records.
- Migration is additive, RLS enabled on slots table, API execute granted to `service_role` ONLY; manual rollback is to redeploy prior main SHA. Existing slot table and SQL function are safe to leave in place.

## Release and proof
1. Verify additive SQL using BEGIN/ROLLBACK and ensure first claim succeeds, second is denied, other slots unaffected, anon/auth role cannot EXECUTE.
2. Apply migration and confirm its exact recorded version, align repository file name to it.
3. Run feature lint, TS, full Jest, production Build, security and order-sync CI.
4. Remove temporary test workflow, squash PR once into main; verify deleted branch.
5. Confirm distinct Hostinger health marker `erplink-supabase-capacity-20261124-r3` and external security smoke, then compare equal low-traffic post-deploy windows via Supabase logs.
6. Run live Zid→Odoo two-quantity partial-return scenario and check no duplicate invoice or stock moves; do not claim 20/20 E2E without running all 20.

## Boundaries
Supabase billing Logs Ingest bytes, egress bytes and order capacity require metered evidence; REST call counts are not billing byte counts. Historical 31 dead letters are intentionally preserved. Telegram message delivery cannot be confirmed with zero linked bot chats. Postgres connection/disconnection logging comes from managed Supabase configuration and is unchanged.

Migration applied in Supabase: `20261124084219_idle_queue_scan_claim` (RLS and RPC grants verified).
