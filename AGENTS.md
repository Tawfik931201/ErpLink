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
- **Email**: `src/lib/email.ts` (SendGrid, SMTP fallback, mock in dev),
  templates in `src/lib/email-templates.ts`
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
| `.gitlab-ci.yml` | CI: `type-check` + `lint` + `build` (no tests exist) + GitLab security templates |

### Schema
| File | Purpose |
|------|---------|
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
- Server-Sent Events for webhook activity (`webhook-emitter`, the Zid
  `/api/webhooks/zid/stream` route, `useZidWebhooks`, `WebhookToast`) — the
  queues and `sync_logs` are the record of truth; nothing reads events live.

## Admin Checks
- `ADMIN_USER_IDS` env var (comma-separated Clerk user IDs)
- `isAdmin(userId)` from `@/lib/auth` checks against that env var
- All admin subscription actions guarded by `requireAdmin()`

## Routing
- The signed-in app lives under the route group `(app)/app/*`, so the real
  dashboard path is **`/app/dashboard`** — there is no top-level `/dashboard`.
  Redirects and `<Link href=...>` inside `(app)` must use the `/app/...` prefix.
  (A `/dashboard` redirect in `admin/layout.tsx` shipped broken for this reason
  and was fixed 2026-09-29.) Public routes (`/pricing`, `/contact`, `/sign-in`,
  `/invoice/[id]`, …) stay at the root.

## Notes
- Always use `supabase` (service_role) for writes — RLS is bypassed intentionally
- UI/texts never say "أفلييت/Affiliate" — clients are told to contact support
- DB tables keep the `partner_*` names where they still exist — do not rename tables;
  do not drop them yet (a later cleanup migration will handle it)
- `affiliate_id` / `affiliate_name` fields remain in TS interfaces as legacy
  read-only (old `SELECT *` rows) — always `NULL` for new data, never displayed
- **No ORM.** Prisma was removed entirely on 2026-09-29: `prisma/schema.prisma`,
  `@prisma/client`, `prisma` and the four `db:*` scripts are gone, and the
  `serverComponentsExternalPackages` list is now just `['xmlrpc']`. Supabase REST
  is the only data path and `supabase/migrations/*.sql` is the sole source of
  truth for the schema. Do not re-add Prisma.
- Deleted routes: `/onboarding/accept`, `/claim-workspace`, `/admin/workspace-links`,
  all `/partner*` and `/partners*` — do not reintroduce
- No Stripe integration — manual bank-transfer flow only (`STRIPE_*` was removed
  from `.env.example` on 2026-09-29; there is no placeholder left)
- Dead deps were **removed from `package.json` and `package-lock.json`** on
  2026-09-29, together with the dead files they only served. Do not re-add:
  `stripe`, `bull`, `ioredis`, `node-cron`, `pg`, `crypto-js`, `date-fns`,
  `jsonwebtoken`, `winston`, `xml2js`, `swr`, `zustand`, and the Radix
  avatar/separator/tooltip packages.
  - `crypto-js` and `swr` still resolve as **transitive** deps of
    `@clerk/nextjs` / `@clerk/shared` — that is expected, not a leftover.
  - `next-auth` and `@next-auth/*` are gone too (`src/app/api/auth/[...nextauth]`
    and `src/types/next-auth.d.ts` were deleted; OAuth is unused). Keep
    `NEXTAUTH_URL` though — `src/app/api/zid/callback/route.ts` still reads it
    as a fallback for `APP_URL`.
  - `prisma` / `@prisma/client` remain: `@prisma/client` is still declared and
    `prisma/schema.prisma` is a tracking model, but no `src` file imports either
    one. Supabase REST is the only runtime data path.
- Real queue = `sync-queue.ts` + `sync-queue-runner.ts` (`setInterval`); there is
  no Redis/Bull and no external cron.
- Deleted dead files (do not recreate): `src/lib/redis.ts`, `src/lib/prisma.ts`,
  `src/lib/empty.js`, `src/lib/zid/client.ts`, `src/lib/webhook-emitter.ts`,
  `src/components/webhook-toast.tsx`, `src/hooks/useZidWebhooks.ts`,
  `src/components/site-header.tsx`, `src/components/site-footer.tsx`,
  `src/components/ui/{avatar,separator,skeleton}.tsx`,
  `src/app/actions/signup-intent.ts`, `src/components/admin/InstallSchemaButton.tsx`,
  `src/app/api/webhooks/zid/stream/route.ts` (SSE is gone entirely — no client
  re-reads webhook events live), `vercel.json`.
