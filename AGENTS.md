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
- **Secrets at rest** (added 2026-10-01): `src/lib/crypto.ts`. `ENCRYPTION_KEY`
  is the **only** key in source; two hardcoded fallbacks were removed. No
  in-source dev fallback remains either — without `ENCRYPTION_KEY` a random
  per-process key is generated, so a restart invalidates anything written
  before it. `ENCRYPTION_LEGACY_KEYS` (comma-separated, **decrypt only**) exists
  solely to migrate rows written by a retired key. `decrypt()` throws rather
  than returning the ciphertext, because the alternative is an API key silently
  used as a key and a failure indistinguishable from success.

## File Map

### Client Facing
| File | Purpose |
|------|---------|
| `src/components/subscription/SubscriptionStatusCard.tsx` | Subscription status card on dashboard (contacts **support**, never affiliate) |
| `src/components/subscription/SubscriptionBanner.tsx` | Expiry banner (always visible, not dismissible, shown to admins too since 2026-10-19; contacts **support**) |

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
| `.gitlab-ci.yml` | CI: `type-check` + `lint` + `test` + `build` + GitLab security templates |

### Schema
| File | Purpose |
|------|---------|
| `supabase/migrations/20260711_partner_system.sql` | Legacy affiliate DDL — tables stay in DB, unused |
| `supabase/migrations/20260803_subscriptions.sql` | `subscriptions` table + RLS |
| `supabase/migrations/20260922_sync_reliability.sql` | The canonical sync-reliability migration |
| `supabase/migrations/20260922_sync_reliability_paste_ready.sql` | Statement-for-statement variant of the above for the Supabase SQL Editor (`public.`-qualified, `to_regclass` guard, wrapped in BEGIN/COMMIT). **Not** the source of truth |

### Billing helpers
| File | Purpose |
|------|---------|
| `src/lib/workspace-trial.ts` | Pure 7-day free-trial math from `workspaces.created_at` (`TRIAL_DAYS`, `trialEndMs`, `trialRemainingMs`, `isTrialExpired`, `trialDaysRemaining`, `trialEndDate`); NULL/unparseable `created_at` is unknown, not expired (added 2026-10-19) |
| `src/lib/workspace-archive.ts` | Sets/clears `workspaces.archived_at`; `archiveExpiredWorkspaces` has an expired-subscription pass **and** a trial-expired pass (bounded, silent no-op while migration `20261018` is unapplied) |
| `src/lib/subscription-countdown.ts` | Pure d/h/m/s countdown helpers shared by the subscription strip and the trial strip (`msToCountdownParts` for raw durations) |
| `src/app/(app)/app/layout.tsx` | `workspaceClosed` gate: archived or trial-expired workspaces get a "closed" notice instead of the client app; admins and `/app/settings/workspace` are exempt |

### Security helpers (added 2026-10-01)
| File | Purpose |
|------|---------|
| `src/lib/webhook-secret.ts` | The one `secretMatches` — constant-time, called by `src/lib/odoo/webhook-secret.ts` |
| `src/lib/custom-field-validation.ts` | Server-side validation + XML/selection sanitising for the add-custom-field action |
| `src/lib/crypto.ts` | `ENCRYPTION_KEY`-only encryption, ephemeral dev key, `ENCRYPTION_LEGACY_KEYS` decrypt-only migration, plus `hkdfHex()` (2026-10-03) — the one HKDF used by both derived ingress credentials |
| `src/lib/zid/webhook-auth.ts` | The Basic credential Zid actually supports, HKDF-derived from `ENCRYPTION_KEY`, and the `ok`/`invalid`/`legacy`/`unconfigured` ingress classification (added 2026-10-03) |
| `src/lib/odoo/webhook-secret.ts` | Per-scope Odoo ingress credential (`stock:<workspace_id>` / `record:<field_mapping_id>`), the shared `ok`/`invalid`/`legacy`/`unconfigured` decision both Odoo routes use, and the legacy-delivery counter (added 2026-10-03) |
| `src/lib/telegram/link-code.ts` | The pure `/start <code>` parsing rule the Telegram poller uses — kept import-free so it can be unit-tested without a database (added 2026-10-03) |
| `src/app/api/admin/odoo-webhooks/refresh/route.ts` | Re-registers every Odoo Automated Action with a derived secret, create-before-delete; refuses to run if nothing is derivable |

## Common Commands

