# Category Standard Mapping audit

Reviewed 2026-11-04. Scope: inbound Zid/Salla categories, Standard Mapping category settings, parent resolution, manual category links and initial category imports. Existing product changes in the working tree were preserved. No deployment, merchant write or live database mutation was performed.

## Corrections

- Configured category matching now uses the selected source and Odoo fields, with metadata-based value conversion. Text identifiers retain leading zeroes. Explicit matching does not fall back to unrelated names, partial complete names, default custom ID fields or a different dynamic match pair. Multiple matches fail instead of updating an arbitrary category.
- `id` can identify an existing Odoo record but is never included in create/write values. Missing, readonly and unsupported match fields are rejected. The dropdown reads suitable fields from the connected model, and settings are validated before saving.
- Costing and valuation are merged without losing flat valuation settings. Empty per-store costing/valuation selections clear inherited fixed defaults. Per-category overrides keep their own priority. Database failures reading overrides are surfaced rather than silently applying a different configuration.
- Field capability checks use `product.category.fields_get`. Saved `manual_periodic`/`periodic` values are translated only when the connected selection confirms the equivalent. Stock journal/input/output field aliases resolve to actual installed model fields. Unsupported settings are reported; category writes do not silently prune them and report success.
- Company-dependent properties run with operation-local `allowed_company_ids`/`force_company`. The base client is never mutated. A record's `company_id` is written only when exposed by the connected model and requested by `link_company`.
- Archive never calls unlink. It uses `active=false` when supported, otherwise an idempotent `[Archived]` name prefix. Delete performs unlink only; delete-or-archive makes one unlink attempt followed by archive on failure; nothing skips the operation.
- Category create/update checks `disabled` and `enabled_actions` at the executor. Durable identity writes are awaited under the current workspace/platform/store/ERP connection and credential generation. Manual mappings also save that identity when a source ID and store are available. Manual match-field writes no longer assume a fixed Zid column or write a source ID into an arbitrarily selected source field.
- Parent resolution for scoped Zid/Salla operations uses the selected store token, its category settings and configured matching. Missing ancestors inherit category settings, cyclic hierarchies fail before writes, and missing store ownership cannot fall back to another token. Explicit root/null parent values clear the parent. Manual parent overrides are applied.
- Initial category imports use the same category executor as webhooks, with the ERP target and create-effect context established before resolving parents and writing the root category. Switching stores clears unsaved category state when no settings exist, and stale settings responses are ignored. Saving settings invalidates the engine settings cache in the current process.
- Manual override names escape SQL LIKE wildcard characters. Only the requested store or explicit platform default can supply an override.

## Version evidence and limits

The existing Odoo connection action detects and stores `odoo_version` in Supabase; it remains unchanged. Runtime field metadata is the compatibility authority because installed modules and customizations can differ within a major version.

Official model sources confirm the valuation key change between [Odoo 14](https://github.com/odoo/odoo/blob/14.0/addons/stock_account/models/product.py) and [Odoo 19](https://github.com/odoo/odoo/blob/19.0/addons/stock_account/models/product.py). In [Odoo 20 accounting](https://github.com/odoo/odoo/blob/20.0/addons/account/models/product.py), category valuation remains `periodic`/`real_time`; its [base category model](https://github.com/odoo/odoo/blob/20.0/addons/product/models/product_category.py) includes `company_id`. The client probes the actual model rather than inferring optional fields from version alone.

Tests use mocked RPC and database clients, including the separately constructed sync-runtime client. The matrix covers Zid/Salla × Odoo majors 14–20 × default/standard/average/FIFO costing × default/manual/automatic valuation, with version-dependent valuation fixtures. Additional execution tests cover matching, rename links, deletion strategies, unsupported settings, company context separation, parent creation/cycles and store ownership.

These checks do not certify seven live Odoo deployments, installed accounting modules, access rights, provider delivery or production migration state. Existing Salla registration follows the [Merchant API event catalogue](https://docs.salla.dev/5394136e0), which lists category created/updated; no category-deletion webhook is invented. Renaming as archive is a visible marker where the model has no native active flag. Distributed application processes can retain their existing settings TTL until it expires.

## Validation

- `npm run type-check`: PASS.
- `npm run lint`: PASS; existing warnings remain, zero errors.
- `npm test -- --runInBand --silent`: PASS, 109 suites / 1,561 tests, including 193 category execution cases in the new suite.
- `npm run build`: PASS, 39 static pages generated; optimization, traces and final route table completed.
- `git diff --check`: PASS.

Build validation uses process-local non-production credentials, mock email, disabled background runners and an external-network guard (localhost and Google font reads only). Repository `.env` files are unchanged.
