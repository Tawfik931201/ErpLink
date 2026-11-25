# Contributing to ERP Link

Thank you for helping improve ERP Link. Contributions that improve synchronization correctness, reliability, security, accessibility and documentation are welcome.

## Workflow

1. Search the issue tracker for an existing report. Discuss substantial changes before implementation.
2. Fork the repository and create a descriptive branch from the current main branch.
3. Read [AGENTS.md](AGENTS.md), the [architecture overview](docs/architecture/overview.md) and [development guide](docs/architecture/development-guide.md).
4. Use an isolated development environment and synthetic fixtures. Never use live merchant credentials or customer records.
5. Keep each pull request focused on one logical change. Add regression tests for changed behavior.
6. Run applicable checks and describe results, known limitations and migration implications in the pull request.
7. Submit the pull request against main. Address review feedback before merging.

## Verification

```bash
npm ci
npm run type-check
npm run lint
npm test -- --runInBand
npm run build
```

For a focused Jest suite, use `npm test -- --runInBand --runTestsByPath path/to/test.ts`.

## Integration safety

- Preserve workspace and store scoping, pinned ERP targets, and authenticated webhook validation.
- Preserve idempotency, retry semantics and durable receipts. Do not silently discard rejected accounting fields or hide remote write failures.
- Avoid destructive ERP operations and production database access in tests.
- Use synthetic data in fixtures, screenshots, logs, and issue reports.
- Do not commit credentials, tokens, customer data or real production exports.
- Do not weaken existing tests simply to make them pass.

## Pull request contents

Describe the problem, the solution, affected integrations, test evidence, and any backward-compatibility or deployment considerations. Disclose untested behavior. Documentation-only changes should be identified as such.

Contribute code only if you have the right to submit it under the project's [AGPL-3.0 license](LICENSE). Preserve applicable third-party notices. Follow the [code of conduct](CODE_OF_CONDUCT.md); report security issues according to [SECURITY.md](SECURITY.md).
