# Audit Report: Salla & Shopify Integrations in ERP Link

**Agent**: Agent 3 — Salla & Shopify Specialist  
**Target Document**: `docs/internal/swarm-findings/agent-3-salla-shopify.md`  
**Date**: November 2026  
**Audited Codebase**:
- **Salla**: `src/lib/salla-client.ts`, `src/app/api/salla/connect/route.ts`, `src/app/api/salla/callback/route.ts`, `src/app/api/webhooks/salla/route.ts`, `src/lib/salla/webhook-auth.ts`, `src/lib/salla/webhook-data.ts`, `src/lib/salla/orders.ts`, `src/lib/salla/order-amounts.ts`, `src/lib/salla/customers.ts`, `src/lib/salla/products.ts`, `src/lib/salla/categories.ts`, `src/lib/products/salla-tax.ts`, `src/lib/platforms/salla/fields.ts`, `src/app/actions/salla.ts`, `src/app/api/admin/salla-webhooks/refresh/route.ts`, `src/lib/returns/detect.ts`, `src/lib/stock-sync-engine.ts`, `src/app/actions/inventory-sync.ts`.
- **Shopify**: `src/lib/shopify-client.ts`, `src/lib/shopify-topics.ts`, `shopify.app.toml`, `src/app/api/shopify/connect/route.ts`, `src/app/api/shopify/callback/route.ts`, `src/lib/shopify/offline-token.ts`, `src/app/api/webhooks/shopify/route.ts`, `src/lib/shopify/products.ts`, `src/lib/shopify/customers.ts`, `src/lib/shopify/enrichment.ts`, `src/lib/platforms/shopify/fields.ts`, `src/app/(app)/app/connect-store/shopify-sync-settings.tsx`.
- **Core Sync Engine & ERP Handlers**: `src/lib/event-operation.ts`, `src/lib/sync/webhook.ts`, `src/lib/sync/events.ts`, `src/lib/sync/mappings.ts`, `src/lib/odoo/order-lines.ts`, `src/lib/odoo/order-values.ts`, `src/lib/odoo/execute-operation.ts`.
- **Unit Test Suites**: 9 suites, 131 tests passing (`tests/unit/salla-*.test.ts`, `tests/unit/shopify-*.test.ts`).

---

## Executive Summary & Parity Matrix

ERP Link is designed to support multi-platform eCommerce integrations connecting to Odoo ERP (and future ERPs). However, **parity between platforms cannot and must not be assumed**. Zid, Salla, and Shopify each possess fundamentally distinct API architectures, webhook delivery formats, authentication mechanisms, and lifecycle contracts.

This audit independently inspects the real production code for **Salla** (`https://api.salla.dev/admin/v2`) and **Shopify** (Admin API `2026-10`, GraphQL + REST), comparing what is implemented in real code versus theoretical assumptions or marketing copy.

### Platform Parity & Capability Matrix

| Feature / Domain | Zid Platform | Salla Platform | Shopify Platform |
| :--- | :--- | :--- | :--- |
| **API Architecture** | REST (`api.zid.sa/v1`) | REST (`api.salla.dev/admin/v2`) | GraphQL (Admin API `2026-10`) + minimal REST |
| **OAuth 2.0 Auth Flow** | Authorization Code (`oauth/authorize`) | Authorization Code (`accounts.salla.sa/oauth2/auth`) | Authorization Code (`admin/oauth/authorize` + standalone install) |
| **Token Model & Refresh** | Refresh token (AES-256 encrypted) | Single-use refresh token (AES-256 encrypted + in-memory mutex) | Expiring offline access token (`grant_type: refresh_token`, encrypted) |
| **Access Token at Rest** | Encrypted (`v2:` AES-256-GCM) | Encrypted (`v2:` AES-256-GCM) | **Plaintext** in `shopify_tokens` (Refresh token is encrypted) |
| **Ingress Webhook Auth** | Basic Auth (HKDF-derived) | Dual-path: Native HMAC or derived header `x-erplink-webhook-secret` | Native HMAC-SHA256 (`x-shopify-hmac-sha256`) |
| **Webhook Registration** | REST (`/managers/webhooks`) | REST (`/webhooks/subscribe`, 29 default topics) | GraphQL (`webhookSubscriptionCreate`, 15 core topics) + TOML |
| **Store → Odoo Orders** | Full sync (Create, Update, Cancel, Deliver) | Full sync (Create, Update, Cancel, Deliver) | Full sync (Create, Update, Cancel, Deliver) |
| **Thin Webhook Enrichment**| Automatic pull (`ZidAPI.orders.get`) | Automatic pull (`getSallaOrder` + `getSallaOrderItems`) | GraphQL Metafield enrichment (`prepareShopifyWebhookData`) |
| **Order Line Discounts** | Extended line total normalisation | Direct line net price & line discount amounts | Line item unit price and total discount |
| **VAT / Tax Calculation** | Saudi VAT calculation & country rules | `amounts.price_without_tax` + tax inference | Included/excluded tax from line items |
| **Analytic Distribution** | Full Odoo 17+ distribution support | Full Odoo 17+ distribution support | **Not implemented** (Zid & Salla only in `order-lines.ts`) |
| **Store → Odoo Customers** | Full sync (create/update) | Full sync (create/update) | Full sync (`resolveShopifyCustomerFullName`) |
| **Store → Odoo Products** | Full sync (simple + variants) | Full sync (options/skus/variants) | Full sync (options/variants) |
| **Store → Odoo Categories**| Full sync (`zid_category`) | Full sync (`salla_category` with parent resolution) | Full sync (`collections/*` -> `product.category`) |
| **Odoo → Store Stock Sync** | Real-time `stock.quant` push via `stock-sync-engine.ts` | Real-time `stock.quant` push via bulk API (`updateSallaStockBulk`) | **NOT IMPLEMENTED** (0 references in `stock-sync-engine.ts`) |
| **Store Location/Branch Sync**| Supported (`x_zid_location_id`) | Supported (Real branches or synthetic default branch) | **Not implemented** for stock push |
| **Reverse Logistics / Returns**| Intercepts `reversed`/`partially_reversed` -> Odoo credit note & picking | Intercepts `order.refunded` / `refunded_items` -> Odoo credit note & picking | **NOT IMPLEMENTED** (`refunds/create` resolves to `null`, skipped) |
| **ERP → Store Fulfillment** | Full delivery picking validation | Full delivery picking validation (Partial flagged for review) | Odoo picking validated. **No push back to Shopify** |
| **Initial Catalog Transfer** | Inbound/Outbound products/categories | Inbound/Outbound products/categories | Inbound/Outbound products/collections/customers (GraphQL) |

