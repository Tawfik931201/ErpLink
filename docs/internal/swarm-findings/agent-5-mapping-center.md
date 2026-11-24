# Agent 5 — Mapping Center Comprehensive Audit Findings

> **Auditor**: Agent 5 — Mapping Center Specialist  
> **Target Scope**: Standard Mapping, Orders Mapping, Products Mapping, Customers Mapping, Categories Mapping, Custom Fields, Payment Method Mapping, Order Status Mapping, Tax Mapping, Warehouse & Account Rules, Invoice & Delivery Automation.  
> **Source Files Audited**:
> - UI Routes: `src/app/(app)/app/mapping-center/` (`page.tsx`, `layout.tsx`, `categories/page.tsx`, `custom/page.tsx`, `custom/[id]/page.tsx`, `add-field/page.tsx`, `add-field/[id]/page.tsx`)
> - UI Components: `src/app/(app)/app/mapping-center/standard-components/` (`order-settings-tab.tsx`, `product-settings-tab.tsx`, `customer-settings-tab.tsx`, `category-settings-tab.tsx`, `setting-card.tsx`), `standard-mapping-client.tsx`, `custom-mapping-client.tsx`, `field-mapping-form.tsx`, `add-custom-field-form.tsx`, `src/components/mapping-center/mapping-center-header.tsx`, `src/components/mapping/category-mapping-dialog.tsx`, `src/components/mapping/product-mapping-dialog.tsx`
> - Server Actions: `src/app/actions/standard-mapping.ts`, `src/app/actions/field-mappings.ts`, `src/app/actions/static-mappings.ts`, `src/app/actions/category-mappings.ts`, `src/app/actions/product-mappings.ts`, `src/app/actions/order-status-mappings.ts`, `src/app/actions/order-custom-status.ts`, `src/app/actions/custom-fields.ts`, `src/app/actions/custom-fields-erpnext.ts`, `src/app/actions/inventory-sync.ts`
> - Domain & Engine Core: `src/lib/mapping-settings.ts`, `src/lib/mapping-constants.ts`, `src/lib/platforms/*/fields.ts`, `src/lib/sync/mappings.ts`, `src/lib/odoo/order-values.ts`, `src/lib/odoo/order-lines.ts`, `src/lib/odoo/order-workflow.ts`, `src/lib/odoo/order-payment.ts`, `src/lib/odoo/analytic-distribution.ts`, `src/lib/returns/engine.ts`, `src/lib/customers/matching-settings.ts`, `src/lib/products/bom-capability.ts`, `src/lib/categories/odoo-values.ts`
> - Test Suites: `tests/unit/mapping-settings.test.ts`, `tests/unit/static-mappings-allowlist.test.ts`, `tests/unit/order-status-actions.test.ts`, `tests/unit/analytic-distribution.test.ts`, `tests/unit/analytic-line-injection.test.ts`, `tests/unit/order-tax-inclusive-sync.test.ts`, `tests/unit/return-settings.test.ts`, `tests/unit/customer-standard-mapping-save.test.ts`, `tests/unit/category-overrides.test.ts`, `tests/unit/product-variants.test.ts`, `tests/unit/sync-workspace-scoping.test.ts`

---

## 1. Architecture & Persistence Overview

### 1.1 Navigation & Route Hierarchy
The Mapping Center (`/app/mapping-center`) is organized into dedicated sub-routes:
1. **Standard Mapping Hub** (`/app/mapping-center`):
   - Houses entity subtabs: **Categories (`categories`)**, **Products (`products`)**, **Customers (`customers`)**, and **Orders (`orders`)**.
   - Supports URL deep-linking via search param `?subtab=orders|products|customers|categories`.
   - Multi-store support: Linked stores for Zid (`zid`), Salla (`salla`), and Shopify (`shopify`) render distinct per-store tabs.
2. **Category Mapping Shortcut** (`/app/mapping-center/categories`):
   - Dedicated direct route initializing `StandardMappingClient` focused on the `categories` subtab.
3. **Custom Field Mappings List** (`/app/mapping-center/custom`):
   - Table of custom per-event integration rules with filtering by platform, sync direction, and operation.
4. **Custom Field Mapping Record Page** (`/app/mapping-center/custom/[id]`):
   - Per-record page with dedicated URL displaying mapped fields (`MappingFieldsCard`), relation policies, and edit form.
5. **Add Custom Field in ERP** (`/app/mapping-center/add-field` & `/app/mapping-center/add-field/[id]`):
   - UI tool to create native custom fields directly in Odoo (`ir.model.fields`) or ERPNext (`Custom Field`) and inject them into views.

### 1.2 Data Persistence Architecture
The Mapping Center utilizes a hybrid relational + JSONB persistence model:
- **`standard_mapping_settings` Table**:
  - Primary source of truth for Standard Mapping.
  - Compound primary key: `(workspace_id, store_type, store_id, entity_type)` where `store_id` is the store merchant key (`merchant_id` for Zid/Salla, `shop_domain` for Shopify, or `''` for platform default).
  - Column `settings`: JSONB storing all configurations for that entity.
  - Resolution precedence implemented in `src/lib/mapping-settings.ts`: Per-store specific row takes precedence over platform-wide default (`''`).
- **`order_status_mappings` Table**:
  - Stores lifecycle state mapping: `(workspace_id, platform, store_id, zid_status)` ➔ `odoo_state`, `enabled`, `invoice_action`, `picking_action`.
  - **Dual-Storage Guarantee**: Server action `saveOrderStatusMappings` writes to both `order_status_mappings` and `standard_mapping_settings.settings.order.status_actions`.
- **`field_mappings` Table**:
  - Stores custom event mappings: `workspace_id`, `name`, `action` (webhook event), `odoo_model`, `odoo_operation`, `mappings` (JSONB), `sync_direction`, `odoo_webhook_id`, `odoo_server_action_id`.
