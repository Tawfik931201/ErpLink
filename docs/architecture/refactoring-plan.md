# Safe refactoring plan

Prepared 2026-11-03 before domain source edits. Checkpoint: `2019abe`; isolated branch: `codex/architecture-safe-refactor`; initial working tree clean. Review the audit first. Existing commits remain the rollback point; no reset, clean, push or deployment is part of this task.

1. **Audit and baseline.** Read project instructions, inventory entrypoints and actual clients, record contracts and existing cycles. Run Jest/type-check/lint/build using temporary non-production credentials and blocked provider access. Record pre-existing failures separately.
2. **Characterize bounded domains before moving them.** Products: variant payload precedence and platform differences. Customers: company/tax fallback and explicit mappings. Categories: scoped query, store/default choice, accounting values and soft failures using a fake query client. Orders: fulfillment precedence, filtering and the shadowed nested fulfillment quirk. Tests must run against checkpoint function bodies first; no live database, provider account or pipeline self-test endpoint.
3. **Extract one responsibility at a time.** Use `src/lib/products/variants.ts`, `customers/company-fields.ts`, `categories/mapping-overrides.ts`, and `orders/fulfillment-items.ts`. Preserve implementation text and caller argument order. Preserve existing public engine exports for variant consumers. New modules must not import the engine. Category extraction retains the existing `supabaseAdmin` instance, not a replacement client or a changed auth policy.
4. **Verify each extraction.** Run relevant characterization plus existing regression suites, inspect a whitespace-insensitive body comparison, run type-check/lint/build and review diff. Do not proceed past an unresolved regression. Full suite and all four gates at the end; maintain a stage ledger in `validation.md`.
5. **Document actual final boundaries.** Add overview, module map, development guide and append navigation/rules to AGENTS.md. Report that central write orchestration remains centralized, rather than claiming complete modularization.

## Deferred high-risk work

Do not relocate Sales Order creation, order lines/tax/pricelist, customer matching/dedup, variant Odoo writes, stock authority, token refresh, webhook verification or queue processing in this pass. First add mocked end-to-end tests asserting exact Odoo model/method/argument order, retry outcomes, tenant/store filters and error behavior for both platforms and relevant Odoo versions. Then propose a separate, concrete migration and obtain approval before a high-risk change. The user instruction explicitly permits stopping an unverified portion and documenting it.

Existing API clients, returns modules, order payment/currency/analytics helpers, shared sync types/runtime, platform fields and UI stay in place because relocating them provides insufficient benefit here. No empty domain repository/service layers will be created just to match a diagram.

## Rollback

Changes are uncommitted and reviewable on the isolated branch. Revert an extraction by restoring its original function body/imports from checkpoint and removing only that extraction's new module/tests. Never delete unrelated user files or use destructive tree-wide commands. Docs and tests can be retained independently; no database migration or external state needs reversal.
