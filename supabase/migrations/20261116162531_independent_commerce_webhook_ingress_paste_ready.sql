-- Paste-ready variant of 20261116162531_independent_commerce_webhook_ingress.sql
-- for the Supabase SQL Editor on installations that paste migrations by hand.
--
-- Why this variant exists: the canonical file uses plain ADD COLUMN / CREATE
-- TABLE / CREATE INDEX, so re-running it after a partial or repeated paste
-- aborts on `column already exists`. Everything below is idempotent, so a
-- second run is a no-op instead of an error.
--
-- Deploying the code from `ba1e193` (store deliveries accepted before an ERP
-- exists) BEFORE this migration is applied makes EVERY Zid/Salla/Shopify
-- webhook fail its durable write:
--   PostgREST PGRST204 — Could not find the 'awaiting_erp' column of 'webhook_inbox'
-- which the routes report as 503 {"received":false,...,"error":"durable_storage_failed"}.

BEGIN;

ALTER TABLE public.webhook_inbox
  ADD COLUMN IF NOT EXISTS awaiting_erp boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS next_dispatch_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_webhook_inbox_dispatch_due
  ON public.webhook_inbox(next_dispatch_at, received_at)
  WHERE status = 'pending' AND workspace_id IS NOT NULL;

ALTER TABLE public.erp_workspace_bindings ADD COLUMN IF NOT EXISTS switched_at timestamptz;
ALTER TABLE public.field_mappings ADD COLUMN IF NOT EXISTS erp_destination_retired_at timestamptz;

CREATE TABLE IF NOT EXISTS reliability_backup.erp_destination_mapping_archive (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  erp_connection_id uuid NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  configuration jsonb NOT NULL
);
REVOKE ALL ON reliability_backup.erp_destination_mapping_archive FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA reliability_backup TO service_role;
GRANT INSERT ON reliability_backup.erp_destination_mapping_archive TO service_role;
GRANT USAGE ON SEQUENCE reliability_backup.erp_destination_mapping_archive_id_seq TO service_role;