```bash
# Type-check the whole project
npm run type-check

# Lint — clean (0 errors) as of 2026-09-29
npm run lint

# Unit tests — 681 tests over 43 suites (added 2026-09-29, grown 2026-10-19)
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
- ⚠️ **`moduleNameMapper` cannot override an alias, because SWC gets there
  first.** `next/jest` hands `tsconfig.paths` to the SWC transform, so an
  import is rewritten *before* Jest resolves it, and the rewritten specifier
  depends on the importing file's location (`@/lib/supabase`,
  `.../src/lib/supabase`, or `../../lib/supabase`). A mapper entry for the
  alias alone therefore matched **none** of them: `tests/mocks/supabase.ts` was
  never loaded, and a test importing `@/lib/supabase` silently built a **real
  Supabase client and hit the real database** (it showed up as a Postgres
  `invalid input syntax for type uuid` plus 200 ms+ per query).
  `jest.config.js` now lists all three shapes, with `.*lib[\\/]supabase$` as
  the one that actually fires. **No test may open a real DB connection** — if a
  test suddenly gets slow, times out at 5 s, or fails with a Postgres error
  message, the mapper regressed. Assert on `supabase.calls`, never live data.
- `supabase.calls` records `{ table, op, args, filters }`; `filters` captures
  `eq`/`neq`/`match` so a test can prove a query was scoped to a workspace.
  Its builder `then` must *call* the resolve callback `await` hands it — an
  `async () => value` there hangs forever. It was broken until the first test
  that actually awaited a query.
- `jest.mock()` does not resolve the `@/` alias, even though a static import
  of the same path does. Use a relative specifier (`../../src/lib/users`).
  TypeScript *also* resolves the alias, so a test needing the mock's own API
  (`supabase.calls`) must import `../mocks/supabase` by path. Both resolve to
  the same file, hence one instance — `static-mappings-allowlist.test.ts`
  asserts that explicitly, because two instances would make it vacuous.
- 681 tests over 43 suites:
  - `tests/unit/zid-order-helpers.test.ts` — `resolveZidShippingCost`,
    `resolveZidCodAmount`, `isSaudiShippingAddress`, `resolveZidStatus`
  - `tests/unit/sync-queue-dedup.test.ts` — `fingerprintPayload`,
    `extractEntityId` (the anti-data-loss rules)
  - `tests/unit/sync-workspace-scoping.test.ts` — source pins proving the
    `field_mappings` query is scoped by `resolvedWorkspaceId` and the preset
    path prefers `deliveryWorkspaceId` over a borrowed mapping's workspace
    (see Cross-tenant safety); each pin has a self-check that fails on the
    old shape
  - `tests/unit/subscription-dates.test.ts` — `computeSubscriptionEndDate`,
    `addMonthsToDate`, `addDaysToDate`, `isValidIsoDate`
  - `tests/unit/subscription-countdown.test.ts` — the banner's per-second
    expiry countdown (`subscriptionRemainingMs` clamped ≥0 with an injectable
    `now`, `msToCountdownParts`, `countdownParts`, both language formatters'
    skip-zero/singular rules, and the pinned loose Arabic plural rule, see
    Status Lifecycle), plus the compact trial readout (`formatClock` →
    "21:06:56" and `formatTrialRemainingAr`/`En` → "6 أيام و 21:06:56" /
    "6 days and 21:06:56", day prefix dropped under one day)
  - `tests/unit/workspace-trial.test.ts` — the 7-day free-trial clock derived
    from `workspaces.created_at` (`trialEndMs`/`trialRemainingMs`/
    `isTrialExpired`/`trialDaysRemaining`, injectable `now`): the clamp rules,
    and the pinned policy that a NULL/unparseable `created_at` is **unknown,
    not expired** (fail-open), see Status Lifecycle
  - `tests/unit/odoo-operation-routing.test.ts` — `normalizeOdooOperation`,
    `presetEntityType`
  - `tests/unit/clerk-authz-guard.test.ts` — scans `src/**` to prove the
    Clerk advisory is unreachable (see Known Vulnerabilities)
  - `tests/unit/platform-fields.test.ts` — the `x_<platform>_id` table and
    the `current` → `legacy` resolution order (Stage 1 of the platform split)
  - `tests/unit/crypto.test.ts` — `encrypt`/`decrypt`, legacy-key rotation,
    and that the retired production key is in no file under `src/`. The key is
    **assembled from fragments** in the test: writing it out in full would put
    the very secret the suite purges back into the repository. A self-check
    pins the fragments so the assertion cannot degrade into a passing no-op.
  - `tests/unit/custom-field-validation.test.ts` — the server-side custom-field
    validation, XML attribute escaping and selection-string sanitising
  - `tests/unit/static-mappings-allowlist.test.ts` — the seven-table allowlist
    in `static-mappings.ts`, the `workspace_id`/`platform` overwrite, and that
    a forbidden table is never touched at all
  - `tests/unit/webhook-secret.test.ts` — `secretMatches`, and that there is
    exactly one copy of it
  - `tests/unit/odoo-webhook-trust.test.ts` — source-level pins for the Odoo →
    store trust rule (see Sync Reliability). These were checked to actually
    fail when the rule is reverted, so they are not vacuous.
  - `tests/unit/zid-webhook-auth.test.ts` — the derived Basic credential, the
    `ok`/`invalid`/`legacy`/`unconfigured` classification, and source pins that
    the dead HMAC path and the unsupported `secret` registration field stay gone
    (see Ingress auth). It also asserts the refresh route is admin-gated and
    refuses to delete webhooks when no credential is derivable.
  - `tests/unit/build-odoo-values-mobile.test.ts` — `buildOdooValues`' `mobile`
    guard: the field is written when Odoo confirms it exists and skipped when it
    does not, without touching the other hardcoded fields (Odoo 19 removed it)
- `tests/unit/telegram-link-code.test.ts` — the `/start <code>` parsing rule,
    including that a 6-character token the generator cannot produce is rejected
    (see Telegram bot)
  - `tests/unit/telegram-poller-boot.test.ts` — source pins proving the poller is
    started from `instrumentation.ts` and not only by a server action, and that
    the decrypt / `getUpdates` / ignored-update paths still log. Checked to fail
    when the boot wiring is removed, so it is not vacuous
  - `tests/unit/salla-webhook-auth.test.ts` — the dual-path credential (native
    HMAC **and** the derived header), the four-way classification, the `token`
    strategy resolved against Salla's self-contradicting docs, the published-event
    allowlist that stops invented slugs, and source pins that the unauthenticated
    `app.uninstalled` guard and the stale-event receipt stay put. All four pins
    were **checked to actually fail** when the rule is reverted, so none is
    vacuous. The negative assertions run against a comment-stripped copy of the
    source: these files deliberately *name* the retired `SALLA_WEBHOOK_SECRET` in
    their comments, and a comment is not a read
  - `tests/unit/event-operation.test.ts` — the event→operation routing contract
    (26 tests): every one of the 29 subscribed Salla events classified
    explicitly, gate↔writer agreement, and the shipment regressions. Every pin
    was **checked to actually fail** when the rule is reverted
  - `tests/unit/odoo-webhook-auth.test.ts` — the per-scope derived credential,
    the same four-way classification, and source pins that the shared env secret
    is never *read* again (naming it in a comment is fine) and that verification
    precedes the first `.select()`. It also asserts the refresh route is
    admin-gated and refuses to run when nothing is derivable.
- ⚠️ **A `'use server'` module may only export async functions.** Next fails
  the build with "Server actions must be async functions" otherwise — this
  happened when the subscription date helpers were briefly exported from
  `subscription-actions.ts`. They now live in `src/lib/subscription-dates.ts`
  (a normal module) and the action file delegates to them. Put pure logic in a
  plain `src/lib/*` file, never in `src/app/actions/*`. This is also why
  `custom-field-validation.ts` and `webhook-secret.ts` are separate modules.
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

## Known Vulnerabilities (updated 2026-10-04, Next 15 upgrade)

`npm audit` was **49 (0 critical, 1 moderate, 48 high)** after the Next 15
upgrade, down from **50 (1 critical, 49 high)**. **The one critical is gone.**
After the Clerk 5→6 upgrade (2026-10-08) it reports **52 (8 moderate,
44 high)** — the delta is Clerk v6's own dependency tree, still 0 critical.
Nothing fixable
without a major bump was left behind (`npm audit fix` + nodemailer 7→10 + axios
1.18.1→1.20.0). What remains needs a framework major upgrade:

| Package | Now | Needs | Real risk here |
|---|---|---|---|
| `next` | 15.5.27 | 16.3.3+ | **None known** — its only advisory now arrives `via: postcss` (build-time, see below) |
| `@clerk/nextjs` | 6.39.7 (v6 line, since 2026-10-08 — v5 broke every route, see below) | 7.x | **None reachable — see below** |
| `postcss` | (nested in Next) | — | Low — build-time only; this is the *only* thing `next` still reports |
| `glob` | — | via eslint-config-next 16 | Low — lint tool only |

The Next 14→15.5.27 upgrade (see **Next.js 15 — upgraded 2026-10-04** below)
closed the critical and is why `next` has no direct advisory any more. The 48
highs are overwhelmingly **dev-tooling only** — `jest` + `@jest/*`,
`@types/jest`, `eslint-config-next`, `@next/eslint-plugin-next`,
`@typescript-eslint/*`, `tailwindcss`, `lint-staged`, and their transitive
deps (`braces`, `chokidar`, `fast-glob`, `globby`, `micromatch`). None of it
ships to the server. The only runtime-relevant highs left are Clerk and
`js-cookie` (a Clerk transitive), both already reasoned about below.

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

### The one Critical that did apply: AVIF RCE — **FIXED 2026-10-04**

Of the 30 distinct advisories npm reported on Next 14, almost none were
reachable. One was, and it was not hypothetical.

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

**Timeline:** on 2026-09-29 it was mitigated the advisory's own way —
`formats: ['image/webp']`. On **2026-10-04** the framework moved to
`next@15.5.27`, which is inside the patched range, so the mitigation was
**reverted** and `formats: ['image/avif', 'image/webp']` is back.

> ⚠️ **The real mitigation was always the version, not the format.** `AVIF off`
> only closed this one advisory while leaving every other Next 14 advisory open.
> If Next is ever downgraded below `15.5.24`, removing `'image/avif'` is
> **necessary but not sufficient** — the whole `>=10.0.0 <15.5.24` range is
> affected. `/_next/image` is unauthenticated by design (`src/middleware.ts`
> excludes it from the Clerk matcher), so it is public attack surface for any
> image format.
>
> Worth knowing: `next/image` is used in **exactly one place** in the whole app
> (`src/components/ui/logo.tsx`), and it points at a **local** path
> (`/logo*.png`). No remote image is ever optimised. That is also why the
> `images.remotePatterns` entries are effectively unused config today, and why
> they are deliberately **exact-hostname** rather than `**.zid.store` /
> `**.odoo.com` — `domains` allowed subdomains, `remotePatterns` does not, and
> widening them again would grow the public endpoint's reach for zero benefit.

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

### Next.js 15 — upgraded 2026-10-04 (14.2.35 → 15.5.27, React 18 → 19)

**Why 15.5.27 and not 16.** The host is a Node process, not a serverless
platform, so nothing forced the major-16 jump, and `15.5.27` is inside the
`>=15.5.24` patched range — i.e. it is the version that actually fixes the AVIF
RCE. Clerk was **not** touched (`@clerk/nextjs@5.7.6` supports Next 15 and
React 19), which was the whole point: see the Clerk section below for why a
Clerk major upgrade is the one thing to avoid here.

> **Update 2026-10-08 — Clerk 5.7.6 → 6.39.7, forced by a runtime break (not
> the CVE).** Clerk v5's `ClerkProvider` calls `headers()` **synchronously**
> (`dist/cjs/app-router/server/ClerkProvider.js:44`, plus `buildRequestLike`
> in `utils.js`), and Next 15.5 turns that into a hard `sync-dynamic-apis`
> error — so **no route rendered at all** (`/` and `/sign-in` both threw
> ``headers()` should be awaited``). v6 makes `ClerkProvider` async with
> `await headers()` (verified in the 6.39.7 source before upgrading). Code
> changes were two lines: `public-site-header.tsx` became `async` with
> `await auth()`, and `middleware.ts` uses the v6 `await auth.protect()`
> form (confirmed against the installed `clerkMiddleware.d.ts`/`auth.d.ts`).
> Everything else already used `await auth()` / `await clerkClient()` /
> `await currentUser()`. `clerk-authz-guard.test.ts` still passes unchanged
> (the `.protect(` scan matches `auth.protect()` the same way). Do **not**
> downgrade back to v5 — staying there re-breaks every page. v7 is still
> out of scope.

**What the codemod changed, and the two edits a codemod cannot make.**

`npx @next/codemod@next-async-request-api .` touched **34 files**:

1. `cookies()` and `headers()` became `Promise`-returning, so every call site
   gained an `await`. This includes files with **no** `params` — plain server
   components and layouts such as `src/app/layout.tsx`, every page under
   `src/app/(public)/`, and the three webhook routes.
2. `params` / `searchParams` in page signatures became `Promise<…>`.

Two follow-ups were required and are easy to miss:

- **`UnsafeUnwrappedCookies` escape hatches.** Where `cookies()` was called in a
  **non-async** function (4 files: `src/app/not-found.tsx`,
  `src/app/(app)/app/dashboard/{loading,not-found}.tsx`,
  `src/components/ImpersonationBanner.tsx`) the codemod could not `await`, so
  it inserted the `as unknown as UnsafeUnwrappedCookies` cast instead. That
  **compiles and works**, but it logs a deprecation warning on every render in
  production and the escape hatch is deleted in Next 16. All four are now real
  `async` components. **Do not let that cast back into the tree.**
- **A mangled dynamic import.** `src/lib/auth.ts:83` reads cookies through a
  lazy `await import('next/headers')` (deliberately lazy — it runs in a
  `try/catch` for the impersonation write-block), and the codemod injected an
  explanatory comment **between** the `await` and the `import`. It parsed, but
  it is mangled. Rewritten by hand to a single clean line.

**Exactly one real React 19 type break**, in `src/components/ui/button.tsx`:
`React.isValidElement()` / `React.Children.only()` now narrow to
`ReactElement<unknown>`, so the shadcn `asChild` pattern's `child.props.className`
stopped type-checking. Fixed with a narrow assertion to
`ReactElement<{ className?: string }>` — type-only, no runtime change.

**`next.config.js` moves** (all three are Next 15 stabilisations, not choices):

| Removed | Replacement |
|---|---|
| `experimental.instrumentationHook: true` | nothing — `instrumentation.js` is stable in 15, and the build still emits `.next/server/instrumentation.js` |
| `experimental.serverComponentsExternalPackages` | top-level `serverExternalPackages: ['xmlrpc']` |
| `images.domains` | `images.remotePatterns` |
| `swcMinify: true` | nothing — SWC minification is the default |

**Gotcha — do not run `npx prettier --write "src/**/*"`.** The repo has **never**
been prettier-clean: `npm run format:check` reports **236 files** with style
issues at `HEAD`. Formatting the tree after a codemod buries the upgrade diff
under ~10k lines of unrelated churn (`sync-engine.ts` alone was 3102 changed
lines). If a codemod introduces trailing semicolons, strip them with a targeted
script instead — the codemod's own output style is the repo's style.

