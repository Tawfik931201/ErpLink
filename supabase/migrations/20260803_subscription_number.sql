-- =============================================================
-- Migration: Subscription Number on Workspaces
-- =============================================================
-- Adds a unique sequential subscription number to the workspaces table.
-- Automatically generates numbers starting from SUB-100001 for all existing
-- and future workspaces.
-- =============================================================

CREATE SEQUENCE IF NOT EXISTS workspace_subscription_seq START WITH 100001;

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS subscription_number TEXT UNIQUE DEFAULT 'SUB-' || nextval('workspace_subscription_seq')::text;
