# ERP Link — prelaunch security audit and release gates

## Scope and verified evidence

- All public tables in Supabase were checked for RLS and direct anon/authenticated table grants; all 46 examined tables had RLS enabled and neither role had direct table grants (2026-11-23).
- Public business RPCs were checked for guest execute privileges; no business RPC was exposed to anon or authenticated roles. The publicly callable `pg_trgm` helper functions are extension helpers, not business writes.
- All 3 Zid test stores had webhook authentication version 2 with no recorded migration errors.
- All 3 ERP connections reported connected. `webhook_legacy_counters` had no Odoo entries at audit time. That is not proof that no inactive old Odoo automated actions exist.
- All existing /api/admin routes reviewed enforce Clerk authentication plus `isAdmin`.
- This release corrects Odoo's one inconsistent default: its unsigned legacy incoming webhooks must be rejected in production, just like Zid and Salla. An explicit `STRICT_WEBHOOK_AUTH=false` (only during a controlled migration) remains available.
- Clerk Svix signature verification now rejects obviously invalid headers, checks clock skew, and caps the streamed request body before allocation.
- Admin impersonation is now same-origin only, preventing cross-origin POST CSRF.
- A public `/api/health/live` release marker permits external deployment verification without secret values or DB queries.

## Required release checks

1. Security CI: `npm ci`, `npm audit --audit-level=moderate`, `npm run type-check`, focused and full Jest must succeed on the PR head.
2. Squash-merge only once to `main`. The branch cleanup workflow deletes the temporary security branch after merge.
3. Hostinger auto-deploy must finish. CI `Verify live Hostinger release and security gates` polls the public release marker then tests fail-closed cron, Clerk, Shopify, Salla, Zid, and Odoo endpoints using deliberately INVALID credentials. These are low-impact, non-destructive probes. **Do not call the application deployed until this job succeeds.**
4. Set and retain `ENCRYPTION_KEY`, `CRON_SECRET`, `CLERK_WEBHOOK_SECRET` and the relevant Zid/Salla/Shopify app secrets. `STRICT_WEBHOOK_AUTH` should be unset or true in production. Do not enable `ZID_ACCEPT_LEGACY_GLOBAL_BASIC_AUTH`. Leave `WEBHOOK_TRUSTED_PROXY_IP_HEADER` unset until the Hostinger edge is proven to overwrite the chosen header; this defaults to a shared anonymous bucket.
5. Check Odoo Automated Actions: any existing action with an old unsigned URL needs re-registration from the authenticated admin control `POST /api/admin/odoo-webhooks/refresh`. The three linked Odoo databases are test-only; check inbound stock and record webhooks after re-registration. No legacy Odoo delivery was observed in the audit, but inactive actions cannot be ruled out from the counter.
6. Confirm end-to-end test orders, products, customers, returns and stock changes on each isolated test workspace/ERP; accepted HTTP 200 only proves delivery, NOT successful Odoo write. Review `sync_queue`, `sync_logs`, `webhook_inbox`, and `sync_queue_dead` after each scenario.
7. Complete an infrastructure check (Hostinger dashboard/observability is not accessible through the current ChatGPT browser connection): deployment runtime revision, cron Authorization header, TLS/proxy, backups/restore point, resource usage, secret rotation/expiry and alerting.
8. Run independent penetration tests and a staging load test before claiming a comprehensive security guarantee.

## Release decision policy

`PR CI PASS` permits merge. `Production smoke PASS` confirms public release marker and rejection checks. **A full launch-ready decision still requires authenticated business E2E, tenant-isolation tests, Hostinger runtime logs, and backup restore verification.** No automated/static audit alone can guarantee zero remaining vulnerabilities.
