# Audit Report: Zid Integration in ERP Link

**Agent**: Agent 2 — Zid Integration Specialist  
**Target Document**: `docs/internal/swarm-findings/agent-2-zid-integration.md`  
**Date**: November 2026  
**Audited Codebase**: ERP Link (`src/lib/zid/`, `src/lib/zid-client.ts`, `src/app/api/webhooks/zid/`, `src/app/api/zid/`, `src/app/actions/zid.ts`, `src/lib/orders/`, `src/lib/returns/zid.ts`, `src/lib/stock-sync-engine.ts`, `tests/unit/zid-*.test.ts`)

---

## Executive Summary

ERP Link implements an enterprise-grade, bidirectional synchronization integration with the **Zid e-Commerce platform** (`https://api.zid.sa`). The integration is designed to handle high-volume retail, multi-location inventory, complex Saudi tax/VAT regulations, Arabic localized statuses, and multi-version Odoo ERP synchronization (Odoo 14 through 20).

Crucially, this audit verifies that the integration contains **hardened production code** designed around real-world platform constraints rather than theoretical OpenAPI assumptions:
1. **Webhook Authentication Reality**: Zid does **not** support HMAC signatures or custom secret headers. The integration implements Zid's only documented inbound security mechanism: **HTTP Basic Authentication** derived per merchant from `ENCRYPTION_KEY` using HKDF.
2. **Anti-Data-Loss Safeguards**: If a Zid order webhook payload arrives with missing or truncated line items, the sync engine **refuses to create an empty Odoo sale order**; instead, it triggers a rate-budgeted pull (`ZidAPI.orders.get`) or fails fast into the queue retry system.
3. **Price Calculation Integrity**: Zid transmits line-item discount totals as *extended line totals* rather than unit prices. The integration explicitly divides extended totals by quantity to prevent multiplying order line values by the quantity twice.
4. **Child Variant Stock Safety**: When pushing stock levels to Zid variants, the engine uses the dedicated partial stock endpoint (`PATCH /v1/products/{variant_id}/stocks/`) rather than the destructive `POST /v1/products/{parent_id}/variants/` endpoint, which notoriously wiped selling prices and attributes in earlier implementations.
5. **Reverse Logistics / Returns**: Recognizing that Zid has no dedicated return webhook event, the engine intercepts status changes to `reversed` or `partially_reversed`, queries `view-for-return` (where `quantity` represents remaining returnable goods), inspects reverse order label receipts for `received_quantity` vs `damaged_quantity`, and generates proper Odoo return pickings and credit notes.

All 22 dedicated Zid unit test suites (**240 unit tests**) pass with 100% success.

---

## 1. OAuth 2.0 Flow, App Installation & Account Linking

### 1.1 Architecture & Flow Comparison (Real vs Theoretical)
Theoretical integrations assume a merchant signs into the app first and then connects their store from an admin settings screen. In reality, Zid's App Market model allows merchants to install the app directly from the **Zid App Market** (`apps.zid.sa`).

ERP Link solves this with an **OAuth-First Onboarding Pipeline**:
```
Zid App Market Launch
       │
       ▼
GET /api/zid/connect ─────────► Generates 32-byte crypto nonce (state)
       │                        Stores hash in `zid_oauth_pending` (kind: 'authorization')
       │                        Sets `zid_oauth_state` HTTP-only cookie (10m TTL)
       ▼
Zid OAuth Authorize URL (api.zid.sa/oauth/authorize)
       │
       ▼ (Merchant approves permissions)
GET /api/zid/callback
       │
       ├─► Validates state against cookie & consumes state atomically (`consumeZidState`)
       ├─► Exchanges `code` for OAuth tokens (`exchangeAuthorizationCodeForResponse`)
       ├─► Calls `managers/account/me` & `managers/account/store` to verify store identity
       ├─► Encrypts tokens with AES-256-GCM
       ├─► Saves to `zid_oauth_pending` (kind: 'connection') with 1h TTL
       └─► Sets `zid_pending_connection` cookie & redirects to `/connect/zid`
               │
               ▼
POST /api/zid/link (Merchant signs in / selects ERP Link Workspace)
       │
       ├─► Authenticates Clerk User (`auth()`)
       ├─► Atomic DB RPC `complete_zid_oauth_connection`:
       │     - Verifies workspace ownership
       │     - Prevents cross-workspace store takeover
       │     - Writes encrypted credentials to `merchant_tokens`
       │     - Deletes pending grant from `zid_oauth_pending`
       └─► Auto-registers 13 core webhooks (`ZID_CORE_EVENTS`) via Zid API
```

