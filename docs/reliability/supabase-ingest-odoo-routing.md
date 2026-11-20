# Supabase Logs Ingest — measured root cause and Odoo routing

Verified 2026-11-20 against Supabase project `bnzkmoorrvtellesgvbq` (`ecommerce`) unified logs, trailing 24 h.

## Sources (events, not GB)

| Source | Events |
|---|---:|
| API Gateway (edge_logs) | 94,568 |
| Postgres | ~8,670 |
| Other sources | < 150 |

Largest API Gateway routes in the same sample:

- GET `telegram_outbox`: 42,440
- GET `sync_queue`: 11,479
- POST `rpc/expire_sync_job_leases`: 9,421
- GET `webhook_inbox`: 9,421
- HEAD `sync_queue`: 9,418
- GET `telegram_bot_codes`: 2,706
- GET `telegram_bots`: 2,704

At time of inspection, *linked Telegram bots = 0*, *pending Telegram messages = 0*, *due queue jobs = 0*, and *pending webhook receipts = 0*. Therefore idle polling was the main avoidable traffic driver.

## Remediation implemented

- Telegram sender checks for a linked bot once per minute; skips outbox scans when none exists, but fails open on DB errors.
- Queue runner polls every 10s under load and every 60s while idle. A successful durable webhook dispatch schedules an in-process wake-up when its job becomes due, with the idle timer still serving as a restart / multi-process recovery fallback.
- Tenant-scoped support lists now read legacy Helpdesk and Odoo Studio models, preventing ticket ID collisions by mapping central-only ticket IDs to negative values.
- Operational queue / dedup / retry state stays in Supabase. Do not move in-flight queue processing to Odoo or browser storage.

## What Odoo stores

- `x_erplink_event`: copied terminal sync logs and historical manually archived queue snapshots.
- `x_erplink_context`: stable user/workspace/store/ERP-connection references.
- `x_erplink_contact_message`: public contact messages.
- `x_erplink_support_ticket` and `x_erplink_support_message`: support ticket metadata and discussion mirror.
- Only non-secret source identifiers and redacted payloads are archived, never access tokens, merchant credentials, or live queue lease/retry state.

## Cleanup constraints

The original 1,249 sync logs and 37 archived queue snapshots were verified in Odoo, but must not be deleted from Supabase until **all** list, search, stats, retry and queue restore paths have been migrated. Deleting them now would remove user-visible history and/or prevent operations.

One previously verified public contact-form row was deleted from Supabase after field-by-field Odoo matching, and the original row remains in Odoo. This proves data relocation, not reduction in Supabase logs ingest.

## PostgreSQL logging

Observed live `log_connections=on` and `log_disconnections=on`, and ~8,670 Postgres log events, almost all severity LOG. If connection audit trails are not legally required, consider disabling connection logging from Supabase **Database Settings** (not an application migration) after assessing audit needs. This does not affect Auth audit logs or the other logging products.

## Measurement and acceptance

Logs Ingest is measured in GB for the organization / billing cycle, not the number of rows in `sync_logs`. Historical consumed quota cannot be reversed by deleting rows; judge reduction by the **new daily ingest rate** over the following 24–48 hours. Compare API Gateway route rates and Postgres events against the baseline above. Also examine organization-level consumption across projects.

Do not treat a lower API count as success until webhook delivery, queue drainage, multi-workspace isolation, replay, Telegram bot activation (within one minute), and user ticket lists are all rechecked after Hostinger deploy.

Primary sources: https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest and https://supabase.com/docs/guides/platform/postgres-connection-logging