---

## 2. Salla Integration Audit

### 2.1 OAuth 2.0 Flow, Token Refresh Locks & Database Persistence

#### Connect Endpoint (`src/app/api/salla/connect/route.ts`)
- **Authentication Guard**: Checks Clerk session (`auth()`). Redirects unauthenticated users to `/sign-in` with `redirect_url` preservation.
- **Environment Verification**: Verifies `SALLA_CLIENT_ID` and `SALLA_REDIRECT_URI`. In production, enforces `https://` on redirect URI.
- **State Security**: Generates a 16-byte cryptographically secure random hexadecimal nonce (`crypto.randomBytes(16).toString('hex')`).
- **Cookie Security**: Stores `salla_oauth_state` as an `httpOnly`, `sameSite: 'lax'`, `secure` (in production) cookie with a 10-minute TTL.
- **OAuth Scopes**: Directly imports `SALLA_OAUTH_SCOPES` from `src/lib/salla-client.ts`:
  ```ts
  export const SALLA_OAUTH_SCOPES =
    'offline_access products.read_write orders.read_write customers.read_write categories.read_write settings.read payments.read webhooks.read_write shippings.read_write'
  ```
- **Authorization URL**: Constructs `https://accounts.salla.sa/oauth2/auth` with `response_type=code`.

#### Callback Endpoint (`src/app/api/salla/callback/route.ts`)
- **Rate Limiting**: Rate limited to 30 requests per minute per IP via `checkRateLimit`.
- **CSRF State Verification**: Strictly compares the query `state` parameter against the stored `salla_oauth_state` cookie before any downstream action.
- **Session & Workspace Resolution**: Before spending the single-use authorization code, resolves the Clerk `userId` and active workspace via `accessibleWorkspaceId(userId, userDb?.active_workspace_id)` or `ensureDefaultWorkspace(userId)`. This prevents "code burning" where an unauthenticated or workspace-less request consumes a one-time token exchange.
- **Token Exchange**: POSTs `client_id`, `client_secret`, `grant_type: 'authorization_code'`, `code`, and `redirect_uri` to `https://accounts.salla.sa/oauth2/token`.
- **Merchant Identity Extraction**: Calls `https://accounts.salla.sa/oauth2/user/info` with the access token. Uses `extractSallaMerchantIdFromProfile()` which safely handles Salla's historical payload variations (accepting `merchant.id`, `merchant_id`, or `store_id` across numeric, string, and object shapes).
- **Secrets at Rest**: Tokens are encrypted using AES-256-GCM (`encrypt()` in `src/lib/crypto.ts`) producing `v2:`-prefixed ciphertexts stored in `salla_tokens`.
- **Expires In Serialization**: Persists `expires_in` as standard numeric `Number(expires_in)` to avoid runtime crashes caused by BigInt JSON serialization in the Supabase client.
- **Default Sync Toggles**: New connections are inserted with `SALLA_CONNECT_SYNC_DEFAULTS` enabled for all order events, products, customers, and categories (Store → ERP). Reconnected stores preserve existing merchant toggles.
- **Multi-Store Support**: Workspaces can link multiple Salla merchants; queries are scoped by `merchant_id`.

