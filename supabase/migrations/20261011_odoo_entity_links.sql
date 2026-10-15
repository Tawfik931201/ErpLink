-- =============================================================
-- Migration: odoo_entity_links — durable store→Odoo record links
-- Date: 2026-10-11
-- =============================================================
-- Why this table exists:
--   After a store webhook (e.g. Salla order.created) creates a record in
--   Odoo (e.g. sale.order #42), the Odoo id must stay resolvable for LATER
--   events (order.updated days later) so custom-mapping update/delete flows
--   can target the right record.
--
-- Why sync_logs is not enough:
--   1) sync_logs is an append-only audit log with no unique key — resolving
--      means `ORDER BY created_at DESC LIMIT 1` on every sync.
--   2) Its lookup is scoped by (workspace_id, zid_entity_id, odoo_model)
--      only — no store. Two Salla stores under one workspace that both have
--      order "1234" collide.
--   3) Successful rows are PURGED after 72h (cleanupExpiredLogs in
--      src/lib/sync-engine.ts) — an update arriving later can never resolve.
--
-- Key: (workspace_id, platform, store_id, odoo_model, store_entity_id).
-- store_id is the merchant_id (zid/salla) or shop_domain (shopify), so two
-- stores of one workspace never share a link. Rows are permanent (durable,
-- not a TTL cache): a stale link is harmless because the engine verifies the
-- Odoo record still exists (client.search) before using it.
--
-- Access: service-role only (like sync_logs). RLS policies below only
-- restrict anon/authenticated PostgREST access; they do not change app
-- behaviour.
--
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS throughout.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.odoo_entity_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL CHECK (platform IN ('zid', 'salla', 'shopify')),
  store_id        TEXT NOT NULL,
  entity_type     TEXT NOT NULL DEFAULT 'orders',
  store_entity_id TEXT NOT NULL,
  odoo_model      TEXT NOT NULL,
  odoo_record_id  INTEGER NOT NULL CHECK (odoo_record_id > 0),
  last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform, store_id, odoo_model, store_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_odoo_entity_links_lookup
  ON public.odoo_entity_links(workspace_id, platform, store_id, odoo_model, store_entity_id);

CREATE INDEX IF NOT EXISTS idx_odoo_entity_links_workspace
  ON public.odoo_entity_links(workspace_id, updated_at DESC);

ALTER TABLE public.odoo_entity_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their workspace odoo_entity_links"   ON public.odoo_entity_links;
CREATE POLICY "Users can view their workspace odoo_entity_links"           ON public.odoo_entity_links
  FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()::text));

DROP POLICY IF EXISTS "Users can insert their workspace odoo_entity_links" ON public.odoo_entity_links;
CREATE POLICY "Users can insert their workspace odoo_entity_links"         ON public.odoo_entity_links
  FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()::text));

DROP POLICY IF EXISTS "Users can update their workspace odoo_entity_links" ON public.odoo_entity_links;
CREATE POLICY "Users can update their workspace odoo_entity_links"         ON public.odoo_entity_links
  FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()::text));

DROP POLICY IF EXISTS "Users can delete their workspace odoo_entity_links" ON public.odoo_entity_links;
CREATE POLICY "Users can delete their workspace odoo_entity_links"         ON public.odoo_entity_links
  FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()::text));

-- =============================================================
-- One-time backfill from sync_logs (best-effort).
-- Takes the newest successful sync per (workspace, store, model, entity)
-- and promotes it to a durable link. Platform is derived by joining the
-- field mapping that produced the log and checking which token table owns
-- its merchant_id — precise, no event-name guessing.
-- Guarded: skipped entirely when either table is absent.
-- =============================================================
DO $$
BEGIN
  IF to_regclass('public.odoo_entity_links') IS NULL
     OR to_regclass('public.sync_logs') IS NULL
     OR to_regclass('public.field_mappings') IS NULL THEN
    RAISE NOTICE 'odoo_entity_links backfill skipped: required tables not all present (harmless)';
    RETURN;
  END IF;

  INSERT INTO public.odoo_entity_links
    (workspace_id, platform, store_id, entity_type, store_entity_id, odoo_model, odoo_record_id, last_synced_at)
  SELECT DISTINCT ON (l.workspace_id, derived.platform, derived.store_id, l.odoo_model, l.zid_entity_id)
    l.workspace_id,
    derived.platform,
    derived.store_id,
    CASE l.odoo_model
      WHEN 'sale.order' THEN 'orders'
      WHEN 'product.template' THEN 'products'
      WHEN 'product.product' THEN 'products'
      WHEN 'res.partner' THEN 'customers'
      WHEN 'product.category' THEN 'categories'
      ELSE 'records'
    END,
    l.zid_entity_id,
    l.odoo_model,
    l.odoo_record_id,
    l.created_at
  FROM public.sync_logs l
  JOIN public.field_mappings fm ON fm.id = l.field_mapping_id
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN EXISTS (SELECT 1 FROM public.salla_tokens st
                     WHERE st.merchant_id = fm.merchant_id AND st.workspace_id = l.workspace_id) THEN 'salla'
        WHEN EXISTS (SELECT 1 FROM public.shopify_tokens sht
                     WHERE sht.shop_domain = fm.merchant_id AND sht.workspace_id = l.workspace_id) THEN 'shopify'
        ELSE 'zid'
      END AS platform,
      COALESCE(NULLIF(fm.merchant_id, ''), l.store_id, '') AS store_id
  ) AS derived
  WHERE l.status = 'success'
    AND l.odoo_record_id IS NOT NULL
    -- odoo_record_id may carry non-Odoo values on other engines (ERPNext
    -- stores names); only numeric Odoo ids become links.
    AND l.odoo_record_id::text ~ '^[0-9]+$'
    AND l.zid_entity_id IS NOT NULL AND l.zid_entity_id <> ''
    AND l.odoo_model IS NOT NULL AND l.odoo_model <> ''
    AND derived.store_id <> ''
  ORDER BY l.workspace_id, derived.platform, derived.store_id, l.odoo_model, l.zid_entity_id, l.created_at DESC
  ON CONFLICT (workspace_id, platform, store_id, odoo_model, store_entity_id) DO NOTHING;
END
$$;
