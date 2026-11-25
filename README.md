# ERP Link

**Open-source commerce-to-ERP integration for developers and merchants.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

ERP Link is a TypeScript and Next.js application designed to connect e-commerce stores to ERP systems, with an emphasis on reliable synchronization, configurable field mapping and workspace isolation.

## Integrations

| Integration | Role |
| --- | --- |
| Zid, Salla, Shopify | Commerce platform adapters and webhook ingestion |
| Odoo | ERP connection, entity mapping and synchronization via XML-RPC |
| ERPNext | REST-based execution path for custom mappings; not feature-equivalent to Odoo |
| Supabase | Database, durable inbox, queue and synchronization state |
| Clerk | Authentication and user/workspace resolution |

The code includes workflows for products, customers, categories, orders and inventory. Availability varies by platform, configuration and ERP version. A successful local build does not establish live integration or accounting compatibility.

## Architecture

```mermaid
flowchart LR
    A[Commerce platform] --> B[Webhook verification]
    B --> C[Durable inbox]
    C --> D[Workspace-scoped job queue]
    D --> E[Mapping and validation]
    E --> F[ERP adapter]
    F --> G[Sync logs and entity links]
```

The repository includes tenant-scoped routing, retries, lease fencing, and reconciliation paths. See the [architecture overview](docs/architecture/overview.md) and [module map](docs/architecture/module-map.md) for implementation details and known limitations.

## Getting started

Use a dedicated development environment, a supported Node.js LTS runtime compatible with the locked dependencies, npm, a separate Supabase project, and a Clerk development instance. Use sandbox stores and a disposable ERP database for integration testing.

```bash
git clone https://github.com/Tawfik931201/ErpLink.git
cd ErpLink
npm ci
cp .env.example .env.local
```

Configure your own development credentials in `.env.local`. Review [local setup](docs/getting-started.md) before starting the application; the database must be initialized first.

```bash
npm run dev
```

Open http://localhost:3000. Never connect a development environment to real merchant data merely to test installation.

## Development and verification

```bash
npm run type-check
npm run lint
npm test -- --runInBand
npm run build
```

The commands are defined in [package.json](package.json). See the [development guide](docs/architecture/development-guide.md) for domain-specific tests. Report actual test results with changes; these commands are not a claim that all current checks pass.

## Community

- [Contributing guide](CONTRIBUTING.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)
- [Issue tracker](https://github.com/Tawfik931201/ErpLink/issues)

ERP Link welcomes useful bug reports, reproducible tests, adapter improvements and documentation contributions. The repository is actively developed; a stable public release and compatibility matrix have not yet been established.

## License

ERP Link is licensed under the [GNU Affero General Public License v3.0](LICENSE). Third-party components retain their respective licenses. Platform names belong to their respective owners; this repository does not imply an endorsement or affiliation.
