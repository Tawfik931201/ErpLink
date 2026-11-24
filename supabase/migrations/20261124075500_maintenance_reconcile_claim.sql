-- Additive Supabase Free-tier optimisation for multi-process Hostinger deployments.
-- No existing user/order/ERP record is modified and no live sync mechanism is removed.
-- The service-role-only RPC atomically elects one reconciliation cycle per slot.
CREATE TABLE IF NOT EXISTS public.erp_maintenance_slots (
  name text PRIMARY KEY,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.erp_maintenance_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_maintenance_slots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.erp_maintenance_slots TO service_role;

CREATE OR REPLACE FUNCTION public.claim_erp_maintenance_slot(
  p_name text,
  p_interval_seconds integer DEFAULT 600
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE claimed text;
BEGIN
  IF p_name NOT IN ('zid_orders_reconcile_v1', 'zid_category_delete_audit_v1') THEN
    RAISE EXCEPTION 'Unsupported maintenance scope' USING ERRCODE = '22023';
  END IF;
  IF p_interval_seconds IS NULL OR p_interval_seconds < 60 OR p_interval_seconds > 3600 THEN
    RAISE EXCEPTION 'Invalid maintenance interval' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.erp_maintenance_slots(name, claimed_at)
    VALUES (p_name, clock_timestamp())
    ON CONFLICT (name) DO UPDATE
      SET claimed_at = EXCLUDED.claimed_at
      WHERE public.erp_maintenance_slots.claimed_at <=
        EXCLUDED.claimed_at - make_interval(secs => p_interval_seconds)
    RETURNING name INTO claimed;
  RETURN claimed IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_erp_maintenance_slot(text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_erp_maintenance_slot(text,integer) TO service_role;
