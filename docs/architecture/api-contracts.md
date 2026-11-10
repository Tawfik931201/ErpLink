# Existing API and integration contracts

Source inspection: 2026-11-03. This is a preservation baseline, not a proposed API. No live endpoint, database or merchant API was called for this document. Examples show shapes rather than customer data. Optional properties with `undefined` values are omitted by JSON serialization. Exact branch implementation remains authoritative in the referenced route.

## Webhook ingress

Routes live under `src/app/api/webhooks/`. Do not normalize their different response shapes or HTTP codes during internal refactoring.

| Endpoint | Existing input and authentication | Main successful response |
| --- | --- | --- |
| `POST /api/webhooks/zid` | Platform event/body with store identity resolved by the route, including `store_id` URL hints; HTTP Basic credential from `src/lib/zid/webhook-auth.ts`. Classification is `ok`, `invalid`, `legacy`, or `unconfigured`; migration compatibility accepts legacy deliveries. | HTTP 200 `{ received: true, queued: boolean }` (`zid/route.ts:717`). `queued` reports the handler result, not completion in Odoo. |
| `POST /api/webhooks/salla` | JSON event envelope, merchant resolved by `extractSallaMerchantId`, event data, optional delivery id. Raw body preserved for native HMAC. Native signature/token and derived `x-erplink-webhook-secret` are handled in `src/lib/salla/webhook-auth.ts`. | HTTP 200 `{ received: true, queued: !enqueued.duplicate, coalesced: enqueued.coalesced }` (`salla/route.ts:546`). No API enrichment in request; worker enriches later. |
| `POST /api/webhooks/shopify` | Raw JSON body, HMAC header, valid `x-shopify-shop-domain`, topic and optional webhook delivery id. Shared configured secret, no derived fallback. | HTTP 200 `{ received: true, queued: true }`; merge branch adds `merged: true`; duplicate branch `{ received: true, processed: false, reason: 'duplicate' }`. |
| `POST /api/webhooks/odoo` | Object or array body; first array element is used. `field_mapping_id` from query/body; model aliases `_model`, `model`, `_name`, otherwise mapping model; record aliases `_id`, `id`, `odooRecordId`. Per-mapping derived credential from query/header/authorization/token via `authorizeOdooWebhook`. | HTTP 202 `{ success: true, queued: true, duplicate: boolean, message: 'Webhook received and queued for sync.' }` (`odoo/route.ts:211`). |
| `POST /api/webhooks/odoo/stock` | Object/array body; UUID `workspace_id` from query/body. `product_id` or quant `_id`/`id` required; `location_id` optional. IDs accept scalar or many2one arrays; positive finite values are truncated. Per-workspace derived credential. | HTTP 202 `{ success: true, queued: true, message: 'Stock webhook received and queued for sync.' }` (`odoo/stock/route.ts:201`). Starts a fire-and-forget drain after durable enqueue even in production. |
| `POST /api/webhooks/clerk` | Raw payload; signature headers, timestamp window and `CLERK_WEBHOOK_SECRET` checked in route. Handles user lifecycle events. | HTTP 200 `{ received: true }`. |

Webhook GET methods are readiness JSON endpoints: Zid/Salla/Shopify report `ok`, message and event/topic information; Odoo record and stock report `ok` and message; Clerk reports `ok` and message.

### Terminal and failure branches that must remain distinct

- Zid/Salla/Shopify unlinked stores: save an orphan receipt with null workspace, then HTTP 202 `{ received: true, processed: false, queued: false, reason: 'store_not_linked' }`. Receipt failure instead returns 503 with `{ received: false, processed: false, error }`.
- Disabled Salla/Shopify events: HTTP 200 `{ received: true, processed: false, reason: 'disabled_in_settings', detail: reason }` plus skip logging. Zid handlers return `skipped`, producing the normal response with `queued: false`.
- Uninstall events have separate token-deletion branches. Unauthenticated Zid/Salla uninstall is refused; accepting legacy non-destructive events does not authorize uninstall. Shopify acknowledges uninstall/GDPR/scope-update separately.
- Invalid credentials: 401; unconfigured production verifier: 500. Anonymous-only ingress buckets may return 429. Credential presence bypasses that bucket, then actual verification decides authenticity. Do not replace this with a blanket rate limit.
- Size limits: 413. Malformed JSON and missing required identifiers can return 400. Some malformed/sentinel events are durably recorded before their existing 400 response; do not convert all malformed requests into ordinary queued jobs.
- Odoo record mapping not found: 404; missing mapping/model/id/workspace: 400. Odoo stock invalid workspace UUID: 400, unknown workspace: 404, workspace lookup failure: 503.
- Durable enqueue failure: Odoo returns 503 `{ error: 'Failed to persist webhook', detail }`; Salla returns 503 `{ received: false, processed: false, error: 'durable_storage_failed' }`; other routes retain their own error body.
- Salla stale events older than 15 minutes are saved with null workspace and acknowledged as stale without enqueue; Shopify has its own stale-event branch. Do not let the regular inbox drain process these orphan rows automatically.

