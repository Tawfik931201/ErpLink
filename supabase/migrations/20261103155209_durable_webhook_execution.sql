-- Additive durable dispatch and fenced execution. Existing ambiguous jobs are
-- retained for controlled recovery; no external operation runs in this migration.
BEGIN;

CREATE SCHEMA IF NOT EXISTS reliability_backup;
REVOKE ALL ON SCHEMA reliability_backup FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS reliability_backup.sync_queue_before_durable AS TABLE public.sync_queue;
CREATE TABLE IF NOT EXISTS reliability_backup.webhook_inbox_before_durable AS TABLE public.webhook_inbox;
REVOKE ALL ON ALL TABLES IN SCHEMA reliability_backup FROM PUBLIC, anon, authenticated;

ALTER TABLE public.webhook_inbox ADD COLUMN IF NOT EXISTS erp_connection_id uuid;
ALTER TABLE public.webhook_inbox ADD COLUMN IF NOT EXISTS connection_generation text;
ALTER TABLE public.webhook_inbox ADD COLUMN IF NOT EXISTS queue_id uuid;
ALTER TABLE public.webhook_inbox ADD COLUMN IF NOT EXISTS durable_version smallint NOT NULL DEFAULT 1;
ALTER TABLE public.webhook_inbox ALTER COLUMN durable_version SET DEFAULT 2;
ALTER TABLE public.sync_queue ADD COLUMN IF NOT EXISTS receipt_id uuid;
ALTER TABLE public.sync_queue ADD COLUMN IF NOT EXISTS erp_connection_id uuid;
ALTER TABLE public.sync_queue ADD COLUMN IF NOT EXISTS connection_generation text;
ALTER TABLE public.sync_queue ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE public.sync_queue ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE public.sync_queue ADD COLUMN IF NOT EXISTS outcome_unknown boolean NOT NULL DEFAULT false;
ALTER TABLE public.sync_queue ADD COLUMN IF NOT EXISTS execution_key text;
ALTER TABLE public.sync_logs ADD COLUMN IF NOT EXISTS erp_connection_id uuid;
ALTER TABLE public.sync_logs ADD COLUMN IF NOT EXISTS connection_generation text;
ALTER TABLE public.sync_logs ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE public.sync_reconcile_state ADD COLUMN IF NOT EXISTS cursor jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.odoo_entity_links ADD COLUMN IF NOT EXISTS erp_connection_id uuid;
ALTER TABLE public.odoo_entity_links ADD COLUMN IF NOT EXISTS connection_generation text;

-- No guess about the destination/effects of jobs already admitted by old code.
UPDATE public.sync_queue SET outcome_unknown=true, next_retry_at=NULL,
  error_message='Legacy unpinned event retained; verify destination and external outcome before recovery'
WHERE erp_connection_id IS NULL;
UPDATE public.webhook_inbox SET status='failed',
  last_error='Legacy unpinned receipt retained; controlled recovery required'
WHERE status='pending' AND workspace_id IS NOT NULL AND erp_connection_id IS NULL;

