-- Add fallback policy column to field_mappings
ALTER TABLE field_mappings
ADD COLUMN IF NOT EXISTS odoo_fallback_policy TEXT NOT NULL DEFAULT 'none';