- **Dedicated Static Mapping Tables** (7 strictly allowlisted tables in `src/app/actions/static-mappings.ts`):
  1. `payment_method_mappings`
  2. `shipping_method_mappings`
  3. `warehouse_mappings`
  4. `currency_mappings`
  5. `tax_mappings`
  6. `payment_term_mappings`
  7. `pricelist_mappings`
- **Manual Entity Link Tables**:
  - `product_mappings`: Manual SKU/ID link overrides (`source_product_id`, `source_product_name`, `source_sku`, `odoo_product_id`).
  - `category_mappings`: Manual category mappings (`source_category_name`, `odoo_category_id`, `parent_id`, `income_account_id`, `expense_account_id`, `property_cost_method`, `property_valuation`, etc.).
  - `entity_links`: Durable two-way cross-reference ledger between store entity IDs and ERP record IDs.

---

## 2. Standard Mapping — Orders (Comprehensive Audit)

The Orders Mapping tab (`OrderSettingsTab.tsx`, 2,546 lines) controls order synchronization, financial posting, inventory allocation, and fulfillment workflow.

### 2.1 Order Sync & Permitted Operations
- **Field / Setting**: `orderDisabled` (Enable/Disable Order Sync)
  - **Arabic**: تفعيل مزامنة الطلبات
  - **Function**: Master toggle to enable or halt order sync for this store.
  - **Data Source**: `standard_mapping_settings.settings.disabled` (boolean).
  - **UI Controls**: Switch toggle.
  - **Sync Engine Impact**: When `true` (`disabled: true`), incoming order webhooks are gated in `processFixedMappingFallback` and logged as `skipped` with reason `disabled_in_settings`.
- **Field / Setting**: `orderEnabledActions` (Allowed Operations)
  - **Arabic**: العمليات المسموح بها
  - **Function**: Defines which order lifecycle operations are allowed.
  - **Data Source**: `standard_mapping_settings.settings.enabled_actions` (string array).
  - **UI Controls**: Multi-select dropdown. Available values:
    - `create` (إنشاء - Create)
    - `update` (تعديل - Update)
    - `cancel` (إلغاء - Cancel)
    - `deliver` (توصيل - Deliver)
  - **Sync Engine Impact**: Gated by `isEntityOperationAllowed`. If an incoming webhook triggers an operation not in this array, the sync engine records a `skipped` log and exits without error.
  - **Common Misconfiguration**: Omitting `update` or `cancel`. When a customer cancels or updates an order in Zid/Salla, the order remains open in Odoo.

### 2.2 Order Matching & Deduplication Field
- **Field / Setting**: `orderMatchZidField` (Store Match Field) & `orderMatchOdooField` (Odoo Match Field)
  - **Arabic**: حقل المتجر وحقل أودو المقابل (حقل المطابقة وتجنب تكرار الطلب)
  - **Function**: Specifies the unique identifier used to look up an existing Sales Order in Odoo before creating a duplicate.
  - **Data Source**: Store fields catalogue (`id`, `code`, `order_number`) vs Odoo fields catalogue on `sale.order` (`name`, `client_order_ref`, `x_zid_order_id`, `x_salla_order_id`).
  - **UI Controls**: SearchableSelect dropdowns with Odoo live field introspection.
  - **Sync Engine Impact**: `findExistingSaleOrderId` executes a search domain on `sale.order` using `[([odooMatchField, '=', storeMatchValue])]`. If found, the existing order is updated instead of created.
  - **Common Misconfiguration**: Matching store `id` to Odoo `name`. Odoo `name` is usually the sequence number (e.g. `SO00123`), whereas store ID is numeric (e.g. `1234567`). Best practice: match store `code`/`order_number` to `client_order_ref` or store `id` to `x_zid_order_id`.

### 2.3 Customer Matching Policy (Fallback Behavior)
- **Field / Setting**: `orderCustomerFallbackPolicy`
  - **Arabic**: سلوك مطابقة العميل في الطلب
  - **Function**: Determines what to do when an incoming order belongs to a customer not previously registered in Odoo.
  - **Data Source**: `standard_mapping_settings.settings.customer_fallback_policy` / `settings.order.customer_fallback_policy`.
  - **UI Values**:
    1. `create_new` (إنشاء عميل جديد): Automatically create a new `res.partner` in Odoo using order customer details.
    2. `skip_order` (إلغاء وتسجيل تخطي): Halts sync of this order and flags it as skipped until the customer exists.
    3. `default_customer` (تعيين عميل افتراضي): Links the order to a fixed generic customer record.
- **Field / Setting**: `orderDefaultCustomerId`
  - **Arabic**: العميل الافتراضي في أودو
  - **Function**: Odoo `res.partner` ID used when `orderCustomerFallbackPolicy === 'default_customer'`.
  - **Data Source**: Odoo `res.partner` live query (`getOdooCustomers`).
  - **Sync Engine Impact**: `order-values.ts` strictly validates that if policy is `default_customer`, `default_customer_id` must be a positive integer, throwing a clear error if unconfigured.
  - **Common Misconfiguration**: Selecting `default_customer` without choosing a customer from the dropdown, causing order creation to fail with `Configured default order customer is missing or invalid`.

### 2.4 Product Matching Policy (Fallback Behavior)
- **Field / Setting**: `orderProductFallbackPolicy`
  - **Arabic**: سلوك مطابقة المنتجات في الطلب
  - **Function**: Determines what to do when an order line contains an item with an unmapped SKU or barcode.
  - **Data Source**: `standard_mapping_settings.settings.product_fallback_policy` / `settings.order.product_fallback_policy`.
  - **UI Values**:
    1. `create_new` (إنشاء منتج جديد): Creates a new `product.product` in Odoo with name, SKU, price, and category.
    2. `skip_order` (إلغاء وتسجيل تخطي): Rejects and skips the order to avoid incomplete line items.
    3. `default_product` (تعيين منتج افتراضي): Uses a designated fallback product in Odoo (e.g. "Generic Product") while keeping the original item name in line description.