### Internal queue contract

`enqueueWebhookEvent` in `src/lib/sync-queue.ts:401` accepts `{ workspaceId, storeId, event, platform, payload, dedupKey? }`. The result can carry `id`, `duplicate`, `coalesced`, `skipped`, or `error` (see `EnqueueResult`). It is not a guarantee of completed synchronization.

1. Missing workspace/store/event returns `{ skipped: true }`.
2. Admission overload returns `{ error: 'ingress_overloaded' }`; authenticated traffic over its workspace share is otherwise deferred, not rejected.
3. Durable receipt precedes queue insert. Odoo writes immediately; store deliveries may use the 50-row/150ms write batcher. Awaiting the batch result is required before acknowledging durability.
4. Explicit delivery id wins; otherwise canonical payload fingerprint forms the dedup identity. Mapping identity participates in Odoo coalescing. Do not substitute an entity id for delivery identity.
5. Queue execution dispatches Odoo record events to `runBackgroundSync`, Odoo stock to `processOdooStockEvent`, and store events to `processWebhookEvent(..., true, workspace_id, queue_id)`.
6. Record worker result `{ ok: false, message }` retries; `{ ok: true, skipped?: true, message? }` settles. Store result with `failed === 0` settles. Missing result retries, not silent success.

The queue payload for Odoo records is `{ field_mapping_id, model, odooRecordId: number, payloadData, auth_status, updated_at? }`. Preserve `auth_status`: an absent Odoo record may trigger deletion only for authenticated deliveries. The stock payload carries `{ workspace_id, product_id, location_id, quant_id, updated_at?, ...quantityFingerprintFields }`; body quantities are fingerprints, never authoritative stock values.

## OAuth and compatibility routes

| Routes | Preservation contract |
| --- | --- |
| `GET /api/{zid,salla,shopify}/connect` | Public OAuth entry points. Zid now persists a hashed, single-use 10-minute state before redirecting; it never requires ERPlink login. |
| `GET /api/zid/callback` | Validates exact cookie/state equality, atomically consumes state and promptly exchanges the code without a Clerk session. Verifies store identity via Zid, saves an encrypted one-hour pending grant, rotates to an opaque HttpOnly cookie, then redirects to `/connect/zid` without codes/tokens. No account binding or core webhook registration before confirmation. JSON debug responses are retired. |
| `GET /api/salla/callback` | Exact `salla_oauth_state`, code, session and active/default workspace before token exchange; configured redirect URI must match connect. Redirect responses carry existing error/success query fields; success clears cookie. See `src/app/api/salla/callback/route.ts:73`. |
| `GET /api/shopify/callback` | Shop validation, exact `shopify_oauth_state`, code, session and workspace, HMAC/token exchange; existing redirects retained. No automatic default workspace creation in this callback. See `src/app/api/shopify/callback/route.ts:29`. |
| `GET /api/auth/zid/authorize`, `GET /api/auth/zid/callback` | Re-export the canonical handlers in place; no login gate and no callback-code forwarding redirect. |
| `GET /api/sign-up-intent/set` | Redirect shim to `/sign-up`. |
| `GET` / `POST /api/auth/[...nextauth]` | Deliberate plain-text `Not Found` response with 404; presence of this shim does not mean NextAuth is active. |

## Browser-facing data and downloads

### Zid embedded launch (2026-11-08)

`GET /embedded?token=<UUID-v4>&language=<ar|en>` is the iframe launch URL.
It requests browser storage access when necessary, exchanges the UUID via the
same-origin JSON `POST /api/zid/embedded/session`, activates a 60-second single-use
Clerk ticket, and navigates within the iframe to the existing app dashboard.
Invalid/revoked credentials return 401; unavailable identity/storage services
return 503; the session endpoint is bounded by an IP rate limit and sends
`private, no-store` and `no-referrer`.

`POST /api/zid/embedded/register` accepts `{ merchantId: string }` only from an
authenticated workspace owner on the app origin. It provisions an isolated
Clerk member for the current store/workspace, hashes a UUID locally, and registers
that UUID with Zid. It does not return provider credentials or impersonate the
installer. Setup and browser limitations: [zid-embedded.md](../zid-embedded.md).

