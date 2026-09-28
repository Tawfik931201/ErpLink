# AGENTS.md — Manual Subscriptions (no affiliate)

> Affiliate system cancelled permanently (2026-09-10, user decision).
> Payments are manual only. No Stripe. No commissions. No affiliate attribution.

## Architecture

- **Auth**: Clerk (user_id is the Clerk `userId` string)
- **DB Access**: Supabase REST client via `supabase` from `@/lib/supabase` (service role key)
- **Server Actions**: `'use server'` in `src/app/actions/`.
  - `subscription-actions.ts` (source of truth for billing):
    - Client: `getMyActiveSubscription`, `getMyWorkspaceBillingDetails`, `getSubscriptionForInvoice`
    - Admin write: `registerSubscription`, `extendSubscription`, `cancelSubscription`,
      `archiveSubscription`, `restoreSubscription`, `addSubscriptionPayment`
    - Admin read: `getAllSubscriptions`, `searchUsersByEmail`, `getAdminStats`,
      `getAllClients`, `getClientStatement`
    - Removed: `getActiveAffiliates`, `detectAffiliateForClient`, `AffiliatePick`,
      all `partner_commissions` auto-creation and affiliate auto-detect.
- **Email**: `src/lib/email.ts` (Resend), templates in `src/lib/email-templates.ts`
  - Active: `subscriptionRegisteredEmail` only.
  - Deprecated stubs (do not use): `partnerApplicationEmail`, `partnerApprovedEmail`,
    `partnerRejectedEmail`, `clientActivationEmail`, `payoutStatusEmail`.
- **Audit**: `src/lib/audit-logs.ts` → `audit_logs` table
- **Translations**: `src/lib/translations.ts` — no `partners.*`, no `admin.partners.*`,
  no `nav.partnerDashboard` / `nav.adminPartners`.

## File Map

### Client Facing
| File | Purpose |
|------|---------|
| `src/components/subscription/SubscriptionStatusCard.tsx` | Subscription status card on dashboard (contacts **support**, never affiliate) |
| `src/components/subscription/SubscriptionBanner.tsx` | Expiry banner (X to dismiss, sessionStorage; contacts **support**) |

### Admin Facing
| File | Purpose |
|------|---------|
| `src/app/(app)/admin/page.tsx` | Financial stats (MRR, revenue — no commission liability) |
| `src/app/(app)/admin/clients/page.tsx` + `AdminClientsClient.tsx` | Client list |
| `src/app/(app)/admin/clients/[userId]/page.tsx` | Client header + KPIs, renders statement client |
| `src/app/(app)/admin/clients/[userId]/ClientStatementClient.tsx` | Statement: subscriptions/payments tables, register/extend/cancel/add-payment modals (no affiliate picker) |
| `src/app/(app)/admin/subscriptions/page.tsx` | Subscription list, renders admin client (no affiliates fetch) |
| `src/app/(app)/admin/subscriptions/AdminSubscriptionsClient.tsx` | Register/extend/cancel modals (manual payment only, no affiliate UI) |

### API
| File | Purpose |
|------|---------|
| `src/app/api/sign-up-intent/set/route.ts` | Removed shim — redirects to `/sign-up` so old links don't 404 |

### Schema
| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Prisma models (for `prisma generate`) |
| `supabase/migrations/20260711_partner_system.sql` | Legacy affiliate DDL — tables stay in DB, unused |
| `supabase/migrations/20260803_subscriptions.sql` | `subscriptions` table + RLS |

## Common Commands

```bash
# Type-check the whole project
npm run type-check

# Lint
npm run lint

# Dev server
npm run dev
```

## Data Model

- `subscriptions`: workspace_id, user_id, start_date, months_paid, end_date,
  amount_paid, currency, status (active/cancelled), notes, created_by, archived_at.
  `affiliate_id` is a **legacy read-only column** (old rows may have values via
  `SELECT *`; new rows are always `NULL` — never write it, never display it).
- `subscription_payments`: per-payment rows (subscription_id, amount, paid_at, notes, created_by)
- `workspaces`: id, user_id, name, subscription_number (no affiliate linkage)
- `users`: id, email, name, phone, active_workspace_id
- `audit_logs`: security audit trail
- Legacy (unused, **do not delete yet** — cleanup migration later):
  `partner_profiles`, `partner_tier_history`, `partner_commissions`,
  `payout_requests` (+ `partner_*` columns on `workspaces` if present)

## Status Lifecycle

### Subscription: admin registers manually (manual payment only, no Stripe)
1. `registerSubscription` (admin): validates client user + workspace, computes
   `end_date = start_date + months − 1 day`, inserts subscription with
   `affiliate_id = NULL`, records a `subscription_payments` row when amount > 0.
   **No commission is created.**
