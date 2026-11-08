-- UUID lookup tokens are bearer credentials. Only their SHA-256 digest is stored.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS uq_zid_embedded_workspace_member
ON public.workspace_members(workspace_id, user_id);
CREATE TABLE public.zid_embedded_access (
  merchant_id text PRIMARY KEY REFERENCES public.merchant_tokens(merchant_id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  clerk_user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.zid_embedded_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zid_embedded_access FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zid_embedded_access TO service_role;

-- Revoking a lookup credential also removes existing sessions' workspace access.
-- Runs with the caller's rights, never SECURITY DEFINER.
CREATE FUNCTION public.cleanup_zid_embedded_member() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  DELETE FROM public.workspace_members
  WHERE workspace_id = OLD.workspace_id AND user_id = OLD.clerk_user_id;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.cleanup_zid_embedded_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_zid_embedded_member() TO service_role;
CREATE TRIGGER cleanup_zid_embedded_member
AFTER DELETE ON public.zid_embedded_access
FOR EACH ROW EXECUTE FUNCTION public.cleanup_zid_embedded_member();

CREATE FUNCTION public.revoke_moved_zid_embedded_access() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    DELETE FROM public.zid_embedded_access WHERE merchant_id = OLD.merchant_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_moved_zid_embedded_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_moved_zid_embedded_access() TO service_role;
CREATE TRIGGER revoke_moved_zid_embedded_access
AFTER UPDATE OF workspace_id ON public.merchant_tokens
FOR EACH ROW EXECUTE FUNCTION public.revoke_moved_zid_embedded_access();
COMMIT;