> **Verification recorded 2026-10-04:** `type-check` 0 errors, `lint` 0 errors
> (1 pre-existing `no-explicit-any` warning in
> `tests/unit/build-odoo-values-mobile.test.ts`), `npm test` 236/236 across 16
> suites, `npm run build` compiled successfully with zero warnings, and
> `.next/server/instrumentation.js` confirmed emitted. One caveat recorded
> honestly: `tests/unit/crypto.test.ts` (legacy-key decryption) failed **once**
> in ~6 full-suite runs and passed every other time, including 5 consecutive
> clean runs. Not caused by this upgrade — neither `src/lib/crypto.ts` nor
> `tests/` is in the diff — but it is a **latent flake in a security test** and
> worth hardening separately.

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
  2. **There are no component tests in this project.** All 224 tests are pure
     functions or source scans — none render a component. Splitting 8,161 lines
     of JSX that *is* the mapping UI has no safety net and cannot be visually
     verified from the CLI.
  Revisit only once Testing Library covers mapping-center. Stages 1–3 are
  done and the UI is intentionally left unified. Full reasoning in
  `docs/platform-code-split-plan.md`.

## Data Model

- `subscriptions`: workspace_id, user_id, start_date, months_paid, end_date,
  amount_paid, currency, status (active/cancelled), notes, created_by, archived_at.
  `affiliate_id` is a **legacy read-only column** (old rows may have values via
  `SELECT *`; new rows are always `NULL` — never write it, never display it).
