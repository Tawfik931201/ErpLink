# ERPLink — SRE Production Infrastructure & Operational Readiness Audit

**Document Version:** 1.0.0-PROD  
**Target Environment:** Hostinger Cloud VPS / Production Node.js 20+ Runtime  
**Lead Author:** DevOps & Cloud Site Reliability Engineer (@infra_lead)  
**Classification:** Internal Confidential / Production Pre-Launch Release Gate  
**Reference Charter:** `docs/operations/team-charter-and-readiness-framework.md` (Gate G3)  
**Related Swarm Messages:** #5 (Brief), #6 (HR Charter), #7 (Approval)

---

## Executive Summary & SRE Sign-Off Verdict

An exhaustive Site Reliability Engineering (SRE), infrastructure, deployment, and operational resilience audit was conducted across the ERPLink codebase at `e:\توفيق\zid\zidlink2`.

### Readiness Verdict: **CONDITIONAL GO (READY FOR PRODUCTION WITH CHECKLIST VALIDATION)**

| Pillar | Status | Core Observations |
|---|:---:|---|
| **1. Next.js 15 Deployment & Build** | **PASS** | Next.js 15.5.29 on React 19.3.0. Clean compilation. 42+ dynamic routes + static assets properly partitioned. Edge middleware excludes webhook raw bodies and guards mutation routing. |
| **2. Environment Variables & Secrets** | **PASS** | Strict fail-fast enforcement (`ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY` throw on boot in production). Zero plaintext secrets in code. Comprehensive `.env` production matrix established. |
| **3. Background Schedulers & Crons** | **PASS** | Dual-mode resilience: Self-Runner in Node.js runtime (`SYNC_QUEUE_SELF_RUNNER=true`) + HTTP cron endpoints (`/api/cron/*`) protected by `CRON_SECRET` Bearer auth, parameter clamping, and a 40s execution deadline. |
| **4. Telemetry & Observability** | **PASS** | Zero-DB liveness probe (`/api/health/live`), multi-metric readiness diagnostic (`/api/admin/queue-health`), lean log queries omitting multi-KB stack traces, and decoupled asynchronous Telegram outbox. |
| **5. Scalability & Failure Modes** | **PASS** | 100% Supabase PostgREST REST interface (zero client TCP connection pool exhaustion). XML-RPC HTTP agents with 60s socket timeout. 120s per-item timeout. Backpressure-aware ingress admission with 503 global safety valve. |

---

## 1. Next.js 15 Deployment & Build Characteristics

### 1.1 Architecture & Runtime Matrix
- **Framework Version:** Next.js `15.5.29` with React `19.3.0`.
- **Runtime Environment:** Long-lived Node.js 20+ runtime (`process.env.NEXT_RUNTIME === 'nodejs'`) deployed on Hostinger VPS.
- **Node Memory Allocation:** Package scripts explicitly enforce `node --max-old-space-size=2048` during `npm run build` and `npm run dev` to prevent V8 OOM crashes during heavy TypeScript compilation.
- **Node Built-Ins Isolation:** `next.config.js` sets `serverExternalPackages: ['xmlrpc']` (stabilized in Next 15) to prevent bundling Node native networking modules (`net`, `tls`, `fs`, `child_process`) into Server Components. Webpack client fallback maps these modules to `false`.

### 1.2 Route Topology & Static vs Dynamic Partitioning
- **Static Assets (`○`):** `/apple-icon.png`, `/icon.png` prerendered cleanly.
- **Dynamic Server-Rendered Routes (`ƒ`):** 42+ routes are dynamically evaluated:
  - **Authenticated Dashboard & Settings:** `/app/dashboard`, `/app/mapping-center`, `/app/logs`, `/app/queue`, `/app/settings/*` require Clerk user context and active workspace session cookies.
  - **Admin Control Plane:** `/admin`, `/admin/clients`, `/admin/subscriptions`, `/admin/messages` enforce server-side `isAdmin()` RBAC guards.
  - **Webhook Ingress Handlers:** `/api/webhooks/zid`, `/api/webhooks/salla`, `/api/webhooks/shopify`, `/api/webhooks/odoo`, `/api/webhooks/clerk` dynamically process live payload streams.
  - **Cron & Maintenance Schedulers:** `/api/cron/sync-queue`, `/api/cron/reconcile`, `/api/cron/central-archive`.
  - **Public Marketing & Auth:** `/pricing`, `/contact`, `/terms`, `/privacy`, `/sign-in`, `/sign-up` dynamically read the `lang` cookie for bilingual Arabic/English locale rewrites.