#### Token Refresh & Mutual Exclusion (`src/lib/salla-client.ts`)
- **Single-Use Refresh Token Hazard**: Salla refresh tokens are single-use. If two concurrent requests attempt to refresh an expired token, the second request invalidates the grant and receives an `invalid_grant` error.
- **In-Memory Refresh Mutex**: `getSallaAccessToken(merchantId)` uses an in-memory lock map `sallaRefreshLocks = new Map<string, Promise<string>>()`. Concurrent requests for the same merchant await the in-flight refresh promise, preventing race conditions.
- **Legacy Token Migration**: Automatically detects unencrypted or legacy CBC tokens and migrates them to AES-256-GCM upon retrieval.
- **Buffer Expiry Window**: Refreshes tokens proactively 5 minutes before expiration (`timeBuffer = 5 * 60 * 1000`).

---

### 2.2 Ingress Webhook Architecture, Dual-Path Auth & Durability

The Salla webhook receiver is implemented in `src/app/api/webhooks/salla/route.ts` and wrapped with `withDurableWebhookResponse`.

#### Dual-Path Authentication (`src/lib/salla/webhook-auth.ts`)
1. **The Problem**: While Salla officially supports native HMAC signing via `X-Salla-Signature`, host environments frequently lacked `SALLA_WEBHOOK_SECRET`, which previously caused immediate HTTP 500 errors on incoming deliveries.
2. **The Solution (Dual-Path Auth)**:
   - **Path A (Native Signature)**: If `X-Salla-Signature` is present and `SALLA_WEBHOOK_SECRET` is configured, verifies the raw request body with HMAC-SHA256 in constant time (`secretMatches`).
   - **Path B (Derived Header)**: Salla's subscription API allows passing custom headers (`headers: [{ key, value }]`). During registration, ERP Link attaches an `x-erplink-webhook-secret` header derived from the host's `ENCRYPTION_KEY` using HKDF (`hkdfHex('salla-webhook-header:v1', [], 32)`). Ingress verifies this header first.
   - **Path C (Token Strategy)**: Honors Salla's `X-Salla-Security-Strategy: token` comparing the static token against `Authorization`.
   - **Legacy / Unauthenticated Classification**: Subscriptions created before the derived header are classified as `legacy`, counted in `webhook_legacy_counters`, and accepted with an operational log warning, but **destructive actions (`app.uninstalled`) are strictly forbidden**.

#### Webhook Ingress Flow & Pipeline
```
Salla Webhook Delivery
       │
       ▼
1. Rate Limiting Check ────────► Anonymous/unauthenticated bucket check
       │
2. Read Body within Limit ─────► Enforces max payload size (WebhookBodyTooLargeError -> 413)
       │
3. verifySallaWebhookAuth ─────► Validates Derived Header OR Native HMAC
       │                          - Invalid -> 401
       │                          - Unconfigured in Production -> 500
       │                          - Legacy -> Counted, accepted (uninstall blocked)
       ▼
4. JSON Parse & Early Returns ──► Invalid JSON -> Saved as orphan receipt -> 400
       │                          - app.installed -> 200 (informational)
       │                          - app.uninstalled -> Token & queue cleanup (requires auth)
       ▼
5. Order Line Validation ──────► validateOrderLines(items, 'salla')
       │                          - Invalid/corrupt lines -> Saved as orphan -> 400
       ▼
6. Stale Event Filter ─────────► Parse timestamp (epoch seconds, ms, or ISO)
       │                          - If > 15 mins old (STALE_EVENT_MAX_AGE_MS) -> Saved to
       │                            webhook_inbox with workspace_id: null -> 200 (stale)
       ▼
7. Workspace Lookup ───────────► Queries salla_tokens by merchant_id
       │                          - Unlinked store -> Stored as orphan receipt -> 202
       ▼
8. Standard Mapping Gate ──────► isWebhookEventEnabled(workspace_id, 'salla', event)
       │                          - Disabled -> Logs skip in sync_logs -> 200
       ▼
9. Durable Enqueue ────────────► enqueueWebhookEvent()
       │                          - Writes to webhook_inbox BEFORE sync_queue
       │                          - Deterministic dedup_key (delivery id or content fingerprint)
       │                          - Database failure -> 503 (forces Salla retry)
       ▼
10. Notifications & Metrics ───► Non-blocking Telegram arrival alert + webhook_metrics update
```

---

### 2.3 Event Routing Contract & Classification

`src/lib/event-operation.ts` maintains an explicit, dedicated classification table for Salla (`SALLA_EVENTS`) to prevent the generic substring heuristic from misrouting Salla's unique event slugs:

