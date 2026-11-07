# Live product audit — 2026-11-06

Target: Zid store 3172448, merchant 3236165, workspace b0bee63a-db5f-4faa-ad23-ee5f9f3c79ce. ERP f69315eb-5cf7-4653-9f55-d44f8bcc9dff, edu-course3, Odoo 19. Tools: Zid MCP for writes/readback, Supabase MCP for receipt/queue/logs, local read-only XML-RPC helper for exact ERP readback. No settings or source changes.

## Records

| QA SKU | Zid | Odoo | Result |
|---|---|---|---|
| ERPLINK-QA-20261106-P01 | a1db5d4e-6af9-4e01-a072-b753f386af7b | template39 / variant57 | Create passed; publish/update failed |
| ERPLINK-QA-20261106-B01 | 136bd394-7be5-4fef-a6a3-0350ad88bf91 | partial template40 / variant58 | BoM failed: mrp.bom absent |
| ERPLINK-QA-20261106-V01 | 289eba90-ed40-4e19-b907-f518f27c9fb6 | template41 | Variants passed |
| ERPLINK-QA-20261106-V01-20 | ac96ca90-fc74-465f-9e53-ca848dc74ab7 | variant61 | Price100, cost50, attribute value28 |
| ERPLINK-QA-20261106-V01-30 | 6552bcfc-a801-44f9-8600-d40f496c7996 | variant60 | Price110, cost50, attribute value27 |

All QA products were created hidden. P01 was temporarily published for the parent agent's order and returned to hidden at 17:43 UTC. No test records were deleted. Initial P01 stock3 was added to the default Zid location; order reduced it to2. ERP qty_available remained0, respecting configured ERP stock authority.

## Current-settings coverage

| Setting | Saved effective per-store value | Live evidence / limit |
|---|---|---|
| Enabled operations | create/update; disabled=false | Create succeeds; publish/update exposes model-ID bug |
| Matching | sku → default_code | Exact SKU readback; no duplicate P01; update still fails after finding variant |
| Product type/inventory tracking | consu, track=true, tracking=none | P01 Odoo consu, is_storable=true, tracking=none |
| Price/cost | source=price, cost_source=cost, markup0, rounding blank, decimals2 | P01 123.45 / 67.89; B01 246.90 /135.78; variant prices100/110 |
| Name language/fallback | ar / true | Exact Arabic names on P01/B01/V01; alternate-language fallback not exercised |
| Description | ar, fallback=name | P01 description_sale exact; empty B01 description_sale became Arabic product name |
| Tax | static_ids [5] | P01/B01 taxes_id [5] |
| Company | null, link=true | P01 company_id=false; selected-company contexts not exercised |
| Variants | AS_VARIANTS | Two real variants under template41, independent SKU and expected price100/110 |
| BoM | enabled, normal | Fails because target lacks mrp.bom; product template40 remains partially created |
| Inventory outbound | enabled, actual | Incoming Zid3 did not overwrite ERP0; actual outbound adjustment not performed |
| Category | auto | Blocked by category schema failure found by category agent; products had no categories |
| UoM | auto_create=true | No new custom UoM in source; not exercised |
| Images | all | Source review only: UI promises all, code writes primary image_1920; no full product.image gallery synchronization |
| Delete | archive; delete operation not enabled | Not exercised (kept configured operations unchanged) |

Alternative saved values (markup/rounding, language, price source, stock mode, company, tax mode, variant mode, BoM type, delete mode, disable/allowed-operation changes) were inventoried in product-settings-tab.tsx and save handler but were not switched globally. No claim of exhaustive combinatorial live coverage.

## Failures and durable evidence

1. Product update/publish resolves a product.product ID and then writes product.template with that ID. P01 template39 has variant57. Failed sync log91cda841-83d9-4f40-a5ab-8aaf6611eb4b at17:42:53 UTC reports product.template(57) missing. Source sync-engine.ts8338–8345 assigns existingId=variantId and changes only deleteModel; update branch8414 onward calls writePreparedRecord(existingId), whose closure8198 writes odooModel. If coincident template57 exists, this risks writing another template. Queue492a89aa-6170-4fdd-a25f-16f26bdfee5e retains retry1/5, outcome_unknown=false.
2. BoM enabled although Manufacturing is absent. Failed log2c57a5d0-36d4-4687-a982-1773ff6251aa at17:43:43 UTC: Object mrp.bom doesn't exist. Queue4d1d9098-7e11-4f4e-963c-de02efd0630f retry1/5; partial template40 remains. Missing bom_ids field on template independently confirms module/capability absent. Did not install module or alter settings.
3. Images all: source-only capability gap documented above, not a newly reproduced media failure.

Successful P01 create logb1f83541-7779-4c8d-840f-ae82b428684f at17:40:47 UTC, following receipt7896aee8-0f8f-4713-b4e6-2d9ac2cb711c at17:40:34 UTC; Zid create17:39:42 UTC. Successful variants logsbee0b053-42ce-4139-b88e-99917514127f, a7364f42-4713-4749-bcb5-547de978632d and df3ecac2-7db6-44d7-b721-55e69391af90.