- **Field / Setting**: `orderDefaultProductId`
  - **Arabic**: المنتج الافتراضي في أودو
  - **Function**: Odoo `product.product` ID used when `orderProductFallbackPolicy === 'default_product'`.
  - **Data Source**: Odoo `product.product` live query (`getOdooProducts`).
  - **Common Misconfiguration**: Choosing `skip_order` in high-volume stores where products are added in the store before Odoo, leading to blocked order flows.

### 2.5 Default Values & Automation Settings
- **Field / Setting**: `orderWarehouseId` (Default Warehouse)
  - **Arabic**: المستودع الافتراضي
  - **Function**: Odoo `stock.warehouse` assigned to `warehouse_id` on `sale.order`.
  - **Data Source**: Odoo `stock.warehouse` (`getOdooWarehouses`).
  - **Sync Engine Impact**: Determines which warehouse reserves stock and generates delivery pickings. If empty, Odoo uses the company default warehouse.
- **Field / Setting**: `orderPricelistId` (Default Pricelist)
  - **Arabic**: قائمة الأسعار الافتراضية
  - **Function**: Odoo `product.pricelist` assigned to `pricelist_id` on `sale.order`.
  - **Data Source**: Odoo `product.pricelist` (`getOdooPricelists`).
- **Field / Setting**: `orderPaymentTermId` (Default Payment Terms)
  - **Arabic**: شروط الدفع الافتراضية
  - **Function**: Odoo `account.payment.term` assigned to `payment_term_id` on `sale.order`.
  - **Data Source**: Odoo `account.payment.term` (`getOdooPaymentTerms`).
- **Field / Setting**: `orderCompanyId` & `orderLinkCompany` (Default Company)
  - **Arabic**: الشركة الافتراضية وربط وتحديد الشركة بالسجل
  - **Function**: Sets `company_id` on `sale.order` in multi-company Odoo setups.
  - **Data Source**: Odoo `res.company` (`getOdooCompanies`).
  - **Sync Engine Impact**: Restricts visibility, accounting journals, and stock locations strictly to this company.
- **Field / Setting**: `orderAutoConfirm` & `orderAutoInvoice` & `orderPartialFulfillment`
  - **Arabic**: التأكيد الآلي، الفوترة الآلية، والمزامنة الجزئية
  - **Function**: Automated triggers on incoming orders.
  - **Sync Engine Impact**:
    - `orderAutoConfirm`: Triggers `sale.order.action_confirm` upon creation.
    - `orderAutoInvoice`: Automatically generates draft invoice.
    - `orderPartialFulfillment`: (Salla) Allows partial fulfillment and split shipments.

### 2.6 Multi-Currency & Base Currency Settings
- **Field / Setting**: `orderMultiCurrencyEnabled`
  - **Arabic**: تفعيل العملات المتعددة (Multi-Currency)
  - **Function**: Records orders in Odoo in the store's currency (e.g. AED, USD, KWD).
  - **Data Source**: `standard_mapping_settings.settings.multi_currency_enabled` / `settings.order.multi_currency_enabled`.
  - **UI Controls**: Toggle.
- **Field / Setting**: `orderBaseCurrencyId`
  - **Arabic**: العملة الأساسية البديلة (Fallback Currency)
  - **Function**: Fallback currency ID in Odoo (usually SAR).
  - **Sync Engine Impact**: Handled in `src/lib/odoo/order-currency-resolution.ts`. If the order arrives in a currency disabled or missing in Odoo, ErpLink converts line prices, shipping, and COD fees to the base currency using the exchange rate to prevent value inflation (e.g. converting 200 AED to ~204 SAR instead of mistakenly booking 200 SAR).

### 2.7 Payment Methods & Accounting Journals Mapping
- **Field / Setting**: `orderPaymentAutoSync`
  - **Arabic**: تسجيل المدفوعات تلقائياً في أودوو عند الدفع في المتجر
  - **Function**: Automatically generates an Inbound Payment (`account.payment`) in Odoo upon payment confirmation and reconciles it with the customer invoice.
  - **Data Source**: `standard_mapping_settings.settings.payment_auto_sync` / `settings.order.payment_auto_sync`.
- **Field / Setting**: `orderPaymentJournalMappings`
  - **Arabic**: ربط طرق الدفع بدفاتر اليومية (Journals)
  - **Function**: Multi-row table mapping store payment gateways (`zid_cod`, `credit_card`, `mada`, `apple_pay`, `tamara`, `tabby`, `stc_pay`, `bank_transfer`, `pos`) to corresponding Odoo Bank/Cash Journals (`account.journal`).
  - **Data Source**: Store payment methods API (`getZidPaymentMethods`, `getSallaPaymentMethods`) ↔ Odoo journals with type `bank` or `cash` (`getOdooJournals`).
  - **Sync Engine Impact**: Executed in `src/lib/odoo/order-payment.ts`. Creates `account.payment` linked to the mapped journal. If the invoice is already posted, it reconciles payment immediately; if the invoice is pending, payment awaits and reconciles upon invoice creation.
  - **Common Misconfiguration**: Mapping payment method to a General journal instead of a Bank/Cash journal, which causes Odoo XML-RPC error `Payment journal must be of type bank or cash`.

### 2.8 Multi-Warehouse Routing Rules
- **Field / Setting**: `storeWarehouseRules`
  - **Arabic**: توجيه المستودعات المتعددة
  - **Function**: Table routing orders to specific Odoo warehouses (`stock.warehouse`) based on the order's branch or location ID in Zid or Salla.
  - **Data Source**: Store branch/location API (`getZidLocations`, `getSallaLocations`) ↔ Odoo warehouses (`getOdooWarehouses`).
  - **Row Structure**: `{ rowKey, zid_location_id, odoo_warehouse_id }`.
  - **Sync Engine Impact**: In `order-values.ts`, the order's location is matched against these rules. If matched, `warehouse_id` is set to the mapped warehouse; if unmapped, it gracefully falls back to `orderWarehouseId` (default warehouse).