1. **Shipment Lifecycle Safety**:
   - `order.shipment.created` routes to operation **`deliver`** (triggers Odoo delivery picking validation).
   - `order.shipment.creating` routes to operation **`update`**.
   - `order.shipment.cancelled` and `order.shipment.return.cancelled` route to operation **`update`**, **NEVER `cancel`**. In Salla, shipments are child records. Cancelling the sales order upon shipment cancellation would destroy active customer orders.
2. **Order Deletion Safety**:
   - `order.deleted` routes to **`update`**, not `delete`. Odoo has no safe cascade deletion for `sale.order`.
3. **Product Inventory**:
   - `product.quantity.low` routes to **`update`**.
   - `product.deleted` routes to **`delete`**.
4. **Deliberately Excluded Events**:
   - `abandoned.cart` is NOT subscribed: the `carts` scope is not requested in the Partners Portal, so subscribing would burn API slots without delivery.
   - `category.deleted` does NOT exist in Salla's API: Salla categories are created/updated only. Subscribing to category deletion previously caused API errors.

---

### 2.4 Payload Enrichment, Order Unnesting & Line Items Architecture

#### Nested Order Payloads (`src/lib/salla/webhook-data.ts`)
In Salla, status change events (such as `order.status.updated`) send a payload shaped as:
```json
{
  "id": 987654321,
  "status": { "id": 12, "name": "Under Review" },
  "order": {
    "id": 111222333,
    "reference_id": 4130,
    "items": [ ... ]
  }
}
```
Here, top-level `id` is the *status update transaction ID*, NOT the order ID.
ERP Link's `prepareSallaWebhookData` explicitly detects `data.order` and re-keys the entity lookup on `data.order.id`. Without this, ERP Link would query non-existent orders, miss existing records, and create duplicate Odoo sales orders.

#### Thin Payload Enrichment (`src/lib/salla/orders.ts`)
- If an order payload arrives without `items` or with zero-priced items (`hasPricedSallaItems(items) === false`), ERP Link calls `getSallaOrder(storeId, orderId)`.
- If line items are still missing valid prices, it calls the paginated `getSallaOrderItems(storeId, orderId)` to guarantee that orders are never written to Odoo with empty or zero-priced lines.

#### Financial & Line Item Normalization (`src/lib/odoo/order-lines.ts` & `src/lib/salla/order-amounts.ts`)
- **Base Net Price**: Extracts `amounts.price_without_tax`. If prices include tax, converts net prices before tax based on configured VAT rates.
- **Line Discounts**: Reads `amounts.total_discount` directly from line items.
- **Order Discounts**: `readSallaOrderDiscount(order)` aggregates `amounts.discounts[].discount.amount`.
- **Cash on Delivery (COD)**: Reads `amounts.cash_on_delivery` and injects a dedicated COD line item into the Odoo sale order if configured.
- **Shipping Charges**: Reads `amounts.shipping_cost.amount` and injects a shipping line if configured.
- **Analytic Accounting**: Salla order lines fully evaluate warehouse and payment analytic distribution rules, writing `analytic_distribution` (Odoo 17+) or `analytic_account_id` (Odoo <17).

---

### 2.5 Products, Variants, Taxes & Category Hierarchies

#### Variants & SKUs (`src/lib/salla/products.ts`)
Salla supports two distinct variant data structures:
1. **`skus` array**: Variant rows carrying `related_option_values` matching `options[].values[].id`. `readSallaSkuAttributes()` resolves attribute names and values cleanly.
2. **`variants` array**: Direct variant objects.

#### Tax Inference (`src/lib/products/salla-tax.ts`)
When synchronizing Salla products to Odoo `product.template`:
- Checks `tax_rate` or `tax.rate`.
- If missing, calculates the effective percentage rate from `tax.amount` and `pre_tax_price.amount` (`Math.round(amount / net * 10_000) / 100`).
- Searches Odoo `account.tax` for an exact matching percentage and name in the active company.

#### Category Hierarchies (`src/lib/salla/categories.ts`)
- Salla categories include a `parent_id` representing the parent category in Salla.
- `KNOWN_PRESET_FIELDS['salla_category']` explicitly maps `parent_id: 'parent_id || parent.id || parent_category_id'`.
- If `parent_id` is missing in a webhook payload, `prepareSallaWebhookData` triggers an enrichment fetch (`getSallaCategory`) to ensure Odoo parent category relationships are correctly structured.

---

### 2.6 Odoo → Salla Inventory Sync (Bulk Quantity API)

ERP Link includes a **real, active Odoo → Salla stock synchronization engine** (`src/lib/stock-sync-engine.ts`):
1. **Trigger**: Odoo Automated Action fires on `stock.quant` changes (purchases, deliveries, manufacturing, adjustments).
2. **Ingress**: Notifies `/api/webhooks/odoo`, placing an Odoo stock event into `sync_queue`.
3. **Execution**: `processOdooStockEvent` reads Odoo's current stock balance.
4. **Branch Mapping**:
   - `listSallaBranches(merchantId)` queries Salla's `GET /branches`.
   - If the merchant's token lacks `branches.read` scope (which returns 401/403), the engine falls back to `FALLBACK_DEFAULT_BRANCH` (`id: 'default'`).
