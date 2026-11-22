# ERP Link security release gates

This change set must NOT auto-deploy to `main` before these gates are met. The
temporary branch is reviewed and squashed **once** into `main`; delete the
temporary branch after a successful production smoke test.

## Before deploying

1. Back up the application environment and Supabase connection configuration.
   Keep the existing `ENCRYPTION_KEY` unchanged. New writes use AES-GCM v2;
   rolling back to CBC-only code will not read newly encrypted secrets.
2. All Odoo/ERPNext connection URLs must be HTTPS with a valid certificate and
   publicly routable DNS. HTTP is refused in production. On 2026-11-22, the
   three linked Odoo connection rows were HTTPS (read-only verification).
3. Update Hostinger's reconcile scheduler FIRST to use an HTTP
   `Authorization: Bearer <CRON_SECRET>` header. Query-string
   `/api/cron/reconcile?key=...` will return 401 after release. The queue
   scheduler accepts `Authorization: Bearer` (or `x-cron-secret`).
4. Ensure `CRON_SECRET` and `ENCRYPTION_KEY` are configured in production.
   Neither belongs in a `NEXT_PUBLIC_` variable.
5. Zid subscriptions created with the shared Basic credential **cannot**
   authenticate under the new per-merchant v2 derivation until re-registered.
   There were 3 linked Zid stores and historical unsigned deliveries. A short,
   controlled migration may use BOTH temporary environment switches:
   `STRICT_WEBHOOK_AUTH=false` and
   `ZID_ACCEPT_LEGACY_GLOBAL_BASIC_AUTH=true`. Restrict this to the deployment
   window, because it weakens inbound webhook authentication. Do NOT enable the
   second switch as a permanent workaround.

## Immediately after the new code is running

1. From a signed-in system **admin** session invoke:
   `POST /api/admin/zid-webhooks/refresh`.
   It removes and recreates subscriptions sequentially; inspect the
   `stores[]` result, including every `registered`, `failed` and `listFailed`.
   A provider API error must be resolved before proceeding.
2. Verify authenticated deliveries for each of the three stores, including
   order/product/customer events, and that each is routed only to its own
   workspace and ERP connection. Inspect runtime logs, queue and application
   sync logs. Keep the transition as short as practical.
3. Set `STRICT_WEBHOOK_AUTH=true`, **unset**
   `ZID_ACCEPT_LEGACY_GLOBAL_BASIC_AUTH`, and restart the app. Test a missing
   Basic header (401) and wrong-store Basic credential (401); a legitimate
   delivery from each store should still succeed.
4. Confirm both cron endpoints work with a Bearer header; confirm
   `?key=` is rejected by the reconcile endpoint.
5. Verify Salla OAuth and Shopify operations if those integrations are active,
   and ERP credential save/read outputs contain no `password`, `access_token`
   or `refresh_token`.
6. Inspect the GitHub security workflow: TypeScript, focused security tests,
   full Jest suite, and `npm audit --omit=dev` must pass before merge;
   investigate any newly introduced failures instead of relying only on
   successful diagnostic steps.

## Rollback

Do not deploy an unmodified older version that cannot decrypt v2 AES-GCM
credentials. Preserve the authenticated decryption implementation even if
other security changes must be rolled back. If webhook delivery fails during
the migration, restore working subscriptions and keep auth strict wherever
possible; do not leave global-credential compatibility enabled permanently.