### 2.9 Analytic Distribution (Cost Center Allocation)
- **Field / Setting**: `orderAnalyticEnabled` & `orderAnalyticRules`
  - **Arabic**: التوزيع التحليلي (الحسابات التحليلية)
  - **Function**: Allocates sales order lines to Odoo analytic accounts (`account.analytic.account`) for management accounting, profitability analysis, and cost centers.
  - **Data Source**: `standard_mapping_settings.settings.order.analytic`: `{ enabled, rules }`.
  - **Condition Types**:
    1. `all` (جميع الطلبات - All orders): Always matches.
    2. `warehouse` (حسب المستودع - By warehouse): Matches order's location/branch.
    3. `payment` (حسب طريقة الدفع - By payment method): Matches normalized payment key.
  - **Sync Engine Impact**: Implemented in `src/lib/odoo/analytic-distribution.ts`:
    - In Odoo 17+: Injects into `sale.order.line.analytic_distribution` as JSON dictionary: `{ "<account_id>": <percentage> }`.
    - In Odoo <= 16: Falls back to `analytic_account_id` with single primary account.
    - All matching rules (e.g. one `all` rule + one `warehouse` rule) are combined.
    - Configured percentages are sent verbatim without forced normalization.

### 2.10 Value Added Tax (VAT) Mapping & Tax-Inclusive Price Extraction
- **Field / Setting**: `orderEnableVat`
  - **Arabic**: تفعيل احتساب ضريبة القيمة المضافة
  - **Function**: Enables tax application on order lines in Odoo based on destination country.
- **Field / Setting**: `orderVatCountryRules` / `orderVatSaudiTaxId` / `orderVatNonSaudiTaxId`
  - **Arabic**: جدول ضرائب أودو حسب دولة شحن الطلب
  - **Function**: Maps destination country codes (e.g. `SA`, `AE`, `KW`, `EG`, `OTHER`) to specific Odoo tax IDs (`account.tax`).
  - **Sync Engine Impact**: In `order-lines.ts`, shipping address ISO code is inspected. If shipping is Saudi Arabia (`SA`), Saudi tax is applied; if international, international/export tax is applied.
- **Field / Setting**: `orderPricesIncludeTax` (Tax-Inclusive Pricing)
  - **Arabic**: أسعار المتجر تشمل الضريبة (استخراج المبالغ قبل الضريبة لكافة البنود والخدمات)
  - **Function**: Calculates pre-tax unit price when store prices are tax-inclusive and Odoo tax configuration is tax-exclusive (`price / (1 + rate/100)`).
  - **Data Source**: `standard_mapping_settings.settings.order.prices_include_tax`.
  - **Scope**: Applied systematically to:
    1. Product lines (`price_unit`)
    2. Shipping & delivery fee lines
    3. Cash on Delivery (COD) service fees
    4. Fixed discount lines (negative amounts)
- **Field / Setting**: `orderCountryTaxRates` (Tax Rates by Destination Country)
  - **Arabic**: جدول نسب الضريبة حسب دولة الشحن وحماية مبيعات التصدير
  - **Function**: Configures the VAT percentage (e.g. SA = 15%, AE = 5%, EG = 14%) used for pre-tax division.
  - **Export Protection**: Any international destination not in this table defaults to 0% tax, ensuring full price is preserved in Odoo without deduction.

### 2.11 Shipping, Cash on Delivery (COD) & Discount Line Items
- **Field / Setting**: `orderAddShipping` & `orderShippingProductId`
  - **Arabic**: رسوم الشحن ومنتج الشحن في أودو
  - **Function**: Appends delivery charges as a dedicated line item on `sale.order`.
  - **Data Source**: Odoo service product (`product.product`).
- **Field / Setting**: `orderAddCod` & `orderCodProductId` & `orderCodAmount`
  - **Arabic**: إضافة رسوم الدفع عند الاستلام (COD) ومنتج COD والمبلغ الاحتياطي
  - **Function**: Adds COD collection fees as a dedicated line item on `sale.order`.
- **Field / Setting**: `orderAddDiscount` & `orderDiscountMode` & `orderDiscountProductId`
  - **Arabic**: إضافة الخصم وطريقة الخصم ومنتج الخصم
  - **Function**: Configures coupon and cart discount handling.
  - **Modes**:
    1. `percent` (نسبة مئوية): Directly applies discount to Odoo line item `discount` percentage field.
    2. `fixed` (قيمة ثابتة سالبة): Adds a dedicated negative line item with the configured discount product.

### 2.12 Store Returns Policy (Automated RMA & Refunds)
- **Field / Setting**: `orderReturnsMode`
  - **Arabic**: طريقة معالجة المرتجع في أودو
  - **Function**: Action taken in Odoo when an order is refunded/reversed in Zid or Salla.
  - **UI Options**:
    1. `nothing` (لا شيء): Ignore store returns.
    2. `negative_so` (إنشاء أمر بيع جديد بكميات سالبة): Creates a separate negative `sale.order`.
    3. `stock_return_credit_note` (مرتجع مخزون على نفس الطلب + إشعار دائن): Executes native `stock.return.picking` wizard and generates `account.move` Credit Note (`out_refund`).
- **Field / Setting**: `orderReturnsCreditNote` & `orderReturnsJournalId`
  - **Arabic**: إنشاء إشعار دائن (Credit Note) ومعرّف دفتر اليومية
  - **Function**: Automatically posts credit note in the specified journal.
- **Field / Setting**: `orderReturnsFallback`
  - **Arabic**: إذا لم يوجد الأمر الأصلي في أودو
  - **Options**: `skip` (Skip return) vs `negative_so` (Create standalone negative order).
- **Field / Setting**: `orderReturnsReasonType` & `orderReturnsReason`
  - **Arabic**: مصدر سبب المرتجع وسبب المرتجع المخصص
  - **Options**: `store_reason` (Use store reason automatically) vs `custom` (Mandatory custom text).