5. **Bulk API Dispatch**:
   - Dispatches stock updates via `updateSallaStockBulk()` targeting `POST /products/quantities/bulk`.
   - Sends exact OpenAPI payload: `{ identifer_type: 'sku', identifer: sku, quantity: qty, mode: 'overwrite', branch: branchId }`.
   - If targeting the default branch, the `branch` key is omitted so Salla applies the quantity to the store's primary location.

---

### 2.7 Returns & Reverse Logistics

Salla returns are fully implemented and verified in real code:
1. **Detection (`src/lib/returns/detect.ts`)**:
   - Detects returns via `isSallaReturnEvent(event)`: `order.refunded` or `order.shipment.return.created`.
   - Also checks for non-empty `refunded_items` on `order.updated` events.
2. **Line Extraction (`extractSallaRefundedLines`)**:
   - Extracts returned SKU, quantity, and unit price from Salla's `refunded_items` array.
3. **Odoo Execution (`src/lib/odoo/execute-operation.ts` & `src/lib/returns/engine.ts`)**:
   - Intercepts the order update before standard order processing.
   - Generates Odoo return pickings (`stock.return.picking`) and draft Credit Notes (`account.move`, `out_refund`) matching the returned quantities.

---

### 2.8 Administrative Management & Webhook Refresh

- **Bulk Webhook Registration**: `registerSallaWebhooks(merchantId)` registers all 29 default topics with concurrency capped at 3 (`SALLA_WEBHOOK_CONCURRENCY`) to prevent overwhelming Salla's rate limits.
- **Admin Ingress Credential Refresh (`src/app/api/admin/salla-webhooks/refresh/route.ts`)**:
  - Administrative route (`POST /api/admin/salla-webhooks/refresh`) guarded by Clerk `isAdmin()`.
  - Loops over all linked stores in `salla_tokens`.
  - Re-subscribes all webhooks with the active derived header (`x-erplink-webhook-secret`).
  - Implements **create-before-delete** semantics: Salla's `/webhooks/subscribe` upserts by URL, replacing subscriptions in place without any downtime or missing deliveries.

---

## 3. Shopify Integration Audit

### 3.1 OAuth 2.0 Flow, Query HMAC & Expiring Offline Access Tokens

#### Connect Endpoint (`src/app/api/shopify/connect/route.ts`)
- **Store-Initiated Install Model**: Supports direct install from Shopify Admin. When `shop` query is omitted, redirects to `https://admin.shopify.com/oauth/install?client_id=...`.
- **App Launch Signature Verification**: If `shop` is present on app launch from Shopify Admin, verifies Shopify's HMAC query parameter using `verifyShopifyCallbackHmac(url, clientSecret)` before initiating the flow.
- **Shop Domain Sanitization**: `normalizeShopDomain(shop)` strictly validates domains against `/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i`.
- **Pre-Auth Session Resolution**: Resolves Clerk `userId` before generating OAuth redirect. Unauthenticated users are sent to `/sign-in` with redirect params.
- **State Security**: Generates 16-byte random hex state stored in an `httpOnly`, `sameSite: 'lax'`, `secure` cookie.

#### Callback Endpoint (`src/app/api/shopify/callback/route.ts`)
- **Rate Limiting**: Rate limited to 30 requests/min via `oauth-shopify-callback` key.
- **State & Domain Verification**: Validates state cookie and sanitizes shop domain.
- **HMAC Query Validation**: Verifies query string signature with `verifyShopifyCallbackHmac`.
- **Expiring Offline Token Exchange**:
  ```ts
  const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      expiring: 1 // Requests modern expiring offline tokens
    }),
  })
  ```
- **Shop Profile Fetch**: Calls GraphQL `{ shop { name email } }` to display friendly store name.
- **Token Persistence (`shopify_tokens`)**:
  - `access_token`: Stored as **plaintext string** in `shopify_tokens.access_token`.
  - `refresh_token`: Stored as **AES-256-GCM encrypted ciphertext** via `encrypt(data.refresh_token)`.
  - `expires_at`: ISO timestamp derived from `expires_in`.
  - `refresh_token_expires_at`: ISO timestamp derived from `refresh_token_expires_in`.
  - `sync_settings`: Populated with `SHOPIFY_CORE_TOPICS` enabled for `shopify2odoo: true`.
- **Automatic Token Refresh (`src/lib/shopify/offline-token.ts`)**:
  - `getShopifyAccessToken(shop)` checks if `expires_at` is within 60 seconds of expiry.
  - Automatically posts `grant_type: 'refresh_token'` with decrypted refresh token to `https://${shop}/admin/oauth/access_token`.
  - Deduplicates concurrent refresh requests using an in-memory `pending = new Map<string, Promise<string>>()`.