- `subscription_payments`: per-payment rows (subscription_id, amount, paid_at, notes, created_by)
- `workspaces`: id, user_id, name, subscription_number, `archived_at`
  (added 2026-10-18, migration `20261018_workspace_archive.sql` — set
  automatically when the last active subscription expires; cleared when a new
  subscription is registered or extended). No affiliate linkage.
- `users`: id, email, name, active_workspace_id (+ `created_at`).
  ⚠️ **`phone` is NOT reliably there.** It exists only in migration
  `20260805_client_phone_and_archive.sql`, which was never applied in some
  environments — selecting it fails the query with `column users.phone does
  not exist` (2026-10-10 outage: it was added to the per-action `users.ts`
  lookup and took the whole app down, because that lookup runs inside every
  server action). Live columns were probed 2026-10-10: id, email, name,
  `active_workspace_id`, `created_at`. Never assume a `users` column without
  probing the live table; `getAllClients` maps `phone: null` until the
  migration is applied.
- `audit_logs`: security audit trail
- Legacy (unused, **do not delete yet** — cleanup migration later):
  `partner_profiles`, `partner_tier_history`, `partner_commissions`,
  `payout_requests` (+ `partner_*` columns on `workspaces` if present)

## Status Lifecycle

### Subscription: admin registers manually (manual payment only, no Stripe)
1. `registerSubscription` (admin): validates client user + workspace, computes
   `end_date = start_date + months − 1 day`, inserts subscription with
   `affiliate_id = NULL`, records a `subscription_payments` row when amount > 0.
   **No commission is created.** Unarchives the workspace afterwards.
2. `extendSubscription` (admin): extends `end_date`, adds months, bumps
   `amount_paid` total, records a payment row. **No commission.** Two modes
   (added 2026-10-18):
   - `months`: calendar months on top of `end_date` — **only on a
     non-expired subscription** (extending an expired one by months still
     refuses with `subscription_expired`; register a new one instead).
   - `days`: whole days — **allowed on an expired subscription too**, in which
     case the base is `today` (manual-renewal / grace flow). Days do NOT change
     `months_paid` (it is the MRR divisor). When the new `end_date` is valid,
     the workspace is unarchived.
3. `cancelSubscription` (admin): sets status `cancelled` (no auto-expiry — `end_date` is source of truth)
4. `archiveSubscription` / `restoreSubscription`: soft-hide old rows from the statement (audit + payments intact)
5. `addSubscriptionPayment`: extra payment against a subscription, bumps `amount_paid` total
- **Free trial (added 2026-10-19):** every workspace gets an automatic
  **7-day free trial** derived from `workspaces.created_at` — no column, no
  migration, pure math in `src/lib/workspace-trial.ts` (`TRIAL_DAYS = 7`).
  The trial exists **only while the workspace has no non-expired active
  subscription**; registering a paid subscription supersedes it entirely
  (`getMyActiveSubscription` then returns `trial: null`). When the trial runs
  out with no subscription the workspace **closes**: `archived_at` is set
  (lazy + the 6h pass) and the client app is replaced by a "closed" notice
  (`workspaceClosed` gate in `src/app/(app)/app/layout.tsx`). The gate exempts
  admins and keeps `/app/settings/workspace` reachable so a user with another
  active workspace can still switch. A NULL/unparseable `created_at` is
  **unknown, not expired** — no trial countdown, no auto-archive (fail-open).
- Client sees a **fixed top alert strip** (`SubscriptionBanner.tsx`) rendered
  above the entire app shell on every page (layout is `h-screen overflow-hidden`,
  banner is a sibling of the scrolling main area — the page scrolls underneath
  it). States: **all red since 2026-10-19** (the near-expiry strip was amber
  before and was made red on request) — no subscription with no trial clock
  ("غير مفعلة") and expired ("المساحة مؤرشفة") carry no countdown because
  they have no deadline; the **free trial** shows a live readout ticking every
  second in the compact form "6 أيام و 21:06:56" / "6 days and 21:06:56" (day
  count + fixed HH:MM:SS clock; the day prefix drops under one day) and flips
  to "انتهت التجربة … مساحة العمل مغلقة" at zero, and when
  ≤7 days remain on a subscription the strip shows a live
  **day/hour/minute/second countdown ticking every second**
  (`src/lib/subscription-countdown.ts`, tests in
  `tests/unit/subscription-countdown.test.ts`) and states when the workspace
  will close, flipping to the expired message at zero without a reload;
  nothing otherwise (>7 days). The trial countdown targets the exact
  `created_at + 7d` instant via `msToCountdownParts`, unlike the subscription
  countdown which targets the end of the inclusive `end_date` day.
  Shown to admins too, and **not dismissible** — the X and the sessionStorage
  memory (`subscription_banner_dismissed`) were removed 2026-10-19 on request:
  the strip must stay on every page view for as long as the state warrants.
