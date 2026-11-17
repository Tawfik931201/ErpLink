# Orders Standard Mapping — exhaustive E2E QA matrix

Work tracker: https://github.com/Tawfik931201/ErpLink/issues/15

**Do not mark a case PASS because `sync_logs.status=success` or Odoo has a sale.order.** Capture the saved settings in Supabase before each test, then record the exact source payload and all persisted Odoo sale.order and sale.order.line values, including taxes and totals. For invoices/payments/pickings, compare those models too. After each case, restore the original settings (unless a purposeful fix is being retained), and verify DB readback. Use distinct `ERPTEST-` identifiers and no production customers.

## Mandatory assertions for EVERY newly created or updated Order

- Zid order ID ↔ Odoo `client_order_ref`, exactly one `sale.order` and one distinct `odoo_entity_links` + effect, correct workspace/store/ERP generation.
- Correct matched customer (individual/business), invoice/shipping partners, company, currency, pricelist, warehouse as configured. Wrong customer match = FAIL even if all totals align.
- Each Zid product SKU/variant maps to correct Odoo `product_id`; quantity, unit charged price, explicit discount, tax_ids, subtotal, total, and names exactly reflect saved field/standard mapping settings. Invalid fallback = FAIL.
- Expected order amounts: subtotal, discounts, shipping, COD, inclusive/exclusive VAT, `amount_untaxed`, `amount_tax`, `amount_total`; **explicitly account for settings that disable extra charges**. Report expected Zid/Odoo total differences due to disabled mapping rather than calling parity PASS.
- Correct workflow transition from configured `order_status_mappings`; `sale.order.state` and mapped invoice, payment, picking actions. Status log success alone is insufficient.
- Queue settled without duplicate ERP writes, partial result masked as success, `outcome_unknown`, stuck lease, or blocked later status events.
- Test original Odoo versions 14–20 using supported field aliases/action semantics, not only whatever version is connected today.

## Matrix (each row requires settings mutation + DB readback + unique real Order + Odoo verification)

