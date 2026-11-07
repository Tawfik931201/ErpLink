# Categories live audit — 2026-11-06

## Target verified

- Zid MCP `zid_store.get_context`: tawfik, store 3172448, https://4npqux.zid.store/.
- Supabase project bnzkmoorrvtellesgvbq, workspace b0bee63a-db5f-4faa-ad23-ee5f9f3c79ce, merchant 3236165.
- ERP connection f69315eb-5cf7-4653-9f55-d44f8bcc9dff, https://edu-course3.odoo.com, DB edu-course3, stored version 19.0+e.

## Actual end-to-end test

Created Zid category through MCP products_manage after preview:

- Zid ID **1776660**, UUID a3298258-d7cd-4fc2-b6be-26b2dc7119aa.
- Arabic name `اختبار ERPlink CAT 20261106 A`; English `ERPlink CAT 20261106 A`.
- The test category was created published (the operation's default), with zero products. The coordinator subsequently hid category1776660 through Zid MCP update_category_publishing; the API returned success. No existing records or Standard Mapping settings were modified.
- Durable webhook receipt e9c32aab-4959-463e-9d43-67c5ef707df8: category.create, received 2026-11-06 17:39:36.575051 UTC, status done. This means dispatched, not ERP success.
- Sync log **8923d7a7-9327-45d8-9062-8eccda2c4325**, 17:39:43.1961 UTC: **failed**, correct ERP connection, no Odoo ID, error **`column category_mappings.store_id does not exist`**.
- Queue c040f064-f499-46d5-b7d0-c474a05d38af: retry_count 1/max_retries 5, same error, next retry was 17:45:32.066 UTC at read time.
- Independent XML-RPC read against the selected ERP authenticated successfully. `product.category` search_read for `ERPlink CAT 20261106` returned **[]**. Creation is therefore **not successful**.

## Saved effective settings and options matrix

The store-specific categories row overrides the platform-default row.

| Control | Saved value | Evidence / limit |
|---|---|---|
| Cost method | average | Actual Odoo fields_get supports standard, fifo, average; UI also offers Odoo default. No category reached write, so actual application unverified. |
| Inventory valuation | real_time | Actual Odoo fields_get supports periodic and real_time; UI also offers default. No write occurred. |
| Match store field | id | Test source ID 1776660. |
| Match ERP field | x_categ_zid_id | Actual fields_get: char, writable. Identity write blocked before Odoo operation. |
| Sync enabled | disabled=false | Webhook accepted and attempted. Disabled state was not switched live. |
| Allowed operations | create, update, delete | Create attempted and failed due to schema. Update/delete not performed because same fixed blocker and destructive policy coverage should not be claimed. |
| Deletion behavior | delete_or_archive | UI options nothing/delete/archive/delete_or_archive. Not executed live. Actual model has no active field; archive implementation uses [Archived] name prefix. |
| Company context | company_id=null, link_company=true | No company selected. Actual model has no company_id, so optional record linkage is unsupported on this model; context-only behavior available in implementation. Other companies not exercised live. |
| Manual category mapping / overrides | inspected | UI maps source category name to existing ERP category and preserves accounting/parent/cost/valuation overrides. Override lookup fails because store_id column is absent. No manual mapping changes performed. |
| Parent hierarchy | test category root/null | Parent/child mutations not attempted while creation blocked. Existing engine supports scoped parent resolution, overrides and cycle checks; this is source evidence only. |

## Root cause

`src/lib/categories/mapping-overrides.ts` queries category_mappings with store_id scoping and throws database errors deliberately rather than silently losing user overrides. Live information_schema confirms **both category_mappings and product_mappings lack store_id**.

Repository migration `supabase/migrations/20261014_per_item_mapping_store_scope.sql` adds those columns plus scoped unique constraints/indexes. It has **not been applied during this audit**. No production schema fix or deployment performed; parent instructed report-only.

## Local verification

Attempted `npm test -- --runInBand --runTestsByPath tests/unit/category-settings-execution.test.ts tests/unit/category-overrides.test.ts tests/unit/mapping-settings.test.ts tests/unit/salla-category-parent.test.ts --silent`.

The command emitted the npm/Jest startup only and no suite results after several minutes; terminated its exact Node processes (8740/10044) to release resources. **No test pass is claimed.** Fixtures inspected explicitly mock sync-runtime and platform API, so the absence of completion is a local test-runner issue to investigate separately; no live DB failures were emitted by tests.

Temporary `.tmp-live-audit/odoo-read.cjs` provides credential-in-memory, read-method-only access to the exact ERP for other audit agents. It contains no secrets. No application source changes were made by this category agent.
