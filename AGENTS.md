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

# Lint — clean (0 errors) as of 2026-09-29
npm run lint

# Unit tests — 99 tests, all pure functions (added 2026-09-29)
npm test
npm run test:watch
npm run test:coverage

# Production build — also a gate
npm run build

# Dev server
npm run dev
```

All four (type-check, lint, test, build) are **blocking** CI jobs.

## Testing (added 2026-09-29)

- Jest is configured via `next/jest` in `jest.config.js` — SWC and the `@/*`
  aliases come from `tsconfig.json`, so tests compile exactly like the app.
- `tests/mocks/supabase.ts` is mapped over `@/lib/supabase` in
  `moduleNameMapper`; **no test may open a real DB connection**. Assert on
  `supabase.calls`, never on live data.
- 99 tests over 6 suites:
  - `tests/unit/zid-order-helpers.test.ts` — `resolveZidShippingCost`,
    `resolveZidCodAmount`, `isSaudiShippingAddress`, `resolveZidStatus`
  - `tests/unit/sync-queue-dedup.test.ts` — `fingerprintPayload`,
    `extractEntityId` (the anti-data-loss rules)
  - `tests/unit/subscription-dates.test.ts` — `computeSubscriptionEndDate`,
    `addMonthsToDate`, `isValidIsoDate`
  - `tests/unit/odoo-operation-routing.test.ts` — `normalizeOdooOperation`,
    `presetEntityType`
  - `tests/unit/clerk-authz-guard.test.ts` — scans `src/**` to prove the
    Clerk advisory is unreachable (see Known Vulnerabilities)
  - `tests/unit/platform-fields.test.ts` — the `x_<platform>_id` table and
    the `current` → `legacy` resolution order (Stage 1 of the platform split)
- ⚠️ **A `'use server'` module may only export async functions.** Next fails
  the build with "Server actions must be async functions" otherwise — this
  happened when the subscription date helpers were briefly exported from
  `subscription-actions.ts`. They now live in `src/lib/subscription-dates.ts`
  (a normal module) and the action file delegates to them. Put pure logic in a
  plain `src/lib/*` file, never in `src/app/actions/*`.
- `resolveZidShippingCost` / `resolveZidCodAmount` / `resolveZidStatus` were
  made `export` (was private) purely so they can be tested. Do not un-export.
- `npm run test:coverage` works but is **not** a gate — the codebase is ~63k
  lines and total coverage is ~4%. Scope coverage, don't chase the number.

### Billing date edge case (deliberately NOT fixed)
`computeSubscriptionEndDate` overflows for month-end starts: paying on
2026-01-31 for 1 month yields **2026-03-02** (30 days), where clamping would
give 2026-02-27/28. The tests pin the current behaviour with a comment. Fixing
it is a **billing behaviour change** and needs an explicit product decision —
do not "correct" it silently.

## Known Vulnerabilities (2026-09-29)

`npm audit` is at **10 (1 critical, 9 high)**, down from 16. Everything fixable
without a major bump was fixed (`npm audit fix` + nodemailer 7→10 + axios
1.18.1→1.20.0). The remainder all need a framework major upgrade:

| Package | Now | Needs | Real risk here |
|---|---|---|---|
| `next` | 14.2.35 | 15.5.24+ (16.3.3+) | **One critical RCE — mitigated, see below**; the rest is DoS/cache |
| `@clerk/nextjs` | 5.7.6 (latest stable v5) | 6.39.3+ | **None reachable — see below** |
| `postcss` | 8.4.31 (nested in Next) | — | Low — build-time only |
| `glob` | — | via eslint-config-next 16 | Low — lint tool only |

> `axios` was a **direct** dependency (`^1.7.2` → 1.18.1) and had drifted into
> the affected range `1.0.0 - 1.19.0` with 6 advisories, which the 2026-09-29
> sweep missed because it only looked at what the earlier fix had touched.
> Bumped to **1.20.0** (same major, patch-level) — that closed the last
> non-major advisory. It is imported by `zid-client.ts`, `salla-client.ts` and
> `shopify-client.ts`, so re-run the sync baseline after any future axios bump.
> The six advisories were ReDoS in the `data:` URL parser and in proxy
> host normalisation, prototype-pollution gadgets in `toFormData`, and HTTP/2
> adapter issues — none reachable against fixed third-party base URLs, but it
> was a direct dep at a vulnerable version, so it got fixed regardless.

### The one Critical that did apply: AVIF RCE (mitigated 2026-09-29)

Of the 30 distinct advisories npm reports, almost none are reachable. One is,
and it is not hypothetical.

**GHSA-2xp9-vwfh-vxw4 — "Unauthenticated Remote Code Execution in Image
Optimization API when AVIF files are used"** — Critical, **CVSS 9.5**,
`PR:N` (no privileges) and `UI:N` (no user interaction). Root cause is a flaw
in the `libheif` library inside `sharp`, triggered whenever an AVIF file is
optimised. Affected `>=10.0.0 <15.5.24`; patched `15.5.24` / `16.3.3`.

It was reachable in this app on all three counts:

1. `next.config.js` had `formats: ['image/avif', 'image/webp']` — AVIF on.
2. `src/middleware.ts` excludes `_next/image` from the Clerk matcher, so the
   optimiser endpoint is **public** — no session, no account needed.
3. `src/components/ui/logo.tsx` uses `next/image`, so the endpoint is live.

**Mitigation applied:** `formats: ['image/webp']`. This is the advisory's own
interim guidance. Cost is negligible — `next/image` is used in exactly one
place in the whole app, so only the logo changes format.

> ⚠️ **Never re-add `'image/avif'` while next is 14.x.** Re-enable it only when
> `next >= 15.5.24`. The same applies to any new `next/image` usage: the
> endpoint is unauthenticated by design, so it is public attack surface.

### Not reachable despite high/CVSS scores — do not chase these

- **RCE on Windows-hosted servers** (CVSS 9.0) — host is Linux.
- **SSRF in WebSocket upgrades** (8.6) — no WebSockets in the app.
- **Middleware bypass in Pages Router with i18n** — this is App Router.
- **SSRF in Server Actions on custom servers** — `start` is plain `next start`.
- **SSRF in rewrites via attacker-controlled hostname** — `LEGACY_ROUTE_MAP` is
  a static table and the middleware rewrite targets `req.nextUrl` only.
- **`postcss` (4 advisories) and `glob`** — build-time and lint-time only; the
  CSS and the lint invocation are not attacker-controlled.
- **`@clerk/*` and `js-cookie`** — Clerk proven unreachable below; `js-cookie`
  is a transitive dep with no attacker-controlled `assign()` input here.

What the Next upgrade *does* still buy: the DoS cluster on the Server Actions
surface (5 advisories at 7.5, and this app has ~25 `'use server'` modules),
RSC response cache poisoning, the Image Optimizer DoS, and unbounded image
disk-cache growth — which is a real operational risk on shared hosting.

### Clerk CVE-2026-42349 is NOT reachable in this app (2026-09-29)

The Clerk advisory is rated High (CVSS 7.6) and is **a call-shape
vulnerability, not an "any app using Clerk" vulnerability**. Only two shapes
are vulnerable:

1. `has()` / `auth.protect()` combining **two** authorization dimensions
   (`reverification` + role/permission/feature/plan, or billing
   feature/plan + role/permission).
2. `@clerk/nextjs` only: `auth.protect()` **silently discards** the
   authorization params when the same argument object also contains
   `unauthenticatedUrl` / `unauthorizedUrl` / `token`.

This app uses **none** of them, verified across all 210 source files:

- `.protect()` is called **exactly once**, `src/middleware.ts:116`, with **no
  arguments** — so there are no params to discard (shape 2 impossible).
- **Zero** `has()` calls on any Clerk object. Every `.has(` in the repo is a
  JS `Set`/`Map`/`Headers` method.
- **Zero** uses of `reverification`, `orgRole`, `orgSlug`, `orgId`,
  `permission`, `plan` or `feature` as authorization params. The app has no
  Clerk Organizations and no Clerk Billing (subscriptions are manual DB rows
  — see Status Lifecycle).
- Authorization is **not** Clerk-based at all: `isAdmin()` is a plain
  `ADMIN_USER_IDS` env lookup in `src/lib/auth.ts:11`, and impersonation is a
  `impersonated_user_id` cookie. `auth()` is read only for `userId`.
- The advisory itself states `clerkMiddleware`, `auth()`, session state and
  token verification are unaffected, and that single-condition checks "continue
  to fail closed".

`tests/unit/clerk-authz-guard.test.ts` **pins this conclusion** — it scans
`src/**` and fails if either vulnerable shape ever appears, if `.protect()`
ever gains arguments, if the single call is removed, or if the deprecated
`getAuth()` returns. It has a self-check suite asserting the scanner really
detects the advisory's own examples and really ignores the safe shapes.

> So: **do not do the Clerk 5→7 major upgrade to fix this CVE.** A major
> upgrade of the auth system — with no integration tests and no way to verify
> locally — risks locking out every client, which is a far worse outcome than
> an unreachable advisory. Revisit only when Clerk ships a patch on the v5
> line (none exists: 5.7.6 is the newest stable v5, only `5.8.0-snapshot.*`
> prereleases follow) or when the app actually adopts org/plan authorization.

- **Do NOT run `npm audit fix --force`** — it jumps Next 14→16 in one step and
  breaks the app silently.
- An `overrides` entry to force `postcss@8.5` into Next 14 was tried and
  rejected: npm refuses (`EOVERRIDE`, postcss is a direct devDependency), and
  forcing it would risk the CSS pipeline to fix a build-time-only advisory.
- Migration plan: `docs/next-16-clerk-7-upgrade-plan.md`. **Clerk is not a
  prerequisite for the Next upgrade** — see that doc for the corrected order.
- Prior to any upgrade, record a manual baseline: sync an order, sync a
  product, update an order, cancel, and run a billing + email cycle.

## Safe Cleanup (2026-09-29)

Checkpoint commit `1fd73c6` ("chore: checkpoint before safe cleanup") holds the
pre-cleanup state. Everything after it is behaviour-preserving.

**Removed dead code** (verified unused by grep across `src` before deleting):
`getZidStoreMeta`, `ZidAPI.storeMeta.deliveryOptions` / `.paymentMethods`,
`getOdooCategories`, `searchOdooAccounts`, `searchOdooJournals`,
`getFieldMappingById`, `getUrlLocaleFromPathname`,
`exchangeAuthorizationCode`, `exchangeAuthorizationCodeWithResponse`.
Kept on purpose: `exchangeAuthorizationCodeForResponse` + `saveTokens` (the Zid
callback uses them), `ZidAPI.storeMeta.orderStatuses`, `stopSyncQueueRunner`,
`stopTelegramPoller`, `botTokenFingerprint`.

**Also removed**: the dead `workspace` / `bell` / `partner` entries in
`sidebar-nav.tsx`'s `ICON_MAP`, the `RawOdooField` type in `field-mapping-client.tsx`,
~12 unused destructured bindings in `odoo.ts`, the `type Language` imports in
three layouts, and the empty dirs `mapping-center/standard/`,
`api/webhooks/zid/stream/`, `components/admin/`.

**Lint is now 0 errors** (was 50 — CI was already red before this cleanup, so
`.gitlab-ci.yml`'s lint stage was failing on `main`). If you introduce an
`unused`/`import order` error, CI turns red again. Unused deps dropped:
`@hookform/resolvers`, `@radix-ui/react-{dropdown-menu,scroll-area,switch,tabs}`,
`immer`, `react-hook-form`, `husky`. Jest/Testing Library were **kept** — no test
files exist yet, but the split below needs them.

**Routing fix**: nine more `/dashboard` → `/app/dashboard` links corrected in the
admin pages, `invoice/[id]`, `SetupWizard`, the impersonate route, and the
sign-in/sign-up Clerk props. `LEGACY_ROUTE_MAP` in `src/middleware.ts` is
deliberately kept for old external links.

**Platform code split — Stage 1 is DONE (2026-09-29).** Stages 2–4 are NOT
started. Source of truth: `docs/platform-code-split-plan.md`.

- `src/lib/platform-fields.ts` now owns the whole `x_<platform>_id` /
  `<platform>_id` table, plus `platformIdField`, `platformLegacyIdField`,
  `platformIdFieldNames`, `allPlatformIdFieldNames`, `pickExistingIdField`
  and `toPlatformKey`. Adding a platform is a one-line change there.
  `tests/unit/platform-fields.test.ts` (23 tests) pins the priority order.
- `pickExistingIdField` takes `{ has(key: string): boolean }`, **not** a
  `Set` — `fetchFieldMeta` returns a `Map<string, OdooFieldMeta>`.
- **Not all six blocks were equivalent.** The plan assumed they were; three
  differ on purpose and are deliberately left alone, each with a comment at
  the site explaining why:
  - the create path never writes `x_shopify_id` (unifying it would start
    writing the column),
  - `erpnext-engine.ts` is Zid/Salla only — zero shopify references,
  - `erpnext-engine.ts` ~479 is a **cross-platform** `else if` chain, not
    platform-scoped, so `pickExistingIdField` is not equivalent.
  Also untouched: `matchStrategy` at ~7005, the field-type defaults at
  ~1888, `stock-sync-engine.ts` and `category-mappings.ts`.
- `syncChildVariantAsVariant` uses the table for its two field names but
  keeps its `try/catch` — its legacy fallback is **exception-driven** (only
  on a thrown error), not existence-driven. Do not "simplify" that to
  `pickExistingIdField`.
- Do **not** add a shopify branch to those skipped sites without a product
  decision — it is a behaviour change, not a refactor.

**Stages 2 and 3 are also DONE (2026-09-29).** Stage 4 (UI) is **decided
against** — see below, do not start it.

- **Stage 2**: `resolveZidShippingCost`, `resolveZidCodAmount`,
  `isSaudiShippingAddress` and `resolveZidStatus` moved out of
  `sync-engine.ts` to `src/lib/zid/order-helpers.ts` (7,122 lines now, was
  7,358). They are pure — no I/O, no Odoo client, no database. All four
  were used only inside `sync-engine.ts`, so the only caller change is one
  import. Verified as a pure move: all 229 deleted lines appear verbatim in
  the new module, and `tests/unit/zid-order-helpers.test.ts` now imports
  from the new path and still passes unchanged.
- **Stage 3**: the field catalogues moved to
  `src/lib/platforms/{odoo,zid,salla,shopify}/fields.ts`, and
  `src/lib/mapping-constants.ts` is now a **19-line barrel** that
  re-exports all ten names, so no import changed. Verified mechanically:
  all 1,163 non-empty original lines are present verbatim in the new files.
  `ODOO_FIELDS` / `STORE_VARIANT_FIELDS` live under `platforms/odoo/`
  because they are Odoo-side, not store-side. New code should import from
  `@/lib/platforms/<platform>/fields` directly; the barrel is for
  backwards compatibility only. `field-mapping-client.tsx` was switched to
  direct per-platform imports (commit `21285b2`), which drops the
  `ODOO_*`/`STORE_VARIANT_FIELDS` constants from its import graph — it
  referenced none of them. `field-mapping-form.tsx` still uses the barrel
  because it genuinely reads all three.
- ⚠️ **The Shopify topic lists were deliberately NOT merged, despite what the
  plan said.** They are not duplicates: `shopify.app.toml` and
  `SHOPIFY_CORE_TOPICS` (5 topics) are what the app subscribes to,
  `SHOPIFY_TOPIC_CATALOG` is the full settings catalogue, and
  `SHOPIFY_EVENTS` (11) is the mapping-centre table that carries a
  `targetModel` per event. `SHOPIFY_EVENTS` offers events the app never
  subscribes to (`products/delete`, `orders/cancelled`, `collections/*`)
  and omits `orders/paid`, which it does subscribe to. Merging them changes
  what the app subscribes to and what the mapping UI shows — a behaviour
  change. The relationship is documented in the header of
  `src/lib/platforms/shopify/fields.ts`. Do not "fix" this duplication.
- ⚠️ **Stage 4 (the UI split) was measured and declined on 2026-09-29 — do not
  start it.** Two reasons, both verified, not assumed:
  1. The plan's premise was wrong. It claimed the two mapping files "mix all
     four platforms equally". Actual reference counts:
     `field-mapping-client.tsx` (5,233) is **odoo-dominated** — 152 odoo vs
     65 zid / 15 salla / 15 shopify. Extracting a shared `FieldMappingPanel`
     per platform would be unifying something that is not evenly split.
  2. **There are no component tests in this project.** All 99 tests are pure
     functions. Splitting 8,161 lines of JSX that *is* the mapping UI has no
     safety net and cannot be visually verified from the CLI.
  Revisit only once Testing Library covers mapping-center. Stages 1–3 are
  done and the UI is intentionally left unified. Full reasoning in
  `docs/platform-code-split-plan.md`.

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
- **Ingress divergences that are deliberate or need a decision — read before
  "fixing" them:**
  - `src/app/api/webhooks/odoo/route.ts` does **not** call
    `isWebhookEventEnabled`, unlike the zid/salla/shopify routes. This is not
    a missing gate. `isWebhookEventEnabled`'s `storeType` union is
    `'zid' | 'salla' | 'shopify'` — there is no `'odoo'` member — and
    `mapEventToEntityAndOp('odoo.model.sync')` returns `null`, which the gate
    treats as `allowed: true`. Adding the call with today's arguments would be
    a no-op that merely *looks* like it gates something. Making ERP→store
    pushes actually respect Mapping Center settings needs a product decision:
    which `store_type` and `entity_type` an inbound Odoo record is judged
    against. `odoo/stock/route.ts` is in the same position.
  - `src/app/api/webhooks/salla/route.ts` hand-rolls the enqueue (its own
    dedup probe, its own coalescing, `max_retries: 3`) instead of calling
    `enqueueWebhookEvent`, which uses `max_retries: 5` and coalesces
    queue-side via `extractEntityId`. It *does* write the receipt and returns
    503 when the durable write fails, so it is not losing data — it is a
    second implementation of the same contract. Converging it moves both the
    retry count and the coalescing behaviour, so it needs a decision.
  - The odoo routes look receipt-less but are not: `enqueueWebhookEvent`
    calls `recordWebhookReceipt` itself (`src/lib/sync-queue.ts:317`) *before*
    the queue insert and returns an error the route turns into a 503. The
    comment at `odoo/route.ts:125` is accurate — do not "add" a receipt there.
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