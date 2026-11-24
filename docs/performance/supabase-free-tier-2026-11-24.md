# Supabase cost reduction — 2026-11-24

## Grounded baseline (UTC 00:54)
- GitHub `main`: `fc171133a2e926c0f4be7dde0136dcd6077346b3`
- Supabase project: `bnzkmoorrvtellesgvbq`
- Database: 68,471,955 bytes, approx. 65 MiB
- Queue rows: 0; dead letter rows: 31 (review separately); inbox: 1,542, all `done`
- Last-24-hour gateway paths returning 404: `fixed_mapping_settings` 192, `fixed_mappings` 191, `fixed_mapping_rules` 121
- All three tables confirmed absent with `to_regclass`; `standard_mapping_settings` confirmed present
- Counts are API log events, **not** directly billable Logs Ingest bytes or attributed per-order query counts
- PostgreSQL `log_connections=on`, `log_disconnections=on`. Logging changes require separate platform configuration/restart impact assessment; this change set does **not** modify database settings.

## Changes
1. Skip three absent legacy table lookups in order/preset processing by default. Standard Mapping remains authoritative and unchanged.
2. Preserve legacy behavior for installations that explicitly set `ENABLE_LEGACY_FIXED_MAPPING_TABLES=true` **only after the legacy tables are created and verified**.
3. Reuse already-loaded Telegram bots while processing pending link codes. If the batch load fails, retain individual-record fallback.

## Reliability and release gates
- Do not alter durable webhook receipt, queue leasing, retries, reconciliation, idempotency or tenant scope.
- Validate typecheck and Jest against the branch; run live Zid → Odoo E2E in an isolated test workspace before production merge.
- Check deployment host's configuration and compare measured 404s, Log Ingest, idle and per-order API request counts after release.
- No evidence of a measured reduction exists until a post-deploy observation window is completed.