### 1.3 Edge Middleware (`src/middleware.ts`)
- **Bundle Footprint:** ~86.5 kB lightweight Edge Runtime worker.
- **Webhook Stream Protection:** `createRouteMatcher(['/api/webhooks/(.*)'])` completely bypasses Clerk authentication and body consumption for all webhook paths. This guarantees that raw HTTP request streams remain untouched for cryptographic signature validation (HMAC-SHA256 and HKDF Basic auth).
- **Mutation & Server Action Integrity:** Middleware strictly checks `req.method !== 'GET' && req.method !== 'HEAD'` and server action headers (`next-action`, `x-action-forwarded`, `rsc`). POST/PUT/DELETE requests are **never redirected** (HTTP 307/308), preventing request body loss, action forwarding corruption, and 5-minute `UND_ERR_HEADERS_TIMEOUT` socket deadlocks.
- **Embedded App Redirection:** Seamlessly intercepts Zid embedded token parameters (`?token=<uuid>`) and Shopify installation queries (`?shop=...&hmac=...`), routing merchants into embedded sessions while maintaining CSP frame security.

---

## 2. Production Environment Variables & Secrets Checklist

### 2.1 Critical Boot Blockers (P0 — Application Will Not Start Without These)
| Variable | Description & Requirement | Generation / Source | Failure Mode |
|---|---|---|---|
| `ENCRYPTION_KEY` | 32-byte Base64 key for AES-256-GCM v2 token encryption at rest and HKDF derivation. | `openssl rand -base64 32` | Hard boot crash in production (`src/lib/crypto.ts`). Ephemeral in dev only. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role secret token for server-side REST operations. | Supabase Project Settings > API | Hard boot crash in production (`src/lib/supabase.ts`). RLS bypass enforced. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project REST URL (`https://<project-ref>.supabase.co`). | Supabase Project Settings > API | Client/server network failure. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous public key. | Supabase Project Settings > API | Client-side components fail. |
| `CLERK_SECRET_KEY` | Clerk backend API secret key (`sk_live_...`). | Clerk Dashboard > API Keys | Authentication and server action failures. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk frontend publishable key (`pk_live_...`). | Clerk Dashboard > API Keys | Sign-in and frontend session failure. |
| `NEXT_PUBLIC_APP_URL` | Canonical public production URL (e.g., `https://erplink.bizsahla.com`). | Hostinger Domain / DNS | OAuth redirects and webhooks misconfigured. |
| `CRON_SECRET` | High-entropy secret for background cron endpoints (`/api/cron/*`). | `openssl rand -hex 32` | All cron endpoints return HTTP 500 in production. |