- Workspace auto-archive (added 2026-10-18, trial pass added 2026-10-19):
  `src/lib/workspace-archive.ts` sets `workspaces.archived_at` in two cases:
  (1) a workspace's latest active subscription expired and no non-expired
  active subscription remains, and (2) a workspace has **no live subscription
  and its 7-day trial has run out** (`created_at` older than `TRIAL_DAYS`).
  Triggered three ways: the 6h runner ticker (`WORKSPACE_ARCHIVE_INTERVAL_MS`),
  lazily inside `getMyActiveSubscription` (fire-and-forget), and on-demand by
  the admin UI. The old carve-out "workspaces with no subscription at all are
  NOT archived (might be mid-signup)" is **superseded** — the trial window IS
  the mid-signup grace period; older unsubscribed workspaces close as of
  2026-10-19 (the pre-existing workspace `703f0dae` created 2026-10-08
  qualifies). A live subscription always wins: the pass excludes any workspace
  with a non-expired active subscription. Unarchive happens automatically on
  `registerSubscription` / `extendSubscription`. Migration `20261018` is
  **applied as of 2026-10-19** (verified live), so the trial pass is active;
  the missing-column guards in `archiveExpiredWorkspaces` / `archiveWorkspace`
  remain as graceful degradation for any other environment that has not pasted
  it — and the trial **countdown and layout gate** need only
  `workspaces.created_at`, so they work either way (they do not depend on the
  `archived_at` write succeeding).

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
  `serverExternalPackages` list (top-level since Next 15) is now just
  `['xmlrpc']`. Supabase REST is the only data path and
  `supabase/migrations/*.sql` is the sole source of truth for the schema. Do
  not re-add Prisma.
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
- ~~`salla/route.ts` hand-rolls the enqueue~~ — **converged 2026-10-05.** It
    now calls `enqueueWebhookEvent` like every other route, so Salla gets the
    shared `max_retries: 5`, queue-side coalescing via `extractEntityId`, and the
    atomic dedup key. It previously keyed `dedup_key = null` whenever Salla sent
    no delivery id, which meant no duplicate protection at all.

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
3. `supabase/migrations/20261009_sync_logs_speed.sql`
   - `sync_logs.resolved_manually` boolean + one-time backfill from the legacy
     `Resolved manually` error text (the ilike text scan it replaces could never
     use an index and made every stats call a full-table scan)
   - composite list indexes `(workspace_id, created_at)`, `(workspace_id,
     status, created_at)`, `(workspace_id, event, created_at)` + a partial
     resolved index — the `/app/logs` list, filters and head-counts are
     index-only after this
   - idempotent (`IF NOT EXISTS` throughout); **required by
     `src/app/actions/sync-logs.ts`** (status filter + stats read the column —
     without it those queries 400)
4. `supabase/migrations/20261010_app_read_speed.sql`
   - read-path indexes for every hot page query (added 2026-10-10, dashboard
     connection review): `data_transfers(workspace_id, created_at)` +
     `(workspace_id, status, created_at)`, `field_mappings(workspace_id)`,
     `subscriptions(workspace_id, status, end_date)` +
     `(workspace_id, created_at)`, `sync_queue(workspace_id, created_at)`,
     `sync_queue_dead(workspace_id, died_at)`, a partial orphan index on
     `webhook_inbox(store_id, received_at) WHERE pending AND workspace_id IS
     NULL`, `erp_connections(workspace_id)`, `workspaces(user_id, created_at)`,
     `users(created_at)`
   - every index is guarded by `to_regclass` (core tables were created from the
     Supabase dashboard, outside the migrations folder, so a missing table
     skips its index instead of failing the file) + `IF NOT EXISTS`
   - pairs with the code-side fixes of the same date: 45s single-flight
     `ttlCache` on `getDashboardStats`/`getEventDistribution`/`getDailyActivity`
     (50 concurrent dashboard loads collapse to one upstream query set), lean
     selects instead of `select('*')` on counts and admin lists, hard `limit`
     caps on unbounded list queries, and `getAllClients` scoped to the page's
     workspaces with optional `{ limit, offset }` pagination
5. `supabase/migrations/20261018_workspace_archive.sql`
   - `workspaces.archived_at` TIMESTAMPTZ + partial index on non-NULL
   - **required by `src/lib/workspace-archive.ts`** — until it is applied the
     archive helpers fail softly (`isWorkspaceArchived` → false,
     `archiveExpiredWorkspaces` → `{ archived: 0 }`), so nothing breaks, but
     the auto-archive feature is inert
   - idempotent (`to_regclass` guard + `IF NOT EXISTS`, BEGIN/COMMIT)
    - **the file itself is already paste-ready** — `public.`-qualified, guarded
      and BEGIN/COMMIT-wrapped, so unlike `20260922` it needs no
      `_paste_ready` variant: paste it directly into the Supabase SQL Editor.
      **Applied 2026-10-19** and verified live the same day: the column exists,
      and the trial pass archived the overdue workspace `703f0dae` (created
      2026-10-08) ~24s after the deploy that shipped it.

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
| same runner, archive ticker | every **6 h** (`WORKSPACE_ARCHIVE_INTERVAL_MS`, min 5 min) | `archiveExpiredWorkspaces()` — sets `workspaces.archived_at` on expired-subscription workspaces |
| `GET /api/cron/sync-queue` | on demand only | `drainWebhookInbox` → drain loop (≤40s) → metrics + orphan count |
| `GET /api/cron/reconcile` | on demand only | single reconciliation cycle |

- The inbox drain runs **before** `processSyncQueue` in every cycle: receipts
  written by ingress are enqueued in the same tick instead of waiting a full
  extra period. `WEBHOOK_INBOX_DRAIN_BATCH` is a constant (25) in
  `sync-queue-runner.ts`, not an env var.

- Started **once** at boot from `src/instrumentation.ts`. `instrumentation.js`
  is **stable since Next 15**, so no `experimental.instrumentationHook` is
  needed any more — the flag was removed on 2026-10-04 and the build still
  emits `.next/server/instrumentation.js`, which is what proves the hook is
  registered. `instrumentation.ts` skips Vercel and `phase-production-build`.
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
- `findExistingOdooRecord` in `src/lib/sync-engine.ts` scopes the `sync_logs`
  lookup by `workspace_id` **and** `platform` — `zid_entity_id` alone is not
  unique across merchants. Keep the filter when touching that function.