---

### 3.2 App Scopes, Protected Customer Data & API Version Unification

#### App Scopes (`shopify.app.toml` & `connect/route.ts`)
- **Configured Scopes**:
  `read_products,write_products,read_orders,read_inventory,read_locations,read_customers,write_customers`
- **Optional Scopes**:
  `write_orders,write_inventory`
- **Critical Architectural & Compliance Constraints**:
  1. **Protected Customer Data**: Accessing `customers/*` webhooks and customer fields requires `read_customers`. Under Shopify App Store policy, this is gated as Protected Customer Data and requires manual approval + use-case justification in the Shopify Partner Dashboard. Without approval, customer API requests and webhook subscriptions return HTTP 403.
  2. **60-Day Order History Limit**: `read_orders` only permits accessing orders created within the last 60 days. Accessing historical orders requires the `read_all_orders` scope, which also requires partner dashboard approval.
  3. **No Fulfillment Scopes**: Scopes do not include `write_fulfillments` or `write_assigned_fulfillment_orders`.

#### API Version Unification
- `SHOPIFY_API_VERSION` is unified across the entire codebase to **`2026-10`** (defined in `src/lib/shopify-client.ts`, `shopify.app.toml`, and `.env.example`).
- Tests in `tests/unit/shopify-platform-integration.test.ts` pin that no older hardcoded versions (such as `2024-01` or `2025-07`) are used.

---

### 3.3 Ingress Webhook Architecture, HMAC Verification & Deduplication

#### Ingress Endpoint (`src/app/api/webhooks/shopify/route.ts`)
- **Headers Read**: `x-shopify-hmac-sha256`, `x-shopify-shop-domain`, `x-shopify-topic`, `x-shopify-webhook-id`.
- **HMAC Verification**:
  ```ts
  verifyShopifySignature(rawBody, signature, webhookSecret)
  ```
  Computes HMAC-SHA256 digest in Base64 using `SHOPIFY_WEBHOOK_SECRET` or `SHOPIFY_CLIENT_SECRET` and validates in constant time using `crypto.timingSafeEqual`.
- **Atomic Deduplication**:
  - Constructs `dedup_key = "shopify:${shopDomain}:${topic}:${webhookId}"`.
  - Checks `sync_queue` for an active pending job with this dedup key. If found, returns 200 immediately (`duplicate: true`).
- **Orphan Receipt Safeguard**: If HMAC succeeds but JSON parsing fails, or if no linked workspace exists, stores the delivery into `webhook_inbox` with `workspace_id = null` and returns HTTP 202/400 instead of dropping the event.

---

### 3.4 Topic Catalog vs Mapping Center vs Webhook Subscriptions

The codebase manages Shopify topics across three layers:
1. **App-Scoped Lifecycle Webhooks (`shopify.app.toml`)**:
   - `app/uninstalled`: Automatically deletes the store record from `shopify_tokens` and clears pending queue jobs.
   - `app/scopes_update`: Automatically updates the `scopes` column in `shopify_tokens`.
   - Mandatory GDPR Topics: `customers/data_request`, `customers/redact`, `shop/redact`. Handled immediately with an audit log and HTTP 200 response within 5 seconds (no ERP sync).
2. **Shop-Scoped Subscriptions (`SHOPIFY_CORE_TOPICS` in `shopify-topics.ts`)**:
   - Registered dynamically via GraphQL `webhookSubscriptionCreate` during OAuth callback or via `syncShopifyWebhooks` action.
   - Topics: `products/create`, `products/update`, `products/delete`, `collections/create`, `collections/update`, `collections/delete`, `orders/create`, `orders/updated`, `orders/cancelled`, `orders/fulfilled`, `orders/paid`, `orders/partially_fulfilled`, `orders/edited`, `orders/delete`, `customers/create`, `customers/update`, `customers/delete`.
3. **The Unsynced Topics Skip**:
   - In `shopify-topics.ts`, the catalog lists topics such as `carts/*`, `checkouts/*`, `inventory_levels/*`, `inventory_items/*`, `refunds/create`.
   - **Critical Audit Finding**: `resolveEventOperation(topic, 'shopify')` returns **`null`** for all of these topics!
   - In `route.ts`, lines 301–333 check `!resolveEventOperation(topic, 'shopify')`. If no custom field mapping exists for the topic, the route logs a skip in `sync_logs` with reason `'no_entity_mapping'` and returns 200 without enqueuing.
   - **Verification**: Pinned by `tests/unit/shopify-webhook-gate.test.ts`:
     ```ts
     it.each([
       'carts/create', 'carts/update', 'checkouts/create', 'checkouts/update', 'checkouts/delete',
       'inventory_levels/update', 'inventory_items/create', 'inventory_items/update', 'inventory_items/delete',
       'refunds/create'
     ])('resolves %s to null', (topic) => { ... })
     ```