2. `extendSubscription` (admin): extends `end_date`, adds months, bumps
   `amount_paid` total, records a payment row. **No commission.**
3. `cancelSubscription` (admin): sets status `cancelled` (no auto-expiry — `end_date` is source of truth)
4. `archiveSubscription` / `restoreSubscription`: soft-hide old rows from the statement (audit + payments intact)
5. `addSubscriptionPayment`: extra payment against a subscription, bumps `amount_paid` total
- Client sees: status card + expiry banner (amber ≤7 days, red when expired);
  both say "تواصل مع الدعم / Contact support". Banner dismissible via X
  (sessionStorage) and never auto-dismisses.

### Removed flows (do not reintroduce)
- Affiliate → client attribution, `registerClientWorkspace`, affiliate auto-detect
  (`workspace link → history → other workspaces`), `getActiveAffiliates`,
  `detectAffiliateForClient`, `AffiliatePick`
- Auto-commissions (`partner_commissions`, `commission.auto_from_subscription*`)
- Payouts (`pending` → `approved` → `paid` / `rejected`)
- Partner tiers (starter/growth/gold), `/partners`, `/onboarding/partner`,
  `/partner/*`, `/admin/partners`, `/admin/commissions`, `/admin/payouts`

## Admin Checks
- `ADMIN_USER_IDS` env var (comma-separated Clerk user IDs)
- `isAdmin(userId)` from `@/lib/auth` checks against that env var
- All admin subscription actions guarded by `requireAdmin()`

## Notes
- Always use `supabase` (service_role) for writes — RLS is bypassed intentionally
- Unused columns in Prisma may exist in SQL (Prisma is tracking model, SQL is source of truth)
- UI/texts never say "أفلييت/Affiliate" — clients are told to contact support
- DB tables keep the `partner_*` names where they still exist — do not rename tables;
  do not drop them yet (a later cleanup migration will handle it)
- `affiliate_id` / `affiliate_name` fields remain in TS interfaces as legacy
  read-only (old `SELECT *` rows) — always `NULL` for new data, never displayed
- Deleted routes: `/onboarding/accept`, `/claim-workspace`, `/admin/workspace-links`,
  all `/partner*` and `/partners*` — do not reintroduce
- No Stripe integration — manual bank-transfer flow only
  (`STRIPE_*` keys in `.env.example` are legacy placeholders, unused in `src`)
- Dead deps (installed but unused in `src` — do not add new imports; remove later):
  `stripe`, `bull`, `ioredis` (`src/lib/redis.ts` never imported), `node-cron`,
  `pg`, `next-auth` — real queue is `sync-queue.ts` + `sync-queue-runner.ts` (`setInterval`)

## Spec-Kit (AI documentation)

> Added 2026-09-10 — spec-driven docs so any AI can understand history + intent.
- `.specify/config.yml` — project config (erplink, ar/en)
- `.specify/memory/constitution.md` — 7 governing principles (simplicity, 3-min connect, manual payments, no affiliate, service_role writes, Clerk, Odoo owns stock/price)
- `.specify/memory/architecture.md` — real stack + actions/api/lib maps (SQL is source of truth)
- `specs/001-simplify-and-integrate/spec.md` — requirements FR-1..FR-5 with acceptance criteria
- `specs/001-simplify-and-integrate/plan.md` — P0 → P1 → P2 plan
- `specs/001-simplify-and-integrate/tasks.md` — 17 actionable tasks
- `specs/001-simplify-and-integrate/history.md` — change log (started from 5 exploration reports)
- Optional: `.github/prompts/speckit.*.prompt.md` — copy-paste helpers
- Rule: spec-kit changes are docs-only (`md`/`yml`) — never break `type-check`

---

## Sync Reliability (added 2026-09-26) — webhooks, no-loss, Hostinger

Source of truth for the reliable-ingest design: this section. SQL migrations are
the source of truth for the schema; `AGENTS.md` never overrides SQL.

### Required migration (apply BEFORE deploying the code)
`supabase/migrations/20260922_sync_reliability.sql`
- `sync_queue.next_retry_at` becomes NULLABLE (frozen = exhausted)
- `sync_queue.dedup_key` + partial unique index (atomic idempotency)
- `webhook_inbox` — durable receipt written *before* the queue; 2xx only after it lands
- `sync_queue_dead` — dead-letter archive (exhausted rows are archived, never hard-deleted)
- `sync_reconcile_state` — reconciliation watermark per scope
- `idx_sync_logs_match` — tenant-safe match lookup index

If this migration is not applied, every webhook route returns 503
(`webhook_inbox_missing`) by design. Do not deploy code without it.