- **`processWebhookEvent` must scope its `field_mappings` query by
  `resolvedWorkspaceId`** (added 2026-10-18). It used to match on
  `store_id`/`merchant_id` alone, so a **stale row in another workspace**
  carrying the same merchant id hijacked the whole sync: `processFixedMappingFallback`
  borrowed `existingMappings[0].workspace_id` + `erp_connection_id`, i.e. the
  other workspace's `standard_mapping_settings`, ERP connection and custom
  mappings ran against this store while the owner's saved settings were never
  read. This was the live "Salla categories ignore my settings and follow old
  ones" report — Zid looked fine only because no stale row matched its store.
  The preset function now takes `deliveryWorkspaceId` and prefers it, borrowing
  the connection only from a same-workspace mapping (else `null`, which falls
  back to the workspace's own `erp_connections`). Keep the `.eq('workspace_id',
  resolvedWorkspaceId)` guard and the `deliveryWorkspaceId` parameter when
  touching either site — `tests/unit/sync-workspace-scoping.test.ts` pins both
  (with self-checks that fail on the old shape). Known stale row at the time of
  the fix: `field_mappings.id = 1ebeec88-…` ("test 1", workspace `703f0dae-…`,
  `merchant_id = 2147022192`) — harmless after the fix (no scoping means it can
  never match again) but orphaned data awaiting cleanup.

### Odoo → store: the webhook body is a trigger, never a source (2026-10-01)

Ingress used to be `ODOO_WEBHOOK_SECRET` — **one shared secret** that every
customer's Odoo instance knows, and which is **not set on the host**. Since
`ab55dae` (2026-09-28) that made `odoo/stock/route.ts` answer
`[Odoo Stock Webhook] Security Alert: ODOO_WEBHOOK_SECRET is not configured in
production.` — a 500, so **every ERP→store push has been dead since then**,
with no error on the Odoo side. Setting the env var would not have fixed it: the
registered Automated Actions send no secret, so the result would have been 401
instead. Both routes now use per-scope derived secrets (see Ingress auth below).

The value-trust rule is unchanged and independent of auth, in
`src/app/api/webhooks/odoo/route.ts` step 3:

| `odooClient.read()` | what is trusted | outcome |
|---|---|---|
| returned the record | **the record only** | body ignored entirely, including the removal signal |
| returned empty | body | the record really is gone — this is the deletion flow |
| threw | **nothing** | `FAIL` → retried 5×, then dead-lettered |

The `recordFromOdoo` flag is what carries that decision down to
`hasRemovalSignal`, which only reads the body when the record was *not* read
back. Do not "improve availability" by falling back to the body on a read
error — that hands anyone with the shared secret a way to push arbitrary prices
into stores exactly while the ERP is down. `tests/unit/odoo-webhook-trust.test.ts`
pins all three branches and fails if the rule is reverted.

Residual, deployment-level: the secret proves *which* scope, not *which tenant
asked*. A caller holding workspace W's secret can still choose *which*
`workspace_id` a stock re-push targets. `odoo/stock/route.ts` validates the UUID
shape and that an `erp_connections` row exists, which drops nonsense ids but
cannot tell a real tenant from a forged one. Closing that needs the URL id bound
to the credential (a signature over the pair), which Odoo's native webhook cannot
send.

### Telegram bot: the poller is started at boot, not by an action (2026-10-03)

**This was a live "the chat never links" bug, and the cause was invisible from
the UI.** The bot token check in `addBotToken` is a direct `getMe` fetch from the
server action, so a token can be perfectly valid while *nothing is polling that
bot*. `startTelegramPoller()` was called from exactly two places — `addBotToken`
and `generateChatLinkCode` — and from nowhere else. `src/instrumentation.ts`
started only the sync queue runner. So the poller existed only inside whichever
process happened to run those actions, and after a restart or a deploy there was
no poller at all: `getUpdates` was never called, `/start <code>` was silently
dropped, the customer got no reply from the bot, and the app sat on "waiting for
link…" until the user happened to re-add the token by hand.

- `src/instrumentation.ts` now starts the poller next to `startSyncQueueRunner()`,
  behind the same `!process.env.VERCEL` gate — long polling needs the long-lived
  Node process the sync runner already relies on. `forceRefreshTelegramPoller()`
  stays in the two actions, but it is now an optimisation (wake the new bot up
  without waiting for the 30s DB refresh), never the reason the poller runs.
- **Never make a failure path in the poller silent again.** All three were, and
  each one is indistinguishable from a quiet bot:
  `decrypt()` of a token saved under a retired `ENCRYPTION_KEY` (a `catch {}`
  that only bumped a counter), a `getUpdates` error (logged only as a count at
  exactly 5, without Telegram's `description` — 409 means two pollers on one
  token, 401 a revoked token), and a received-but-ignored update.
- The bot now logs its start-up line, how many bots it is polling, every update
  it receives, the code it extracted, and the success line. **"0 bots"** or no
  `update … from chat …` line is the first thing to look at.
- Code parsing lives in `src/lib/telegram/link-code.ts` (pure, no imports) so it
  is testable without a database. It accepts `/start CODE`, `/start@Bot CODE`,
  the bare code, lower case and extra words, and it rejects 6-character tokens
  containing `I`, `O`, `0` or `1` — the generator's alphabet omits those four
  (`generateLinkCode`), so such a token can never be one of our codes and used to
  cause a pointless lookup and a misleading "invalid code" reply.

### Ingress auth, 2026-10-01 (Zid **and Odoo** rewritten 2026-10-03 — the earlier text was wrong)

- `secretMatches` lives in `src/lib/webhook-secret.ts` (one copy — it was
  duplicated in both Odoo routes) and always uses `crypto.timingSafeEqual`.
  Length is compared first because `timingSafeEqual` throws on a mismatch, and
  a throw would be a 500 instead of a 401.
- ⚠️ **Zid signs nothing.** The 2026-10-01 entry claimed Zid sends an
  `X-Zid-Signature` HMAC-SHA256 and that a missing `ZID_WEBHOOK_SECRET` was a
  hard 500. Both were wrong, and the combination took **every Zid delivery in
  production to a 500**: the secret was never set, and it could never have
  worked. Zid's `POST /v1/managers/webhooks` schema is `event`, `target_url`,
  `original_id`, `conditions`, `username`, `password` — there is no `secret`
  field, and the old registration sent one that Zid silently ignored.
- **The mechanism Zid actually supports is HTTP Basic.** Supply `username` +
  `password` when creating the webhook and Zid sends
  `Authorization: Basic base64(username:password)` on every delivery
  ("This allows partners to verify that the webhook request is coming from
  Zid"). That is now the only ingress check.
- **The credential is derived, not configured** —
  `src/lib/zid/webhook-auth.ts` HKDF-SHA256s `ENCRYPTION_KEY` with the
  domain separator `zid-webhook-basic-auth:v1`. Reason: no new env var could be
  added on the host, and `ENCRYPTION_KEY` is already guaranteed in production
  because `crypto.ts` refuses to boot without it. What Zid stores is the HKDF
  output; the key itself is never sent and never committed. Rotating
  `ENCRYPTION_KEY` invalidates the credential and requires re-registration —
  the same operational class as `ENCRYPTION_LEGACY_KEYS`.
- **Credentials live on the webhook row, so re-registration is mandatory.**
  A webhook created before this change keeps delivering with no `Authorization`
  header forever; no server-side config can fix it. `POST
  /api/admin/zid-webhooks/refresh` (Clerk + `isAdmin`, also a button on
  `/app/admin`) deletes and re-creates each linked store's webhooks, one store
  at a time (Zid allows ~60 req/min). It refuses to touch anything when no
  credential is derivable — deleting first would replace working webhooks with
  ones that can never authenticate.
- **Legacy deliveries are currently accepted.** `verifyZidWebhookAuthorization`
  returns `ok` / `invalid` / `legacy` (no header) / `unconfigured`, and the
  route accepts `legacy` rather than 401-ing it, because a hard reject would
  silently kill every store's sync during the migration. What it will not do is
  act destructively on one: `app.uninstalled` (the only irreversible branch —
  it deletes the merchant's tokens, and `store_id` sits in the URL) is refused
  for unauthenticated callers. The server log counts them
  (`Unauthenticated delivery #N`, logged for the first 3 and every 50th) — that
  counter reaching zero is the signal to drop the `legacy` branch.
