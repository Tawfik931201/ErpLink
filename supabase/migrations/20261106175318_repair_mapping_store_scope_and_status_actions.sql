-- Repair deployment drift without changing saved merchant settings.
-- Replaces legacy uniqueness by its actual columns, not a guessed/truncated name.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.product_mappings ADD COLUMN IF NOT EXISTS store_id text NOT NULL DEFAULT '';
ALTER TABLE public.category_mappings ADD COLUMN IF NOT EXISTS store_id text NOT NULL DEFAULT '';

DO $$
DECLARE
  item record;
  old_constraint record;
  old_columns text[];
  new_columns text[];
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('product_mappings', 'source_product_id', 'uq_product_mappings_ws_platform_store_source'),
    ('category_mappings', 'source_category_name', 'uq_category_mappings_ws_platform_store_name')
  ) AS specifications(table_name, source_column, constraint_name)
  LOOP
    old_columns := ARRAY['workspace_id', 'platform', item.source_column];
    new_columns := ARRAY['workspace_id', 'platform', 'store_id', item.source_column];
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = format('public.%I', item.table_name)::regclass AND c.contype = 'u'
        AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum, position)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.position) = new_columns
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (workspace_id, platform, store_id, %I)',
        item.table_name, item.constraint_name, item.source_column);
    END IF;
    FOR old_constraint IN
      SELECT c.conname FROM pg_constraint c
      WHERE c.conrelid = format('public.%I', item.table_name)::regclass AND c.contype = 'u'
        AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum, position)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.position) = old_columns
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', item.table_name, old_constraint.conname);
    END LOOP;
  END LOOP;
END $$;

-- New unique indexes already cover (workspace_id, platform, store_id).
-- Do not create redundant indexes or remove unrelated existing constraints.
DO $$
DECLARE
  add_invoice boolean;
  add_picking boolean;
  before_status jsonb;
  before_settings jsonb;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='order_status_mappings' AND column_name='invoice_action') INTO add_invoice;
  SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='order_status_mappings' AND column_name='picking_action') INTO add_picking;
  SELECT jsonb_agg(to_jsonb(o) - 'invoice_action' - 'picking_action' ORDER BY id)
    INTO before_status FROM public.order_status_mappings o;
  SELECT jsonb_agg(to_jsonb(s) ORDER BY id) INTO before_settings FROM public.standard_mapping_settings s;

  ALTER TABLE public.order_status_mappings ADD COLUMN IF NOT EXISTS invoice_action text DEFAULT NULL;
  ALTER TABLE public.order_status_mappings ADD COLUMN IF NOT EXISTS picking_action text DEFAULT NULL;

  -- The old reader merged JSON actions while these columns were absent.
  -- Seed newly added columns once; existing columns (including cleared values)
  -- remain authoritative on subsequent runs. Empty JSON values remain empty.
  IF add_invoice OR add_picking THEN
    WITH effective_actions AS (
      SELECT o.id,
        coalesce(coalesce(s.settings #> '{order,status_actions}', s.settings->'status_actions')->o.zid_status->>'invoice_action', '') AS invoice_action,
        coalesce(coalesce(s.settings #> '{order,status_actions}', s.settings->'status_actions')->o.zid_status->>'picking_action', '') AS picking_action
      FROM public.order_status_mappings o
      LEFT JOIN LATERAL (
        SELECT settings FROM public.standard_mapping_settings s
        WHERE s.workspace_id=o.workspace_id AND s.store_type=o.platform
          AND s.entity_type='orders' AND s.store_id IN (o.store_id, '')
        ORDER BY (s.store_id=o.store_id) DESC LIMIT 1
      ) s ON true
    )
    UPDATE public.order_status_mappings o
    SET invoice_action = CASE WHEN add_invoice THEN a.invoice_action ELSE o.invoice_action END,
        picking_action = CASE WHEN add_picking THEN a.picking_action ELSE o.picking_action END
    FROM effective_actions a WHERE a.id=o.id;
  END IF;

  -- updated_at triggers may advance timestamps, but no state, identity or enabled
  -- flag may change. Saved settings are never rewritten by this migration.
  IF (SELECT jsonb_agg(to_jsonb(o) - 'invoice_action' - 'picking_action' - 'updated_at' ORDER BY id)
      FROM public.order_status_mappings o) IS DISTINCT FROM
    (SELECT jsonb_agg(value - 'updated_at') FROM jsonb_array_elements(before_status)) THEN
    RAISE EXCEPTION 'Order status identity/state invariants changed';
  END IF;
  IF (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.standard_mapping_settings s)
      IS DISTINCT FROM before_settings THEN
    RAISE EXCEPTION 'Saved settings changed';
  END IF;
END $$;

COMMENT ON COLUMN public.order_status_mappings.invoice_action IS 'Invoice action: none, create, post, create_and_post, cancel; empty means no action';
COMMENT ON COLUMN public.order_status_mappings.picking_action IS 'Stock picking action: none, create, validate, create_and_validate, cancel; empty means no action';
NOTIFY pgrst, 'reload schema';
COMMIT;
