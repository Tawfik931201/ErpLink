-- ────────────────────────────────────────────────────────────────────────────
-- 20260802_order_cancel_deliver_presets.sql
-- Seeds preset definitions for order cancel/deliver events (all platforms)
-- so the fixed-mapping path can sync order status changes end-to-end.
-- Idempotent: ON CONFLICT (preset_key) DO NOTHING.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO fixed_mapping_preset_definitions
  (preset_key, platform, odoo_model, action, category, icon_name, display_order, default_label_ar, default_label_en, default_field_rows)
VALUES
  -- ─── Orders (cancel) ───────────────────────────────────
  ('zid_order_cancel',   'zid',     'sale.order',   'order.cancel',      'orders', 'Ban',             43, 'إلغاء طلب (زد → أودو)',     'Cancel Order (Zid → Odoo)',
   '[{"odoo_field":"x_zid_id","platform_field":"id"}]'::jsonb),

  ('salla_order_cancel', 'salla',   'sale.order',   'order.cancel',      'orders', 'Ban',             44, 'إلغاء طلب (سلة → أودو)',   'Cancel Order (Salla → Odoo)',
   '[{"odoo_field":"x_salla_id","platform_field":"id"}]'::jsonb),

  ('shopify_order_cancel','shopify','sale.order',   'order.cancel',      'orders', 'Ban',             45, 'إلغاء طلب (شوبيفاي → أودو)', 'Cancel Order (Shopify → Odoo)',
   '[{"odoo_field":"x_zid_id","platform_field":"id"}]'::jsonb),

  -- ─── Orders (deliver) ──────────────────────────────────
  ('zid_order_deliver',   'zid',     'sale.order',   'order.deliver',     'orders', 'Truck',           46, 'توصيل طلب (زد → أودو)',     'Deliver Order (Zid → Odoo)',
   '[{"odoo_field":"x_zid_id","platform_field":"id"}]'::jsonb),

  ('salla_order_deliver', 'salla',   'sale.order',   'order.deliver',     'orders', 'Truck',           47, 'توصيل طلب (سلة → أودو)',   'Deliver Order (Salla → Odoo)',
   '[{"odoo_field":"x_salla_id","platform_field":"id"}]'::jsonb),

  ('shopify_order_deliver','shopify','sale.order',   'order.deliver',     'orders', 'Truck',           48, 'توصيل طلب (شوبيفاي → أودو)', 'Deliver Order (Shopify → Odoo)',
   '[{"odoo_field":"x_zid_id","platform_field":"id"}]'::jsonb)
ON CONFLICT (preset_key) DO NOTHING;