---

### 3.5 Out-of-Order Burst Handling & Product Update Deduplication

High-volume Shopify stores frequently emit bursts of update webhooks. `src/app/api/webhooks/shopify/route.ts` implements two optimizations:
1. **Stale Event Detection (`extractShopifyUpdatedAtMs`)**:
   - Reads `updated_at` or `created_at` from the incoming payload.
   - Queries pending queue rows for the same entity. If a pending queue job already has a *newer* timestamp than the incoming webhook, the incoming webhook is marked `stale_event`, saved as an orphan receipt, and skipped to prevent regressing newer ERP state.
2. **`products/update` In-Queue Coalescing**:
   - When a burst of `products/update` webhooks arrives for the same product ID, instead of inserting multiple queue rows, the route locates the existing pending queue item and updates its `payload` and `updated_at` in place (`merged: true`).

---

### 3.6 GraphQL Metafield Enrichment & Data Transformation

Shopify webhook payloads do not include custom metafields by default.
- In `src/lib/shopify/enrichment.ts` (`prepareShopifyWebhookData`), when an incoming webhook is processed by the queue worker:
  - Products, Customers, Orders, and Collections are queried via GraphQL for their `metafields(first: 100)`.
  - Metafields are normalized by `normalizeShopifyMetafields()` into nested objects:
    `payload.metafields[namespace][key] = value`.
  - This allows Standard Mapping and custom field mappings to map paths such as `metafields.custom.external_code` into Odoo fields.

---

### 3.7 Order Synchronization & Customer Name Normalization

#### Customer Matching & Address Splitting (`src/lib/odoo/order-values.ts` & `src/lib/shopify/customers.ts`)
- Shopify payloads separate customer names into `first_name` and `last_name`, while Odoo `res.partner` requires a single `name` field.
- `resolveShopifyCustomerFullName` combines `[first_name, last_name]`. If missing, it inspects `default_address.name`, then `addresses[0].name`.
- Guest checkouts (where `customer` is null) are safely handled: buyer email is extracted from top-level `payload.email` or `payload.contact_email`, and shipping street/city from `shipping_address.address1` and `shipping_address.city`.

#### Order Lines (`src/lib/odoo/order-lines.ts`)
- Line items are read from Shopify's `line_items` array.
- Line mappings default to SKU resolution: `line_items[].sku` matches Odoo `product.product.default_code`.
- Price and quantity: `line_items[].price` and `line_items[].quantity`.

#### Fulfillment Synchronization
- Webhooks `orders/fulfilled` and `orders/partially_fulfilled` map to operation **`deliver`**.
- In Odoo (`src/lib/odoo/execute-operation.ts`), operation `deliver` confirms the sale order if in quotation state and validates delivery picking (`processFullDelivery` or `processPartialDelivery`).
- **No Push to Shopify**: ERP Link does NOT push fulfillments back to Shopify.

---

### 3.8 Initial Data Transfer (Products, Customers, Collections)

In `src/app/actions/transfers.ts`, Shopify data transfer is implemented for:
1. **Products**: `listShopifyProducts` (GraphQL query reading 250 products per page via cursor) and `createShopifyProduct` (GraphQL mutation `productSet`).
2. **Customers**: `listShopifyCustomers` (GraphQL query) and `createShopifyCustomer` (GraphQL mutation `customerCreate`).
3. **Collections**: `listShopifyCollections` (GraphQL query `collections(first: 250)`) and `createShopifyCollection` (GraphQL mutation `collectionCreate`).
4. **Orders**: Not supported in initial transfer (consistent with Zid and Salla).

---

### 3.9 Architectural Gaps, Missing Features & Discrepancies vs Zid/Salla

The audit verified the following **functional gaps and differences** where Shopify does NOT have parity with Zid or Salla:

1. **NO Odoo → Shopify Inventory Sync**:
   - `src/lib/stock-sync-engine.ts` implements inventory sync from Odoo `stock.quant` for Zid (`runZidArm`) and Salla (`runSallaArm`).
   - **Shopify has 0 mentions** in `stock-sync-engine.ts`.
   - `src/app/actions/inventory-sync.ts` is strictly typed:
     ```ts
     type InventoryStoreType = 'zid' | 'salla'
     ```
   - Odoo inventory changes cannot be pushed to Shopify.
2. **NO Shopify Returns / Refunds Support**:
   - `src/lib/returns/detect.ts` supports Zid and Salla. Line 208 falls through to `return false` for Shopify.
   - `src/lib/event-operation.ts` maps `refunds/create` to `null`.
   - `src/app/api/webhooks/shopify/route.ts` skips `refunds/create` with `no_entity_mapping`.
   - Shopify refund events do not generate credit notes or return pickings in Odoo.
