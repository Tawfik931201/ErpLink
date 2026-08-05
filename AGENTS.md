# AGENTS.md — Affiliate System

## Architecture

- **Auth**: Clerk (user_id is the Clerk `userId` string)
- **DB Access**: Supabase REST client via `supabase` from `@/lib/supabase` (service role key)
- **Server Actions**: `'use server'` in `src/app/actions/`.
  - `partners.ts`: `requestPartnership`, `getMyPartnerProfile`, 6 admin actions (approve/reject/suspend/reactivate/setTier)
  - `partner-actions.ts`: `getPartnerStats`, `getPartnerClients`, `getPartnerDetail`
  - `partner-admin.ts`: `addCommission`, `reviewPayoutRequest`
  - `subscription-actions.ts`: `registerSubscription`, `extendSubscription`, `cancelSubscription`, `getAllSubscriptions`, `getMyActiveSubscription`, `searchUsersByEmail`, `getActiveAffiliates`
  - `affiliate-actions.ts`: `registerClientWorkspace`, `getAffiliateClients`
- **Email**: `src/lib/email.ts` (Resend), templates in `src/lib/email-templates.ts`
- **Audit**: `src/lib/audit-logs.ts` → `audit_logs` table
- **Tiers**: `src/lib/partner-tiers.ts` (starter/growth/gold configs)
- **Translations**: `src/lib/translations.ts` (`admin.partners.*`, `partners.*`, `nav.*`)

## File Map

### Affiliate Facing
| File | Purpose |
|------|---------|
| `src/app/(public)/partners/page.tsx` | Landing page (pre-login) |
| `src/app/(app)/onboarding/partner/page.tsx` | Affiliate application form |
| `src/app/(app)/partner/[partnerId]/layout.tsx` | Auth guard + nav bar |
| `src/app/(app)/partner/[partnerId]/page.tsx` | Dashboard: KPIs, register-client form, recent clients |
| `src/app/(app)/partner/[partnerId]/clients/page.tsx` | Client list table (workspace/subscription) |
| `src/app/(app)/partner/[partnerId]/commissions/page.tsx` | Commission history |
| `src/app/(app)/partner/[partnerId]/payouts/page.tsx` | Payout request list |
| `src/app/(app)/partner/[partnerId]/payouts/new/page.tsx` | New payout form |
| `src/components/partner/RegisterClientForm.tsx` | Direct client workspace registration (no approval) |
| `src/components/partner/AffiliateRecentClients.tsx` | Recent clients widget |

### Client Facing
| File | Purpose |
|------|---------|
| `src/components/subscription/SubscriptionStatusCard.tsx` | Subscription status card on dashboard |
| `src/components/subscription/SubscriptionBanner.tsx` | Expiry banner (X to dismiss, sessionStorage) |

### Admin Facing
| File | Purpose |
|------|---------|
| `src/app/(app)/admin/partners/page.tsx` | Affiliate list + approve/reject/suspend/reactivate |
| `src/app/(app)/admin/partners/AdminPartnersClient.tsx` | Client component with tabs + modals |
| `src/app/(app)/admin/partners/[partnerId]/page.tsx` | Affiliate detail (workspaces + subscriptions) |
| `src/app/(app)/admin/subscriptions/page.tsx` | Subscription list + register/extend/cancel |
| `src/app/(app)/admin/subscriptions/AdminSubscriptionsClient.tsx` | Register modal (client search, workspace, months, amount) |
| `src/app/(app)/admin/commissions/page.tsx` | Add commission form + recent list |
| `src/app/(app)/admin/commissions/AddCommissionForm.tsx` | Affiliate/client picker + gross amount |
| `src/app/(app)/admin/payouts/page.tsx` | Review payout requests |
| `src/app/(app)/admin/payouts/PayoutsReviewClient.tsx` | 3-action modal (approve/pay/reject) |

### API
| File | Purpose |
|------|---------|
| `src/app/api/admin/install-partner-schema/route.ts` | Run DDL against Supabase (admin only) |
| `src/app/api/partner/request-payout/route.ts` | Submit payout request |

### Schema
| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Prisma models (for `prisma generate`) |
| `supabase/migrations/20260711_partner_system.sql` | DDL + RLS (source of truth for DB) |
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

- `partner_profiles`: user_id → status → tier → commission_rate (UI name: Affiliate)
- `partner_tier_history`: tier/rate changes (audit trail)
- `partner_commissions`: per-subscription commission (gross × rate = amount)
- `payout_requests`: cash-out requests (pending → approved → paid / rejected)
- `subscriptions`: workspace_id, user_id, affiliate_id (→ partner_profiles), start_date, months_paid, end_date, amount_paid, currency, status (active/cancelled), created_by
- `audit_logs`: security audit trail

## Status Lifecycle

### Subscription: admin registers manually
1. `registerSubscription` (admin): validates client user + workspace, computes `end_date = start_date + months − 1 day`, inserts subscription, **auto-creates commission** = `amount_paid × affiliate commission_rate` (status `approved`, source `manual`)
2. `extendSubscription` (admin): extends `end_date`, adds months, creates a new auto-commission for the paid amount
3. `cancelSubscription` (admin): sets status `cancelled` (no auto-expiry — `end_date` is source of truth)
- Client sees: status card + expiry banner (amber ≤7 days, red when expired); banner dismissible via X (sessionStorage) and never auto-dismisses

### Affiliate → client attribution (direct, no approval)
1. Affiliate calls `registerClientWorkspace` with client email + workspace name
2. Client must have an existing account (`client_not_found` otherwise)
3. Workspace created with `partner_id` set and `partner_status='active'` immediately (audit log written)

### Payout: `pending` → `approved` → `paid` (or `rejected`)
- Admin can go directly from `pending` to `paid` (skipping `approved`)
- `payment_reference` required when going to `paid`

## Admin Checks
- `ADMIN_USER_IDS` env var (comma-separated Clerk user IDs)
- `isAdmin(userId)` from `@/lib/auth` checks against that env var
- All admin subscription actions guarded by `requireAdmin()`

## Notes
- Always use `supabase` (service_role) for writes — RLS is bypassed intentionally
- Unused columns in Prisma may exist in SQL (Prisma is tracking model, SQL is source of truth)
- UI/texts say "أفلييت/Affiliate"; DB tables keep the `partner_*` names — do not rename tables
- Invitation flow (partner_onboarding_invitations) was removed — table may still exist in older DBs but is unused
- Deleted routes: `/onboarding/accept`, `/claim-workspace`, `/admin/workspace-links` — do not reintroduce
