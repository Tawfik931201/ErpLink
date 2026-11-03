# Validation ledger

Date: 2026-11-03. Checkpoint: `2019abe`; branch: `codex/architecture-safe-refactor`. Initial Git status was clean. Changes remain local; no push, deployment, schema migration, provider sync or admin diagnostic endpoint was invoked.

## Execution safety and environment

Commands run on Windows with Node `v24.13.1` and npm `11.8.0`; the checked CI configuration uses Node 20. No runtime version was changed. Gate processes use temporary CI placeholder Supabase/Clerk/encryption values, mock email, disabled runners and blocked external HTTP/fetch. Read-only Google font downloads and localhost are allowed for Next build. Existing `.env` files are not edited. Build still reports their filenames as loaded; process-local values take precedence. Tests use mocks, never production fixtures.

The temporary runner, network preload and raw logs live outside the repository at `%TEMP%/erplink-architecture-baseline-20261103/`. Log names below identify runs, not portable dependencies needed by the app.

## Baseline before domain source extraction

| Gate | Result | Evidence/interpretation |
| --- | --- | --- |
| `npm run type-check` | PASS, exit 0 | `baseline-type-check.log`. |
| `npm run lint` | FAIL, exit 1 | One existing `import/order` error in `src/app/actions/sync-logs.ts:7`; other diagnostics are warnings. `baseline-lint.log`. |
| `npm test -- --ci --runInBand` | FAIL, exit 1 | 83/84 suites, 1212/1213 tests passed; `order-tax-inclusive-sync.test.ts:168` exceeded 5s. Newly added characterization suites were not in this run's discovery. `baseline-test.log`. |
| `npm run build` | PASS, exit 0 | Next 15.5.28; compiled, type validated, 39 static pages generated and final route table emitted. Existing webpack large-string cache warning. `baseline-build.log`. |
| Isolated unchanged tax suite | FAIL | 8/9 passed; repeated 5s timeout without concurrent build. `baseline-isolated-tax-retry.log`. |

Root cause of the timeout was a test isolation gap, not proven resource contention: `sync-runtime.ts` constructs an admin client outside the ordinary Supabase module mapper. Missing `shipping.title` currently falls back to the shipping object; carrier lookup then queries `shipping_method_mappings`. Network was blocked, but client retry waits exceeded the timeout. A **test-only** explicit runtime mock now uses the existing fake Supabase and asserts workspace/platform/source filters; all original financial assertions remain. Isolated rerun passed **9/9**, with the affected case completing in 32ms. Runtime parsing and database clients were not changed.

The pre-existing lint error was corrected by moving one import below `sync-engine` in the same action file. No action name, query or response changed.

## Characterization before movement

| Area | Checkpoint run | Method |
| --- | --- | --- |
| Product variants + customer company fields | 2 suites, 11 tests PASS | Public variant engine export; private customer source slice transpiled in an isolated VM. No app code exported solely for testing. |
| Category overrides + fulfillment items | 2 suites, 12 tests PASS | Exact private source slices in a VM, injected fake query builder and actual pure path/name helpers. Covers localized aliases, tenant/platform query predicates, store/default precedence, soft errors and fulfillment quirks. |

After extraction these suites import the focused modules directly. Product coverage additionally asserts the original engine export is the same function. Temporary source-evaluation harnesses are removed from final tests.

## Stage ledger

1. **Products/customers:** moved variant interface/parser and company-field helper pair verbatim; preserved old public variant export and internal calls. **8 suites / 77 tests PASS**, type-check **PASS**, lint **PASS** (warnings remain), build **PASS** (39 static pages). `stage1-{type-check,lint,build}.log` preserve gate evidence. Independent review found no regression; route keys identical to baseline.
2. **Categories/orders:** moved category override function with the same sync admin client and fulfillment parser with no dependencies. **7 suites / 72 tests PASS** in 5.755s (`stage2-targeted.log`), including category parents, workspace scoping, tax-inclusive lines, return wiring and no-loss regression. Final project gates follow below.

## Mechanical and scope review

- TypeScript AST comparison against `2019abe`: bodies of `extractGenericVariants`, `readNonEmptyString`, `injectCustomerCompanyFields`, `applyCategoryMappingOverrides` and `extractFulfilledItems` are unchanged after CRLF/LF normalization. **All remaining top-level engine function bodies are unchanged too.** The variant interface was moved with its fields intact and is now exported for the engine's type import.
- Local runtime dependency scan: **304 → 308 source files**, same **two** existing strongly connected components, **no new cycle**. Includes local static imports/reexports and literal dynamic imports/require, excludes explicit type-only declarations; computed imports and external dependency internals are not proven by this scan. See `source-inventory.md` for the checkpoint inventory.
- `sync-engine.ts`: **9424 → 9174 lines** by the same newline-counting method. File count/line count alone is not a quality claim.
- No route handler, UI component, page/layout, stylesheet, schema/migration, package manifest/lockfile or environment file changed. Existing API output implementations remain in their original files. Build route-key equality is checked separately from provider behavior.
- Git diff inspection finds only domain function moves/imports/compatibility export, the one import reorder, tests, and documentation. No deleted function or new business rule. `git diff --check` passes for tracked changes; repository-wide formatting was not run.

## Final project gates

| Gate | Result |
| --- | --- |
| `npm run type-check` | **PASS**, exit 0. |
| `npm run lint` | **PASS**, exit 0; existing warnings remain. |
| `npm test -- --ci --runInBand` | **PASS: 88 suites, 1237 tests**, 29.975s; 24 new cases across four domain suites. |
| `npm run build` | **PASS**, exit 0; compiled, type validated, 39 static pages generated, optimization/traces completed and final route table emitted. Final app-route keys match the original baseline. |

All four final gates ran sequentially and passed. Final logs/results use the `final-` prefix in the temporary evidence directory, including `final-app-paths-manifest.json`. Final build completed 2026-11-03 at 13:56:41 Cairo time (11:56:41 UTC). Build is a separate required gate, not inferred from tests or compilation alone. The final diff/scope and mechanical comparison were reviewed again; no further source/test changes followed the passing gates.

## Review limits

Source pins are retained, but they are not proof of complete provider behavior. No visual screenshots, live OAuth refresh, production webhook delivery, live database state, merchant order creation, deployed scheduling or real Odoo version compatibility was tested. The engine's Sales Order writes, tax/state/matching and outbound Odoo route remain in place pending broader mocked orchestration coverage. See `refactoring-plan.md`.