### Ingress contract (all webhook routes)
1. Verify signature.
2. Honour settings: `isWebhookEventEnabled(workspaceId, platform, event)`
   reads `standard_mapping_settings` (Mapping Center = source of truth).
3. `recordWebhookReceipt` — durable write.
4. `enqueueWebhookEvent` — atomic `dedup_key` + coalescing.
5. Respond 2xx **only after** step 3; on failure return 503 so the platform retries.
   Never 4xx for a store-not-linked event (that is a permanent loss) — the Zid
   route stores an orphan receipt and returns 202.

### dedup_key rules (critical, easy to get wrong)
`dedup_key` identifies the **event/delivery**, never the **record/entity**.
- Shopify: `X-Shopify-Webhook-Id`; Salla: `webhook id`; Zid: delivery id if sent.
- Odoo sends no delivery id → use `write_date` if present, else
  `fingerprintPayload()` (sha1 of canonicalised JSON).
- A record-scoped key (`odoo:<model>:<id>`) makes every later update look like a
  duplicate and silently drops real changes. Do not reintroduce it.
- Coalescing (same entity while a row is pending) is handled by `sync_queue`
  via `extractEntityId`, keyed on `odooRecordId` / `quant_id` / `product_id` /
  `order_id` — so repeated updates collapse to one Odoo write.

### Scheduler — in-process runner is the primary path (NOT cron)

> Changed 2026-09-28. The Hostinger host has a `crontab` binary that reports
> success but writes nothing to `/var/spool/cron` (dir stays empty, owner is the
> user, `EXIT=0`). hPanel exposes no Cron Jobs page either. **There is no
> working external scheduler on this host** — do not plan around one.

| Path | Period | Does |
|---|---|---|
| `startSyncQueueRunner()` in `src/lib/sync-queue-runner.ts` | every **30s** (`SYNC_QUEUE_POLL_INTERVAL_MS`) | `processSyncQueue(SYNC_QUEUE_DEFAULT_BATCH)` |
| same runner, reconcile ticker | every **10 min** (`SYNC_RECONCILE_INTERVAL_MS`) | `reconcileZidOrders()` — heals dropped webhooks |
| `GET /api/cron/sync-queue` | on demand only | `drainWebhookInbox` → drain loop (≤40s) → metrics + orphan count |
| `GET /api/cron/reconcile` | on demand only | single reconciliation cycle |

- Started **once** at boot from `src/instrumentation.ts`, which requires
  `experimental.instrumentationHook: true` in `next.config.js` (Next 14.x).
  `instrumentation.ts` skips Vercel and `phase-production-build`.
- **`SYNC_QUEUE_SELF_RUNNER=true` is required in production.** Without it the
  runner returns early and a boot-time warning fires, because no external
  scheduler exists to take over.
- Safety: per-cycle overlap guard (`__syncQueueRunnerProcessing` /
  `__syncQueueReconcileProcessing`), single-instance guard
  (`__syncQueueRunnerStarted`), `unref()` on both timers, and a fix-up drain 5s
  after boot so anything queued while the process was down clears immediately.
  Load grows with actual queue depth, never with elapsed time.
- Only gap: the runner stops while the process is down, so there is a short
  window after a restart/deploy before the first tick. The 5s fix-up drain
  closes most of it.
- The `/api/cron/*` routes stay available for manual runs and for any future
  host that does have a working cron. Both require `CRON_SECRET`; in production
  a missing value makes them return 500 rather than run unauthenticated.
- **Auth differs per route — use the Bearer header, it is the only one both
  accept:** `Authorization: Bearer $CRON_SECRET`. `?key=` works on `reconcile`
  only, `x-cron-secret` on `sync-queue` only. Do not assume a third form works.
- `vercel.json` crons are irrelevant here.

### Load knobs (tune down for shared hosting)
- `SYNC_QUEUE_CONCURRENCY` (default 10), `SYNC_QUEUE_BATCH_SIZE` (default 50),
  `SYNC_QUEUE_MAX_RETRIES` (default 5), `COALESCE_WINDOW_MS` (5s).
- Reconciliation self-limits: `MAX_API_CALLS_PER_RUN = 4` and
  `MAX_ENQUEUED_PER_RUN = 100` per cycle, sequential (Zid allows 60 req/min).
- `processSyncQueue` is disabled in `phase-production-build`.

### Service role
`src/lib/supabase.ts` throws in production when `SUPABASE_SERVICE_ROLE_KEY` is
missing. The old `|| ANON_KEY` fallback made every write fail silently under
RLS while appearing healthy. Dev-only fallback logs a warning.

### Cross-tenant safety
`findExistingOdooRecord` in `src/lib/sync-engine.ts` scopes the `sync_logs`
lookup by `workspace_id` **and** `platform` — `zid_entity_id` alone is not
unique across merchants. Keep the filter when touching that function.