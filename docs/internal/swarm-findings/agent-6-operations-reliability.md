# Agent 6: Operations & Reliability Audit Report

> **Auditor**: Agent 6 — Operations & Reliability Specialist  
> **Target Subsystems**: Sync Logs, Sync Queue, Ingress Admission, Retry Engine, Circuit Breaker, Manual Resolution, Initial Transfer, Notifications (In-App, Telegram, Push), Health & Monitoring, and Idempotency Guarantees.  
> **Status**: Verified in Real Code & Test Suites (879+ Unit Tests Passing)  
> **Date**: 2026-11-24  

---

## 1. Executive Summary & Reliability Philosophy

The operations and reliability architecture in ERP Link is built upon a fundamental design tenet established in October 2026: **"لا تضيع ولا ترفض" (Never lose, never reject authenticated traffic)**. 

### Core Reliability Principles:
1. **Delay is acceptable; data loss is unacceptable**: Webhook deliveries from commerce platforms (Zid, Salla, Shopify) and ERP (Odoo) must be durably recorded **before** any business processing or HTTP response. Platforms do not resend webhooks following a `4xx` response; therefore, blanket `429 Too Many Requests` rate limiting was abolished on certified ingress routes.
2. **Write-Ahead Logging (WAL)**: Ingress routes write an immutable receipt into `webhook_inbox` prior to returning HTTP `2xx`/`202`. Background processing transitions receipts to `sync_queue`.
3. **No Silent Drops**: Any event that is skipped due to settings, missing mappings, unsupported topics, or older revisions writes an explicit `sync_logs` row with `status = 'skipped'`, `trigger_type = 'webhook-ingress'`, and an explanatory machine/human-readable skip code.
4. **Fairness Across Tenants**: Multi-tenant processing incorporates fair-share round-robin scheduling, targeted fair-fetch queries to prevent starving smaller workspaces, and strict per-workspace concurrency caps (`MAX_CONCURRENT_PER_WORKSPACE = 3`).
5. **Fenced Unknown Outcomes**: Network drops or RPC timeouts during an ERP mutation do not auto-replay blindly. Uncertain states are quarantined with `outcome_unknown = true` to protect against duplicate journal entries, duplicate sales orders, or corrupted stock quantities.

---

## 2. Sync Logs System (`src/app/(app)/app/logs/`)

### 2.1 Architecture & Navigation Split
The Sync Logs user interface follows an **Odoo-style borderless list and record view architecture**:
- **List View (`/app/logs`)**:
  - Implementation: [logs-client.tsx](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/logs/logs-client.tsx) and [log-ui.tsx](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/logs/log-ui.tsx).
  - Uses `getSyncLogs({ lean: true })`.
  - **Performance Optimization**: The select clause explicitly names columns and omits **both** `payload` JSON and `error_message` (which often contain multi-KB stack traces or raw JSON dumps). This ensures sub-50ms query times over tens of thousands of rows.
  - Column visibility preferences are stored in the client's `localStorage` (`erplink.logs.columns.v1`). Available columns include: Status, Event, Entity, Model, Trigger Type, Entity Item ID, Record ID, Mapping, Store ID, Log ID, Time, and Auto Delete.