- **Event loss during the migration window:** the refresh is delete-then-create,
  so a store's events are briefly unregistered. `reconcileZidOrders()` heals
  **orders**; it does not cover products, so re-sync products by hand after
  running the refresh if the gap mattered.
- ⚠️ **Odoo also signs nothing, and Odoo's native webhook cannot send a custom
  header.** The previous entry claimed Odoo used a shared `ODOO_WEBHOOK_SECRET`
  and that new instances should use an `x-odoo-secret` header. Odoo's Automated
  Action URL accepts a query string only, so the secret must ride in
  `?secret=`, which lands in access logs and Referer headers — acceptable here
  because the value is a **derived, per-scope** credential that can be
  re-registered at any time, not a reusable shared key.
- **The Odoo credential is derived per scope, not per env.**
  `src/lib/odoo/webhook-secret.ts` HKDF-SHA256s `ENCRYPTION_KEY` under
  `odoo-webhook-secret:v1`, scoped `stock:<workspace_id>` or
  `record:<field_mapping_id>`. Same reason as Zid: no new host env var, and
  `ENCRYPTION_KEY` is guaranteed in production. Two consequences worth keeping:
  a stock secret only authorises its own workspace, and a record secret only its
  own mapping — `authorizeOdooWebhook` runs **before** the first `.select()` in
  both routes, so an unauthenticated caller gets no existence oracle.
  Rotating `ENCRYPTION_KEY` invalidates every Odoo action and requires the
  refresh, same as `ENCRYPTION_LEGACY_KEYS`.