`GET /api/mapping-center/settings?store=<zid|salla|shopify>&entity=<categories|products|customers|orders>&storeId=<optional>` is session/active-workspace scoped. Returns HTTP 200 `{ settings: object|null, orderStatusMappings: Record<string,{state,enabled}>|null }` and `Cache-Control: private, no-store`. Explicit store settings override platform defaults. Invalid request: 400 `{error}`; unauthenticated: 401; timeout/lookup failure: 503. No workspace returns both fields null. Each read is bounded by a 5-second timeout (`src/app/api/mapping-center/settings/route.ts:30`).

`GET /api/tickets/attachments?id=<positive integer>` returns binary content, not JSON. Clerk user/email ticket ownership is checked (admin exempt). Existing headers include content type, encoded attachment filename, `private, max-age=3600`, and `nosniff`. Plain-text errors use 400/401/403/404/413/429/500. The body limit is 10 MiB. Uses the separate helpdesk JSON-RPC client `src/lib/odoo.ts`, not a workspace integration connection.

Server Actions in `src/app/actions/` are also external boundaries consumed by components. Preserve exported async names, argument/default shapes, return unions and error strings. Do not move exports into a plain module and expose previously private mutation helpers as browser-callable actions. Domain-specific action signatures remain documented by their TypeScript declarations; no wholesale contract rename is part of this work.

## Schedulers and admin operations

`GET /api/cron/sync-queue`: `Authorization: Bearer ...` or `x-cron-secret`; missing configured secret is 500 in production, mismatch 401. `batch` is parsed/clamped to 1..100 (including current JavaScript `Number(null)` behavior); IP limit 60/min. Drains inbox then time-boxed queue batches. HTTP 200 `{ success: true, timestamp, inbox, batchesRun, totalProcessed, durationMs, orphanInbox, metrics }`; processing exception is 500 `{ success: false, error }`. POST is 405 `{ error: 'Method not allowed' }`.

`GET /api/cron/reconcile`: bearer or query `key`; `window` parsed/clamped to 1..1440 minutes, limit 20/min. Returns `{ success, timestamp, result }`, 500 when `result.stopped === 'error'`; thrown error is 500 `{ success: false, error }`. POST is 405. Only Zid orders are reconciled by the actual implementation, despite broad comments mentioning other platforms.

Admin routes re-check Clerk and `isAdmin`; their existing choice of 401 versus 403 is part of the contract:

| Endpoint | Request and response |
| --- | --- |
| `GET /api/admin/workspaces` | 401 if unauthorized; 200 `{ success: true, workspaces: [{id,name}] }`, up to 200; failures 500 `{error}`. |
| `POST /api/admin/pipeline-selftest` | `{workspaceId, confirm:true}` required; 401/400/404 failures. Returns `{success,runId,totalMs,steps,notes,workspace}`. Writes synthetic database rows and audit data; do not run during an offline audit. |
| `POST /api/admin/load-rehearsal` | `{workspaceId,count,confirm:true,mode?,allowProductionDrain?}`; count 1..20000, default mode enqueue. Production drain requires explicit flag. Returns `{success,mode,count,inserted,insertMs,insertsPerSec,drained,drainSucceeded,drainRetried,cleaned,note}`. This route can perform real integration work in drain mode. |
| `GET /api/admin/queue-health` | Admin-only operational snapshot including readiness and ingress/queue information; retain the full route-defined object (`src/app/api/admin/queue-health/route.ts:203`). 401 unauthorized. |
| `GET` / `POST /api/admin/webhook-legacy-status` | 403 unauthorized. GET returns durable legacy counters; POST optionally accepts `platform`, resets selected/all counters and returns `{ok:true,reset,legacyCounters}`. |
| `GET /api/admin/webhook-orphans/replay` | 403 unauthorized; `{orphans,message}`. |
| `POST /api/admin/webhook-orphans/replay` | Optional `{limit}`, default 25, clamp 1..100. Returns `{replayed,duplicate,unlinked,skipped,failed,scanned}`. Excludes uninstall/sentinel events; can enqueue real work. |
| `POST /api/admin/{zid,salla,odoo}-webhooks/refresh` | 403 unauthorized; refuses without derivable credential; mutates external registrations. Zid deletes then recreates, Salla subscribes/upserts, Odoo creates before deleting. Returns platform-specific reports; Odoo `{ok,refreshed,failed,workspaces}`. GET responds with method guidance/405 as defined in each route. |
| `GET` / `POST /api/admin/impersonate` | Admin/target validation, existing GET/query and POST form/JSON compatibility, cookie/redirect handling in `src/app/api/admin/impersonate/route.ts`. Keep routes and write-block behavior intact. |

No request to any mutating admin endpoint above was made. A successful local build does not validate real webhook registrations, token refresh, merchant permissions, or Odoo method availability.

### Zid OAuth-first account linking (2026-11-10)