### 2.13 Live Custom Status Field in Odoo (`x_order_status`)
- **Field / Setting**: `orderUpdateCustomStatus` & `orderStatusCustomField`
  - **Arabic**: تحديث حالة طلب المتجر داخل أودو (حقل مخصص)
  - **Function**: Creates and updates a Selection field on Odoo `sale.order` (e.g. `x_zid_order_status`, `x_salla_order_status`).
  - **Automation**: Button "إنشاء الخانة في أودو الآن" invokes `createZidOrderStatusFieldInOdoo`:
    1. Inspects live store statuses (including sub-statuses via Zid StoreMeta API).
    2. Creates selection field on `sale.order` in `ir.model.fields`.
    3. Injects field into `sale.order` form view via xpath extension.
    4. Automatically updates this field on every order status webhook.

### 2.14 Order Status Lifecycle Mapping Table
- **Component**: `OrderSettingsTab` (Section 12)
- **Arabic**: جدول مواءمة وربط حالات الطلب
- **Function**: Maps each store order status to its exact lifecycle in Odoo:
  - **Store Statuses**:
    - Zid: `new`, `preparing`, `ready`, `indelivery`, `delivered`, `canceled`, `reversed`, `partially_reversed`, `reverse_in_progress`.
    - Salla: `under_review`, `confirmed`, `preparing`, `ready`, `shipped`, `in_transit`, `delivered`, `completed`, `canceled`, `refunded`, `partial`, `pending_payment`, `on_hold`.
    - Shopify: `pending`, `authorized`, `partially_paid`, `paid`, `partially_refunded`, `refunded`, `voided`.
  - **Target Odoo State**:
    - `draft` (مسودة - Quotation)
    - `sent` (تم إرسال العرض - Quotation Sent)
    - `sale` (طلب مؤكد - Sales Order via `action_confirm`)
    - `done` (مغلق - Locked Order via `action_done` / `action_lock`)
    - `cancel` (ملغي - Cancelled Order via `action_cancel`)
  - **Stock Picking Action**:
    - `''` (No Action)
    - `create` (Create picking only)
    - `validate` (Validate picking only)
    - `create_and_validate` (Create and validate delivery picking)
    - `cancel` (Cancel picking)
  - **Invoice Action**:
    - `''` (No Action)
    - `create` (Create draft invoice only)
    - `post` (Post invoice only via `action_post`)
    - `create_and_post` (Create and post invoice)
    - `cancel` (Cancel invoice)
  - **Enabled Toggle**: Allows excluding individual status webhooks from mutating Odoo.

---

## 3. Standard Mapping — Products (Comprehensive Audit)

The Products Mapping tab (`ProductSettingsTab.tsx`, 1,264 lines) governs catalog synchronization, variant architectures, pricing calculations, inventory authority, and Bills of Materials (BoM).

### 3.1 Product Type & Inventory Tracking
- **Field / Setting**: `productType` (Default Product Type)
  - **Arabic**: نوع المنتج الافتراضي في أودو
  - **Function**: Sets `detailed_type` (Odoo 15+) or `type` (Odoo <= 14) on `product.template`.
  - **Values from Odoo**: `consu` (استهلاكي - Consumable), `product` (مخزني - Storable Product), `service` (خدمة - Service).
  - **Sync Impact**: If set to `product`, Odoo tracks stock ledger movements.
- **Field / Setting**: `trackInventory` & `trackingMethod`
  - **Arabic**: تتبع المخزون وطريقة التتبع
  - **Function**: Enables stock tracking and sets `tracking` field in Odoo.
  - **Options**: `none` (بدون تتبع), `lot` (بالدفعات - By Lots), `serial` (بالرقم التسلسلي - By Unique Serial Number).

### 3.2 Default Company
- **Field / Setting**: `productCompanyId` & `productLinkCompany`
  - **Arabic**: الشركة الافتراضية وربط وتحديد الشركة بالسجل
  - **Function**: Sets `company_id` on `product.template`. Restricts product visibility and pricing to the selected legal entity.

### 3.3 Pricing Rules & Currency Adjustments
- **Field / Setting**: `markupPercent` (Markup/Discount %)
  - **Arabic**: نسبة الربح/الخصم %
  - **Function**: Applies a percentage modifier to product price during sync (`price * (1 + markup/100)`).
- **Field / Setting**: `costSource` (Cost Source)
  - **Arabic**: مصدر التكلفة
  - **Options**:
    - `none`: Don't update cost (Odoo owns cost).
    - `cost`: Sync store `cost` field to Odoo `standard_price`.
    - `price`: Use store `price` as Odoo cost.
- **Field / Setting**: `priceSource` (Price Source)
  - **Arabic**: مصدر السعر الأساسي
  - **Options**: `price` (Store regular price), `sale_price` (Store discounted sale price), `cost` (Store cost).
- **Field / Setting**: `rounding` & `decimalPlaces`
  - **Arabic**: طريقة التقريب وعدد الخانات العشرية
  - **Options**: `nearest` (لأقرب رقم صحيح), `ceil` (رفع لأعلى), `floor` (خفض لأسفل), none. `decimalPlaces` defaults to 2 (range 0–6).

### 3.4 Multilingual Names & Description Handling
- **Field / Setting**: `nameLanguage` & `descLanguage`
  - **Arabic**: لغة اسم المنتج ولغة وصف المنتج
  - **Options**: `ar` (العربية), `en` (الإنجليزية), `both` (اللغتين معاً).
- **Field / Setting**: `nameFallback`
  - **Arabic**: استخدام اللغة البديلة للاسم عند عدم توفرها
  - **Function**: If preferred language is empty in the store, automatically falls back to the other language.
- **Field / Setting**: `descFallback` & `descCustomText`
  - **Arabic**: الرجوع في الوصف والنص المخصص للوصف
  - **Options**: `none`, `name` (use product name), `custom` (use `descCustomText`), `empty`.