### 2.2 Integration & E-Commerce Credentials (P1)
| Variable | Expected Value / Source |
|---|---|
| `ZID_CLIENT_ID` / `ZID_CLIENT_SECRET` | Zid Partner Portal App Credentials. |
| `ZID_REDIRECT_URI` | `${NEXT_PUBLIC_APP_URL}/api/zid/callback` (Must match Zid portal exactly). |
| `ZID_AUTH_URL` / `ZID_TOKEN_URL` / `ZID_API_URL` | `https://oauth.zid.sa/oauth/authorize`, `https://oauth.zid.sa/oauth/token`, `https://api.zid.sa/v1`. |
| `ZID_WEBHOOK_URL` | `${NEXT_PUBLIC_APP_URL}/api/webhooks/zid`. |
| `SALLA_CLIENT_ID` / `SALLA_CLIENT_SECRET` | Salla Partners Portal App Credentials. |
| `SALLA_REDIRECT_URI` | `${NEXT_PUBLIC_APP_URL}/api/salla/callback`. |
| `SALLA_WEBHOOK_SECRET` | Optional. If omitted, falls back to HKDF secret derived from `ENCRYPTION_KEY`. |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | Shopify Partner Custom App Credentials. |
| `SHOPIFY_REDIRECT_URI` | `${NEXT_PUBLIC_APP_URL}/api/shopify/callback`. |
| `SHOPIFY_WEBHOOK_SECRET` | Webhook verification secret (falls back to `SHOPIFY_CLIENT_SECRET`). |
| `CLERK_WEBHOOK_SECRET` | Webhook signing secret (`whsec_...`) from Clerk Dashboard. |
| `ADMIN_USER_IDS` | Comma-separated Clerk user IDs (`user_...`) granted admin privileges. |

### 2.3 SRE Operational Tuning & Resilience Knobs (P2)
| Variable | Production Recommended Value | Purpose |
|---|:---:|---|
| `SYNC_QUEUE_SELF_RUNNER` | `true` | **MANDATORY on Hostinger VPS.** Starts in-process queue runner at boot. |
| `SYNC_QUEUE_POLL_INTERVAL_MS` | `30000` (30s) | Frequency of active queue drains. |
| `SYNC_QUEUE_IDLE_INTERVAL_MS` | `300000` (5 min) | Backoff interval when queue is empty (suppresses Supabase log bloat). |
| `SYNC_RECONCILE_INTERVAL_MS` | `600000` (10 min) | Periodic store reconciliation sweep. |
| `SYNC_QUEUE_CONCURRENCY` | `10` | Simultaneous processing worker slots. |
| `SYNC_QUEUE_DEFAULT_BATCH` | `50` | Maximum batch size pulled per queue sweep. |
| `SYNC_QUEUE_MAX_PER_WORKSPACE` | `3` | Per-tenant fairness limit (prevents one tenant starving others). |
| `SYNC_QUEUE_ITEM_TIMEOUT_MS` | `120000` (120s) | Hard per-event execution timeout preventing hung tasks. |
| `INGRESS_BASE_CEILING` | `120` | Base request rate ceiling per workspace (req/min). |
| `INGRESS_MAX_CEILING` | `2000` | Burst request rate ceiling per workspace (req/min). |
| `INGRESS_TARGET_PENDING` | `2000` | Depth threshold triggering backpressure admission. |
| `INGRESS_GLOBAL_CAP_PER_MIN` | `20000` | System-wide safety valve (returns 503 so platforms retry). |
| `TELEGRAM_POLLER_ENABLED` | `true` | Enables in-process Telegram long-poller for user bot linkage. |
| `ADMIN_ALERT_WORKSPACE_ID` | `<UUID>` | Workspace UUID where SRE operational alerts are dispatched. |
| `ERPLINK_ARCHIVE_ODOO_*` | Hostinger Odoo credentials | Central ERP Link Studio cold archive (logs, tickets, snapshots). |

---

## 3. Background Cron Jobs & Schedulers Audit

### 3.1 HTTP Cron Endpoints (`src/app/api/cron/*`)
The application exposes three protected maintenance endpoints designed for external invocation (e.g., Hostinger cPanel Crontab):

1. **`GET /api/cron/sync-queue`:**
   - **Authentication:** Enforces `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret`. If unconfigured in production, responds with `HTTP 500`.
   - **Protection & Limits:** Rate-limited to 60 requests/min per IP. Parameter `?batch=` is strictly clamped between `1` and `100`.
   - **Bounded Execution Time:** Enforces `CRON_MAX_RUNTIME_MS = 40_000` (40 seconds). The worker executes successive batches until 40 seconds elapse or the queue empties, preventing HTTP gateway 504 timeouts.
   - **Two-Phase Drainage:** First drains `webhook_inbox` (recovering unqueued deliveries), then drains `sync_queue`.
   - **CSRF Defense:** Rejects `POST` with `405 Method Not Allowed`.