-- Settings may contain nested records and arrays. Keep source-side selectors,
-- toggles, match fields and status rules, and clear remote record references.
CREATE OR REPLACE FUNCTION public.clear_switched_erp_references(value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      RETURN (SELECT coalesce(jsonb_object_agg(key, public.clear_switched_erp_references(item)), '{}'::jsonb)
              FROM jsonb_each(value) AS fields(key, item)
              WHERE key NOT IN ('store_warehouse_mappings', 'odoo_stock_webhook', 'location_mappings')
                AND (key !~ '(_id|_ids)$' OR key ~ '^(zid|salla|shopify|source|store)_'));
    WHEN 'array' THEN
      RETURN (SELECT coalesce(jsonb_agg(public.clear_switched_erp_references(item) ORDER BY position), '[]'::jsonb)
              FROM jsonb_array_elements(value) WITH ORDINALITY AS entries(item, position));
    ELSE RETURN value;
  END CASE;
END $$;
REVOKE ALL ON FUNCTION public.clear_switched_erp_references(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_switched_erp_references(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.switch_erp_mapping_destination(
  p_workspace_id uuid, p_connection_id uuid, p_erp_type text, p_url text, p_db_name text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE binding public.erp_workspace_bindings%ROWTYPE;
        mapping_table text;
        previous_rows jsonb;
        snapshot jsonb := '{}'::jsonb;
BEGIN
  -- Resolve against the saved connection again and serialize switches for
  -- the workspace. The connection row stays locked until the switch commits.
  PERFORM 1 FROM public.erp_connections c
  WHERE c.id = p_connection_id AND c.workspace_id = p_workspace_id
    AND (c.status IS NULL OR c.status = 'connected')
    AND coalesce(nullif(c.erp_type, ''), 'odoo') = p_erp_type
    AND c.url = p_url AND coalesce(c.db_name, '') = p_db_name
    AND NOT EXISTS (SELECT 1 FROM public.erp_connections other
                    WHERE other.workspace_id = p_workspace_id AND other.id <> c.id)
  FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT * INTO binding FROM public.erp_workspace_bindings
  WHERE workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF (binding.erp_connection_id, binding.erp_type, binding.url, binding.db_name)
     IS NOT DISTINCT FROM (p_connection_id, p_erp_type, p_url, p_db_name)
  THEN RETURN true; END IF;

  -- Reconnecting the same database does not invalidate its numeric record IDs.
  IF (binding.erp_type, binding.url, binding.db_name)
     IS DISTINCT FROM (p_erp_type, p_url, p_db_name) THEN
    FOREACH mapping_table IN ARRAY ARRAY[
      'category_mappings', 'currency_mappings', 'payment_method_mappings',
      'product_mappings', 'shipping_method_mappings', 'tax_mappings',
      'warehouse_mappings', 'fixed_mapping_settings', 'fixed_mapping_rules'
    ] LOOP
      IF to_regclass(format('public.%I', mapping_table)) IS NULL THEN CONTINUE; END IF;
      EXECUTE format(
        'WITH removed AS (DELETE FROM public.%I WHERE workspace_id = $1 RETURNING *)
         SELECT jsonb_agg(to_jsonb(removed)) FROM removed', mapping_table)
      INTO previous_rows USING p_workspace_id;
      IF previous_rows IS NOT NULL THEN
        snapshot := snapshot || jsonb_build_object(mapping_table, previous_rows);
      END IF;
    END LOOP;

    SELECT jsonb_agg(to_jsonb(settings)) INTO previous_rows
      FROM (SELECT * FROM public.standard_mapping_settings
            WHERE workspace_id = p_workspace_id FOR UPDATE) AS settings;
    IF previous_rows IS NOT NULL THEN
      snapshot := snapshot || jsonb_build_object('standard_mapping_settings', previous_rows);
    END IF;
    UPDATE public.standard_mapping_settings SET
      settings = public.clear_switched_erp_references(settings) #- '{inventory,sync_enabled}',
      updated_at = now()
    WHERE workspace_id = p_workspace_id;

    -- Preserve field mappings and their dependent sync logs for inspection.
    UPDATE public.field_mappings SET erp_destination_retired_at = now()
    WHERE workspace_id = p_workspace_id AND erp_destination_retired_at IS NULL;

    INSERT INTO reliability_backup.erp_destination_mapping_archive
      (workspace_id, erp_connection_id, configuration)
    VALUES (p_workspace_id, binding.erp_connection_id, snapshot);
  END IF;

  UPDATE public.erp_workspace_bindings SET erp_connection_id = p_connection_id,
    erp_type = p_erp_type, url = p_url, db_name = p_db_name,
    switched_at = CASE
      WHEN (binding.erp_type, binding.url, binding.db_name)
        IS DISTINCT FROM (p_erp_type, p_url, p_db_name) THEN now()
      ELSE binding.switched_at END
  WHERE workspace_id = p_workspace_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.switch_erp_mapping_destination(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.switch_erp_mapping_destination(uuid, uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.dispatch_webhook_receipt(p_receipt_id uuid, p_queue_row jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE receipt public.webhook_inbox%ROWTYPE; job_id uuid;
BEGIN
  SELECT * INTO receipt FROM public.webhook_inbox WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found'; END IF;
  IF receipt.queue_id IS NOT NULL THEN RETURN receipt.queue_id; END IF;

  IF receipt.awaiting_erp AND receipt.status = 'pending'
    AND receipt.platform IN ('zid', 'salla', 'shopify')
    AND receipt.erp_connection_id IS NULL AND receipt.connection_generation IS NULL THEN
    receipt.erp_connection_id := (p_queue_row->>'erp_connection_id')::uuid;
    receipt.connection_generation := nullif(p_queue_row->>'connection_generation', '');
  END IF;
  IF receipt.workspace_id IS NULL OR receipt.erp_connection_id IS NULL OR receipt.connection_generation IS NULL THEN
    RAISE EXCEPTION 'Receipt requires verified destination recovery';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.erp_connections c WHERE c.id = receipt.erp_connection_id
    AND c.workspace_id = receipt.workspace_id AND (c.status IS NULL OR c.status = 'connected')) THEN
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
  ON CONFLICT(receipt_id) DO UPDATE SET receipt_id = excluded.receipt_id RETURNING id INTO job_id;

  UPDATE public.webhook_inbox SET queue_id = job_id, status = 'done', processed_at = now(),
    awaiting_erp = false, last_error = NULL, erp_connection_id = receipt.erp_connection_id,
    connection_generation = receipt.connection_generation
  WHERE id = receipt.id;
  RETURN job_id;
END $$;

REVOKE ALL ON FUNCTION public.dispatch_webhook_receipt(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_webhook_receipt(uuid,jsonb) TO service_role;

COMMIT;

-- ─── Verification (read-only, run after COMMIT) ──────────────────────────────
-- Expect two rows, both `t`.
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'webhook_inbox'
--   AND column_name IN ('awaiting_erp', 'next_dispatch_at');
