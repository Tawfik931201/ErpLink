-- Additive, backward-compatible extension to the service-role-only maintenance RPC.
-- Preserve order and category reconciliation slots; coalesce only scheduled
-- idle queue scans across independent Hostinger Node processes.
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
  IF p_name NOT IN ('zid_orders_reconcile_v1', 'zid_category_delete_audit_v1', 'queue_idle_drain_v1') THEN
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