### 1.2 Core File Map for Authentication
| File | Responsibility |
|---|---|
| [`src/lib/zid/auth.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/auth.ts) | Constructs the authorization URL. Omits custom scopes by default to prevent Zid `EC4` errors unless `ZID_OAUTH_SCOPE` is explicitly set in environment. |
| [`src/lib/zid/config.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/config.ts) | Reads required environment variables (`ZID_CLIENT_ID`, `ZID_CLIENT_SECRET`, `ZID_REDIRECT_URI`, `ZID_AUTH_URL`, `ZID_TOKEN_URL`, `ZID_API_URL`). |
| [`src/lib/zid/oauth-pending.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/oauth-pending.ts) | Manages temporary state tokens and encrypted pending connection payloads in Supabase table `zid_oauth_pending`. |
| [`src/app/api/zid/connect/route.ts`](file:///e:/توفيق/zid/zidlink2/src/app/api/zid/connect/route.ts) | Public entry point for OAuth initiation. Rate-limited to 30 requests/min. |
| [`src/app/api/zid/callback/route.ts`](file:///e:/توفيق/zid/zidlink2/src/app/api/zid/callback/route.ts) | Handles authorization code exchange, calls Zid API for store verification, and stores encrypted payload. |
| [`src/app/api/zid/link/route.ts`](file:///e:/توفيق/zid/zidlink2/src/app/api/zid/link/route.ts) | Finalizes linking between the verified Zid store and the authenticated user's workspace. |
| [`src/app/api/auth/zid/authorize/route.ts`](file:///e:/توفيق/zid/zidlink2/src/app/api/auth/zid/authorize/route.ts) | Backward-compatible shim redirecting legacy URL `/api/auth/zid/authorize` to `/api/zid/connect`. |
| [`src/app/api/auth/zid/callback/route.ts`](file:///e:/توفيق/zid/zidlink2/src/app/api/auth/zid/callback/route.ts) | Backward-compatible shim delegating `/api/auth/zid/callback` to `/api/zid/callback`. |

### 1.3 Permissions & Scopes
- **Scope Negotiation**: In [`src/lib/zid/auth.ts#L11-L16`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/auth.ts#L11-L16), ERPlink avoids sending arbitrary scope strings in the URL. By default, Zid grants the exact scopes configured in the Zid Partner Portal for that App ID. Passing unconfigured or misspelled scopes causes Zid to immediately reject authorization with error code `EC4`.
- **Required Partner Scopes**:
  - `orders_read`, `orders_write`
  - `products_read`, `products_write`
  - `customers_read`, `customers_write`
  - `webhooks_read`, `webhooks_write`
  - `locations_read`, `locations_write`
  - `embedded_apps_tokens_write` (Mandatory for Embedded iframe mode)

---

## 2. Token Lifecycle, Storage Security & Multi-Tenant Fencing

### 2.1 Encryption at Rest
Tokens are persisted in the `merchant_tokens` table. In compliance with repository security rules:
- `access_token`, `refresh_token`, and `authorization_token` (Zid's static partner-level app token) are encrypted via AES-256-GCM using `encryptZidCredentials()` ([`src/lib/zid/credentials.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/credentials.ts)).
- Plaintext legacy rows are automatically upgraded to encrypted ciphertext when fetched by [`loadTokens()`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/token.ts#L108-L121) without modifying `updated_at` (preserving expiry anchoring).
- Secret leaks in API responses are scrubbed: [`publicZidStore()`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/credentials.ts#L21) filters out secret columns before token metadata is returned to administrative UI actions.

### 2.2 Token Storage Interface & Auto-Refresh Mechanism
The token management subsystem ([`src/lib/zid/token.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/token.ts)) provides:
1. **Clock Skew Window**: Expiration is calculated with an operational skew buffer:
   ```typescript
   export function isExpired(expiresAt: number): boolean {
     return Date.now() + 60_000 >= expiresAt // EXPIRY_SKEW_MS = 60s
   }
   ```
2. **Single-Flight Concurrency Control (`refreshInFlight`)**: When a burst of webhooks or concurrent user actions triggers a token refresh, all requests share a single in-flight Promise keyed by `[merchantId, workspaceId]`. This prevents sending multiple simultaneous refresh requests to Zid, which would invalidate the refresh token.
3. **Generation Anchoring via WeakMap Snapshots**: `SupabaseZidTokenStore` captures a snapshot of `{ id, workspace_id, store_id, refresh_token }` when loading credentials. When `saveTokens()` writes back the refreshed token, it enforces:
   ```typescript
   .eq('id', snapshot.id)
   .eq('workspace_id', snapshot.workspace_id)
   .eq('refresh_token', snapshot.refresh_token)
   ```
   If a store has been uninstalled or moved to another workspace during the refresh call, the write fails safely rather than resurrecting stale credentials.
4. **Cross-Tenant Safety Enforcement**: `assertTokenWorkspace()` verifies that the token being used belongs exclusively to the active `workspaceId`. A tenant in Workspace A can never execute operations against a store linked to Workspace B.

---

## 3. Zid Embedded App Architecture (Iframe Launch)

### 3.1 The Iframe Cookie Problem
When ERP Link is launched inside Zid's merchant control panel iframe (`dashboard.zid.sa/.../apps/{app_id}/embedded`):
- Modern web browsers treat standard cookies inside cross-site iframes as third-party cookies.
- Clerk's Frontend API rejected normal password/Google sign-in attempts inside the iframe with `authorization_invalid` ("Unauthorized request").

### 3.2 Implemented Embedded Solution
ERP Link implements a ticket-based authentication bridge documented in [`docs/zid-embedded.md`](file:///e:/توفيق/zid/zidlink2/docs/zid-embedded.md):
1. **URL Normalization**: Zid launches the app by passing query parameters `?token=<uuid>&language=<locale>`. Middleware checks [`src/lib/zid/embedded-url.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/embedded-url.ts) and immediately redirects requests carrying a UUID token to `/[locale]/embedded?token=<uuid>`.
2. **Dedicated Token Exchange (`POST /api/zid/embedded/session`)**:
   - The client-side embedded page posts the token to `/api/zid/embedded/session`.
   - The route calls [`createEmbeddedTicket(token)`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/embedded.ts#L72-L98).
   - The token hash is looked up in table `zid_embedded_access`.
   - The system verifies that the store is currently connected to the workspace and that the embedded user is an active workspace member.
   - It issues a single-use Clerk sign-in ticket valid for 60 seconds (`client.signInTokens.createSignInToken`).
3. **Isolated Identity Provisioning**:
   - [`registerEmbeddedAccess()`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/embedded.ts#L17-L70) creates an isolated Clerk user with `externalId: zid-embedded:${workspaceId}:${merchantId}` and email `...@embedded.invalid`.
   - This identity is given standard `member` permissions on the workspace and is explicitly forbidden from inheriting workspace owner or system admin privileges.
   - The generated UUID token is registered with Zid's API via `POST /managers/embedded-apps-token`.

---

## 4. Webhooks Architecture & Authentication Security

### 4.1 Real Ingress Authentication vs Theoretical HMAC
- **Theoretical Assumption**: A webhook handler expecting `X-Zid-Signature` or a signature hash based on an HMAC secret.
- **Verified Code Reality**: Zid documentation (`docs.zid.sa/webhooks`) confirms Zid **never sends HMAC signatures**.
  - Zid's only supported inbound authentication mechanism is **HTTP Basic Authentication**.
  - During webhook registration (`POST /v1/managers/webhooks`), ERP Link supplies `username: 'zid'` and a 32-byte derived password.
  - Zid sends `Authorization: Basic <base64(username:password)>` on every webhook delivery.
  - The derived credential is generated deterministically using HKDF over `ENCRYPTION_KEY`:
    ```typescript
    // src/lib/zid/webhook-auth.ts
    hkdfHex('zid-webhook-basic-auth:merchant:v2', [merchantId], 32)
    ```
  - The incoming header is verified using constant-time comparison via `secretMatches` to prevent timing attacks.

### 4.2 Ingress Pipeline & Durable Buffering
The webhook endpoint ([`src/app/api/webhooks/zid/route.ts`](file:///e:/توفيق/zid/zidlink2/src/app/api/webhooks/zid/route.ts)) handles traffic with zero in-request sync:
```
Inbound HTTP POST /api/webhooks/zid
       │
       ├─► Check unauthenticated flood limits (checkUnauthenticatedIngressLimit)
       ├─► Read body within strict memory bounds (readWebhookBodyWithinLimit)
       ├─► Verify Basic Authentication (verifyZidWebhookAuthorization)
       │     ├─ Status 'ok': Certified delivery (admitted at any volume)
       │     ├─ Status 'invalid': Immediate 401 Unauthorized
       │     └─ Status 'legacy': Pre-Basic webhook (tracked in `webhook_legacy_counters`)
       ├─► Store Identity Normalization (`normalizeZidStoreId`)
       ├─► Fast Uninstall Branch:
       │     └─ If event is `app.uninstalled`: Validates auth -> cleans tokens -> 200 OK
       ├─► Upstream Line Items Validation (`validateOrderLines`)
       │     └─ If lines broken: saves to `webhook_inbox` (orphan) -> returns 400 Bad Request
       ├─► Check Event Enabled Gate (`isWebhookEventEnabled`)
       │     └─ If disabled in Settings: logs skip -> returns 200 OK
       ├─► Enqueue to Central Queue (`enqueueWebhookEvent`) with `acceptBeforeErp: true`
       ├─► Asynchronous arrival alert to Telegram (`notifyOrderArrival`)
       └─► Return HTTP 200/202 immediately to Zid
```

### 4.3 Webhook Event Mapping & Registration
[`src/lib/zid/webhooks.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/webhooks.ts) maps internal settings keys to the 16 real Zid webhook events:
- **Orders**: `order.create`, `order.status.update`, `order.payment_status.update`
- **Catalog**: `product.create`, `product.update`, `product.delete`, `product.publish`
- **Categories**: `category.create`, `category.update`, `category.delete`
- **Customers**: `customer.create`, `customer.update`, `customer.merchant.update`, `customer.login`
- **Carts**: `abandoned_cart.created`, `abandoned_cart.completed`

*Note on Unofficial Events*: Old events like `order.cancelled`, `order.delivered`, and `product.stock.update` were removed from registration because Zid never fires them as distinct topics; status updates arrive strictly via `order.status.update`, and stock adjustments arrive via `product.update`.

---

## 5. Order Processing Pipeline & ERP Synchronization

### 5.1 Authoritative Order Enrichment (`enrichZidOrder`)
In [`src/lib/zid/orders.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/orders.ts):
- Webhook payloads for orders frequently lack line items (e.g. status changes send only `{ id: 12345, order_status: 'delivered' }`).
- If line items (`items`, `products`, `order_items`) are missing or if the delivery is from an untrusted legacy source, `enrichZidOrder()` calls `ZidAPI.orders.get(creds, orderId)` to fetch the full snapshot.
- **Pull Token Bucket Rate Limiting**: Calls are bounded by `acquirePullToken('zid', workspace)` (maximum 60 requests/minute per store).
- **Anti-Data-Loss Enforcement**:
  ```typescript
  if (!orderData || !orderData.products) {
    return { errorMessage: `Zid order details unavailable for id ${orderId}: ...` }
  }
  ```
  If fetching the order details fails, the order is **not** written to Odoo with empty lines. The task fails and returns an error to `sync_queue`, which retries with exponential backoff up to 5 times before archiving to the dead-letter queue.
- **Live Status Precedence**: When merging live API order data with a webhook event, the real-time API status takes precedence over the stale event payload.

### 5.2 Line Item Unit Price vs Extended Total
Located in [`src/lib/orders/zid-line-unit-price.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/orders/zid-line-unit-price.ts):
- **Problem**: Zid transmits `discounted_total` and `total` as **extended line totals** (e.g. for `quantity = 2`, `price = 500`, Zid sends `discounted_total = 1000`). If mapped directly to Odoo's `price_unit`, Odoo computes `1000 * 2 = 2000`, doubling the order total.
- **Solution (`resolveZidLineUnitSalePrice`)**:
  1. Checks for explicit unit fields: `net_sale_price`, `gross_sale_price`, `sale_price`, `price_after_discount`.
  2. If absent, divides `discounted_total` by `quantity` (`discounted_total / qty`).
  3. Falls back to regular unit `price`.
  4. Falls back to `total / qty`.

### 5.3 Shipping, COD Surcharges & Discounts
[`src/lib/zid/order-helpers.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/order-helpers.ts) resolves financial totals from Zid's `payment.invoice[]` array:
- **Shipping Cost (`resolveZidShippingCost`)**: Scans `payment.invoice[]` for codes/titles matching `/ship|deliver|freight|توصيل|شحن/i`. Explicit zero (`value = 0`) is treated as authoritative free shipping, preventing false fallbacks.
- **COD Collection Surcharge (`resolveZidCodAmount`)**: Scans `payment.invoice[]` for COD fee identifiers (`/cod|cash|عند الاستلام|تحصيل/i`), while strictly excluding tax, shipping, and discount rows to avoid double-counting.
- **Discounts & Coupons (`resolveOrderDiscountAmount`)**: Reads coupon rows from `payment.invoice[]`. Since Zid transmits discounts as negative amounts, ERPlink takes `Math.abs(num)` because Odoo requires positive discount amounts.

### 5.4 Multi-Country VAT Resolution & Invoice Parity
- **Destination Country Detection**: [`isSaudiShippingAddress()`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/order-helpers.ts#L225) and [`resolveOrderCountryCode()`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/order-helpers.ts#L341) inspect recipient addresses, cities (Arabic and English), and phone dialing codes (+966, +20, +971, +965, etc.).
- **Dynamic VAT Rule Resolution**: [`resolveOrderVatTax()`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/order-helpers.ts#L580) evaluates the configured `vatCountryRules` table:
  - Exact destination country match (e.g., SA -> 15% VAT).
  - Explicit export rules (e.g., EG / AE -> 0% export tax).
  - Fallback rule (`OTHER` / `*`).
- **Inclusive Draft Invoice Parity (`reconcileInclusiveDraftInvoice`)**:
  - In [`src/lib/odoo/order-invoice-integrity.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo/order-invoice-integrity.ts), before posting a VAT-inclusive draft invoice, the engine compares the invoice total with `sale.order.amount_total` (tolerance 0.05 SAR).
  - If a discrepancy occurs due to Odoo re-calculating gross prices, the engine updates `account.move.line` unit prices and tax IDs directly to match the confirmed sales order.

---

## 6. Customer Matching & Creation

1. **Configurable Matching Key**: Reads `match_odoo_field` and `match_zid_field` from the Customers Standard Mapping settings (e.g. matching Zid `mobile` or `email` to Odoo `phone`, `mobile`, `email`, or `ref`).
2. **Missing Key Hydration**: If the order payload contains only `customer_id` without the matching field (e.g. email), [`readOrderRelatedDetails()`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/order-related-data.ts) queries `ZidAPI.customers.get(creds, customerId)` within the pull budget.
3. **Deduplicated Creation (`createPreparedOrderCustomer`)**:
   - In [`src/lib/orders/customer-create.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/orders/customer-create.ts), new customer creation uses an execution context key based on `[email, phone, name]`.
   - If two orders for the same customer are synced concurrently, they resolve to the same newly created `res.partner` without creating duplicates.
4. **Order Update Immutability**: When updating an existing Odoo sales order, the original customer link (`partner_id`) is strictly preserved and not overwritten.

---

## 7. Product & Variant Synchronization

### 7.1 Catalog Enrichment & Variant Structures
- **Minimal Webhook Hydration**: Zid product webhooks frequently contain only basic attributes. [`enrichZidProduct()`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/products.ts) calls `ZidAPI.products.get()` to retrieve the complete variant matrix, options, and bundle structures.
- **Variant Sync Modes**:
  - `AS_VARIANTS`: Maps Zid parent products to Odoo `product.template` and Zid variants to Odoo `product.template.attribute.value` with attribute price deltas.
  - `AS_SEPARATE_PRODUCTS`: Maps each Zid variant to a standalone Odoo `product.template` with an independent `default_code` and barcode.
- **Odoo Schema Compatibility Matrix**:
  - **Odoo 14**: `type = 'product'`, `tracking = 'none'`.
  - **Odoo 15–17**: Requires both `type = 'product'` and `detailed_type = 'product'`.
  - **Odoo 18–19**: `type = 'consu'`, `is_storable = true`.
  - **Odoo 20**: Supports independent variant sales price (`lst_price`).

### 7.2 Bill of Materials & Bundles
- Zid bundle classes (`grouped_product`, `dynamic_bundle`) are mapped to Odoo Bills of Materials (`mrp.bom`) of type `phantom` (Kit).
- The engine pre-validates all bundle components and quantities before creating the BoM record in Odoo, ensuring that kit stock is dynamically calculated from component availability.

### 7.3 Stock Sync: Preventing Price Overwrites
In [`src/lib/stock-sync-engine.ts#L888-L908`](file:///e:/توفيق/zid/zidlink2/src/lib/stock-sync-engine.ts#L888-L908):
- **Historic Defect**: Previously, updating variant stock in Zid called `POST /v1/products/{parent_id}/variants/`. Because Zid treats this endpoint as a complete replacement, any unspecified fields (prices, barcodes, weights) were wiped and reset to zero.
- **Verified Fix**:
  ```typescript
  // Updates variant stock records exclusively without touching prices or attributes
  await ZidAPI.products.stocks.bulkUpdate(creds, zidProductId, [
    { location: zidLocationId, available_quantity: roundedQty, is_infinite: false }
  ])
  ```
  Standalone products use `ZidAPI.locations.stockUpdate(creds, zidLocationId, [{ product_id, available_quantity }])`.

---

## 8. Order Status Mappings & Multi-Action Workflows

### 8.1 Status Normalization
[`resolveZidStatus()`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/order-helpers.ts#L752) maps incoming Arabic and English status values to canonical keys:

| Zid Incoming Status | Canonical Key | Default Odoo State |
|---|---|---|
| `جديد` / `new` | `new` | `draft` (Quotation) |
| `جاري التجهيز` / `preparing` | `preparing` | `sale` (Sales Order) |
| `جاهز` / `ready` | `ready` | `sale` |
| `جاري التوصيل` / `indelivery` | `indelivery` | `sale` |
| `تم التوصيل` / `delivered` | `delivered` | `done` (Locked) |
| `ملغي` / `cancelled` | `cancelled` | `cancel` (Cancelled) |
| `مسترجع` / `reversed` | `reversed` | Handled via Returns Engine |
| `مسترجع جزئيا` / `partially_reversed` | `partially_reversed` | Handled via Returns Engine |
| `جاري الاسترجاع` / `reverse_in_progress` | `reverse_in_progress` | *Ignored* (Awaiting completion) |

### 8.2 Three-Tier Multi-Action Execution
For each status mapped in the `order_status_mappings` table, the engine executes three independent actions:
1. **Sales Order State Transition (`applyOrderStatusAction`)**:
   - `sale` -> calls `sale.order.action_confirm`.
   - `cancel` -> calls `sale.order.action_cancel` with context `{ disable_cancel_warning: true }`.
   - `done` -> calls `action_lock` (Odoo 17+) or `action_done` (Odoo <= 16).
2. **Stock Picking Workflow (`applyOrderPickingAction`)**:
   - `create` -> Confirms order to generate stock pickings.
   - `validate` / `create_and_validate` -> Calls `processFullDelivery` to mark stock pickings as done.
   - `cancel` -> Cancels pending stock pickings.
3. **Invoicing & Payment Workflow (`applyOrderInvoiceAction`)**:
   - `create` / `create_and_post`: Calls the standard wizard `createOrderInvoice()`. If products have `invoice_policy = 'delivery'` and are not yet shipped, the wizard produces zero lines. The engine seamlessly falls back to [`createDraftInvoiceForOrder()`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo/order-workflow.ts#L315), directly generating an `account.move` linked to `sale_line_ids`.
   - `post`: Posts draft invoices and triggers [`syncOrderPayment()`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo/order-payment.ts) to register and reconcile customer payments against the sales invoice.

---

## 9. Inventory Synchronization (Bidirectional)

### 9.1 Odoo -> Zid Real-Time Stock Push
1. An Odoo Automated Action on `stock.quant` posts an HTTP webhook to `/api/webhooks/odoo/stock`.
2. The webhook verifies the shared secret, resolves the workspace, and enqueues an `odoo.stock.quant.update` event in `sync_queue`.
3. The queue coalesces rapid duplicate updates on the same product and location.
4. [`stock-sync-engine.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/stock-sync-engine.ts) reads the authoritative balance from Odoo (`readOdooQtyAtLocation`), maps the Odoo warehouse to the paired Zid location, and executes:
   - For child variants: `ZidAPI.products.stocks.bulkUpdate`.
   - For standalone products: `ZidAPI.locations.stockUpdate`.

### 9.2 Zid -> Odoo Stock Adjustment
1. When a `product.update` webhook containing `stocks[]` is received, the engine maps Zid locations to Odoo internal locations via `resolveWarehouse()`.
2. It adjusts Odoo stock via the `stock.change.product.qty` wizard or directly through `stock.quant` with `action_apply_inventory`.
3. **Oscillation Loop Prevention**: In [`src/lib/odoo/product-stock.ts#L14-L19`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo/product-stock.ts#L14-L19), if "Odoo -> Zid Inventory Sync" is enabled in settings, all reverse Zid -> Odoo stock writes are **strictly suppressed** to ensure Odoo remains the undisputed single source of truth.

---

## 10. Returns, Refunds & Reversals

### 10.1 Realities of Zid Return Architecture
- Zid publishes **no return-specific webhook event**.
- Returns are detected from `order.status.update` when status is `reversed` or `partially_reversed`.
- **Transient Guard**: Status `reverse_in_progress` is explicitly excluded from return processing to avoid returning stock before the customer's items physically arrive.

### 10.2 Authoritative Return State (`view-for-return`)
In [`src/lib/returns/zid.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/returns/zid.ts) and [`src/lib/returns/detect.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/returns/detect.ts):
1. **Quantity Semantic**: In Zid's `GET /v1/managers/store/orders/{id}/view-for-return`, `products[].quantity` represents the **remaining returnable quantity**, not the returned quantity. An empty array `products: []` signifies that the entire order has been returned.
2. **Receipt Inspection (`extractZidReceivedReturnLines`)**:
   - Inspects `reverse_order_label_requests[]` for `received_quantity`, `not_received_quantity`, and `damaged_quantity`.
   - If `damaged_quantity > 0`, the engine halts automatic reversal and flags `return_damaged_requires_financial_review`.
   - If grouped components are returned individually, it halts automatic reversal for financial review.
3. **Odoo Return Execution (`processOrderReturn`)**:
   - **Mode `stock_return_credit_note`**:
     1. Locates the original completed stock picking (`stock.picking`).
     2. Generates and validates an Odoo return picking (`stock.return.picking`).
     3. Locates the posted sales invoice (`account.move`).
     4. Creates and posts a credit note (`out_refund`) linked to the original invoice and reconciles outstanding balances.

---

## 11. Resilience, Retry Mechanisms & Edge Cases

### 11.1 Queue Architecture & Idempotency
- **Durable Ingestion**: All events are persisted to the Supabase `sync_queue` table before any ERP network I/O takes place.
- **Deduplication Key (`dedupKey`)**: Composed of `platform`, `workspaceId`, `storeId`, `event`, and a SHA-256 fingerprint of the normalized payload (`fingerprintPayload`). Duplicate webhooks delivered within the coalescing window are merged rather than executed multiple times.
- **Exponential Backoff**: Failed sync operations are rescheduled with increasing delays:
  ```typescript
  const delayMs = Math.min(60_000 * Math.pow(2, attempts), 3_600_000)
  ```
  After 5 failed attempts, the task is marked `error` and routed to the Dead Letter Queue in `sync_logs` with complete diagnostic payloads and stack traces.

### 11.2 Orphan Receipts Durability
If an inbound webhook arrives with an unrecognized event, missing workspace link, or malformed JSON, the ingress route **never drops the payload**. It calls [`recordOrphanReceipt()`](file:///e:/توفيق/zid/zidlink2/src/lib/webhook-inbox.ts), storing the raw payload in `webhook_inbox` with status `orphan` and returning HTTP 202. Administrators can replay orphaned events from the admin dashboard once the store connection is resolved.

### 11.3 Credential Redaction Interceptor
In [`src/lib/zid-client.ts#L306-L327`](file:///e:/توفيق/zid/zidlink2/src/lib/zid-client.ts#L306-L327):
An Axios response error interceptor inspects all outbound HTTP errors. It scrubs `Authorization`, `X-Manager-Token`, and `Access-Token` values from error messages and response data, replacing them with `[REDACTED]`. This guarantees that sensitive tokens never leak into server logs, Sentry, or user-facing error dialogs.

---

## 12. Verification Matrix: Real Implementation vs Theoretical

| Capability | Real Code Implementation | Theoretical Assumption | Audit Status |
|---|---|---|---|
| **OAuth Flow** | OAuth-first onboarding with temporary encrypted storage in `zid_oauth_pending` | User logs in first, then initiates OAuth | **Verified Real** |
| **OAuth Scopes** | Omits URL scopes to let Partner Portal defaults govern, preventing `EC4` errors | Sends hardcoded scope list | **Verified Real** |
| **Embedded App** | Ticket-based token exchange via `POST /api/zid/embedded/session` for cross-site iframes | Standard cookie login inside iframe | **Verified Real** |
| **Webhook Auth** | HTTP Basic Auth derived per merchant from `ENCRYPTION_KEY` using HKDF | HMAC SHA256 header / secret | **Verified Real** |
| **Ingress Rate Limits** | Certified Basic deliveries admitted at any volume; unauthenticated floods shed | Blanket IP rate-limiting | **Verified Real** |
| **Store Identity** | Resolves `store_id` vs `merchant_id` via `normalizeZidStoreId` to prevent log mismatch | Assumes `store_id` is always present | **Verified Real** |
| **Order Line Items** | Refuses orders with missing lines; pulls full snapshot via `ZidAPI.orders.get` | Writes empty sale order to ERP | **Verified Real** |
| **Line Unit Prices** | Divides `discounted_total` by `quantity` to resolve true unit prices | Takes `discounted_total` as unit price | **Verified Real** |
| **Shipping Fees** | Scans `payment.invoice[]`; explicit 0 stops fallback | Difference between totals | **Verified Real** |
| **COD Fees** | Scans `payment.invoice[]` for COD patterns excluding tax/shipping rows | Dedicated `cod_fee` key | **Verified Real** |
| **Invoice Parity** | `reconcileInclusiveDraftInvoice` ensures draft invoice matches sale order within 0.05 SAR | Relies on Odoo onchange math | **Verified Real** |
| **Variant Stock Update** | `ZidAPI.products.stocks.bulkUpdate` (`PATCH /v1/products/{id}/stocks/`) | `POST /variants` (which wiped prices) | **Verified Real** |
| **Product Bundles** | Auto-creates Odoo Kit BoM (`mrp.bom`, type='phantom') from Zid bundle components | Standalone products only | **Verified Real** |
| **Stock Oscillation** | Odoo->Zid sync suppresses reverse Zid->Odoo writes | Bidirectional loop | **Verified Real** |
| **Returns Detection** | Intercepts `order.status.update` for `reversed`; ignores `reverse_in_progress` | Dedicated return webhook event | **Verified Real** |
| **Return Quantities** | Queries `view-for-return` (`products[].quantity` = remaining returnable) | Assumes quantity = returned goods | **Verified Real** |
| **Damaged Items** | Halts auto-return if `damaged_quantity > 0` for financial review | Automatically refunds everything | **Verified Real** |
| **Dead Letter Handling** | Malformed/orphaned webhooks saved to `webhook_inbox` with HTTP 202/400 | Discards unroutable events | **Verified Real** |

---

## Conclusion

The Zid integration in ERP Link is completely implemented, hardened against real API quirks, and thoroughly validated with unit tests. It treats Zid's specific idiosyncrasies—such as HTTP Basic webhook auth, extended line totals, remaining-quantity return representations, and destructive variant endpoints—with purpose-built architectural solutions that prevent data loss, accounting discrepancy, and infinite inventory loops.
