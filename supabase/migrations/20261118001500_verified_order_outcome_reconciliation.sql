-- Controlled reconciliation of ERP effects quarantined after a worker lease expires.
-- A remote read and exact Standard Mapping comparison MUST happen outside this
-- function before a trusted service-role operator supplies evidence.
-- No automatic release or blind retry of unknown outcomes.

CREATE TABLE IF NOT EXISTS public.sync_queue_outcome_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id uuid NOT NULL UNIQUE,
  workspace_id uuid NOT NULL,
  platform text NOT NULL,
  store_id text NOT NULL,
  event text NOT NULL,
  execution_key text,
  source_order_id text NOT NULL,
  source_updated_at text,
  source_payload_md5 text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('confirmed_applied', 'confirmed_no_remote_effect')),
  evidence jsonb NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_outcome_reviews_workspace
  ON public.sync_queue_outcome_reviews(workspace_id, reviewed_at DESC);

ALTER TABLE public.sync_queue_outcome_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sync_queue_outcome_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.sync_queue_outcome_reviews TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_verified_unknown_order_job(
  p_job_id uuid,
  p_decision text,
  p_evidence jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  job public.sync_queue%ROWTYPE;
  affected integer := 0;
  comparison jsonb;
BEGIN
  IF p_decision NOT IN ('confirmed_applied', 'confirmed_no_remote_effect')
     OR p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' THEN
    RAISE EXCEPTION 'Invalid outcome reconciliation request';
  END IF;

  -- Lock the exact row and refuse any job already claimed or already reviewed.
  SELECT * INTO job FROM public.sync_queue
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND OR job.outcome_unknown IS DISTINCT FROM true
    OR job.lease_token IS NOT NULL
    OR job.platform <> 'zid'
    OR job.event NOT IN ('order.updated', 'order.status.update') THEN
    RETURN false;
  END IF;

  IF coalesce(p_evidence->>'reviewed_by', '') = ''
    OR coalesce(p_evidence->>'verified_odoo_order_id', '') = ''
    OR coalesce(p_evidence->>'verified_source_updated_at', '') <> coalesce(job.payload->>'updated_at', '')
    OR coalesce(p_evidence->>'verified_source_order_id', '') <> coalesce(job.payload->>'id', '') THEN
    RAISE EXCEPTION 'Source identity, update time, ERP ID and reviewer must match the quarantined receipt';
  END IF;

  comparison := p_evidence->'mapped_order_comparison';
  IF comparison IS NULL OR jsonb_typeof(comparison) <> 'object'
    OR coalesce(comparison->>'expected_total', '') = ''
    OR coalesce(comparison->>'actual_total', '') = ''
    OR coalesce(comparison->>'expected_state', '') = ''
    OR coalesce(comparison->>'actual_state', '') = ''
    OR comparison->>'lines_verified' <> 'true' THEN
    RAISE EXCEPTION 'An explicit mapped order total/state/line comparison is required';
  END IF;

  IF p_decision = 'confirmed_applied' AND (
    comparison->>'expected_total' <> comparison->>'actual_total'
    OR comparison->>'expected_state' <> comparison->>'actual_state'
    OR comparison->>'workflow_verified' <> 'true'
  ) THEN
    RAISE EXCEPTION 'Cannot mark applied: mapped amount, state or workflow differs from Odoo';
  END IF;

  IF p_decision = 'confirmed_no_remote_effect' AND
    (p_evidence->>'no_remote_effect_verified' <> 'true' OR job.retry_count >= job.max_retries) THEN
    RAISE EXCEPTION 'Safe retry requires independent proof of no effect and remaining retry budget';
  END IF;

  INSERT INTO public.sync_queue_outcome_reviews (
    queue_id, workspace_id, platform, store_id, event, execution_key,
    source_order_id, source_updated_at, source_payload_md5, decision, evidence
  ) VALUES (
    job.id, job.workspace_id, job.platform, job.store_id, job.event, job.execution_key,
    job.payload->>'id', job.payload->>'updated_at', md5(job.payload::text), p_decision, p_evidence
  );

  IF p_decision = 'confirmed_applied' THEN
    -- Release same-execution-key later statuses only after the full mapped
    -- snapshot has been independently verified. Keep the audit after deletion.
    DELETE FROM public.sync_queue
      WHERE id = job.id AND outcome_unknown AND lease_token IS NULL;
  ELSE
    -- Never retry while a remote effect might have happened.
    UPDATE public.sync_queue
       SET outcome_unknown = false,
           processing_started_at = NULL,
           lease_expires_at = NULL,
           next_retry_at = now(),
           error_message = 'Verified no remote effect; explicitly released for retry'
     WHERE id = job.id AND outcome_unknown AND lease_token IS NULL;
  END IF;

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Outcome reconciliation settlement lost its row fence';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_verified_unknown_order_job(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_verified_unknown_order_job(uuid, text, jsonb)
  TO service_role;