### 3.5 Product Variants Sync Mode (Architectural Choice)
- **Field / Setting**: `productVariantSyncMode`
  - **Arabic**: خيارات مزامنة المتغيرات (Variants)
  - **UI Options**:
    1. `AS_VARIANTS` (منتج رئيسي بمتغيرات): Creates a single `product.template` in Odoo and groups options under `product.attribute.line` generating linked `product.product` records.
    2. `AS_SEPARATE_PRODUCTS` (منتجات مستقلة منفصلة): Creates a standalone `product.template` for each variant option, appending the attribute value into the product name.
  - **Sync Impact**: Foundational data architecture setting. Governs how stock, barcoding, and sales orders handle product options.

### 3.6 Bundles & Bill of Materials (BoM / Kits)
- **Field / Setting**: `bomEnabled` & `bomType`
  - **Arabic**: تفعيل إنشاء قائمة المواد BoM ونوع قائمة المواد
  - **Function**: Automatically generates a Bill of Materials (`mrp.bom`) for bundled products.
  - **Types**:
    1. `phantom` (تجميع فوري - Kit / Phantom): Sold as a bundle; components are deducted directly from stock upon delivery without manufacturing orders.
    2. `normal` (تصنيع - Manufacture / Normal): Requires manufacturing orders (`mrp.production`).
  - **Validation**: Enforced by `assertBomCapability` in `src/lib/products/bom-capability.ts`. Verifies Odoo exposes `mrp.bom` with required fields (`product_tmpl_id`, `bom_line_ids`, `type`). If the Odoo database lacks the Manufacturing module, save is safely prevented with an explanatory message.

### 3.7 Category Sync & Default Tax Settings
- **Field / Setting**: `categorySyncMode`
  - **Arabic**: مزامنة التصنيفات
  - **Options**: `auto` (تلقائي), `skip` (تخطي), `map_existing` (ربط بالموجود).
- **Field / Setting**: `taxSyncMode` & `defaultTaxIds`
  - **Arabic**: طريقة مزامنة الضريبة والضرائب الافتراضية في أودو
  - **Options**: `auto_by_name` (تلقائي حسب الاسم والنسبة), `static_ids` (ضرائب ثابتة محددة من `defaultTaxIds`), `skip` (تخطي بدون ضريبة).

### 3.8 On Store Deletion Policy
- **Field / Setting**: `productOnDelete`
  - **Arabic**: إجراء الحذف في المتجر
  - **Options**: `nothing` (لا شيء), `delete` (حذف المنتج من أودو), `archive` (أرشفة المنتج `active = false`), `delete_or_archive` (محاولة الحذف فإن فشلت لوجود قيود مبيعات يتم الأرشفة).

### 3.9 Bi-Directional Inventory Sync (Odoo ➔ Store)
- **Field / Setting**: `invSyncEnabled` & `invSyncMode`
  - **Arabic**: مزامنة المخزون (من أودو إلى المتجر) ونوع الرصيد
  - **Function**: Odoo acts as source of truth for stock quantities. Changes in Odoo automatically push to Zid or Salla.
  - **Balance Modes**:
    1. `actual` (الرصيد الفعلي - On Hand / `qty_available`).
    2. `forecast` (الرصيد المتوقع - Forecasted / `virtual_available`).
- **Odoo Stock Webhook Integration**:
  - Buttons "إنشاء Webhook" / "حذف" automatically provision or clean up Base Automation (`base.automation`) in Odoo monitoring stock level changes and firing back to `/api/webhooks/odoo/stock`.
- **Location Pairing**:
  - Multi-row table: maps each store branch location (`source_location_id`) to an exact Odoo physical stock location (`odoo_location_id` on `stock.location`).

### 3.10 Product Matching Field & Operations
- **Field / Setting**: `productMatchZidField` ↔ `productMatchOdooField`
  - **Arabic**: حقل المطابقة والمزامنة
  - **Options**: Store `sku`, `barcode`, `id` ↔ Odoo `default_code`, `barcode`, `id`, `x_zid_product_id`.
- **Field / Setting**: `productDisabled` & `productEnabledActions` (`create`, `update`, `delete`).
- **Manual & Auto Mapping Tool** (`ProductMappingDialog`):
  - Allows bulk manual linking and contains the AI/algorithmic Auto-Match tool (`autoMatchAndLinkProducts`), matching thousands of items by SKU or Barcode in seconds and updating Odoo records.

---

## 4. Standard Mapping — Customers (Comprehensive Audit)

The Customers Mapping tab (`CustomerSettingsTab.tsx`, 421 lines) manages CRM synchronization, partner creation, and ledger receivables.

### 4.1 Default Customer Type
- **Field / Setting**: `customerDefaultType`
  - **Arabic**: نوع العميل الافتراضي (طبيعة حساب العميل)
  - **Function**: Sets `is_company` on `res.partner`.
  - **Options**:
    - `auto` (تلقائي): Detects company vs individual automatically based on presence of commercial registration, tax number, or company name fields.
    - `person` (فرد - Individual): Sets `is_company: false`.
    - `company` (شركة - Company): Sets `is_company: true`.

### 4.2 Default Accounting Accounts (Ledger Integration)
- **Field / Setting**: `receivableAccountId` (Account Receivable)
  - **Arabic**: حساب المدينين الافتراضي
  - **Function**: Sets `property_account_receivable_id` on `res.partner`.
  - **Data Source**: Odoo chart of accounts filtered by `account_type = 'asset_receivable'` (`getOdooAccountsByType`).
- **Field / Setting**: `payableAccountId` (Account Payable)
  - **Arabic**: حساب الدائنين الافتراضي
  - **Function**: Sets `property_account_payable_id` on `res.partner`.
  - **Data Source**: Odoo chart of accounts filtered by `account_type = 'liability_payable'`.
  - **Common Misconfiguration**: Leaving accounts blank in multi-company databases where Odoo does not have a company fallback account, causing partner creation to fail.

### 4.3 Default Company & On Deletion Policy
- **Field / Setting**: `customerCompanyId` & `customerLinkCompany`: Sets `company_id` on `res.partner`.
- **Field / Setting**: `customerOnDelete`: `nothing`, `delete`, `archive`, `delete_or_archive`.

