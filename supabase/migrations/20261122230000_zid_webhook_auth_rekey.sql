-- Distinguish existing merchant-scoped Zid webhook registrations (shared/legacy
-- Basic credential) from new registrations (merchant-specific HKDF v2).
--
-- On an existing table, ADD COLUMN DEFAULT 1 backfills ONLY existing rows.
-- ALTER DEFAULT 2 then makes future OAuth installations v2 from creation.
-- Both operations are idempotent: repeated schema pushes do not re-mark v2
-- merchants as needing another destructive webhook refresh.
ALTER TABLE public.merchant_tokens
  ADD COLUMN IF NOT EXISTS zid_webhook_auth_version smallint NOT NULL DEFAULT 1;

ALTER TABLE public.merchant_tokens
  ALTER COLUMN zid_webhook_auth_version SET DEFAULT 2;

ALTER TABLE public.merchant_tokens
  ADD COLUMN IF NOT EXISTS zid_webhook_auth_claimed_at timestamptz;

ALTER TABLE public.merchant_tokens
  ADD COLUMN IF NOT EXISTS zid_webhook_auth_last_error text;

COMMENT ON COLUMN public.merchant_tokens.zid_webhook_auth_version
  IS '1 = manager webhook subscriptions need per-merchant Basic rekey; 2 = migrated/current';
COMMENT ON COLUMN public.merchant_tokens.zid_webhook_auth_claimed_at
  IS 'Atomic migration lease; attempts older than 60 minutes may be retried on startup';
