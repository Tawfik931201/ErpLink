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
5. The three linked **test** Zid stores were marked version 1 in Supabase
   by migration `zid_webhook_auth_rekey_versioning` on 2026-11-23. The new
   Node.js startup task (15 seconds after boot) claims each legacy merchant
   atomically, deletes its old manager webhooks, and registers merchant-specific
   Basic auth subscriptions. It marks version 2 **only after** a successful
   refresh. The App Market / Partner Portal subscription webhooks use the
   separate authenticated app-wide callback and must NOT be deleted.
   `ZID_AUTO_REKEY_WEBHOOKS=false` is an emergency opt-out.
6. The migration is **destructive to old manager subscriptions** and must be
   observed until completion. Do not enable
   `ZID_ACCEPT_LEGACY_GLOBAL_BASIC_AUTH=true` in normal operation. The
   `STRICT_WEBHOOK_AUTH=true` production default rejects old unsigned
   events until subscriptions are recreated. The stores are test-only and the
   owner approved a brief transition.

## Immediately after the new code is running

1. The migration runs automatically from `src/instrumentation.ts` on the
   Hostinger Node.js server. Check Supabase:
   `SELECT merchant_id, zid_webhook_auth_version,
   zid_webhook_auth_claimed_at, zid_webhook_auth_last_error
   FROM public.merchant_tokens ORDER BY merchant_id;`
   All three rows should eventually have `zid_webhook_auth_version = 2`
   and `zid_webhook_auth_last_error IS NULL`. Startup refresh may require
   several minutes because it is paced to avoid Zid's request-rate limits.
2. If any row remains version 1 or has an error, investigate Hostinger and
   Zid logs. The existing authenticated admin fallback is
   `POST /api/admin/zid-webhooks/refresh`. Be aware that the manual route
   deletes and re-creates the store subscriptions too.
3. Verify authenticated delivery for each store (order/product/customer), correct
   workspace and ERP target, inbox/sync queue, and audit logs.
4. Confirm missing Basic headers and cross-store Basic credentials return 401.
   Exactly the registered Zid Partner Portal app-market topics with **no**
   `store_id` must continue to verify using the separate app-wide Basic
   credential. They must not authorize an order/product/customer event.
5. Verify the internal queue runner and reconciliation loop are enabled on
   Hostinger (`SYNC_QUEUE_SELF_RUNNER=true`). The Hostinger cron may be a
   backup; if used, update it to the Bearer header and confirm the obsolete
   `?key=` path returns 401.
6. Test the active Salla/Shopify integrations, credential read/save responses,
   and the GitHub security workflow (audit, TypeScript, focused Jest, full Jest).

## Rollback

Do not deploy an unmodified older version that cannot decrypt v2 AES-GCM
credentials. Preserve the authenticated decryption implementation even if
other security changes must be rolled back. If webhook delivery fails during
the migration, restore working subscriptions and keep auth strict wherever
possible; do not leave global-credential compatibility enabled permanently.