| ID | Setting / profile to mutate | Required checks |
|----|-----------------------------|----------------|
| OM-01 | `enabled_actions` create ON/OFF | ON creates; OFF no creation and explicit skip |
| OM-02 | `enabled_actions` update ON/OFF | ON changes mapped fields; OFF does not mutate |
| OM-03 | `match_zid_field` / `match_odoo_field` | id/client_order_ref vs alternate legitimate mapped field; no cross-order matches |
| OM-04 | `auto_confirm` false/true | draft vs confirmed sale; obey Odoo state transitions |
| OM-05 | `auto_invoice` false/true | none vs appropriate invoice; no duplicate invoice on retry |
| OM-06 | Configured company | correct `company_id`, correct fiscal/pricelist constraints |
| OM-07 | Customer matching individual/business | exact partner, no company/person cross-link |
| OM-08 | Warehouse mapping default/alternate | correct stock location/picking with available actual test stock |
| OM-09 | `productFallbackPolicy` existing/missing | correct matched product, explicit fallback/skip policy |
| OM-10 | `defaultProductId` fallback | missing SKU uses only configured fallback |
| OM-11 | `addShippingAsLine` false/true | zero/add shipping line as configured; explicit expected total |
| OM-12 | `shippingProductId` valid/invalid | exact product, no duplicate or silent missing charge |
| OM-13 | `shippingProductSku` valid/unmatched | SKU matching and error handling |
| OM-14 | Shipping fee 0/nonzero/15/multiple destinations | correct amount and zero-cost behavior |
| OM-15 | `enableVat` false/true | explicit zero tax vs configured VAT |
| OM-16 | `vatSaudiTaxId` | Saudi proper tax ID and tax total |
| OM-17 | `vatNonSaudiTaxId` / country rules | export/foreign fiscal positions |
| OM-18 | `pricesIncludeTax` false/true | price division only when configured, rounded correctly |
| OM-19 | `taxRatePercent` 0/5/15 | expected inclusive price; total/tax rounding |
| OM-20 | `taxRatesByCountry` set/empty | SA/EG/AE/export matches expected tax rule |
| OM-21 | Product explicit 0% tax with Odoo default 15% | must not inherit 15% |
| OM-22 | `addDiscountAsLine` false/true | preserve actual charge; fixed negative line only when requested |
| OM-23 | `discountMode` percent/fixed | exact unit/list price and discount percentage or negative line, never double-discount |
| OM-24 | `discountProductId` / `discountProductSku` | configured Odoo discount product, tax cleared when VAT off |
| OM-25 | Item-level sale_price != catalog/net_price | actual billed price vs explicit discount representation |
| OM-26 | Coupon and order-level discount | item+order discount interaction; no double application |
| OM-27 | 100% discount / zero final amount | 0 totals, no false fallback pricing |
| OM-28 | `addCodAsLine` false/true | only genuine COD payments add fee |
| OM-29 | `codProductId` / `codProductSku` | correct product and no Odoo default VAT leak |
| OM-30 | `codAmount` 0/nonzero/tax-inclusive | fee amounts and taxes exact |
| OM-31 | Mixed VAT on product/shipping/discount/COD | line-by-line summed totals; no product-default VAT leak |
| OM-32 | Multiline, quantity >1, variant, bundle | correct component qty and no duplicated parent lines |
| OM-33 | Foreign currency vs Odoo company currency | explicit conversion and correct currency fields |
| OM-34 | Status mapping new/preparing/ready/delivered | Odoo transition + no illegal state downgrade |
| OM-35 | Status mapping cancelled/returned | cancel/return action and stock/invoice side effects |
| OM-36 | Custom invoice_action create/post | correct account.move and idempotency |
| OM-37 | Payment method mapped/unmapped | journal/method, payment registered only when enabled |
| OM-38 | Partial/full payment, COD, transfer | residual and payment state correct |
| OM-39 | Partial/full refund, return/credit note | reconcile amount and invoice/stock effects |
| OM-40 | Shipping partial fulfillment and backorder | only expected picking/stock movement |
| OM-41 | Digital/downloadable/voucher | service behavior without stock picking |
| OM-42 | Analytic distribution/account, if configured | correct Odoo-version-dependent header/line fields |
| OM-43 | Concurrent 20 create + 20 update under deployment | exactly one linked Odoo order, no cross-order writes |
| OM-44 | Delivery duplicate, out-of-order update-before-create | correct settled final state, no dropped event |
| OM-45 | Unknown ERP effect + later same execution_key | controlled reconciliation with evidence; never blind replay |
| OM-46 | Hostinger rolling deploy while queue busy | worker build/config generation consistent; no old-config financial writes |
| OM-47 | Missing product/stock/shipping method in Zid | classify as source data blocked; do not mark app FAIL or PASS |
| OM-48 | Settings cache invalidation after Supabase mutation | next order uses new saved settings, not stale previous values |

## Per-case evidence format

```
CASE: OM-xx
ZID_ORDER_ID:
ODOO_ORDER_ID:
GIT_SHA_AND_DEPLOY_SHA:
ODOO_VERSION:
WORKSPACE_AND_STORE:
STANDARD_MAPPING_SETTINGS_BEFORE:
SETTINGS_CHANGED_AND_CONFIRMED_READBACK:
CUSTOM_FIELD_MAPPING_AND_STATUS_MAPPING_SNAPSHOT:
SOURCE_LINES_PAYMENT_SHIPPING_TAX:
EXPECTED_ODOO_HEADER_AND_LINES:
ACTUAL_ODOO_HEADER_AND_LINES:
INVOICE_PAYMENT_PICKING_CHECKS:
QUEUE_INBOX_AND_ERP_EFFECTS:
RESULT: PASS | FAIL | BLOCKED
FAILURE_ROOT_CAUSE:
FIX_COMMIT_AND_FRESH_RETEST:
SETTINGS_RESTORED_AND_CONFIRMED:
```

Keep this matrix and GitHub issue updated after each session. Never report 10/10 until all applicable cases pass on a fully deployed tested main SHA and the queue is reconciled.
