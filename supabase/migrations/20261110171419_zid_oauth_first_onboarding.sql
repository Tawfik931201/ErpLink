BEGIN;

-- Server-only grants. Raw handles/codes are never persisted. Unlinked stores
-- cannot enter normal synchronization through merchant_tokens.
CREATE TABLE public.zid_oauth_pending (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  kind text NOT NULL CHECK (kind IN ('authorization', 'connection')),
  store_id text,
  store_name text,
  encrypted_payload text,
  expires_at timestamptz NOT NULL,
  CHECK (kind <> 'connection' OR
    (store_id IS NOT NULL AND encrypted_payload IS NOT NULL))
);
CREATE INDEX zid_oauth_pending_expiry ON public.zid_oauth_pending(expires_at);
ALTER TABLE public.zid_oauth_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zid_oauth_pending FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zid_oauth_pending TO service_role;

-- Invoker privileges: executable only by the server's service role. The row
-- lock and transaction make retries/concurrent confirmation safe.
CREATE FUNCTION public.complete_zid_oauth_connection(
  p_hash text, p_user_id text, p_workspace_id uuid, p_token_data jsonb
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  pending public.zid_oauth_pending%ROWTYPE;
  existing public.merchant_tokens%ROWTYPE;
  target_merchant text;
BEGIN
  SELECT * INTO pending FROM public.zid_oauth_pending
    WHERE token_hash = p_hash AND kind = 'connection'
      AND expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Connection expired or consumed'; END IF;

  -- Check the CURRENT owner, not an active-workspace hint or submitted user id.
  PERFORM 1 FROM public.workspaces
    WHERE id = p_workspace_id AND user_id = p_user_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace owner required'; END IF;
  IF pending.store_id IS DISTINCT FROM p_token_data->>'store_id'
    OR coalesce(p_token_data->>'access_token', '') = ''
    OR coalesce(p_token_data->>'refresh_token', '') = '' THEN
    RAISE EXCEPTION 'Invalid verified connection';
  END IF;

  -- Serialize all pending authorizations for this store, including first install.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('zid-oauth:' || pending.store_id, 0));
  IF (SELECT count(*) FROM public.merchant_tokens WHERE store_id = pending.store_id) > 1 THEN
    RAISE EXCEPTION 'Ambiguous existing store';
  END IF;
  SELECT * INTO existing FROM public.merchant_tokens WHERE store_id = pending.store_id FOR UPDATE;
  IF FOUND THEN
    IF existing.workspace_id IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'Store already belongs to another workspace';
    END IF;
    target_merchant := existing.merchant_id;
    -- Keep the legacy key and configured sync settings on reauthorization.
    UPDATE public.merchant_tokens SET
      access_token = p_token_data->>'access_token',
      refresh_token = p_token_data->>'refresh_token',
      authorization_token = p_token_data->>'authorization_token',
      token_type = p_token_data->>'token_type',
      expires_in = (p_token_data->>'expires_in')::bigint,
      name = p_token_data->>'name', email = p_token_data->>'email',
      username = p_token_data->>'username', uuid = p_token_data->>'uuid',
      updated_at = clock_timestamp()
      WHERE id = existing.id;
  ELSE
    target_merchant := pending.store_id;
    IF EXISTS (SELECT 1 FROM public.merchant_tokens WHERE merchant_id = target_merchant) THEN
      RAISE EXCEPTION 'Store key conflicts with an existing connection';
    END IF;
    INSERT INTO public.merchant_tokens (
      merchant_id, store_id, workspace_id, access_token, refresh_token,
      authorization_token, token_type, expires_in, name, email, username, uuid,
      old_id, sync_settings, updated_at
    ) VALUES (
      target_merchant, pending.store_id, p_workspace_id,
      p_token_data->>'access_token', p_token_data->>'refresh_token',
      p_token_data->>'authorization_token', p_token_data->>'token_type',
      (p_token_data->>'expires_in')::bigint, p_token_data->>'name',
      p_token_data->>'email', p_token_data->>'username', p_token_data->>'uuid',
      pending.store_id::bigint, p_token_data->'sync_settings', clock_timestamp()
    );
  END IF;
  DELETE FROM public.zid_oauth_pending WHERE token_hash = p_hash;
  UPDATE public.users SET active_workspace_id = p_workspace_id WHERE id = p_user_id;
  RETURN target_merchant;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_zid_oauth_connection(text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_zid_oauth_connection(text,text,uuid,jsonb) TO service_role;
COMMIT;