- **Detail View (`/app/logs/[id]`)**:
  - Implementation: [page.tsx](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/logs/[id]/page.tsx) and [log-detail-client.tsx](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/logs/[id]/log-detail-client.tsx).
  - Fetches the complete row via `getSyncLogById(logId)` in [sync-logs.ts](file:///e:/توفيق/zid/zidlink2/src/app/actions/sync-logs.ts).
  - Displays full error message, technical metadata, store/ERP references, and an interactive [PayloadViewer](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/logs/payload-viewer.tsx) with JSON tree formatting and instant string search.

### 2.2 Status Lifecycle & Definitions
Sync logs capture four core lifecycle states:

| Status Key | Arabic Label | English Label | Badge Styling | Underlying Condition |
| :--- | :--- | :--- | :--- | :--- |
| `success` | ناجح | Success | Green border/bg (`text-success`) | `status = 'success' AND resolved_manually = false` |
| `manual` | محلول يدوياً | Resolved Manually | Amber border/bg (`text-amber-600`) | `resolved_manually = true` |
| `failed` | فشل | Failed | Red border/bg (`text-destructive`) | `status = 'failed'` |
| `skipped` | تم التخطي | Skipped | Gray muted border/bg (`text-muted-foreground`) | `status = 'skipped'` |
| `processing`| جاري المزامنة... | Syncing... | Blue spinner (`text-primary`) | Live in-flight state (UI feedback) |

### 2.3 Instant Search & Index Strategy
- Search is performed via `syncLogSearchFilter` in [src/lib/sync-log-search.ts](file:///e:/توفيق/zid/zidlink2/src/lib/sync-log-search.ts).
- Avoids PostgREST ILIKE wildcard full-table scans. Queries run against trigram GIN indexes or exact prefix match indexes (`idx_sync_logs_match`).
- Platform filtering matches against the catalog of valid webhooks ([SHOPIFY_TOPIC_CATALOG](file:///e:/توفيق/zid/zidlink2/src/lib/shopify-topics.ts), Zid topics, Salla events).
- Platform tokens are resolved dynamically per workspace using `merchant_tokens`, `salla_tokens`, and `shopify_tokens` so that multi-platform IDs are cleanly segregated.

### 2.4 Manual Resolution vs. Re-send Actions
On the log detail page (`/app/logs/[id]`), when a record has `status = 'failed'` or `status = 'skipped'`, two user action buttons appear:
1. **Resolve Manually (`resolveLogManually`)**:
   - **Semantic**: Marks the record as resolved because the operator handled the discrepancy directly in Odoo or the store.
   - **Database Mutation**:
     ```typescript
     await supabase.from('sync_logs').update({
       status: 'success',
       error_message: 'Resolved manually in Odoo / تم الحل يدويًا في أودو',
       trigger_type: 'manual',
       resolved_manually: true
     }).eq('id', logId).eq('workspace_id', user.active_workspace_id)
     ```
   - **Effect**: Clears the failure from the dashboard error counters without executing any ERP write operations.
2. **Re-send / Retry (`retrySyncLog`)**:
   - **Semantic**: Re-executes the integration logic using the recorded payload.
   - **Execution Target Check**: Validates the pinned ERP connection (`validateExecutionTarget`). Rejects legacy logs lacking pinned connection generation (`Legacy sync log has no pinned ERP target`).
   - **Branching**:
     - If `field_mapping_id` is a valid UUID, re-runs custom mapping via `processSingleMapping`.
     - Otherwise, falls back to Standard Mapping preset execution via `processWebhookEvent` (`isQueueExecution = true`).
   - Updates the existing log in place (`trigger_type = 'manual'`, `resolved_manually = false`), clearing old errors, and cleans up any redundant newly created sync row.

### 2.5 Log Retention Policy
- Defined in [src/lib/sync/log-retention.ts](file:///e:/توفيق/zid/zidlink2/src/lib/sync/log-retention.ts).
- `SYNC_LOG_SUCCESS_RETENTION_HOURS = Number.POSITIVE_INFINITY`
- `SYNC_LOG_FAILURE_RETENTION_DAYS = Number.POSITIVE_INFINITY`
- `cleanupExpiredLogs()` is a **deliberate no-op**. Automatic deletion of operational sync logs is frozen in production to preserve audit trails until central administrative archiving is completed.
- Pinned by characterization tests in [tests/unit/sync-log-retention.test.ts](file:///e:/توفيق/zid/zidlink2/tests/unit/sync-log-retention.test.ts).

### 2.6 Webhook Skip Reason Registry (`src/lib/webhook-skip-log.ts`)
When an event cannot or should not be synced, `logWebhookSkip` inserts a `sync_logs` row with `status = 'skipped'` and `trigger_type = 'webhook-ingress'`:

```
Webhook Ingress / Worker
         │
         ├── Disabled in Settings ─────────▶ [disabled_in_settings]
         ├── Unknown / Unhandled Event ────▶ [unhandled_event] / [unknown_topic]
         ├── Stale Payload (Outdated) ─────▶ [stale_event]
         ├── Unmapped Topic / Entity ──────▶ [no_entity_mapping]
         │
         └── Odoo → Store Skips:
                 ├── Direction Disabled ───▶ [odoo_direction_disabled]
                 ├── Unsupported ERP Type ─▶ [odoo_erp_type_unsupported]
                 ├── No Model Fields ──────▶ [odoo_no_field_mappings]
                 ├── Unauthenticated Del. ─▶ [odoo_deletion_unauthenticated]
                 ├── Missing Delete Values ▶ [odoo_deletion_no_values]
                 ├── Missing Match Value ──▶ [odoo_deletion_no_match_value]
                 └── Empty Match Field ────▶ [odoo_empty_match_field]
```

---

## 3. Queue System & Retry Engine (`src/app/(app)/app/queue/`)

### 3.1 Architectural Layout & Storage
The queue pipeline utilizes four tables in Supabase:
1. `webhook_inbox`: Write-Ahead Log storing incoming webhook receipts with deduplication key `uq_webhook_inbox_dedup`.
2. `sync_queue`: Active operational queue. Claimed rows carry short-lived lease tokens (`lease_token`, `lease_expires_at`).
3. `sync_queue_dead`: Permanent dead-letter archive for exhausted records (`died_at`, original payload, last error).
4. `queue_archives`: Reversible user archive table holding manually archived queue rows for 7 days (`expires_at`).

### 3.2 The Four Operational Queue Tabs

| Tab Name | Arabic Name | Filter Criteria | Operational Purpose |
| :--- | :--- | :--- | :--- |
| **Pending** | معلّقة | `next_retry_at IS NOT NULL AND next_retry_at != FROZEN_SENTINEL AND outcome_unknown = false` | Normal jobs scheduled for execution or awaiting backoff. |
| **Frozen** | مجمّدة | `(next_retry_at IS NULL OR next_retry_at = FROZEN_SENTINEL) AND outcome_unknown = false` | Jobs that exhausted 5 retries or hit terminal business rules. Require merchant/admin action. |
| **Orphans** | يتيمة | `status = 'pending' AND workspace_id IS NULL AND store_id IN (workspace stores)` | Webhooks that arrived before store linking was finalized. |
| **Archive** | الأرشيف | `sync_queue_dead` rows + `queue_archives` rows | Historical record of dead letters and user-archived items (retention: 7 days in user archive, 30 days before dead-letter cleanup). |

### 3.3 Concurrency, Scheduling & Fair-Share Rules
Configured in [src/lib/sync-queue.ts](file:///e:/توفيق/zid/zidlink2/src/lib/sync-queue.ts):
- `SYNC_QUEUE_CONCURRENCY`: Default `10` simultaneous workers across all workspaces.
- `SYNC_QUEUE_DEFAULT_BATCH`: Default `50` items pulled per drain cycle.
- `MAX_CONCURRENT_PER_WORKSPACE`: Strict ceiling of `3` active workers per workspace, preventing a single merchant's Odoo instance from being overwhelmed.
- `SYNC_QUEUE_ITEM_TIMEOUT_MS`: Default `120,000ms` (2 minutes). Hard timeout for XML-RPC calls to prevent worker starvation.
- **Fair-Share Round-Robin**: Queue items are grouped by `workspace_id`. The batch is assembled by round-robin extraction across active workspaces.
- **Anti-Starvation Fair-Fetch**: If a workspace with pending items is absent from the top `next_retry_at` window (e.g., due to an older backlog of 10,000 items in another store), `processSyncQueue` performs targeted queries for up to 50 starved workspaces (`MIN_SHARE_PER_WORKSPACE = 5`).
- **Wave Claiming (`selectQueueClaimWave`)**: Workers lease only items that can execute immediately under the `MAX_CONCURRENT_PER_WORKSPACE = 3` and product-family lock constraints. Eliminates "ghost leases" across server restarts.

### 3.4 Dependency Ordering Guarantees
Within each workspace's batch, items are ordered to preserve semantic integrity:
1. **Orders**: `order.create` / `order.created` always precedes `order.update` / `order.status.update` for the same entity ID.
2. **Product Families**: Parent and child variant items are sorted by dependency rank:
   - Rank 0: Parent Create
   - Rank 1: Child Variant Create
   - Rank 2: Parent Update / Publish
   - Rank 3: Child Variant Update
   - Rank 4: Child Variant Delete
   - Rank 5: Parent Delete
   This prevents race conditions where child variant updates hit Odoo before the template attribute lines exist.

### 3.5 Retry Mechanisms, Backoff & Season Mode
- **Max Retries**: `SYNC_QUEUE_MAX_RETRIES = 5`.
- **Exponential Backoff**:
  ```typescript
  backoffMinutes = Math.min(Math.pow(2, retryCount - 1) * floor, cap)
  ```
  - Standard Mode: Base 5 min; cap 360 min (6 hours). Sequence: 5m, 10m, 20m, 40m, 80m...
  - Season Mode (`SYNC_SEASON_MODE=true`): Base 1 min; cap 15 min. Sequence: 1m, 2m, 4m, 8m, 15m (all 5 attempts occur within ~30 minutes).
- **Jitter**: Adds `0..60,000ms` random delay to prevent synchronized thundering herd spikes against Odoo.
- **Rate-Limit & Connection Refused Backoff**: Automatically forces higher initial floor when error contains `429`, `ECONNREFUSED`, `ETIMEDOUT`, `502`, or `504`.

### 3.6 Circuit Breaker Protection
- **Mechanism**: In-memory tracker per workspace in `sync-queue.ts`.
- **Threshold**: `SYNC_CB_THRESHOLD = 10` consecutive network/infrastructure failures.
- **Action**: When 10 consecutive network errors occur, the workspace is parked for `SYNC_CB_COOLDOWN_MIN = 15` minutes (`next_retry_at = now + 15m`).
- **Failure Classification**: Only trips on infrastructure outages (XML-RPC socket hang up, ECONNRESET, ETIMEDOUT, 502/503/504, bad gateway). Deterministic business validation errors **never** trip the circuit breaker.
- **Recovery**: Any single successful operation clears the failure counter immediately (`noteWorkspaceSuccess`).

### 3.7 Terminal Return Reviews & Quarantined Unknown Outcomes
1. **Terminal Business Reviews (`isTerminalReturnReview`)**:
   - Errors such as `return_damaged_requires_financial_review`, `return_receipt_quantity_invalid`, or `order_cod_fee_amount_mismatch_requires_review` immediately jump to `retry_count = max_retries` and freeze. Burning retries on identical business payloads is blocked.
2. **Quarantined Unknown Outcomes (`outcome_unknown = true`)**:
   - If an operation times out or aborts while communicating with Odoo, the system cannot verify whether Odoo committed the change.
   - The row is marked `outcome_unknown = true`, `next_retry_at = null`, and `execution_key` is fenced.
   - Subsequent operations on the same entity are blocked until an operator reviews and reconciles the state.
   - The UI "Retry Frozen" button deliberately excludes `outcome_unknown = true` records.

### 3.8 User Operational Controls in Queue UI

```
┌────────────────────────────────────────────────────────────────────────┐
│                              Queue Controls                            │
├───────────────────┬────────────────────────────────────────────────────┤
│ Send Now          │ Triggers `sendNowWorkspace()`. Processes pending   │
│ (إرسال الآن)      │ items immediately respecting concurrency caps.     │
├───────────────────┼────────────────────────────────────────────────────┤
│ Retry Frozen      │ Triggers `retryFrozenItems()`. Resets retry_count  │
│ (إعادة تشغيل)     │ to 0 and schedules execution now (excludes unkown).│
├───────────────────┼────────────────────────────────────────────────────┤
│ Replay Orphans    │ Triggers `replayOrphanItems()`. Enqueues receipts  │
│ (استرجاع الأيتام) │ that arrived prior to store connection.            │
├───────────────────┼────────────────────────────────────────────────────┤
│ Replay Dead       │ Triggers `replayDeadItem()` or `replayAllDeadItems`│
│ (استرجاع الأرشيف) │ Restores dead-letter items with clean dedup keys.  │
├───────────────────┼────────────────────────────────────────────────────┤
│ Archive Selected  │ Triggers `archiveQueueItems()`. Snapshots rows to  │
│ (أرشفة)           │ `queue_archives` (7-day TTL) then deletes source.  │
├───────────────────┼────────────────────────────────────────────────────┤
│ Restore Archive   │ Triggers `restoreQueueArchive()`. Restores a user- │
│ (استعادة)         │ archived row back into `sync_queue`.               │
└───────────────────┴────────────────────────────────────────────────────┘
```

---

## 4. Initial Transfer System (`src/app/(app)/app/initial-transfer/`)

### 4.1 Architecture & Flow
- UI Entry: [transfer-client.tsx](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/initial-transfer/transfer-client.tsx).
- Action Handler: [src/app/actions/transfers.ts](file:///e:/توفيق/zid/zidlink2/src/app/actions/transfers.ts).
- Designed for catalog bootstrapping when a store or ERP is first connected.
- **Asynchronous Execution**: `startInitialTransfer` creates a `data_transfers` row with `status = 'pending'`, kicks off `runTransferInBackground(...)` asynchronously without awaiting it, and returns immediately to the client.

### 4.2 Supported Entities & Deliberate Exclusions
- **Supported Entities**:
  1. `categories` (`product.category` ⇄ store categories/collections)
  2. `products` (`product.template` ⇄ store products)
  3. `customers` (`res.partner` ⇄ store customers)
- **Deliberate Exclusion of Orders**: Orders are **not** supported for bulk initial transfer. Order synchronization involves financial validation, currency rounding, tax inclusive/exclusive math, inventory reservations (pickings), and payment reconciliation. Orders must be ingested through the transactional webhook pipeline or historical reconciliation scripts.

### 4.3 Directions & Platform Support
- **Directions**:
  - `store_to_odoo` (or legacy alias `zid_to_odoo`): Pulls from store, maps fields, and creates/updates in Odoo.
  - `odoo_to_store` (or legacy alias `odoo_to_zid`): Pulls from Odoo via `searchRead`, maps fields, and pushes to store.
- **Supported Store Adapters**:
  - **Zid**: Uses `ZidAPI.products`, `ZidAPI.categories`, `ZidAPI.customers`.
  - **Salla**: Uses `listSallaProducts`, `listSallaCategories`, `listSallaCustomers`.
  - **Shopify**: Uses GraphQL client (`listShopifyProducts`, `listShopifyCollections`, `listShopifyCustomers`, `createShopifyProduct`, etc.).

### 4.4 Concurrency, Progress Tracking & Idempotency
- **Worker Concurrency**: Runs with `runWithConcurrencyLimit(5, entities, ...)` (5 simultaneous workers).
- **Throttled Progress Reporting**: Updates `records_created`, `records_failed`, and `failure_reason` in the database throttled to once every 3,000ms (`updateDbProgress`).
- **Deduplication on Import**:
  - Odoo side: Invokes `findExistingOdooRecord(odooClient, odooModel, entity, odooValues, matchFields, ..., workspaceId, platform)` to update existing records rather than creating duplicates.
  - Store side: Checks existing items by SKU or match key before invoking create vs. update.

---

## 5. Notification & Alerting Infrastructure

### 5.1 In-App Notification Center
- **Component**: [src/components/notification-center.tsx](file:///e:/توفيق/zid/zidlink2/src/components/notification-center.tsx).
- **Backend Service**: [src/lib/app-notifications.ts](file:///e:/توفيق/zid/zidlink2/src/lib/app-notifications.ts).
- **Storage**: `app_notifications` table (`workspace_id, platform, event, event_key, status, title, body, href`).
- **Real-Time Delivery**: Real-time push to open browser tabs is achieved via in-memory Server-Sent Events (SSE) at `src/app/api/notifications/stream/route.ts` via `publishAppNotification`.
- **Web Push**: Fanout to Web Push devices registered in `browser_push_subscriptions` via `browser_push_deliveries` using VAPID credentials. Bounded, non-overlapping push worker drains pending notifications with exponential retry.

### 5.2 Telegram Notification System
- **Outbox System (`src/lib/telegram-outbox.ts`)**:
  - Direct HTTP calls to `api.telegram.org` were replaced by the permanent `telegram_outbox` table.
  - Rate limited to 15 messages/second with a strict 5,000ms fetch timeout.
  - Handles Telegram HTTP `429 Too Many Requests` by honoring `parameters.retry_after`.
  - **Single Message per Event Guarantee**: `event_key` prevents notification spam. Arrival alerts are delayed by 20,000ms (`TELEGRAM_ARRIVAL_DELAY_MS`). If sync succeeds or fails before that delay, the result message replaces the arrival message.
- **Long Poller (`src/lib/telegram-long-poller.ts`)**:
  - Booted at server startup via [src/instrumentation.ts](file:///e:/توفيق/zid/zidlink2/src/instrumentation.ts).
  - Handles `/start <code>` linking commands.
  - Parsing rules in [src/lib/telegram/link-code.ts](file:///e:/توفيق/zid/zidlink2/src/lib/telegram/link-code.ts) use a 6-character alphabet omitting ambiguous characters (`I`, `O`, `0`, `1`) and accept extra words or lower case.

### 5.3 Administrative System Alerts (`src/lib/admin-alerts.ts`)
Monitors overall system health and sends consolidated Telegram alerts to `ADMIN_ALERT_WORKSPACE_ID`:
- **Throttling**: Single consolidated alert per hour for matching failure sets.
- **Monitored Thresholds**:
  - `oldest_pending`: Oldest pending queue item > 1,800s (30 minutes).
  - `deep_backlog`: Queue depth > 2,000 items.
  - `outcome_unknown`: Any `unknownOutcome > 0`.
  - `frozen`: Any `frozen > 0`.
  - `dead_letter`: Any rows in `sync_queue_dead`.
  - `inbox_failed`: Webhook receipts failing delivery.
  - `telegram_failed`: Messages exhausted in outbox.
  - `global_cap`: Ingress safety valve triggered.

---

## 6. Health Metrics & Diagnostics Tooling

### 6.1 Readiness & Health Endpoints
1. **`GET /api/admin/queue-health`**:
   - Admin-only comprehensive operational assessment.
   - Verifies database migrations: `webhook_inbox`, `sync_queue`, `sync_queue_dead`, `sync_reconcile_state`, `telegram_outbox`, `erp_effects`, `webhook_acceptances`.
   - Returns queue counts (`pending`, `frozen`, `uncertain`, `dead`, `orphans`, `activeLeases`).
   - Evaluates system readiness and reports structured `blockers` (conditions causing data loss) and `warnings`.
2. **`POST /api/admin/pipeline-selftest`**:
   - Executes [src/lib/pipeline-selftest.ts](file:///e:/توفيق/zid/zidlink2/src/lib/pipeline-selftest.ts).
   - Validates the end-to-end webhook ingress, WAL persistence, dedup key integrity, coalescing, and outbox buffering using synthetic test data.
   - Cleans up all generated test rows and leaves zero residue.
3. **`GET /api/health/live`**:
   - Lightweight public liveness probe returning JSON release tags without database overhead.

---

## 7. Idempotency & Anti-Data-Loss Guarantees

### 7.1 Event Identification vs. Entity Identification
- **Critical Invariant**: `dedup_key` must identify the **delivery / event**, NEVER the **record / entity**.
- In [src/lib/sync-queue.ts](file:///e:/توفيق/zid/zidlink2/src/lib/sync-queue.ts):
  - If the platform sends a delivery ID (`X-Shopify-Webhook-Id`, Salla `webhook_id`, Zid delivery ID), it is used directly: `delivery:<platform>:<storeId>:<event>:<deliveryId>`.
  - If no delivery ID is provided (e.g. Odoo Automated Actions or Zid payloads without delivery ID), `fingerprintPayload(payload)` computes a SHA-1 hash over key-sorted JSON.
  - **Why**: Using a record ID (such as `odoo:<model>:<id>` or `zid:<order_id>`) causes second and third legitimate updates to be dropped as duplicates.

### 7.2 Webhook Receipt Write-Ahead Log
- Webhooks land in `webhook_inbox` with unique index `uq_webhook_inbox_dedup`.
- HTTP 2xx is returned **only after** the receipt is stored.
- If a duplicate delivery arrives while the receipt is pending, Postgres raises error `23505`, which is handled gracefully as `{ duplicate: true }` without failing the request.

### 7.3 Odoo → Store Webhook Trust Rule
- Implemented in `src/app/api/webhooks/odoo/route.ts`.
- **The webhook body is treated as a trigger, never as a data source**.
- Values are read back directly from the customer's Odoo instance via XML-RPC.
- If Odoo read succeeds: Odoo record values are used; payload body values are ignored.
- If Odoo read throws: The event fails and is retried.
- If Odoo returns empty: Treated as confirmed record deletion.

---

## 8. User-Facing Troubleshooting Playbooks

### Playbook A: An Order Failed to Sync
1. Navigate to `/app/logs`.
2. Filter status by **Failed (فشل)** or search by order number.
3. Click the failed log row to open `/app/logs/<id>`.
4. Inspect the `error_message`:
   - If caused by missing product mapping or missing tax rate:
     - Navigate to `/app/mapping-center`.
     - Configure the missing product SKU or tax rate.
     - Return to `/app/logs/<id>` and click **Re-send (إعادة الإرسال)**.
   - If the operator created the order manually in Odoo:
     - Click **Resolve Manually (حل يدوي)** to clear the error.

### Playbook B: Queue Items are Frozen
1. Navigate to `/app/queue` and select the **Frozen (مجمدة)** tab.
2. Review the error descriptions on frozen rows.
3. If errors were due to temporary ERP downtime:
   - Click **Retry Frozen (إعادة تشغيل المجمد)** in the top action bar.
4. If specific items are invalid test transactions:
   - Select the checkbox next to the rows and click **Archive (أرشفة)**.

### Playbook C: Orphan Items in Queue
1. In `/app/queue`, click the **Orphans (يتيمة)** tab.
2. Orphan items indicate that webhooks arrived before the store token was saved in the workspace.
3. Ensure the store is connected in `/app/connect-store`.
4. Click **Replay Orphans (استرجاع الأيتام)**. The system links receipts to the workspace and moves them to the active queue.

### Playbook D: Setting up Telegram Notifications
1. Go to `/app/settings/notifications`.
2. Click **Add Bot** and provide the Telegram Bot Token (obtained from `@BotFather`).
3. Click **Generate Link Code** (generates a 6-character code such as `7X9K2M`).
4. In Telegram, open the bot and send `/start 7X9K2M`.
5. The long poller automatically pairs the chat and sends a confirmation message.

---

## 9. Red Lines & Safety Rules for Maintainers

1. **NEVER add blanket rate limiters to webhook routes**: Doing so turns traffic surges into permanent data loss. Use `admitWorkspaceEvent`.
2. **NEVER delete sync logs based on age**: `cleanupExpiredLogs()` must remain disabled. Historical audit records must be preserved.
3. **NEVER change `dedup_key` to a record ID**: It must always identify the event or payload fingerprint.
4. **NEVER parse JSON payloads in lean log listings**: Keep `getSyncLogs({ lean: true })` free of `payload` and `error_message`.
5. **NEVER call `api.telegram.org` synchronously from sync workers**: All notifications must pass through `telegram_outbox`.
6. **NEVER auto-replay `outcome_unknown = true` queue items**: Uncertain outcomes must be operator-reconciled to avoid financial and stock duplication.

---
*Report compiled and verified by Agent 6 (Operations & Reliability Specialist).*