DROP INDEX IF EXISTS public.uq_sync_queue_dedup_key;
DROP INDEX IF EXISTS public.uq_webhook_inbox_dedup;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_queue_receipt ON public.sync_queue(receipt_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_receipt_v2 ON public.webhook_inbox
  (workspace_id,platform,store_id,dedup_key) WHERE durable_version=2 AND dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_queue_claimable ON public.sync_queue(next_retry_at)
  WHERE lease_token IS NULL AND NOT outcome_unknown AND next_retry_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_entity_lease ON public.sync_queue(execution_key)
  WHERE lease_token IS NOT NULL;
ALTER TABLE public.webhook_inbox DROP CONSTRAINT IF EXISTS webhook_inbox_workspace_id_fkey;
ALTER TABLE public.webhook_inbox ADD CONSTRAINT webhook_inbox_workspace_id_fkey
  FOREIGN KEY(workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;

ALTER TABLE public.odoo_entity_links DROP CONSTRAINT IF EXISTS odoo_entity_links_workspace_id_platform_store_id_odoo_model_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_link_target ON public.odoo_entity_links
  (workspace_id,platform,store_id,erp_connection_id,connection_generation,odoo_model,store_entity_id);

CREATE TABLE IF NOT EXISTS public.erp_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operation_key text UNIQUE NOT NULL,
  workspace_id uuid NOT NULL, platform text NOT NULL, store_id text NOT NULL,
  erp_connection_id uuid NOT NULL, connection_generation text,
  entity_id text NOT NULL, model text NOT NULL,
  status text NOT NULL CHECK(status IN ('in_progress','succeeded','uncertain','rejected')),
  remote_id text, error_code text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_effects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_effects FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.erp_effects TO service_role;
CREATE INDEX IF NOT EXISTS idx_erp_effect_scope ON public.erp_effects(workspace_id,erp_connection_id,status);

-- A separate encrypted recovery copy covers every successful HTTP branch,
-- including unknown/disabled/lifecycle events. No untrusted body is auto-run.
CREATE TABLE IF NOT EXISTS public.webhook_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text NOT NULL,
  payload_ciphertext text NOT NULL, payload_hash text NOT NULL,
  response_status integer NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.webhook_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_acceptances FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.webhook_acceptances TO service_role;
CREATE INDEX IF NOT EXISTS idx_webhook_acceptances_received ON public.webhook_acceptances(received_at);

CREATE OR REPLACE FUNCTION public.dispatch_webhook_receipt(p_receipt_id uuid,p_queue_row jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE receipt public.webhook_inbox%ROWTYPE; job_id uuid;
BEGIN
  SELECT * INTO receipt FROM public.webhook_inbox WHERE id=p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found'; END IF;
  -- Link survives successful queue-row deletion: recovery cannot replay it.
  IF receipt.queue_id IS NOT NULL THEN RETURN receipt.queue_id; END IF;
  IF receipt.workspace_id IS NULL OR receipt.erp_connection_id IS NULL OR receipt.connection_generation IS NULL THEN
    RAISE EXCEPTION 'Receipt requires verified destination recovery';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.erp_connections c WHERE c.id=receipt.erp_connection_id
    AND c.workspace_id=receipt.workspace_id AND (c.status IS NULL OR c.status='connected')) THEN
    RAISE EXCEPTION 'Receipt connection is outside workspace or disabled';
  END IF;
  INSERT INTO public.sync_queue(receipt_id,workspace_id,store_id,event,platform,payload,dedup_key,
    erp_connection_id,connection_generation,execution_key,retry_count,max_retries,next_retry_at)
  VALUES(receipt.id,receipt.workspace_id,receipt.store_id,receipt.event,receipt.platform,receipt.payload,receipt.dedup_key,
    receipt.erp_connection_id,receipt.connection_generation,
    md5(jsonb_build_array(receipt.workspace_id,receipt.platform,receipt.store_id,receipt.erp_connection_id,
      coalesce(receipt.payload->>'id',receipt.payload->'data'->>'id',receipt.payload->>'order_id',
        receipt.payload->>'odooRecordId',receipt.payload->>'quant_id',receipt.id::text))::text),0,
    greatest(1,least(20,coalesce((p_queue_row->>'max_retries')::int,5))),
    coalesce((p_queue_row->>'next_retry_at')::timestamptz,now()))
  ON CONFLICT(receipt_id) DO UPDATE SET receipt_id=excluded.receipt_id RETURNING id INTO job_id;
  UPDATE public.webhook_inbox SET queue_id=job_id,status='done',processed_at=now() WHERE id=receipt.id;
  RETURN job_id;
END $$;

CREATE OR REPLACE FUNCTION public.claim_sync_job(p_job_id uuid,p_force boolean DEFAULT false,p_lease_seconds int DEFAULT 900)
RETURNS SETOF public.sync_queue LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  RETURN QUERY UPDATE public.sync_queue q SET lease_token=gen_random_uuid(),
    lease_expires_at=now()+make_interval(secs=>greatest(30,least(p_lease_seconds,3600)))
  WHERE q.id=p_job_id AND q.lease_token IS NULL AND NOT q.outcome_unknown
    AND q.next_retry_at IS NOT NULL AND q.retry_count<q.max_retries
    AND q.erp_connection_id IS NOT NULL AND q.connection_generation IS NOT NULL
    AND (p_force OR q.next_retry_at<=now())
    AND NOT EXISTS(SELECT 1 FROM public.sync_queue other WHERE other.id<>q.id
      AND other.execution_key=q.execution_key AND (other.lease_token IS NOT NULL OR other.outcome_unknown))
    RETURNING q.*;
EXCEPTION WHEN unique_violation THEN RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_sync_job_leases()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.sync_queue SET outcome_unknown=true,next_retry_at=NULL,
    lease_token=NULL,lease_expires_at=NULL,error_message='ERP_OUTCOME_UNKNOWN: worker lease expired; reconciliation required'
  WHERE lease_token IS NOT NULL AND lease_expires_at<now();
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END $$;

REVOKE ALL ON FUNCTION public.dispatch_webhook_receipt(uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_sync_job(uuid,boolean,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.expire_sync_job_leases() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_webhook_receipt(uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_sync_job(uuid,boolean,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_sync_job_leases() TO service_role;
COMMIT;