### 4.4 Customer Matching Field & Validation Guard
- **Field / Setting**: `customerMatchZidField` ↔ `customerMatchOdooField`
  - **Arabic**: حقل المطابقة والمزامنة للعميل
  - **Options**: Store `telephone`/`mobile`/`email`/`id` ↔ Odoo `mobile`/`phone`/`email`/`id`.
  - **Strict Validation Guard**: `validateCustomerMatchSettings` in `src/lib/customers/matching-settings.ts`:
    - Ensures both source and target match fields are selected together.
    - Probes Odoo live metadata to verify the target field actually exists in the connected database and is a writable scalar (`char`, `text`, `integer`, `float`, `selection`).
    - Prevents picking readonly computed fields or fields removed in newer Odoo versions (e.g. `mobile` vs `phone`).

### 4.5 Sync Operations & Rules
- `customerDisabled` (boolean) & `customerEnabledActions` (`create`, `update`, `delete`).

---

## 5. Standard Mapping — Categories (Comprehensive Audit)

The Categories Mapping tab (`CategorySettingsTab.tsx`, 392 lines) configures product taxonomy, cost valuation models, and hierarchy.

### 5.1 Costing Method & Inventory Valuation
- **Field / Setting**: `costMethod` (Costing Method)
  - **Arabic**: طريقة حساب التكلفة
  - **Function**: Sets `property_cost_method` on `product.category`.
  - **Values from Odoo**: `standard` (Standard Price), `fifo` (First In First Out), `average` (Average Cost / AVCO).
- **Field / Setting**: `inventoryValuation` (Inventory Valuation)
  - **Arabic**: تقييم المخزون
  - **Function**: Sets `property_valuation` on `product.category`.
  - **Values from Odoo**: `manual_periodic` (يدوي / دوري), `real_time` (آلي / دائم - Automated).
  - **Accounting Impact**: If `real_time` is selected, Odoo automatically creates accounting entries on stock receipts and deliveries.
  - **Validation**: `saveStandardMappingSettings` runs `prepareCategoryValues`, verifying that the costing method and inventory valuation values are accepted by the connected Odoo instance.

### 5.2 Category Matching, Company & Deletion Policy
- **Field / Setting**: `categoryCompanyId` & `categoryLinkCompany`: Sets company context.
- **Field / Setting**: `onDeleteAction`: `nothing`, `delete`, `archive`, `delete_or_archive`.
- **Field / Setting**: `matchZidField` ↔ `matchOdooField`:
  - Enforced by server action: must select both fields or neither. Target field is validated via `categoryFields` against `product.category`.
- **Field / Setting**: `disabled` & `enabledActions` (`create`, `update`, `delete`).
- **Manual Category Mapping** (`CategoryMappingDialog`):
  - Accessible via button "ربط يدوي للتصنيفات" or route `/app/mapping-center/categories`.
  - Allows mapping source category to Odoo category, specifying Odoo Parent Category (`parent_id`), Income Account (`income_account_id`), Expense Account (`expense_account_id`), and Stock Valuation accounts.

---

## 6. Custom Fields & Field Mappings (Custom Mapping Engine)

### 6.1 Creating Custom Fields in ERP (`AddCustomFieldForm.tsx` & `custom-fields.ts`)
- **Route**: `/app/mapping-center/add-field` and `/app/mapping-center/add-field/[id]`
- **Function**: Allows merchants and administrators to add custom fields to Odoo or ERPNext directly from ErpLink without entering developer mode in ERP.
- **Form Controls & Inputs**:
  - `fieldLabel`: Display name (Arabic/English).
  - `technicalName`: Must start with `x_` (validated on client and server via `validateCustomFieldInput`).
  - `odooModel`: Target model (e.g. `sale.order`, `product.template`, `res.partner`, `stock.picking`).
  - `fieldType`: `char`, `text`, `integer`, `float`, `boolean`, `date`, `datetime`, `many2one`, `selection`.
  - `relation`: (for `many2one`) Related model (e.g. `res.partner`).
  - `selectionOptions`: (for `selection`) Key-label pairs.
  - `views`: Where to inject (`list`, `form`, `both`).
  - `readonly`, `required`, `copy`, `help` text.
  - `groupIds`: Odoo security access groups.
- **Odoo View Injection Mechanism**:
  - Uses `injectFieldIntoViews` executing multi-stage xpath queries against `ir.ui.view`:
    1. Tries `<xpath expr="//sheet" position="inside">`
    2. Tries `<xpath expr="//group" position="inside">`
    3. Tries `<xpath expr="//notebook" position="before">`
    4. Tries `<xpath expr="//form" position="inside">`
  - Creates extension view (`mode = 'extension'`, `priority = 99`) linked to the base view (`inherit_id`).

### 6.2 Custom Field Mappings (`FieldMappingForm.tsx` & `field-mappings.ts`)
- **Route**: `/app/mapping-center/custom` & `/app/mapping-center/custom/[id]`
- **Form Controls**:
  - `name`: Mapping identifier.
  - `platform`: `zid`, `salla`, `shopify`.
  - `storeKey`: Multi-store selector.
  - `action`: Store trigger event (15 Zid events, 78 Salla events, Shopify webhooks).
  - `odooModel`: Target ERP model.
  - `odooOperation`: `create`, `update`, `delete`.
  - `syncDirection`: `store_to_erp` (Store ➔ ERP), `erp_to_store` (ERP ➔ Store), or both.
  - `odooMatchField` & `zidMatchField`: Record identifier for updates. Special token `__odoo_record_id` binds directly to `entity_links` table.
  - `odooFallbackPolicy`: `none`, `create` (create record if not found), `block` (halt sync if not found).
  - **Line Mappings**:
    - `erpField`: Target model field.
    - `zidField`: JSON path in webhook payload.
    - `staticValue`: Constant value override.
    - `policy` (for relations): `create`, `default`, `block`, `none`.
    - `fuzzyMatchMappings` & `matchOperator` (`AND` / `OR`).
    - `inlineSubMapping`: Sub-table mapping for lines (e.g. `order_line`).
