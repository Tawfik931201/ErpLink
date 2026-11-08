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