- `src/lib/sync-engine.ts` is ~8200 lines but has **no duplicated blocks** — it
  is organically large, not copy-pasted. Do not split it as a "cleanup" task
  without a dedicated migration; a 2026-09-29 review found the only genuine
  repeats were the 4× `isEntityOperationAllowed` preset guard and 2×
  "no field items" skip, both now single functions.

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

### Required migrations (apply BEFORE deploying the code)
In order:
1. `supabase/migrations/20260922_sync_reliability.sql`
   - `sync_queue.next_retry_at` becomes NULLABLE (frozen = exhausted)
   - `sync_queue.dedup_key` + partial unique index (atomic idempotency)
   - `webhook_inbox` — durable receipt written *before* the queue; 2xx only after it lands
   - `sync_queue_dead` — dead-letter archive (exhausted rows are archived, never hard-deleted)
   - `sync_reconcile_state` — reconciliation watermark per scope
   - `idx_sync_logs_match` — tenant-safe match lookup index
2. `supabase/migrations/20260928_dedup_key_pending_only.sql`
   - narrows `uq_sync_queue_dedup_key` to `next_retry_at IS NOT NULL` (pending only)
   - narrows `uq_webhook_inbox_dedup` to `status = 'pending'`
   - **both are required** for the Zid fingerprint dedup to work; a *settled* row
     must stop vetoing new work
   - idempotent; the file ends with read-only pre-flight + verification queries

If `20260922` is not applied, every webhook route returns 503
(`webhook_inbox_missing`) by design. Do not deploy code without it.

### Ingress contract (all webhook routes)
1. Verify signature.
2. Honour settings: `isWebhookEventEnabled(workspaceId, platform, event)`
   reads `standard_mapping_settings` (Mapping Center = source of truth).
3. `recordWebhookReceipt` — durable write.
4. `enqueueWebhookEvent` — atomic `dedup_key` + coalescing.
5. Respond 2xx **only after** step 3; on failure return 503 so the platform retries.
   Never 4xx for a store-not-linked event (that is a permanent loss) — Zid,
   Salla and Shopify all store an orphan receipt and return 202.

### dedup_key rules (critical, easy to get wrong)
`dedup_key` identifies the **event/delivery**, never the **record/entity**.
- Shopify: `X-Shopify-Webhook-Id`; Salla: `webhook id`; Zid: delivery id if sent.
- No delivery id (Zid, Odoo) → use `write_date` if present, else
  `fingerprintPayload()` (sha1 of canonicalised JSON). Two genuinely different
  updates then produce two different keys; an exact redelivery collapses.
- A record-scoped key (`odoo:<model>:<id>`, or Zid's old `payload.uuid`) makes
  every later update look like a duplicate and silently drops real changes.
  This was a live bug: reconciliation every 10 min masked it for **orders only**,
  so 2nd+ edits of a Zid *product* never reached Odoo. Do not reintroduce it.
- A unique-violation (23505) on insert is a **benign duplicate**, not a failure —
  `recordWebhookReceipt` returns `{ ok: true, duplicate: true }`. Do not turn it
  into a 503.
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
| `startSyncQueueRunner()` in `src/lib/sync-queue-runner.ts` | every **30s** (`SYNC_QUEUE_POLL_INTERVAL_MS`) | `drainWebhookInbox(25)` → `processSyncQueue(SYNC_QUEUE_DEFAULT_BATCH)` |
| same runner, reconcile ticker | every **10 min** (`SYNC_RECONCILE_INTERVAL_MS`) | `reconcileZidOrders()` — heals dropped webhooks |
| `GET /api/cron/sync-queue` | on demand only | `drainWebhookInbox` → drain loop (≤40s) → metrics + orphan count |
| `GET /api/cron/reconcile` | on demand only | single reconciliation cycle |

- The inbox drain runs **before** `processSyncQueue` in every cycle: receipts
  written by ingress are enqueued in the same tick instead of waiting a full
  extra period. `WEBHOOK_INBOX_DRAIN_BATCH` is a constant (25) in
  `sync-queue-runner.ts`, not an env var.

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
- `vercel.json` is deleted — crons are irrelevant here.

### Load knobs (tune down for shared hosting)
- `SYNC_QUEUE_CONCURRENCY` (default 10), `SYNC_QUEUE_BATCH_SIZE` (default 50),
  `SYNC_QUEUE_MAX_RETRIES` (default 5).
- Coalescing has **no time window** (`COALESCE_WINDOW_MS` was removed as dead):
  `sync_queue` keeps only the newest row per entity within a single drain batch,
  keyed on `extractEntityId`. `maybeCleanup()` also prunes `webhook_inbox` older
  than 7 days, once an hour, alongside `cleanupExpiredLogs()`.
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