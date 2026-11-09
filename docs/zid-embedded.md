# Zid embedded launch

## Findings (2026-11-08)

The installed app at `https://dashboard.zid.sa/en-sa/stores/3172448/apps/6958/embedded`
displayed the public website and the normal Clerk sign-in flow. A previous
verification screen showed `You are signed out`. The public Clerk environment
at `https://clerk.bizsahla.com/v1/environment` reported `partitioned_cookies: false`.
This is evidence of an iframe session/storage problem, not proof of an email
delivery failure. No live OTP was requested during this investigation.

[Zid's current Embedded Apps guide](https://docs.zid.sa/embedded-apps-2168216m0)
requires a registered UUID lookup token and merchant identification on launch,
bypassing a separate login. Google sign-in inside an iframe is not the launch
mechanism. The ordinary Clerk sign-in remains available for direct app access.

## Enable on the deployment

1. Apply `supabase/migrations/20261108125125_zid_embedded_access.sql`.
   This migration has not been applied by the code change. It requires the
   existing `merchant_tokens`, `users`, `workspaces`, and `workspace_members`
   tables. It ensures unique membership `(workspace_id, user_id)`; existing
   duplicate memberships must be resolved before applying the migration.
2. Deploy the code. In Zid Partner Dashboard for app **6958**, set Application
   URL to `https://erplink.bizsahla.com/embedded`.
3. Include the documented `embedded_apps_tokens_write` OAuth scope in the app's
   Zid configuration. If `ZID_OAUTH_SCOPE` is set, preserve its existing scopes
   and add this one there too. Reauthorize the connected store when its current
   credentials do not have the scope. Do not replace existing scopes.
4. As the workspace owner, open the connected Zid store's detail page and click
   **Enable sign-in inside Zid**. This registers a fresh UUID with Zid. Repeat
   for each store and after reinstalling. A failed attempt must be retried; a
   network failure during rotation can invalidate the prior lookup token.
5. Open the app from Zid's installed apps list. Zid supplies `token` and
   `language`. If the browser blocks the app's existing cookies, use the inline
   storage-access button and allow the browser's permission prompt.

Storage Access API permission can require a previous top-level visit to the app
and a user gesture. Browsers that deny this permission, do not implement the API,
or block cookies more strictly still need live validation and/or Clerk-supported
partitioned-cookie configuration. This code does **not** guarantee compatibility
with every browser or change the Clerk instance's cookie configuration.

## Identity and authorization

`registerEmbeddedAccess` creates an isolated Clerk identity with a stable,
server-controlled external ID per workspace/store. It does not impersonate the
installer, an administrator, or an account matched by email. A local member row
grants the existing default page permissions. Owner-only operations remain
owner-only. Team management, workspace deletion, and other owner-only functions
continue to require the real owner. This is workspace-level access, so other
stores deliberately sharing that workspace remain visible.

The synthetic email ends in `@embedded.invalid`; it is not a delivery
address and is also supplied to Clerk, whose deployed instance requires an email.
The signed Clerk webhook skips default-workspace provisioning for these identities.
If Clerk rejects this identity or adds sign-in session tasks,
the launch fails visibly; do not weaken verification checks to force completion.
Manual subscriptions and trial dates belong to the existing workspace and do
not change.

Only a SHA-256 digest of the UUID is saved. Browser POST exchanges it for a
single-use Clerk ticket valid for 60 seconds, then completes Clerk's `ticket`
strategy and navigates inside the same iframe. Zid API credentials never reach
the browser. The launcher removes the UUID from its current history entry before
requesting a ticket; launch pages and session responses are not cached and use
`no-referrer`. Web/proxy access logs should redact the launch query string.
Launching selects the store's workspace again. When Clerk already has an active
session in this browser context, the launcher signs it out before activating the
isolated store identity; without partitioned Clerk cookies this can also affect
the direct app session. Verify this behavior during the deployment integration pass.

Session issuance rechecks the store's workspace, membership, identity metadata,
and Clerk banned/locked flags. Disconnect/uninstall cascades the lookup row;
its deletion removes the member row, so existing sessions lose access to that
workspace. Moving a merchant token to another workspace also revokes the grant.
The Clerk identity itself is retained; it is not a workspace owner or admin.

Clerk sign-in tokens: [official reference](https://clerk.com/docs/reference/backend/sign-in-tokens/create-sign-in-token).
Cookie access: [Clerk cookies](https://clerk.com/docs/guides/how-clerk-works/cookies).

## Verification boundaries

Unit coverage uses mocked Clerk and Supabase only. Deployment, SQL triggers,
Zid token registration, Clerk's instance-specific identity requirements, browser
storage approval, successful ticket activation, RTL/LTR layouts, and full
authenticated screens inside the live Zid iframe require an integration pass
after deployment. Local type/lint/test/build results alone do not establish
end-to-end Embedded approval.

## Diagnosis 2026-11-09 — `authorization_invalid` ("Unauthorized request") in Zid

Reported: opening the installed app at
`https://dashboard.zid.sa/en-sa/stores/3172448/apps/6958/embedded` shows the
app, but signing in from inside Zid returns Clerk Frontend API JSON:

```json
{ "errors": [{ "message": "Unauthorized request",
  "long_message": "You are not authorized to perform this request",
  "code": "authorization_invalid" }],
  "clerk_trace_id": "412349d1540bd5feb8748c809d2c2b4a" }
```

Verified live the same day:

1. **`GET https://erplink.bizsahla.com/embedded` returned 404.** The
   embedded-launch commit (`8d517d4`) was not deployed, so Zid's iframe
   loaded the homepage / normal Clerk sign-in form instead of `/embedded`.
   A normal sign-in inside a cross-site iframe is exactly what Clerk's
   Frontend API rejects with `authorization_invalid` while the instance
   has `partitioned_cookies: false` (confirmed via
   `https://clerk.bizsahla.com/v1/environment`). The ticket flow on
   `/embedded` exists precisely to bypass the normal sign-in.
2. **Code fix (this change):** the middleware now routes any GET/HEAD
   carrying a Zid embedded UUID token to `/embedded`, whatever the
   configured Application URL is (`src/lib/zid/embedded-url.ts`, pure and
   unit-tested in `tests/unit/zid-embedded-url.test.ts`). This makes the
   launch tolerant of a Partner-Dashboard URL that still points at the
   homepage — but the correct URL remains
   `https://erplink.bizsahla.com/embedded`; set it in Zid anyway.
3. **Still required outside this repo (no code can do these):**
   - Deploy the embedded-launch commit (the 404 above proves it is live
     only after a deploy + `GET /embedded` returns 200).
   - Apply `supabase/migrations/20261108125125_zid_embedded_access.sql`.
   - Clerk Dashboard → Sessions → **enable Partitioned cookies**
     (instance flag `partitioned_cookies`). This is Clerk's supported way
     for a session cookie to survive inside a cross-site iframe; without
     it the app relies on the Storage Access API grant from
     `EmbeddedStorageGate`, which Chrome grants per top-level site and
     which Safari/Firefox may deny. Re-check
     `https://clerk.bizsahla.com/v1/environment` → `partitioned_cookies: true`
     after toggling.
   - Clerk Dashboard → authorized origins/domains: ensure
     `https://erplink.bizsahla.com` is the registered production domain
     (it is the instance `home_url`); add `https://dashboard.zid.sa` if
     the dashboard offers an authorized-origins list for embedded apps.
   - Zid Partner Dashboard → app 6958: Application URL
     `https://erplink.bizsahla.com/embedded`, scope
     `embedded_apps_tokens_write` (add to `ZID_OAUTH_SCOPE` if set, then
     reauthorize the store).
   - As workspace owner, per store: **Enable sign-in inside Zid**
     (registers the UUID), then open the app from Zid's installed-apps
     list. Do not use Google/password sign-in inside the Zid iframe —
     that path is the one that returns `authorization_invalid`.

   Follow-up 2026-11-09 (same day): the error persisted and a live re-check
   still showed `partitioned_cookies: false` — i.e. the Dashboard toggle
   above had not been applied yet. With the flag off, Clerk's
   `__session`/`__client`/`__client_uat` cookies are `SameSite=Lax` and are
   third-party inside the Zid iframe, so the Frontend API cannot identify
   an authorized client and rejects sign-in with
   `authorization_invalid`. No code change can flip this instance flag.
   After enabling it, clear site data for `erplink.bizsahla.com` and
   `clerk.bizsahla.com` (old unpartitioned `__session` conflicts with the
   partitioned one) and re-check
   `https://clerk.bizsahla.com/v1/environment` → `partitioned_cookies: true`
   before retesting in Zid. If the embedded token was never registered
   (button above never clicked, or the migration unapplied), Zid loads
   the app without a token and the merchant lands on the manual sign-in
   form — the exact path that fails — so both steps are required.

   Sign-in card width (same day): `8d517d4` had set Clerk's
   `rootBox`/`cardBox` to `w-full max-w-full`, stretching the sign-in
   card to the full page width. Reverted to a constrained centered card
   (`w-full max-w-md`, `mx-auto`) in `src/lib/clerk-appearance.ts`,
   pinned by `tests/unit/clerk-appearance.test.ts`.
