-- Expiring Shopify offline access tokens (required for public apps since 2026-04-01).
-- Additive migration: existing legacy connections remain readable until they
-- complete their next authorization, when expiring token metadata is saved.
-- Tokens are service-role only; never select these columns in client actions.
ALTER TABLE public.shopify_tokens
  ADD COLUMN IF NOT EXISTS refresh_token text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at timestamptz;

COMMENT ON COLUMN public.shopify_tokens.refresh_token IS
  'Sensitive Shopify rotating refresh token. Server only; never expose to clients/logs.';
COMMENT ON COLUMN public.shopify_tokens.expires_at IS
  'Timestamp for Shopify offline access token expiry.';
COMMENT ON COLUMN public.shopify_tokens.refresh_token_expires_at IS
  'Timestamp for Shopify rotating refresh token expiry.';
