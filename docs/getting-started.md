# Local development setup

This guide describes a development setup based on the repository structure and package scripts. It has not been verified end-to-end against a fresh installation; report missing prerequisites or migration issues in the issue tracker without sharing credentials.

## Prerequisites

- Git, npm and a supported Node.js LTS runtime compatible with the package lock.
- A dedicated Supabase development project and Clerk development instance.
- Optional sandbox merchant accounts and an isolated Odoo/ERPNext test database for integration testing.

## Install

```bash
git clone https://github.com/Tawfik931201/ErpLink.git
cd ErpLink
npm ci
cp .env.example .env.local
```

On PowerShell, use `Copy-Item .env.example .env.local` instead of `cp` if needed.

## Configure

Review [.env.example](../.env.example), replace placeholders with your own development settings, and keep real values out of Git. Use your development Clerk and Supabase credentials. The Supabase service-role key and encryption keys must remain server-side.

Review [database migrations](../supabase/migrations/) in order and apply them to a new development database using your Supabase migration tooling. Do not apply unreviewed migrations to production. Some migrations may depend on prior schema state or service configuration; investigate any failure rather than skipping it.

Configure only the commerce adapters you intend to test, using developer credentials and the callback URLs appropriate to your local environment. Never reuse production OAuth credentials or route local tests into production webhooks.

## Run and verify

```bash
npm run dev
```

Visit http://localhost:3000. Verify local authentication before configuring any ERP connection. For a quick source-level validation run:

```bash
npm run type-check
npm test -- --runInBand
```

See [the development guide](architecture/development-guide.md) for targeted tests, and [architecture overview](architecture/overview.md) for service boundaries. Mocked tests do not prove real platform compatibility. For integration tests, use disposable records and explicitly check workspace, store, destination and accounting outcomes.

A long-lived Node runtime may be required for background worker behavior. Review queue and webhook deployment requirements before any self-hosted production deployment.
