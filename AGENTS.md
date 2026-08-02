# AGENTS.md — Partner System

## Architecture

- **Auth**: Clerk (user_id is the Clerk `userId` string)
- **DB Access**: Supabase REST client via `supabase` from `@/lib/supabase` (service role key)
- **Server Actions**: `'use server'` in `src/app/actions/`.
  - `partners.ts`: `requestPartnership`, `getMyPartnerProfile`, 6 admin actions (approve/reject/suspend/reactivate/setTier)
  - `partner-actions.ts`: `getPartnerStats`, `createClientInvitation`, `acceptClientInvitation`, `getPartnerClients`, `getPartnerDetail`
  - `partner-admin.ts`: `claimPartnerWorkspace`, `reviewPartnerWorkspace`, `addCommission`, `reviewPayoutRequest`
- **Email**: `src/lib/email.ts` (Resend), templates in `src/lib/email-templates.ts`
- **Audit**: `src/lib/audit-logs.ts` → `audit_logs` table
- **Tiers**: `src/lib/partner-tiers.ts` (starter/growth/gold configs)
- **Translations**: `src/lib/translations.ts` (`admin.partners.*`, `nav.*`)

## File Map

### Partner Facing
| File | Purpose |
|------|---------|
| `src/app/partners/page.tsx` | Landing page (pre-login) |
| `src/app/onboarding/partner/page.tsx` | Partnership application form |
| `src/app/partner/[partnerId]/layout.tsx` | Auth guard + nav bar |
| `src/app/partner/[partnerId]/page.tsx` | Dashboard: KPIs, invite form, recent clients |
| `src/app/partner/[partnerId]/clients/page.tsx` | Client list table |
| `src/app/partner/[partnerId]/commissions/page.tsx` | Commission history |
| `src/app/partner/[partnerId]/payouts/page.tsx` | Payout request list |
| `src/app/partner/[partnerId]/payouts/new/page.tsx` | New payout form |
| `src/components/partner/InviteClientButton.tsx` | Inline invite form |
| `src/components/partner/ClientInvitationCard.tsx` | Recent clients widget |

### Client Facing
| File | Purpose |
|------|---------|
| `src/app/onboarding/accept/page.tsx` | Accept invitation → sign-up |
| `src/app/claim-workspace/page.tsx` | Create workspace after sign-up |

### Admin Facing
| File | Purpose |
|------|---------|
| `src/app/admin/partners/page.tsx` | Partner list + approve/reject/suspend/reactivate |
| `src/app/admin/partners/AdminPartnersClient.tsx` | Client component with tabs + modals |
| `src/app/admin/workspace-links/page.tsx` | Approve/reject workspace-partner links |
| `src/app/admin/workspace-links/WorkspaceLinksClient.tsx` | Tabbed table + action buttons |
| `src/app/admin/commissions/page.tsx` | Add commission form + recent list |
| `src/app/admin/commissions/AddCommissionForm.tsx` | Partner/client picker + gross amount |
| `src/app/admin/payouts/page.tsx` | Review payout requests |
| `src/app/admin/payouts/PayoutsReviewClient.tsx` | 3-action modal (approve/pay/reject) |

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

- `partner_profiles`: user_id → status → tier → commission_rate
- `partner_tier_history`: tier/rate changes (audit trail)
- `partner_onboarding_invitations`: token-based client invites (pending → accepted → linked)
- `partner_agreements`: contracts with PDF + SHA-256 (draft → active)
- `partner_commissions`: per-invoice commission (gross × rate = amount)
- `payout_requests`: cash-out requests (pending → approved → paid / rejected)
- `audit_logs`: security audit trail

## Status Lifecycle

### Invitation: `pending` → `accepted` → `linked`
1. Partner invites → `pending`
2. Client clicks link → `accepted`
3. Client creates workspace → `linked` + `workspace_id`, `created_user_id` set

### Payout: `pending` → `approved` → `paid` (or `rejected`)
- Admin can go directly from `pending` to `paid` (skipping `approved`)
- `payment_reference` required when going to `paid`

## Admin Checks
- `ADMIN_USER_IDS` env var (comma-separated Clerk user IDs)
- `isAdmin(userId)` from `@/lib/auth` checks against that env var

## Notes
- Always use `supabase` (service_role) for writes — RLS is bypassed intentionally
- Unused columns in Prisma may exist in SQL (Prisma is tracking model, SQL is source of truth)
- `notes` column removed from `partner_onboarding_invitations` (not in DDL)
- `expires_at` made nullable in Prisma + SQL (no expiration for MVP invitations)