3. **NO ERP → Shopify Fulfillment / Tracking Push**:
   - When a delivery order is validated in Odoo, no webhook or API call pushes tracking numbers or fulfillment status to Shopify.
4. **NO Analytic Distribution for Shopify**:
   - `src/lib/odoo/order-lines.ts` (line 1118) limits analytic distribution injection to:
     ```ts
     if (platform === 'zid' || platform === 'salla') { ... }
     ```
   - Shopify orders do not receive analytic account or distribution tags on line items.
5. **Access Token Encryption Difference**:
   - `salla_tokens.access_token` and `merchant_tokens.access_token` are encrypted with AES-256-GCM.
   - `shopify_tokens.access_token` is stored as **plaintext** (only `refresh_token` is encrypted). Access is restricted by Supabase RLS policies and service role keys.

---

## 4. Unit Test Verification & Source Pins

All 9 dedicated Salla and Shopify unit test suites were executed and verified passing:

```
Test Suites: 9 passed, 9 total
Tests:       131 passed, 131 total
Time:        7.645 s
```

### Verified Test Suites Summary:
1. `tests/unit/salla-webhook-auth.test.ts` (34 tests):
   - Verifies HKDF-SHA256 derived header `x-erplink-webhook-secret`.
   - Verifies native HMAC-SHA256 signature verification.
   - Verifies static token strategy header comparison.
   - Verifies legacy classification and refusal of unauthenticated `app.uninstalled`.
   - Verifies timestamp parsing (epoch seconds, ms, and ISO).
2. `tests/unit/salla-order-create-audit.test.ts` (14 tests):
   - Verifies Salla order creation in Odoo, line items, VAT, COD, discounts, and custom status fields.
3. `tests/unit/salla-product-create-audit.test.ts` (12 tests):
   - Verifies product template and variant creation, tax rate inference, and match fields.
4. `tests/unit/salla-category-parent.test.ts` (8 tests):
   - Verifies category hierarchy and `parent_id` mapping.
5. `tests/unit/shopify-webhook-gate.test.ts` (28 tests):
   - Verifies `collections/*` routing to `categories` (create/update/delete).
   - Verifies `orders/delete` routing to `cancel`.
   - Verifies that unsynced topics (`carts/*`, `checkouts/*`, `inventory_levels/*`, `inventory_items/*`, `refunds/create`) resolve to `null`.
   - Verifies that `listShopifyCollections` uses GraphQL instead of legacy REST.
6. `tests/unit/shopify-platform-integration.test.ts` (6 tests):
   - Verifies metafield normalization (`normalizeShopifyMetafields`).
   - Verifies source field catalogue for all core topics.
   - Verifies Shopify module independence (no imports from `@/lib/zid`).
   - Verifies API version `2026-10`.
7. `tests/unit/shopify-offline-token.test.ts` (11 tests):
   - Verifies expiring offline token fields, refresh payload construction, and token rotation.
8. `tests/unit/shopify-customer-name.test.ts` (10 tests):
   - Verifies `resolveShopifyCustomerFullName` concatenation and fallbacks.
9. `tests/unit/shopify-connect-origin.test.ts` (8 tests):
   - Verifies query HMAC validation, domain normalization, and state cookie attributes.

---

## 5. Architectural Recommendations & Roadmap

1. **Implement Odoo → Shopify Inventory Sync**:
   - Extend `src/lib/stock-sync-engine.ts` with a `runShopifyArm` function using Shopify's GraphQL `inventorySetOnHandQuantities` or `inventoryAdjustQuantities` mutation.
   - Update `src/app/actions/inventory-sync.ts` type definition to `'zid' | 'salla' | 'shopify'`.
2. **Implement Shopify Returns / Refunds Engine**:
   - Add Shopify support to `isReturnSignal()` in `src/lib/returns/detect.ts`.
   - Route `refunds/create` in `src/lib/event-operation.ts` to `{ entityType: 'orders', operation: 'update' }`.
   - Extract refunded line items from Shopify's `refund_line_items` array to trigger Odoo credit notes and return pickings.
3. **Encrypt Shopify Access Tokens**:
   - Align `shopify_tokens.access_token` with Zid and Salla by encrypting it with AES-256-GCM (`encrypt()`) upon storage and decrypting in `getShopifyAccessToken()`.
4. **Add Shopify Line-Level Analytic Distribution**:
   - Enable `platform === 'shopify'` in `src/lib/odoo/order-lines.ts` (line 1118) so Shopify orders can leverage Odoo analytic distribution rules.
5. **Add Reverse Fulfillment Push**:
   - Provide an optional Odoo Automated Action on `stock.picking` validation to push tracking numbers and fulfillment confirmations back to Salla (`POST /orders/{id}/shipping`) and Shopify (`fulfillmentCreateV2` mutation).
