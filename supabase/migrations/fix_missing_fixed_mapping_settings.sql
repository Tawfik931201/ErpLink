-- تشغيل هذا الكود في Supabase SQL Editor
-- ينشئ جدول fixed_mapping_settings المفقود

CREATE TABLE IF NOT EXISTS fixed_mapping_settings (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  preset_key   TEXT NOT NULL,
  settings     JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, preset_key)
);

COMMENT ON TABLE  fixed_mapping_settings IS 'Stores per-preset settings overrides (language, price, category mode, image handling, etc.)';
COMMENT ON COLUMN fixed_mapping_settings.settings IS 'JSON with keys like name_language, price_source, category_sync_mode, image_sync, stock_direction, match_strategy, etc.';