- **Bi-Directional Automated Action Registration in Odoo**:
  - When `syncDirection` includes `erp_to_store`, `saveFieldMapping` automatically calls `registerOdooWebhook`:
    - Creates `base.automation` (or `ir.actions.server`) in Odoo.
    - Generates a scoped webhook secret derived from `ENCRYPTION_KEY` using HKDF.
    - Odoo changes immediately push back to ErpLink!

---

## 7. Static Mappings (7 Dedicated Allowlisted Tables)

Managed via `src/app/actions/static-mappings.ts`. All 7 tables enforce strict server-side allowlisting (`ALLOWED_TABLES`) and workspace/platform scoping:
1. **`payment_method_mappings`**: Maps store payment methods (`payment_method_id` / code) to ERP payment methods and journals.
2. **`shipping_method_mappings`**: Maps shipping couriers (e.g. Aramex, SMSA, DHL) to Odoo delivery carriers (`delivery.carrier`).
3. **`warehouse_mappings`**: Maps store inventory branches to ERP warehouses/locations.
4. **`currency_mappings`**: Maps international ISO currencies to ERP currency records with fixed exchange rates.
5. **`tax_mappings`**: Maps store tax classes to ERP tax rules (`account.tax`).
6. **`payment_term_mappings`**: Maps store payment conditions to Odoo payment terms.
7. **`pricelist_mappings`**: Maps customer groups / customer tiers to Odoo pricelists.

---

## 8. Comprehensive Misconfigurations & Troubleshooting Matrix

| Setting / Feature | Misconfiguration | Technical Root Cause | Sync Engine Impact | Resolution |
| :--- | :--- | :--- | :--- | :--- |
| **Order Status Actions** | Confirmed orders attempting to lock in Odoo 17+ | Odoo 17 replaced `action_done` with `action_lock` | RPC method not found if version-blind | ErpLink detects Odoo major version (`>= 17 ? 'action_lock' : 'action_done'`) |
| **Order Status Actions** | Cancelling orders with open stock pickings | Odoo blocks `action_cancel` if picking is validated | Order cancellation fails in Odoo | ErpLink cancels open pickings first and sets `{ context: { disable_cancel_warning: true } }` |
| **Customer Fallback** | Selecting `default_customer` without choosing a customer | `default_customer_id` is empty/null | `order-values.ts` throws: `Configured default order customer is missing or invalid` | Select a valid Odoo partner from the customer dropdown |
| **Customer Match Field** | Selecting `mobile` when Odoo 19+ only has `phone` | Odoo version removed `mobile` field | RPC lookup fails with column does not exist | `validateCustomerMatchSettings` inspects Odoo fields live before saving |
| **Product BoM** | Enabling BoM when Manufacturing module is uninstalled | `mrp.bom` model does not exist in Odoo | Sync throws exception during bundle creation | `assertBomCapability` checks `mrp.bom` model existence during save |
| **Prices Include Tax** | Enabling tax inclusion without configuring destination tax rates | Missing country rule for international shipping | International export orders divided by 15% erroneously | Export Protection rule defaults unlisted countries to 0% tax rate |
| **VAT Mapping** | Setting Saudi Tax to a Tax-Included tax when Prices Include Tax is on | Double tax deduction occurs | Order line net price is under-calculated | Use Tax-Excluded taxes in Odoo when enabling "Prices Include Tax" in ErpLink |
| **Payment Journals** | Mapping COD / Tamara to a General journal | Odoo payment registration requires `bank` or `cash` | Inbound payment creation fails with `Payment journal must be of type bank or cash` | Select an Odoo journal configured with Type = Bank or Cash |
| **Multi-Store Mapping** | Workspace with 2 stores sharing 1 platform default | Querying without store_id returns first row | Store A settings accidentally applied to Store B | `getEffectiveStandardMappingSettings` resolves per-store `merchant_id` first |
| **Custom Field `x_`** | Typing technical name without `x_` prefix | Odoo requires `x_` on all user-created fields in `ir.model.fields` | Odoo rejects field creation | Form and Server Action automatically validate and enforce `x_` prefix |
| **Multi-Currency** | Order placed in USD/AED with currency inactive in Odoo | Odoo rejects transactions in inactive currencies | Order creation fails | Currency resolution engine auto-converts lines to base currency (`SAR`) using rate |
| **Category Costing** | Choosing Automated Valuation without setting valuation accounts | Odoo requires stock input/output/valuation accounts | Product creation fails when assigning category | Map stock accounts in Manual Category Mapping or Odoo category form |

---

## 9. Verification & Codebase Integrity Check

Every finding in this audit has been verified directly against real code and unit tests:
- `tests/unit/mapping-settings.test.ts`: Verified store key normalization, per-store precedence, and multi-tenant scoping.
- `tests/unit/static-mappings-allowlist.test.ts`: Verified 7-table allowlist and security boundary against arbitrary table writes.
- `tests/unit/order-status-actions.test.ts`: Verified picking actions (`create`, `validate`, `create_and_validate`, `cancel`) and invoice actions (`create`, `post`, `create_and_post`, `cancel`).
- `tests/unit/analytic-distribution.test.ts`: Verified multi-rule evaluation (`all`, `warehouse`, `payment`), percentage preservation, and normalization.
- `tests/unit/order-tax-inclusive-sync.test.ts`: Verified pre-tax net extraction across products, shipping, COD, and discount lines with export protection.
- `tests/unit/return-settings.test.ts` & `return-wiring.test.ts`: Verified return detection, negative SO, and Credit Note generation.
- `tests/unit/customer-standard-mapping-save.test.ts`: Verified customer match field validation.

---
*Generated by Agent 5 (Mapping Center Specialist) for the ERP Link Swarm Discovery findings.*
