-- Queue lease recovery + deterministic product event ordering support.
-- Safe to apply before/after the app deploy: existing workers ignore the new
-- column/function, while new workers fall back if this migration is absent.

ALTER TABLE public.sync_queue
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sync_queue_expired_unstarted_lease
  ON public.sync_queue(lease_expires_at)
  WHERE lease_token IS NOT NULL
    AND processing_started_at IS NULL
    AND NOT outcome_unknown;

CREATE OR REPLACE FUNCTION public.claim_sync_job(
  p_job_id uuid,
  p_force boolean DEFAULT false,
  p_lease_seconds int DEFAULT 60
)
RETURNS SETOF public.sync_queue
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=''
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.sync_queue q
  SET lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 3600))),
      processing_started_at = NULL
  WHERE q.id = p_job_id
    AND q.lease_token IS NULL
    AND NOT q.outcome_unknown
    AND q.next_retry_at IS NOT NULL
    AND q.retry_count < q.max_retries
    AND q.erp_connection_id IS NOT NULL
    AND q.connection_generation IS NOT NULL
    AND (p_force OR q.next_retry_at <= now())
    AND NOT EXISTS (
      SELECT 1
      FROM public.sync_queue other
      WHERE other.id <> q.id
        AND other.execution_key = q.execution_key
        AND (other.lease_token IS NOT NULL OR other.outcome_unknown)
    )
  RETURNING q.*;
EXCEPTION WHEN unique_violation THEN
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_sync_job_started(
  p_job_id uuid,
  p_lease_token uuid,
  p_lease_seconds int DEFAULT 180
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=''
AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.sync_queue q
  SET processing_started_at = coalesce(q.processing_started_at, now()),
      lease_expires_at = now() + make_interval(secs => greatest(60, least(p_lease_seconds, 3600)))
  WHERE q.id = p_job_id
    AND q.lease_token = p_lease_token
    AND q.lease_expires_at > now()
    AND NOT q.outcome_unknown;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_sync_job_leases()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=''
AS $$
DECLARE
  safely_requeued integer := 0;
  uncertain integer := 0;
BEGIN
  -- A row that was leased but never marked started cannot have touched ERP.
  -- It is therefore safe to release and retry immediately after a worker dies.
  UPDATE public.sync_queue
  SET lease_token = NULL,
      lease_expires_at = NULL,
      processing_started_at = NULL,
      next_retry_at = now(),
      error_message = NULL
  WHERE lease_token IS NOT NULL
    AND lease_expires_at < now()
    AND processing_started_at IS NULL
    AND NOT outcome_unknown;
  GET DIAGNOSTICS safely_requeued = ROW_COUNT;

  -- Once processing started, a dead worker may already have committed a remote
  -- effect. Preserve exactly-once safety by quarantining for reconciliation.
  UPDATE public.sync_queue
  SET outcome_unknown = true,
      next_retry_at = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      error_message = 'ERP_OUTCOME_UNKNOWN: active worker lease expired; reconciliation required'
  WHERE lease_token IS NOT NULL
    AND lease_expires_at < now()
    AND processing_started_at IS NOT NULL
    AND NOT outcome_unknown;
  GET DIAGNOSTICS uncertain = ROW_COUNT;

  RETURN safely_requeued + uncertain;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sync_job(uuid,boolean,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mark_sync_job_started(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.expire_sync_job_leases() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sync_job(uuid,boolean,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_sync_job_started(uuid,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_sync_job_leases() TO service_role;
