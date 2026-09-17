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