Apply `supabase/migrations/20261110175806_zid_oauth_first_onboarding.sql` **before deploying** these routes. It adds server-only `zid_oauth_pending` and the service-role-only, invoker `complete_zid_oauth_connection` RPC. A stable `ENCRYPTION_KEY` is required, including development. Expired grants are rejected immediately and purged on new OAuth attempts.

`GET /connect/zid` is public, dynamic, private/no-store and uses same-origin referrer policy in both HTTP headers and HTML metadata. This keeps same-site HTML form submissions from becoming Origin:null while suppressing external referrers. OAuth callbacks retain no-referrer. It shows the verified store and Create account / Link existing account options; Clerk returns to this clean URL. Signed-in merchants explicitly select an owned workspace and confirm. No email-based account matching or silent binding occurs. A one-hour pending grant survives sign-in and process restarts. Expiry requires a fresh authorization. Denial without a callback leaves only an expiring state; starting again is safe.

`POST /api/zid/link` requires the canonical Origin, a Clerk session and the pending HttpOnly cookie. One transaction locks the grant, rechecks workspace ownership, rejects a store already belonging to another workspace, saves the credentials and consumes the grant. Existing store keys and sync settings survive reauthorization; new rows use verified store IDs rather than manager IDs. Same-manager/multiple-store credentials cannot replace one another. Ambiguous legacy rows fail closed. Failed writes roll back without losing the grant. Successful confirmation updates active workspace, registers core webhooks and redirects to `/app/connect-odoo`; webhook setup failure instead redirects to the store page with an explicit warning. Saving Odoo settings retains the existing bootstrap path. Manual billing is unchanged.

The external App Market activation URL should be `/api/zid/connect` (the existing callback URL without a code also enters that handler). Application URL remains the external ERPlink app URL, not `/embedded`. The listing must disclose the ERPlink account and Odoo configuration requirements. Production migration, deployment and a merchant end-to-end browser pass are separate from local verification.

### Zid credential storage and isolation (2026-11-10)

`src/lib/zid/credentials.ts` is the shared encryption/public-projection boundary.
OAuth confirmation encrypts access, refresh and authorization credentials before
passing them to the binding transaction. The pending payload remains separately
encrypted. `src/lib/zid/token.ts` decrypts on the server only, transparently upgrades
legacy plaintext rows on first use, and preserves their original expiry anchor.
A stable `ENCRYPTION_KEY` is required for credential writes. Existing ciphertext
continues to support the configured decrypt-only legacy keys; unreadable
ciphertext raises an error and is never used as an API credential.

Renewal only updates the exact row/store/workspace and refresh-credential version
read before contacting Zid. A disconnected, moved or reauthorized connection
cannot be resurrected or overwritten by that stale refresh. No renewal path
inserts a new connection. Missing/ambiguous/orphan rows and database errors fail
closed. When a workspace is supplied by an authenticated caller or job, the
reader rechecks it before decrypting or migrating credentials. In-flight refresh
sharing is process-local; compare-and-update protects writes across workers, but
this is not a distributed provider-call lock.

`getActiveWorkspaceZidTokens` reads an explicit display-field list and applies a
second allowlist projection to its return value, including previously cached rows.
Neither plaintext nor encrypted credentials reach browser props/server-action
responses. Zid API failures drop authenticated Axios request/config objects and
redact credential values from response diagnostics while preserving status and
retry headers; OAuth exchange/refresh errors also omit raw provider bodies. Disconnect/settings actions verify the store belongs to the current
workspace before any webhook API call. The Zid parent-category lookup uses its
explicit store scope rather than the first store in a workspace.

Deploy these readers and writers together. No additional schema migration is
needed for encryption (the OAuth-first migration above is still required for
onboarding). Already stored plaintext is upgraded when a connection is used,
renewed or reauthorized; idle untouched rows are not claimed to have been
migrated. No production rows were accessed or rewritten during local validation.

Deployment note (2026-11-10): the OAuth-first migration was applied to the
configured Supabase project and the local filename matches its recorded version
20261110175806. The deployed legacy merchant_tokens table lacked the canonical
UUID id column; the migration now adds it and a unique index without removing
connections. Post-apply checks confirmed both existing connections retained,
RLS enabled, public access denied, and service-role completion/ownership/replay
checks passing in a fully rolled-back synthetic transaction. The RLS-without-
policies advisory is intentional for this server-only table. Application
end-to-end activation remains a separate merchant/browser check.

Zid confirmation Origin fix (2026-11-10): no-referrer on the confirmation page
caused browsers to send Origin:null for its native POST form, which correctly
failed the endpoint's strict Origin check. The page header and HTML metadata now
both use same-origin. The endpoint still rejects null/missing/foreign origins;
no CSRF bypass or proxy-host allowlist was added. Production probes without
credentials returned 401 for the canonical Origin and 403 for Origin:null,
confirming the configured base origin was already correct.