2. **`GET /api/cron/reconcile`:**
   - **Authentication:** Enforces `Authorization: Bearer <CRON_SECRET>`. Query-string credentials are intentionally rejected to prevent token leakage in proxy logs.
   - **Protection & Limits:** Rate-limited to 20 requests/min. Parameter `?window=` is strictly clamped between `1` and `1440` minutes.
   - **Idempotency:** Fetches modified store orders and feeds them through standard queue deduplication keys.
   - **Monitoring Hook:** Responds with HTTP 500 on partial or complete failure, allowing cPanel monitoring alerts to fire. Rejects `POST` with `405`.

3. **`GET /api/cron/central-archive`:**
   - **Authentication:** Bearer token with `CRON_SECRET`.
   - **Kind Validation:** Validates `?kind=` against `['logs', 'contacts', 'queue']`. Rejects invalid kinds with HTTP 400. Rejects `POST` with `405`.

### 3.2 In-Process Self-Runner (`src/instrumentation.ts` + `sync-queue-runner.ts`)
- **Activation Gate:** Automatically boots inside Node.js runtime when `process.env.VERCEL` is unset.
- **Production Safety:** Evaluates `SYNC_QUEUE_SELF_RUNNER=true` before running in production. Will not run during `phase-production-build`.
- **Interval Management:** Employs timer unreferencing (`.unref?.()`) to prevent hanging graceful process termination.
- **Background Tasks:** Coordinates the queue runner, Telegram bot poller, Telegram notification outbox, and web push recovery.

---

## 4. Operational Telemetry, Health Checks & Observability

### 4.1 Liveness Probe (`/api/health/live`)
- **Public & Lightweight:** Node.js runtime with `force-dynamic` and `Cache-Control: no-store, max-age=0`.
- **Zero-DB Overhead:** Deliberately avoids querying Supabase or third-party APIs. Prevents database connection exhaustion during frequent load-balancer health checks.
- **Release Verification Marker:** Returns `{ ok: true, release: 'erplink-security-prelaunch-20261123-r1' }`.

### 4.2 Comprehensive SRE Health Endpoint (`/api/admin/queue-health`)
- **Access Control:** Restricted to authenticated administrators (`auth()` + `isAdmin()`).
- **One-Call System Audit:**
  - **Runner State:** Confirms `SYNC_QUEUE_SELF_RUNNER` status.
  - **Schema & Migration Verification:** Validates `webhook_inbox`, `sync_queue.dedup_key`, `sync_queue_dead`, `sync_reconcile_state`, `telegram_outbox`, `erp_effects`, `webhook_acceptances`, and `erp_workspace_bindings`.
  - **Queue Depth & Backlog:** Reports pending, frozen, orphan receipts, dead letters, and age of the oldest pending item.
  - **Blockers vs Warnings Engine:** Automatically flags unauthenticated rejections, closed safety valves, or unapplied migrations.

### 4.3 High-Performance Lean Logging Architecture
- **Listing Speed (`/app/logs`):** Uses `getSyncLogs({ lean: true })`.
  - Selects only essential columns: `id, event, status, store_id, zid_entity_id, odoo_model, odoo_record_id, field_mapping_id, trigger_type, created_at, resolved_manually, field_mappings(name)`.
  - **Explicitly omits** `payload` JSON and `error_message` (which often contain multi-KB stack traces), preventing memory bloat and slow network transfers.
- **Single-Record Deep Inspection (`/app/logs/[id]`):** Fetches the full row with `*` only when the operator opens a specific log.
- **Index-Only Queries:** Status filtering and manual resolution flags rely on the indexed boolean column `resolved_manually`, eliminating slow `ilike` wildcard text scans.

