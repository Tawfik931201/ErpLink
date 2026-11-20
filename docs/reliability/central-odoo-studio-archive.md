# Central Odoo Studio archive for ERP Link

## Purpose

Central Odoo Studio acts as a durable ADMINISTRATIVE archive, distinct from every merchant ERP connection. Supabase remains the authority for Clerk users, workspace membership, store OAuth credentials, mapping and the active queue.

Never use a merchant's Odoo instance to store data belonging to another tenant.

## Odoo Studio models (all labels and menu names in English)

| Model | Role | Primary external identifier |
| --- | --- | --- |
| `x_erplink_context` | Workspace/store/user/ERP scope + migration checkpoints | `x_source_uuid` |
| `x_erplink_event` | Sync log and manual queue archive snapshots | `x_source_uuid` |
| `x_erplink_support_ticket` | Central metadata mirror of existing Helpdesk tickets | `x_source_uuid` |
| `x_erplink_support_message` | Central mirror of user replies, linked to support ticket | `x_source_uuid` |
| `x_erplink_contact_message` | Public contact form messages | `x_source_uuid` |

Model relationships: event/ticket/contact `x_context_id` -> context; support message `x_support_ticket_id` -> support ticket.

Users and workspaces are linked by ORIGINAL Clerk user IDs and Supabase UUIDs, not by names, email or sequential Odoo IDs. The admin group `ERP Link Archive Administrators` has Create/Read/Update, without Delete.

The default backend keeps Supabase and the original Odoo Helpdesk operational. The central mirror NEVER blocks checkout, webhook processing, customer support submission or Helpdesk chatter.

## Hostinger configuration

Configure these server-side-only environment variables in Hostinger and redeploy:

- `ERPLINK_ARCHIVE_ODOO_URL` — HTTPS Odoo base URL.
- `ERPLINK_ARCHIVE_ODOO_DB` — the administrative Odoo database.
- `ERPLINK_ARCHIVE_ODOO_USERNAME` — API account with access to five models.
- `ERPLINK_ARCHIVE_ODOO_API_KEY` — API key/password for that account.

Do not use any `NEXT_PUBLIC_*` variables for secrets. Do not reuse a merchant connection.

## Backfill scheduler

Run one independent Hostinger scheduled job per source (e.g. every 5–15 minutes, staggered). The existing `CRON_SECRET` must be set. Example:

```sh
curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://erplink.bizsahla.com/api/cron/central-archive?kind=logs"
curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://erplink.bizsahla.com/api/cron/central-archive?kind=contacts"
curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://erplink.bizsahla.com/api/cron/central-archive?kind=queue"
```

All backfills copy oldest records first, page by `(created_at, id)` or `(archived_at, id)`, and persist checkpoints only after the corresponding Odoo row is written. Check `archived` counts and errors for each cron invocation. During outages, source rows remain intact; replay is idempotent by original external IDs.

Note: External IDs in Odoo Studio are indexed but no database-enforced uniqueness constraint was installed. Avoid concurrent runs of the SAME source kind; the checkpoint and search-before-create are not a substitute for an atomic unique index.

## Safe cutover

1. Ensure the central Odoo credentials work from the Hostinger runtime, not only a ChatGPT connector.
2. Run all three backfills until each returns `archived: 0` and compare distinct UUID counts against Supabase with scoped samples.
3. Validate tenant identity, support-message linkage, created timestamps and status values.
4. Set `ERPLINK_ARCHIVE_ODOO_CONTACTS_READ_PRIMARY=true` only after reconciliation. This switches the authenticated admin contact inbox to paginated Odoo reads; old Supabase rows remain as individual-record fallback.
5. Retain source data unless a separate verified archive-first cleanup policy has been designed and approved.

A zero count alone is NOT conclusive if a source is concurrently writing; repeat the check after an interval.

## Current safety policy

- Automatic deletion of `sync_logs` by age is disabled.
- Automatic pruning of `queue_archives` by age is disabled.
- Active queue retries, webhook-inbox cleanup and Telegram outbox cleanup remain unchanged.
- User-requested manual archive / restore remains unchanged.
- Sync-log and queue-archive payloads are redacted for keys such as access tokens, passwords, API keys and secrets before storage.
- Backfills run in a dedicated cron route, NEVER inline with webhook ingestion or queue processing.

## Remaining acceptance criteria

Do not claim migration complete until Hostinger credentials are configured, historical backfills have run, counts and tenant ownership are reconciled, contact primary read is enabled, and CI and deployed end-to-end tests pass. The ChatGPT Odoo connector is NOT a credential available inside the deployed Next.js application.
