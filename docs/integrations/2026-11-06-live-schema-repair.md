# Live mapping schema repair — 2026-11-06

## Scope and diagnosis

The authorized live Standard Mapping audit used Zid store `3172448` / merchant `3236165`, workspace `b0bee63a-db5f-4faa-ad23-ee5f9f3c79ce`, Supabase project `bnzkmoorrvtellesgvbq`, and ERP connection `f69315eb-5cf7-4653-9f55-d44f8bcc9dff` (`edu-course3.odoo.com`, Odoo 19).

The original category create failed before Odoo writes because `category_mappings.store_id` did not exist. Inspection also found `product_mappings.store_id` and `order_status_mappings.invoice_action` / `picking_action` absent. Existing source migrations describe these columns, but the legacy category unique constraint's actual truncated name differs from the names listed in the old migration.

## Applied repair

`supabase/migrations/20261106175318_repair_mapping_store_scope_and_status_actions.sql` was generated with Supabase CLI `migration new`, reviewed against live columns, constraints, indexes, rows and advisors, and applied once through Supabase MCP `apply_migration`.

- Adds mapping store keys with `NOT NULL DEFAULT ''`, retaining legacy platform-default rows.
- Creates unique keys including store ID before removing only legacy unique constraints whose actual column lists match. Primary keys, foreign keys and unrelated indexes remain intact.
- Adds order action columns and seeds them once from the effective per-store/default Standard Mapping JSON. This is necessary because the modern table row becomes authoritative after columns exist. Existing action columns are never overwritten on rerun, including intentionally cleared values.
- Preserves all status states, enabled flags, identities and saved Standard Mapping settings. No merchant settings or Odoo modules were changed.
- Uses one transaction, a five-second lock timeout and invariant assertions. Requests PostgREST schema-cache reload after DDL.

## Verification

| Invariant | Before | After |
|---|---|---|
| Status rows | 185 | 185 |
| Original status fields MD5 | `9df3032c6042b48aed0d3d57712d24f5` | Identical after excluding new action columns |
| Category mapping rows | 5 | 5 |
| Original category fields MD5 | `377daa79dd26f959a80707308546d4bf` | Identical after excluding new store key |
| Product mapping rows | 0 | 0 |
| Complete Standard Mapping settings MD5 | `71cbe7add3afe33e61c83f66bc000ca6` | Identical |
| Populated action rows | Five effective JSON actions | Same five table action pairs |

The five preserved action rows belong to the tested workspace/store:

| Status | Invoice | Picking |
|---|---|---|
| ready | create | create |
| preparing | create | create_and_validate |
| delivered | create_and_post | create_and_validate |
| reversed | post | create_and_validate |
| partially_reversed | create_and_post | create_and_validate |

All remaining 180 action pairs are empty. A second execution of the migration SQL inside a rolled-back transaction asserted the full status-row hash remained identical and returned `idempotent_same_status_rows`; no second migration-history entry was created. A first wrapper attempt had a JavaScript dollar-replacement syntax error before SQL execution; the corrected callback preserved dollar quoting and passed.

Post-repair constraints are `UNIQUE (workspace_id, platform, store_id, source_category_name)` and `UNIQUE (workspace_id, platform, store_id, source_product_id)`. Health advisor findings remained empty. Security advisor results were unchanged from baseline: 38 informational RLS-without-policy entries consistent with service-role server access, plus existing [mutable search path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) and [extension in public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) warnings. They were not modified by this repair.

## Live category result

- Fresh category `1776664` (`ERPlink CAT 20261106 B`) created through Zid MCP synchronized successfully to Odoo category **67**, log `39741e41-e861-4893-b89e-b218e471a7dc`, 17:56:20.760728 UTC.
- Original failed category `1776660` automatically retried and synchronized to Odoo category **68**, log `e1760162-29a7-496f-8753-31d4c1b9bb78`, 17:56:21.458955 UTC. No queue rows were edited manually.
- Independent authenticated XML-RPC reads confirmed both categories have the correct `x_categ_zid_id`, `property_cost_method=average`, `property_valuation=real_time` and root parent. These are the unchanged saved store-specific settings.
- An update sent before the original create retried was skipped because its ERP record did not exist yet. The subsequent update succeeded, log `9e326958-ade4-4d4a-9333-9862c32672e3` at 17:57:12.179891 UTC. Independent XML-RPC read returned exactly one matching category, still ID **68**, renamed to `اختبار ERPlink CAT 20261106 A تحقق`, with unchanged configured costing/valuation.

No application source was changed by this schema repair. This verifies the configured live category create path and preserved order-action storage; it does not claim all category option combinations or all invoice/stock workflows were exercised against the live ERP.
