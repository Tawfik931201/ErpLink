# Orders live Standard Mapping audit — 2026-11-06

## Scope and identity

Fourth independent agent reviewed the live test started by the coordinator. Zid store `3172448` / merchant `3236165`, workspace `b0bee63a-db5f-4faa-ad23-ee5f9f3c79ce`, Supabase project `bnzkmoorrvtellesgvbq`, ERP connection `f69315eb-5cf7-4653-9f55-d44f8bcc9dff`, Odoo `https://edu-course3.odoo.com`, database `edu-course3`, version 19. The per-store Orders settings take precedence over platform defaults. No settings, schema, code, existing customer records, payment collections, actual shipping services or posted accounting entries were changed by this agent.

## Live results

- QA Zid order `501806043`, created 17:42:19 UTC, reference `ERPLINK-QA-20261106`, one QA product, QA customer `501138932`, COD pending, total SAR143.45.
- Natural webhook created Odoo SO `125`, name `S00126`, customer `33`. One SO matches `client_order_ref=501806043`, so the subsequent update did not duplicate it.
- Creation success log `8c45fe1a-be7d-4d8a-854e-aa3a1865564a`, 17:42:56 UTC. State was draft, status custom field new, no initial invoices/pickings: consistent with the saved per-status new rule despite legacy auto_confirm/auto_invoice=true JSON values.
- Coordinator moved the QA order to ready at 17:44:06 UTC. Success log `5a558d1e-3044-4f5e-913a-a06205a06e80`, 17:44:52 UTC. Actual Odoo readback: SO sale; `x_zid_order_status=ready`; picking `83` / `WH/OUT/00042`, assigned; draft customer invoice `85`, total143.45, not_paid. No `account.payment` exists for QA partner33.
- An early read while the worker was processing showed empty invoice_ids. A later authoritative read found invoice85. Do not infer failure from a mid-execution snapshot.
- Hostinger observed an XML-RPC serialization exception from the invoice wizard (`allow_none=False`), but the actual invoice was created. The implementation rereads invoice_ids after ambiguous responses and recovered without creating a second invoice. One invoice by origin S00126.
- This agent cancelled the same QA Zid order at 17:46:25 UTC, using preview_change then its exact plan_id, to prevent it remaining ready for fulfillment. Final cancellation readback is appended below.

## Exact line assertions

| Odoo line | Meaning | Product | Qty | Unit excluding tax | Total including tax | Tax IDs | Analytic distribution |
|---|---|---:|---:|---:|---:|---|---|
|515|QA product|57|1|107.35|123.45|[5]|2:100, 6:100|
|516|Shipping|1|1|13.04|15.00|[5]|2:100, 6:100|
|517|COD fee|3|1|4.35|5.00|[5]|2:100, 6:100|

SO amount_total143.45 and tax18.71. Company1, warehouse1, currency151 SAR, default pricelist1. Invoice lines455–457 preserve the same products, quantities, unit amounts, tax IDs and analytic percentages. The warehouse rule account2 plus all rule account6 are both included at100 each, without normalization, exactly as configured.

## Settings inventory and coverage

Inventory comes from the live per-store settings and `standard-components/order-settings-tab.tsx` props / settings save payload in `standard-mapping-client.tsx`.

