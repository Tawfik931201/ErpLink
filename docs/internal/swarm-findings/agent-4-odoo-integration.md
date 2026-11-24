# Audit Report: Odoo ERP Integration in ERP Link

**Agent**: Agent 4 — Odoo Integration Specialist  
**Target Document**: `docs/internal/swarm-findings/agent-4-odoo-integration.md`  
**Date**: November 2026  
**Audited Codebase**: ERP Link (`src/lib/odoo/`, `src/lib/odoo-client.ts`, `src/lib/odoo.ts`, `src/app/actions/odoo.ts`, `src/app/(app)/app/connect-odoo/`, `src/lib/returns/odoo.ts`, `tests/unit/odoo-*.test.ts`)

---

## Executive Summary

ERP Link features a production-grade, highly specialized Odoo ERP integration engineered to bridge e-commerce platforms (**Zid**, **Salla**, and **Shopify**) with **Odoo Community and Enterprise editions across versions 14 through 20**.

The integration does not treat Odoo as a static API. Instead, it features an adaptive version-aware architecture that introspects Odoo schema dynamically (`fields_get`, `common.version`), provides hardened XML-RPC transport with connection pooling and transient fault recovery, protects accounting integrity (VAT, multi-currency, and credit note tax assertions), and gracefully handles major structural breakages introduced by Odoo between versions 14 and 20 (including Odoo 18's storable goods refactor, Odoo 19's partner field removals, and Odoo 20's elimination of the return wizard).

All 15 dedicated Odoo test suites (173 unit tests) pass cleanly with 0 failures.

---

## 1. Connection Screen & Credential Architecture

### 1.1 User Interface & Navigation
- **Route**: [`/app/connect-odoo`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/connect-odoo/page.tsx)
- **Component**: [`OdooConnectionForm`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/connect-odoo/odoo-form.tsx)
- **Supported Systems**: Odoo ERP (Primary) and ERPNext.

### 1.2 Required Credentials
For Odoo connections, the following fields are strictly required:
1. **Server URL (`url`)**:
   - Must include `http://` or `https://`. In production (`NODE_ENV === 'production'`), HTTPS is mandatory.
   - Protected against Server-Side Request Forgery (SSRF) via [`validateSafeExternalUrl`](file:///e:/توفيق/zid/zidlink2/src/app/actions/odoo.ts#L172-L196) and [`resolvePublicDestination`](file:///e:/توفيق/zid/zidlink2/src/lib/security/safe-external-fetch.ts). Rejects loopback addresses, `.local`, `.internal`, private subnets, and credentials embedded inside URLs.
2. **Database Name (`db_name` / `db`)**:
   - The exact Odoo database name.
   - **Architectural note**: Odoo databases are input directly by the user rather than auto-discovered via `/web/database/list`. In production and Odoo.sh environments, `list_db = False` is standard security hardening; querying database lists externally often results in 403 Forbidden or RPC access errors.
3. **Username / Email (`username`)**:
   - User login in Odoo with sufficient access rights (Sales, Inventory, Invoicing/Accounting).
4. **API Key / Password (`apiKey`)**:
   - Supported across Odoo 14–20.
   - The UI explicitly guides users to create an **API Key** under Odoo User Settings rather than using their master password.
   - Encrypted at rest using AES-256-GCM via `encrypt(apiKey)` in [`src/lib/crypto.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/crypto.ts). The plaintext password is never sent to the client browser; server actions strip passwords via [`toPublicErpConnection`](file:///e:/توفيق/zid/zidlink2/src/app/actions/odoo.ts#L95-L109).

### 1.3 Connection Testing & Verification Lifecycle
- **Test Action**: [`testErpConnection`](file:///e:/توفيق/zid/zidlink2/src/app/actions/odoo.ts#L201-L253).
  1. Validates URL format and SSRF constraints.
  2. Instantiates a transient [`OdooClient`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo-client.ts).
  3. Executes `client.authenticate()` against `/xmlrpc/2/common`.
  4. Upon successful authentication, queries `client.getVersionInfo()` to introspect the remote Odoo edition and build version.
- **Saving Action**: [`saveErpConnection`](file:///e:/توفيق/zid/zidlink2/src/app/actions/odoo.ts#L343-L487).
  1. Tests connection prior to committing.
  2. Stores encrypted credentials in Supabase `erp_connections`.
  3. Performs best-effort update of `odoo_version` column.
  4. Binds workspace execution target via `requireWorkspaceBinding`.
  5. Clears in-process and Next.js data caches (`ttlCache.clear('odoo:')`, `revalidateTag`).
  6. Triggers asynchronous background auto-bootstrap (`autoBootstrapWorkspace`).

---

## 2. Database, Company, Warehouse & Account Resolution

### 2.1 Multi-Company Architecture
Multi-company setups are handled with strict partition boundaries:
- **Default Company Discovery**: During [`autoBootstrapWorkspace`](file:///e:/توفيق/zid/zidlink2/src/lib/auto-bootstrap.ts#L138-L146), the engine queries `res.users` for the authenticated `uid` to determine their default `company_id`.
- **Company Context Enforcement**:
  - In [`order-currency-resolution.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo/order-currency-resolution.ts#L31), calls pass `context: { allowed_company_ids: [companyId] }` to guarantee pricelists and currencies resolve within the target company.
  - In [`order-workflow.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo/order-workflow.ts#L380-L384), draft invoice creation isolates sales journals by `['company_id', '=', companyId]`, preventing cross-company journal leakage.
  - In [`value-settings.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo/value-settings.ts#L79-L84), `company_id` is assigned to records according to the workspace's Standard Mapping settings. If `link_company === false`, `company_id` is stripped to allow multi-company sharing.

### 2.2 Warehouse & Location Selection
- **Warehouse Retrieval**: [`getOdooWarehouses`](file:///e:/توفيق/zid/zidlink2/src/app/actions/odoo.ts#L1084-L1123) queries `stock.warehouse` (`fields: ['id', 'name', 'code']`) with a 10-minute TTL cache.
- **Location Retrieval**: [`getOdooLocations`](file:///e:/توفيق/zid/zidlink2/src/app/actions/odoo.ts#L1204-L1250) queries `stock.location` (`fields: ['id', 'name', 'complete_name', 'usage']`), optionally filtering by `usage = 'internal'`.
- **Branch / Warehouse Routing**: Platform branch IDs (Zid/Salla/Shopify) are mapped in Standard Mapping to specific Odoo warehouses or stock locations via [`resolveWarehouse`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo/order-location.ts).

### 2.3 Chart of Accounts Compatibility Across Versions
[`getOdooAccountsByType`](file:///e:/توفيق/zid/zidlink2/src/app/actions/odoo.ts#L1322-L1383) adapts dynamically to Odoo's changing accounting schema:
- **Odoo 16+**: Filters by `account_type` (`asset_receivable` or `liability_payable`).
- **Odoo 14–15**: Filters by relational field `user_type_id.type` (`receivable` or `payable`).
- **Odoo 17+ Multi-Company**: Uses `company_ids` (many2many) instead of `company_id` (many2one).

---

## 3. RPC Protocols & Client Transport Architecture

### 3.1 Dual-Client Architecture
The codebase maintains two distinct Odoo clients for specific operational boundaries:
1. **Multi-Tenant Workspace Client** ([`src/lib/odoo-client.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo-client.ts)):
   - Protocol: **XML-RPC** (`xmlrpc` npm library).
   - Endpoints:
     - `/xmlrpc/2/common`: For public methods (`version`) and authentication (`authenticate`).
     - `/xmlrpc/2/object`: For ORM operations via `execute_kw`.
   - Used for all customer sync operations (Products, Orders, Customers, Inventory, Invoices).
2. **Central Platform Client** ([`src/lib/odoo.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo.ts)):
   - Protocol: **JSON-RPC 2.0** over HTTP POST to `/jsonrpc`.
   - Used exclusively for ERP Link's central support ticketing and audit archiving (`x_erplink_support_ticket`).

### 3.2 High-Throughput Transport Optimizations
To support high event volume (hundreds of webhook events per minute) without choking Odoo or causing TLS connection exhaustion:
- **Global UID Cache (`uidCache`)**:
  - Keyed by `url|db|username|sha256(apiKey)[0..16]`.
  - Caches up to 500 authenticated user IDs. Eliminates 1 unnecessary XML-RPC round-trip per webhook event.
  - Automatically evicted (`evictUid`) when an authentication error (401/403/Access Denied) occurs.
- **Global Version Cache (`versionCache`)**:
  - Keyed by `url`. Caches parsed `OdooVersionInfo` up to 200 servers.
- **HTTP/HTTPS Keep-Alive Agent Pooling**:
  - Configures `https.Agent` and `http.Agent` with `keepAlive: true`, `maxSockets: 24`, `maxFreeSockets: 8`, `keepAliveMsecs: 30000`, and `timeout: 60000`.
  - Reuses TLS handshakes across consecutive calls.
- **Transient Transport Error Recovery**:
  - Handles reverse-proxy HTML error responses (502 Bad Gateway, 503 Service Unavailable, Cloudflare HTML errors) and socket disconnects (`ECONNRESET`, `EPIPE`, `ETIMEDOUT`).
  - Idempotent operations (`search`, `read`, `search_read`, `fields_get`, and ORM `write`) automatically retry once on a fresh socket (`freshConnection = true`).
  - **Anti-Duplication Rule**: Non-idempotent operations (`create`, `unlink`, action workflows) **never** retry automatically at the transport level to prevent creating duplicate orders, pickings, or payments in Odoo.
- **Unknown Outcome Detection**:
  - Wrapped via [`runErpCreateEffect`](file:///e:/توفيق/zid/zidlink2/src/lib/erp-effect-context.ts). If an XML-RPC call drops connection during `create`, the system checks whether the record was committed before declaring failure.
- **Security & Impersonation Guard**:
  - All non-read methods enforce [`checkImpersonationWriteBlock('Odoo ERP')`](file:///e:/توفيق/zid/zidlink2/src/lib/auth.ts), strictly prohibiting support agents from writing data while impersonating a tenant.

---

## 4. Comprehensive Version Support Matrix (Odoo 14 to Odoo 20)

ERP Link supports Odoo versions 14, 15, 16, 17, 18, 19, and 20. The integration accounts for structural changes across these versions:

| Feature / Model Field | Odoo 14 | Odoo 15 | Odoo 16 | Odoo 17 | Odoo 18 | Odoo 19 | Odoo 20 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Product Type (`product.template.type`)** | `'product'`, `'consu'`, `'service'` | `'product'`, `'consu'`, `'service'` | `'product'`, `'consu'`, `'service'` | `'product'`, `'consu'`, `'service'` | `'consu'`, `'service'` (`'product'` removed!) | `'consu'`, `'service'` | `'consu'`, `'service'` |
| **Storable Goods Flag (`is_storable`)** | ❌ Does not exist | ❌ Does not exist | ❌ Does not exist | ❌ Does not exist | ✅ Required (`is_storable=True`) | ✅ Required (`is_storable=True`) | ✅ Required (`is_storable=True`) |
| **Detailed Type (`detailed_type`)** | ❌ Does not exist | ✅ Required (mirrors `type`) | ✅ Required (mirrors `type`) | ✅ Required (mirrors `type`) | ❌ Removed | ❌ Removed | ❌ Removed |
| **Tracking Selection (`tracking`)** | `'none'`, `'lot'`, `'serial'` | `'none'`, `'lot'`, `'serial'` | `'none'`, `'lot'`, `'serial'` | `'none'`, `'lot'`, `'serial'` | `'none'`, `'lot'`, `'serial'` | `'none'`, `'lot'`, `'serial'` | `'lot'`, `'serial'` ONLY (`'none'` removed! Use `false`) |
| **SO Line Tax Field** | `tax_id` | `tax_id` | `tax_id` | `tax_id` | `tax_ids` (Renamed!) | `tax_ids` | `tax_ids` |
| **SO Line UoM Field** | `product_uom` | `product_uom` | `product_uom` | `product_uom` | `product_uom` | `product_uom_id` (Renamed!) | `product_uom_id` |
| **Partner Mobile (`res.partner.mobile`)** | ✅ Exists | ✅ Exists | ✅ Exists | ✅ Exists | ✅ Exists | ❌ Removed! (KeyError if sent) | ❌ Removed! |
| **Customer Company Type** | `company_type` | `company_type` | `company_type` | `company_type` | `company_type` | `company_type` | `is_company` (Boolean only) |
| **Partner Registry (`company_registry`)** | Optional | Optional | Optional | Optional | Optional | Optional | ❌ Not in standard CE |
| **Analytic Accounting** | `analytic_account_id` on header | `analytic_account_id` on header | `analytic_distribution` (dict) | `analytic_distribution` + `plan_id` | `analytic_distribution` | `analytic_distribution` | `analytic_distribution` |
| **SO Confirmation / Lock** | `action_done` | `action_done` | `action_done` | `action_lock` | `action_lock` | `action_lock` | `action_lock` |
| **SO Cancel Context** | Normal | Normal | Normal | `disable_cancel_warning: true` | `disable_cancel_warning: true` | `disable_cancel_warning: true` | `disable_cancel_warning: true` |
| **Stock Move Done Quantity** | `quantity_done` | `quantity_done` | `quantity_done` | `quantity` | `quantity` | `quantity` | `quantity` |
| **Stock Return Wizard** | `stock.return.picking` (`create_returns`) | `stock.return.picking` (`create_returns`) | `stock.return.picking` (`create_returns`) | `stock.return.picking` (`action_create_returns`) | `stock.return.picking` | `stock.return.picking` | ❌ Wizard Removed! Uses `stock.picking.action_return()` |
| **Payment Memo Field** | `ref` | `ref` | `ref` | `ref` | `memo` (Renamed!) | `memo` | `memo` |
| **Payment Method Line** | `payment_method_id` | `payment_method_line_id` | `payment_method_line_id` | `payment_method_line_id` | `payment_method_line_id` | `payment_method_line_id` | `payment_method_line_id` |
| **Payment Journal Entry Creation** | Standard | Standard | Standard | Standard | Standard | Standard | Requires `force_payment_move: true` |

---

## 5. Models & Workflows Deep Dive

### 5.1 Sales Orders (`sale.order` & `sale.order.line`)
- **Workflow State Engine** ([`src/lib/odoo/order-workflow.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo/order-workflow.ts)):
  - Maps platform statuses (e.g. `ready`, `in_delivery`, `delivered`, `cancelled`) to Odoo states (`draft`, `sent`, `sale`, `done`, `cancel`).
  - Enforces Odoo confirmation state requirements: before generating delivery pickings or invoices, ensures the order is confirmed (`action_confirm`).
  - In Odoo 17+, cancels via `action_cancel` passing `{ context: { disable_cancel_warning: true } }` to bypass interactive UI wizard traps.
  - In Odoo 17+, locks orders via `action_lock` (fallback to `action_done` on Odoo 14–16).

### 5.2 VAT & Tax Architecture
- **Tax Resolution** ([`resolveOrderVatTax`](file:///e:/توفيق/zid/zidlink2/src/lib/zid/order-helpers.ts)):
  - Evaluates recipient shipping destination country.
  - Matches configured rules: Saudi Standard Tax (15%), GCC rules, Zero-rated/Export, or specific international mappings.
- **Price Inclusive vs. Exclusive Math**:
  - When prices in the store include VAT (`pricesIncludeTax = true`):
    $$\text{Unit Price Excluding Tax} = \text{round}\left(\frac{\text{Gross Price}}{1 + \frac{\text{Tax Rate}}{100}}, 2\right)$$
  - Applies identical exclusion math to shipping fees, COD fees, and discount totals.
- **Explicit Zero-Tax Protection**:
  - If VAT is disabled or destination is tax-exempt, order lines explicitly write `tax_ids = [[6, 0, []]]`.
  - **Critical safeguard**: Without this explicit empty array, Odoo's ORM injects the default customer sales tax assigned to the product template, corrupting the sales total.
- **Draft Invoice Total Parity Reconciliation** ([`src/lib/odoo/order-invoice-integrity.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo/order-invoice-integrity.ts)):
  - Compares draft `account.move` total against `sale.order.amount_total`.
  - Tolerates minor rounding differences ($\le 0.05$ SAR).
  - If a discrepancy occurs due to Odoo's invoice wizard re-evaluating taxes from product defaults, `reconcileInclusiveDraftInvoice` safely reconciles invoice line unit prices and tax IDs back to the sales order lines before posting.

### 5.3 Order Line Adjustments & Fees
- **Shipping Line**:
  - Generated as a dedicated `sale.order.line` with resolved `shipping_product_id` or SKU.
  - Resolves carrier service to `carrier_id` on the parent `sale.order` header.
- **Discounts**:
  - Mode `'percent'`: Injects percentage directly into `sale.order.line.discount`.
  - Mode `'fixed'`: Appends a dedicated negative adjustment line item (`price_unit = -Math.abs(discount)`).
- **Cash on Delivery (COD) Fee**:
  - Appends fee line item when payment method matches COD (`payMethodCode === 'zid_cod'` or regex matching Arabic/English COD phrases).
- **Dynamic Bundles & Product Kits**:
  - The parent bundle product is added at full price as a service line.
  - Picked kit components are appended as $0.00$ price lines so Odoo inventory pickings move the physical stock without doubling the order valuation.
- **Defensive Field Pruning**:
  - Prior to writing order lines, all non-standard fields outside `ALLOWED_LINE_KEYS` and live-introspected `fields_get` metadata are stripped to prevent Odoo from rejecting the entire batch.

### 5.4 Invoicing (`account.move` & `account.move.line`)
- **Invoice Generation**:
  - Primary path: Executes public wizard `sale.advance.payment.inv` with `{ advance_payment_method: 'delivered' }`.
  - Direct draft fallback ([`createDraftInvoiceForOrder`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo/order-workflow.ts#L315-L450)): If products have `invoice_policy = 'delivery'` and goods have not yet shipped, the wizard returns empty. ERP Link directly constructs an `account.move` (`move_type: 'out_invoice'`) linked to the sales order lines (`sale_line_ids: [[6, 0, [line.id]]]`), fulfilling the merchant's workflow without violating Odoo constraints.
  - Posting: Posts draft invoices via `account.move.action_post` (with fallback to `post`).

### 5.5 Payments & Reconciliation (`account.payment`)
- **Payment Creation** ([`src/lib/odoo/order-payment.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo/order-payment.ts)):
  - Creates `account.payment` with `payment_type: 'inbound'`, `partner_type: 'customer'`.
  - In Odoo 18–20: Uses `memo = ref`. In Odoo 14–17: Uses `ref = ref`.
  - In Odoo 15–20: Resolves `payment_method_line_id`. In Odoo 14: Uses `payment_method_id`.
  - In Odoo 20: Passes `{ context: { force_payment_move: true } }` to ensure the journal entry is posted immediately with an outstanding receipts account.
- **Invoice Reconciliation**:
  - Matches unreconciled debit move lines on `account.move` (the invoice) with credit move lines on `account.payment.move_id` on matching receivable accounts.
  - Executes `account.move.line.reconcile` (with fallback to `js_assign_outstanding_line`).

### 5.6 Inventory & Stock Deliveries (`stock.picking` & `stock.quant`)
- **Full Delivery Processing** ([`processFullDelivery`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo/order-workflow.ts#L1219-L1263)):
  - Finds open pickings (`stock.picking`) linked to the sales order.
  - If picking is `draft` or `confirmed`, calls `action_assign` to check availability.
  - Updates move quantities: tries `quantity` (Odoo 17+), falls back to `quantity_done` (Odoo 14–16).
  - Validates picking via `button_validate` with `{ context: { skip_sms: true } }`.
- **Direct Stock Adjustments** ([`src/lib/odoo/product-stock.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo/product-stock.ts)):
  - Tries `stock.change.product.qty` wizard.
  - Falls back to direct `stock.quant` modification: sets `inventory_quantity: qty` and executes `action_apply_inventory`. Safely ignores XML-RPC "cannot marshal None" server quirks.
  - **Reverse Write Lock**: When "Odoo $\to$ Store" inventory sync is active, any incoming Store $\to$ Odoo stock write is blocked (`isInventorySyncErpToStoreEnabled`), preserving Odoo as the single source of truth.

---

## 6. Returns & Reverse Logistics

Implemented in [`src/lib/returns/odoo.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/returns/odoo.ts) and [`src/lib/returns/engine.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/returns/engine.ts):

### 6.1 Return Signal Detection
- Intercepts return events prior to sales order writes.
- Detects Zid return statuses (`returned`, `refunded`, `reverse_in_progress` ignored).
- Detects Salla `refunded_items` payload mapping.

### 6.2 Three Supported Return Strategies
1. **Negative Sales Order (`createNegativeSaleOrder`)**:
   - Creates a mirror sales order named `RET:<OriginalOrderName>` with negative quantities and unit prices.
2. **Reverse Stock Picking (`createStockReturn`)**:
   - **Odoo 14–19**: Creates `stock.return.picking` wizard with `product_return_moves` (`to_refund: true`), executes `action_create_returns` (fallback to `create_returns`).
   - **Odoo 20**: Uses native `stock.picking.action_return([[pickingId]])`. Includes an idempotent retry cache checking candidate moves so retried webhooks do not mint duplicate draft pickings.
   - Validates the return picking via `button_validate`.
3. **Customer Credit Note (`createCreditNote`)**:
   - Creates `account.move` with `move_type: 'out_refund'`, linked via `reversed_entry_id = originalInvoiceId`.
   - Lines carry returned quantities and explicitly clear default taxes (`tax_ids: [[6, 0, line.taxIds || []]]`).
   - **Double-Audit Assertion** ([`assertPersistedCreditTaxes`](file:///e:/توفيق/zid/zidlink2/src/lib/returns/odoo.ts#L1339-L1370)): Asserts persisted tax values against expected return values both before posting and after posting to guarantee no unmapped taxes were injected.

---

## 7. Odoo Webhooks & Inbound Security

### 7.1 Automated Action Registration
- [`registerOdooWebhook`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo-webhook.ts) dynamically inspects Odoo's automation models:
  - **Odoo 17+**: Configures `base.automation` using `action_server_ids` and native `state: 'webhook'` on `ir.actions.server`. If native webhook state is absent, generates Python code action (`state: 'code'`).
  - **Odoo 14–16**: Configures automated action with Python code execution via `requests.post`.
  - Introspects field groups: strips group-restricted fields (such as `standard_price`) from `webhook_field_ids` to avoid security permission failures.

### 7.2 Inbound Webhook Authentication Scheme
- Located in [`src/lib/odoo/webhook-secret.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo/webhook-secret.ts).
- Webhook endpoints: `/api/webhooks/odoo` (Record changes) and `/api/webhooks/odoo/stock` (Stock movements).
- **HKDF Derivation**: Secrets are cryptographically derived from `ENCRYPTION_KEY` using HKDF-SHA256 scoped to `workspace_id` or `field_mapping_id`.
- **Zero Configuration**: No manual secret copying required by merchants. The secret is derived and embedded as `&secret=...` during action registration.
- **Migration & Read-Back Trust Rule**:
  - Actions registered prior to secret introduction are classified as `legacy` and admitted safely.
  - **The Trust Rule**: Inbound Odoo webhook payloads are treated purely as cache-invalidation triggers, never as data sources. Upon receiving a trigger, ERP Link re-queries the customer's Odoo database directly via XML-RPC to fetch current balances. An attacker cannot forge stock quantities or prices.

---

## 8. Verified Unit Test Coverage

All 15 test suites and 173 tests pass in local Jest verification (`npm test -- tests/unit/odoo-`):

1. `tests/unit/odoo-version.test.ts` (10 tests): Validates parsing of on-premise, enterprise, and Odoo Online `saas~` version strings.
2. `tests/unit/odoo-product-registration-versions.test.ts` (14 tests): Verifies product types, storable flags, detailed types, and tracking options across Odoo 14, 15, 16, 17, 18, 19, and 20.
3. `tests/unit/build-odoo-values-mobile.test.ts` (3 tests): Verifies partner `mobile` field guard for Odoo 19+.
4. `tests/unit/build-odoo-values-datetime.test.ts` (4 tests): Tests UTC datetime and date string normalization.
5. `tests/unit/odoo-operation-routing.test.ts` (28 tests): Tests model operations routing, presets, and entity types.
6. `tests/unit/odoo-order-payment.test.ts` (12 tests): Verifies payment creation, memo/ref fields, and multi-version reconciliation.
7. `tests/unit/odoo-direct-invoice-company.test.ts` (8 tests): Tests company isolation on direct draft invoices.
8. `tests/unit/odoo-stock-webhook-reconcile.test.ts` (16 tests): Tests stock webhook reconciliation and balance queries.
9. `tests/unit/odoo-webhook-auth.test.ts` (18 tests): Tests HKDF secret derivation, scope separation, and legacy delivery windows.
10. `tests/unit/odoo-webhook-trust.test.ts` (10 tests): Asserts read-back rule preventing untrusted webhook payload injection.
11. `tests/unit/odoo-xmlrpc-transport.test.ts` (15 tests): Tests keep-alive connection pooling, transient 502/HTML recovery, and anti-duplication rules.
12. `tests/unit/odoo-create-unknown-outcome.test.ts` (8 tests): Verifies detection and recovery from dropped connection creates.
13. `tests/unit/odoo-record-write-fallback.test.ts` (11 tests): Verifies automatic pruning of invalid/unsupported fields during record write.
14. `tests/unit/odoo-confirmed-order-pricelist.test.ts` (7 tests): Tests pricelist isolation on confirmed orders.
15. `tests/unit/odoo-order-update-pricelist.test.ts` (9 tests): Tests order updates without pricelist corruption.

---

## 9. Discrepancies, Architectural Highlights & Recommendations

1. **Database Discovery Assumption**:
   - *Finding*: Odoo database name is entered manually by the user in `OdooConnectionForm` rather than selected from a dropdown.
   - *Status*: Working as intended. Fetching `/web/database/list` is intentionally avoided because production and cloud Odoo instances disable database listing.
2. **Production Target**:
   - *Finding*: While Odoo 14 through 20 are actively supported and unit-tested in code, the core production baseline is tested most rigorously against Odoo 17, 18, and 19.
3. **Odoo 20 Wizard Migration**:
   - *Finding*: Odoo 20 completely removed `stock.return.picking`. The codebase already implements the public method `stock.picking.action_return()` for version 20+, with fallback to `stock.return.picking` for versions 14–19.
4. **Partner Mobile Deprecation**:
   - *Finding*: Odoo 19 removed `mobile` from `res.partner`. The codebase safely inspects model metadata and prunes `mobile` from partner creates/writes.
5. **Zero-Configuration Auto-Bootstrap**:
   - *Finding*: When an Odoo connection is saved, `autoBootstrapWorkspace` queries the live Odoo database to discover default company, warehouse, pricelist, and income/expense accounts, eliminating manual setup hurdles.
