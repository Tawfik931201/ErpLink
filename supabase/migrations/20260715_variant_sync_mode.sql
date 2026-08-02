-- Migration: Add variant synchronization preferences columns to field_mappings table
ALTER TABLE field_mappings 
ADD COLUMN IF NOT EXISTS variant_sync_mode VARCHAR(255) DEFAULT 'AS_VARIANTS',
ADD COLUMN IF NOT EXISTS variant_odoo_match_field VARCHAR(255) NULL,
ADD COLUMN IF NOT EXISTS variant_zid_match_field VARCHAR(255) NULL;
