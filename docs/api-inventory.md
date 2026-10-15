# API Inventory (OWASP API9 — generated 2026-10-08, update with every new route)

REST only. No GraphQL/gRPC. Source of truth is `src/app/api/**/route.ts`
plus Server Actions in `src/app/actions/*`.

## Public (no Clerk session)

| Route | Auth | Rate limit | Notes |
|---|---|---|---|
| `POST /api/webhooks/zid` | Basic (derived) / legacy-counted / strict-401 | 120/min + 1 MB cap | `app.uninstalled` refused when unauth |
| `POST /api/webhooks/salla` | derived header → native HMAC / legacy / strict-401 | 120/min + 1 MB cap | `app.uninstalled` refused when unauth |
| `POST /api/webhooks/shopify` | HMAC (`SHOPIFY_WEBHOOK_SECRET`, 500 in prod if unset) | 120/min + 1 MB cap | `app/uninstalled` cleans token |
| `POST /api/webhooks/odoo` | per-scope `?secret=` / legacy / strict-401 | 120/min + 1 MB cap | auth before mapping lookup (no oracle) |
| `POST /api/webhooks/odoo/stock` | per-scope `?secret=` / legacy / strict-401 | 120/min + 1 MB cap | UUID shape + erp_connections check |
| `POST /api/webhooks/clerk` | Svix (`CLERK_WEBHOOK_SECRET`) | — | user sync |
| `GET /api/zid|shopify|salla/connect` | Clerk session (entry) | — | sets oauth state cookie |
| `GET /api/zid|shopify|salla/callback` | Clerk session + state equality | 30/min | state mismatch → redirect, never exchange |
| `GET /api/auth/zid/*` | shim → canonical | — | no duplicated logic |

## Authenticated (Clerk)

| Route | Check |
|---|---|
| `GET /api/tickets/attachments?id=` | `auth()` + ownership (`partner_email`) or `isAdmin`; 60/min; 10 MB cap; generic 500 |
| `GET /api/mapping-center/settings` | `active_workspace_id` scoping |
| `POST /api/admin/impersonate` | `isAdmin` + 10/min + 15-min cookie + audit |
| `POST /api/admin/{zid,salla,odoo}-webhooks/refresh` | `isAdmin` |
| `GET /api/cron/sync-queue`, `GET /api/cron/reconcile` | `CRON_SECRET` (Bearer preferred); batch/window capped; POST → 405 |

## Rules for new endpoints

1. Add the route to this file.
2. Authenticate before any DB I/O; scope every query by `workspace_id`.
3. Add `checkRateLimit` + body-size guard for public routes.
4. Never return raw `error.message` to the client.
5. Destructive branches (`delete`, `uninstall`) require verified auth.
