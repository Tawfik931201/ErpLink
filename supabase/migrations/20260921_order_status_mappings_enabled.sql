-- Migration: per-status enable flag for order status mappings
-- Date: 2026-09-21
--
-- Adds `enabled` to order_status_mappings so each store status can be toggled:
-- disabled statuses leave Odoo untouched when Zid moves into them.

ALTER TABLE order_status_mappings ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