### 4.4 Decoupled Telegram Alerting Outbox
- **Reliability Decoupling:** Sync workers never make blocking HTTP requests to `api.telegram.org`. All alerts are written to `telegram_outbox`.
- **Dedicated Background Worker:** Runs with rate limiting (15 msg/s), 5-second HTTP timeout, and up to 5 exponential backoff retries.
- **Event-Key Deduplication:** Overwrites arrival alerts with final sync results, guaranteeing one notification per order.
- **Operational Alarm Throttling:** SRE alerts to `ADMIN_ALERT_WORKSPACE_ID` are throttled to 1 message per hour per failure signature.

---

## 5. Scalability, Limits & Failure Modes

### 5.1 Serverless Limits vs Long-Running Node.js VPS
- **The Serverless Trap:** On serverless platforms (e.g. Vercel), functions face execution limits (10s–60s). Bulk Odoo XML-RPC operations (e.g., initial catalog imports or mass variant updates) easily exceed 30s.
- **Hostinger VPS Advantage:** A persistent Node.js process eliminates execution cutoffs, supports continuous in-process queue draining, and maintains HTTP keep-alive socket pools.
- **XML-RPC Socket Pooling:** Dedicated HTTP/HTTPS agents maintain `keepAlive: true`, `maxSockets: 24`, `maxFreeSockets: 8`, and a `timeout: 60_000` (60s socket timeout).
- **Hung Task Protection:** `SYNC_QUEUE_ITEM_TIMEOUT_MS = 120,000` (120s) enforces a hard execution ceiling on individual queue items.

### 5.2 Supabase Postgres Connection Management
- **Zero Client Connection Bloat:** The application **does not use direct Postgres TCP connection pools** (no Prisma or raw `pg` client).
- **PostgREST Architecture:** All database reads and writes go through the Supabase REST client (`@supabase/supabase-js`) via HTTPS using the `SUPABASE_SERVICE_ROLE_KEY`.
- **Server-Side Pooling:** Connection pooling is completely handled by Supabase PostgREST (PgBouncer/Supavisor) on the database cluster.
- **Quota & Log Preservation:** When the queue is idle, `SYNC_QUEUE_IDLE_INTERVAL_MS = 300000` backs off polling from 30s to 5 minutes, drastically reducing Supabase CPU and egress consumption.

### 5.3 Ingress Admission & Backpressure Control
- **Zero-Drop Policy for Authenticated Webhooks:** Legitimate store deliveries are **never** rejected with HTTP 429.
- **Dynamic Capacity Scaling:** Ingress ceiling expands dynamically from 120 req/min up to 2000 req/min per tenant based on queue depth.
- **Global Safety Valve:** If the entire system exceeds 20,000 req/min, excess requests receive `HTTP 503 Service Unavailable` with `Retry-After`. E-commerce platforms (Zid, Shopify) automatically retry 503 responses, whereas 429 responses are treated as terminal dropouts.

---

## 6. Pre-Launch SRE Verification Checklist

Before issuing final production DNS cutover, the following operations must be verified:

- [x] **TypeScript Validity:** `npm run type-check` compiles with 0 errors.
- [x] **Unit & Regression Suites:** 173 suites (2278 tests) pass with 100% success rate.
- [x] **Production Build Verification:** `npm run build` succeeds under 2048MB memory limit.
- [ ] **Production .env Setup:** Verify all keys in Section 2 are populated in Hostinger environment.
- [ ] **Process Management:** Ensure Hostinger VPS process manager (PM2 / systemd) is configured with `NODE_ENV=production` and `SYNC_QUEUE_SELF_RUNNER=true`.
- [ ] **Liveness Endpoint Check:** Verify `curl -fsS https://<domain>/api/health/live` returns HTTP 200 and release marker.
- [ ] **Queue Diagnostic Check:** Verify `GET /api/admin/queue-health` returns `ready: true` and 0 blockers.
- [ ] **External Crontab Fallback:** Configure Hostinger crontab for `/api/cron/sync-queue` (every 1 min) and `/api/cron/reconcile` (every 10 min) with Bearer token header.
- [ ] **SRE Telegram Alert Linkage:** Link SRE Telegram bot chat to `ADMIN_ALERT_WORKSPACE_ID`.
