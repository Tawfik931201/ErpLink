BEGIN;
-- Resource identity baseline prevents legacy manual ERP numeric mappings from
-- silently being reused after the destination database/server is replaced.
-- Credential rotation alone does not change this baseline.
CREATE TABLE IF NOT EXISTS public.erp_workspace_bindings (
  workspace_id uuid PRIMARY KEY, erp_connection_id uuid NOT NULL,
  erp_type text NOT NULL, url text NOT NULL, db_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_workspace_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_workspace_bindings FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.erp_workspace_bindings TO service_role;
INSERT INTO public.erp_workspace_bindings(workspace_id,erp_connection_id,erp_type,url,db_name)
SELECT c.workspace_id,c.id,c.erp_type,c.url,coalesce(c.db_name,'') FROM public.erp_connections c
WHERE c.workspace_id IS NOT NULL AND
  (SELECT count(*) FROM public.erp_connections other WHERE other.workspace_id=c.workspace_id)=1
ON CONFLICT(workspace_id) DO NOTHING;
COMMIT;