| Setting group | Current settings | Evidence / limit |
|---|---|---|
|Enable/actions|disabled=false; create/update/cancel/deliver|Create and ready update observed; cancel test initiated. Disable gate and deliver were not toggled/tested.|
|Matching|id→client_order_ref|SO125 reused for ready update; exactly one matching SO. Alternative source/ERP fields not changed.|
|Company|link_company=true, company_id1|SO company1 confirmed. Other companies/default-unlinked behavior not exercised.|
|Customer fallback|create_new, default customer null|Existing QA partner33 reused. Missing customer create_new/default_customer/skip_order branches not exercised.|
|Product fallback|create_new, default product null|Existing QA variant57 matched by SKU. Missing product create_new/default_product/skip_order branches not exercised.|
|Defaults|warehouse1, pricelist/payment term null|warehouse1, Odoo default pricelist1, SAR151 observed. Nondefault pricelist/payment terms not exercised.|
|Warehouse rules|Default location→1; Riyadh location→2|Default→1 exercised. Location2 not exercised.|
|Currency|multi_currency=true, base151 SAR|SAR preserved. Conversion, rates, foreign amounts not exercised.|
|VAT|enabled, SA5, OTHER17, country rules|SA tax5 applied to product+shipping+COD. Non-SA/custom country rules not exercised.|
|Tax-inclusive pricing|true,15%; SA15% country rate|107.35+13.04+4.35 base and18.71 VAT reproduce source143.45. Alternative rates/exclusive mode not changed.|
|Shipping|enabled, product1, SKU null|Shipping15 becomes one tax-adjusted line product1. Zero shipping/no line branch not exercised.|
|COD|enabled, product3, amount null, SKU null|Actual fee5 becomes product3 line, pending payment stays unpaid. Fixed override/non-COD branch not exercised.|
|Discount|enabled, percent; no product ID|No coupon/discount in this test, so fixed/percentage/coupon calculation not exercised.|
|Analytics|enabled; all6:100; default warehouse2:100; Riyadh1:100|All+default rules appear together unchanged on SO and invoice. Payment condition and other warehouse not exercised.|
|Custom status|enabled, x_zid_order_status|new→ready observed. Cancellation readback below. Field creation/other custom statuses not exercised.|
|Status native workflow|new draft; ready sale, picking=create, invoice=create|Both exercised. Ready created assigned picking and draft invoice; no delivery or invoice posting performed.|
|Status alternatives|preparing sale+validate+invoice create; delivered sale+validate+post; returns rules; cancelled cancel|Preparing/delivered/return statuses not executed because they validate inventory or post accounting; cancel tested for cleanup. Configured empty invoice/picking actions are significant.|
|Payment sync|enabled; zid_cod→journal14|No payment created for pending COD, as expected. Paid, reconciliation and journal override not exercised.|
|Returns|stock_return_credit_note; credit note true journal9; missing→negative_so; store reason|Not exercised. No credit notes/negative SO or stock returns intentionally created.|
|Partial fulfillment|true in persisted settings|No partial delivery performed.|
|Legacy auto flags|auto_confirm=true, auto_invoice=true persisted|Per-status actions determine observed behavior; these flags were not toggled and are not evidence of automatic invoicing new orders.|

## Findings and limits

1. Live DB `order_status_mappings` lacks invoice_action and picking_action, matching an unapplied migration `20261029_order_status_invoice_picking_actions.sql`. The legacy JSON fallback actually worked for ready in this environment. This remains deployment/schema debt, not a demonstrated ready-flow failure.
2. Invoice wizard can return an XML-RPC error despite completing the remote write on Odoo19. Readback recovered and avoided duplicate invoices in this case; the error must not prompt blind retry.
3. A successful webhook receipt/queued job is not sufficient evidence; actual SO, line, picking and invoice data were read separately.
4. All configurable groups were inventoried. Only current-setting paths represented by this QA order were executed. Alternative settings, paid flows, foreign currency, partial delivery and returns remain unverified live. No claim of complete combinatorial setting coverage or Odoo14–18 live compatibility is made.
5. No code change or application gate run belongs to this agent's task. Pre-existing modified order-payment/action-results files and their tests were untouched.

## Final cancellation readback

Natural cancellation update succeeded: sync log `1d4c9990-876e-4018-8ab7-ef396e0d53c8`, 17:46:53 UTC, order.status.update, SO125. Actual readback: SO125 state=cancel, custom status=cancelled; picking83 state=cancel; invoice85 state=cancel, payment_state=not_paid, total143.45. Thus cancellation also cancelled the draft invoice despite the per-status invoice_action/picking_action being blank. This is the existing native cancellation behavior, distinct from an explicit invoice or picking action. The QA order is no longer ready for fulfillment; no posted invoice, payment or completed picking remains.