- **Re-registration is required for Odoo too**, and is *create-before-delete*
  (`POST /api/admin/odoo-webhooks/refresh`, Clerk + `isAdmin, also a button on
  `/app/admin`). Delete-first would leave a tenant with no action at all if
  creation failed; overlap is harmless because ingress is idempotent per
  delivery. It rewrites `standard_mapping_settings.inventory.odoo_stock_webhook`
  and each `field_mappings.odoo_webhook_id`. It refuses to touch anything when
  no secret is derivable.
- **Legacy (no `?secret=`) Odoo deliveries are accepted for now** — `ok` /
  `invalid` / `legacy` / `unconfigured`; `invalid` is 401, `unconfigured` is 500
  in production and skipped only in dev. Accepting `legacy` is survivable
  *because of the trust rule above*: the body is a trigger, and values are read
  back from the tenant's own Odoo. The deletion branch is the residual — it
  needs a real `field_mapping_id` and is counted in the log
  (`Unauthenticated delivery #N`, first 3 then every 50th). That counter
  reaching zero is the signal to reject `legacy`, same as Zid.
- A **missing** secret is still a hard failure in production (500) for the
  **shopify** route — Shopify genuinely signs, and nothing derives a fallback
  for it. **Check it on any host that never received the var.**
  **Salla is no longer in this class** — see below. **Still not migrated:**
  Shopify uses one shared env secret and will 500 if it is unset.

### Salla ingress, rewritten 2026-10-05 — it was the live outage, and it is dual-path

`SALLA_WEBHOOK_SECRET` was empty on the host and the route treated that as a hard
500 **before parsing anything**, so every Salla delivery was lost with no error on
Salla's side. Setting the var would not have fixed it either: registration
attached the secret to a `x-erplink-webhook-secret` header that the route never
read, so only the native signature was ever accepted. Both halves are fixed in
`src/lib/salla/webhook-auth.ts` + `src/app/api/webhooks/salla/route.ts`.

- **Salla does sign natively**, unlike Zid. `signature` is the default strategy
  for every Partner App: `X-Salla-Security-Strategy: signature` plus
  `X-Salla-Signature` = HMAC-SHA256 hex of the **raw** body, keyed with the
  Portal secret. Verified first when the host holds that secret. The raw-body
  requirement is why the route reads `await req.text()` and never re-stringifies.
- **The derived header is the always-on path.** Registration attaches
  `x-erplink-webhook-secret`, HKDF-derived from `ENCRYPTION_KEY` under
  `salla-webhook-header:v1` — no new host env var, and `ENCRYPTION_KEY` is
  already guaranteed in production. Same reasoning and same operational class as
  the Zid and Odoo credentials: **rotating `ENCRYPTION_KEY` invalidates it and
  requires re-registration.**
- ⚠️ **Salla's docs contradict themselves about the `token` strategy, and we
  resolved it deliberately.** The strategy table and the AsyncAPI spec both put
  the token in `Authorization`; one prose paragraph instead claims a 32-char
  SHA256 of the request body in `X-Salla-Signature` — the Signature section
  copied with the name swapped, and impossible, since a hash of *this* body
  cannot be a token stored ahead of time. **We follow the table and the spec:
  `Authorization`, compared statically.** Hashing it would 401 every legitimate
  token delivery. This is defence in depth, not an outage fix — the app is on
  `signature`, so a stray token delivery previously classified `legacy`.
- **Four-way classification** `ok` / `invalid` / `legacy` / `unconfigured`, with
  `unconfigured` reachable **only** when nothing is derivable *and* no env secret
  (dev). A signed delivery on a secretless host is `legacy`, never
  `unconfigured` — failing closed there is the outage itself. The derived header
  is compared **first**, so a wrong header is `invalid` rather than falling
  through to a signature check.
- **Legacy deliveries are accepted** and counted (`Unauthenticated delivery #N`,
  first 3 then every 50th); that counter reaching zero is the signal to drop the
  `legacy` branch. `app.uninstalled` is refused for unauthenticated callers —
  it deletes the merchant's tokens and `merchant_id` is in the payload.
- **Re-registration: `POST /api/admin/salla-webhooks/refresh`** (Clerk +
  `isAdmin`, also a button on `/app/admin`). It **re-subscribes**, it does not
  delete first: Salla's `/webhooks/subscribe` upserts by URL, so there is no
  outage window — the opposite trade-off from Zid (delete-then-create) and Odoo
  (create-before-delete). It refuses to touch anything when no credential is
  derivable, and registers stores sequentially.
- `registerSallaWebhooks` now returns
  `SallaWebhookRegistrationResult { registered, failed, credentialAttached }`
  instead of a bare count, so a partial failure is reportable instead of only
  warnable. The OAuth callback passes `undefined` rather than the env value — an
  empty string used to mean "attach no header at all".
- ⚠️ **The webhook event catalogue was wrong and is now verified.** An earlier
  pass added `order.shipment.ready`, `order.shipment.in_transit`,
  `order.shipment.out_for_delivery`, `order.shipment.delivered`,
  `order.shipment.updated`, `order.shipment.deleted`, `product.publish`,
  `abandoned.cart.update` and `abandoned.cart.purchased` — **none of which
  Salla publishes.** They were counted in `failed` and warned, so it was loud,
  but the deliver preset still had nothing real to fire on. Verified against the
  Portal's `salla_events action=list` for this app, cross-checked with
  `https://docs.salla.dev/webhooks`. `tests/unit/salla-webhook-auth.test.ts`
  now holds the published catalogue as an allowlist and fails on any slug that is
  not in it — **do not add a slug from memory; verify it first.**
  - The real shipment family is `order.shipment.{creating,created,cancelled}` and
    `order.shipment.return.{creating,created,cancelled}`, all of which map to the
    `orders` entity because the name contains `order`. Salla's **bare**
    `shipment.*` events also exist and are the tempting choice, but they map to
    **no entity** in `webhook-gate.ts`, so they would be enqueued with nothing to
    sync against. Subscribe the `order.`-prefixed ones only.
  - `product.available` is struck through in Salla's own list as deprecated;
    `product.quantity.low` is the live one.
  - ⚠️ **`category.deleted` does not exist** — it predates this work and was
    asserted in a test as "needed, without it delete sync can never run". Salla's
    category catalogue is `created`/`updated` only. It was removed: subscribing a
    non-existent event buys nothing. **But note it does not reliably *error*** —
    the app-level `webhook_config.development.subscribed_events` in the Portal
    still carries `product.publish`, `abandoned.cart.update`,
    `abandoned.cart.purchased`, `product.available` and the `store.branch.*`
    family, none of which the Portal offers in `salla_events action=list`. So an
    unknown slug can persist silently rather than fail the call, which means the
    per-store `failed` counter is **not** a complete picture of what is live —
    inspect the Portal list directly. The engine's category-**delete** path is
    real but **not webhook-drivable**; do not re-add the subscription as if it
    were.
- **Portal state for app `1691480817` ("ERP لينك" / "ERPLink"), verified
  2026-10-05.** `status: development`, `subscribers: 0`, `latest_publication:
  null`, `approved: null`, `is_publishable: false`. So **no merchant store exists
  on this app yet** — every store is a demo store, and demo stores get app-level
  config changes immediately, while merchants' live stores only get them after a
  publication is approved. Two consequences: a per-store
  `POST /api/admin/salla-webhooks/refresh` has nothing real to re-register until
  there is a live store, and the publication itself is blocked until the merchant
  settings form (`settings: null`) and its sections are filled.
- ⚠️ **All three Portal URLs are three *different* ephemeral ngrok subdomains** —
  `app_url` `bd46-…`, `redirect_urls` `6f06-…`, `webhook_url` `a77d-…`. Any ngrok
  restart mints new ones, which silently breaks OAuth callbacks and webhook
  delivery. Set them to one real domain before treating any of this as
  production, then re-run the refresh.
- The Portal **does** hold a 64-hex `webhook_secret` and `webhook_security_strategy:
  signature`. That value is the `SALLA_WEBHOOK_SECRET` for the native HMAC path —
  read it from the Portal, never paste it into a file or a log.
- The `carts` scope is **deselected**, which is why `abandoned.cart` is not
  subscribed (the slug is real; there is simply no scope to deliver it).
- **A stale delivery is saved, not discarded.** `STALE_EVENT_MAX_AGE_MS` (15 min)
  still refuses to *enqueue* a late redelivery, because re-running it would push
  an old price/status over newer state. It is no longer silently dropped: it is
  written to `webhook_inbox` with a **null `workspace_id`**, which
  `drainWebhookInbox` excludes by query — durable and recoverable by hand, but
  unable to regress the store on its own. This matters because
  `reconcileZidOrders` has **no Salla peer**, so nothing else would ever recover
  a genuinely late event. A failed write there returns 503, not 2xx.
- **Salla order enrichment is no longer size-based.** `keys.length <= 4` let an
  `order.updated` payload with a dozen fields but no `items` through untouched,
  writing an Odoo order with no line items that looked like it had synced.
  Enrichment is now driven by `items` being absent for `order.*`; the size
  heuristic remains for customers and categories.


- The OAuth `connect` routes are deliberately **unauthenticated**: Shopify and
  Zid redirect to them and they are stateless entry points. The real boundary
  is each `callback`, which now resolves the Clerk session and the active
  workspace **before** spending the single-use authorization code.
