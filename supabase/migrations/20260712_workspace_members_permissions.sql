-- =============================================================
-- Migration: Workspace member permissions + invitations
-- =============================================================
-- Adds page-level permissions to workspace_members
-- Creates workspace_invitations for inviting new users via Clerk
-- =============================================================

-- 1. Add permissions column to workspace_members
ALTER TABLE workspace_members
ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '["dashboard", "connect-store", "connect-odoo", "mapping-center", "transfers", "tickets"]'::jsonb;

-- 2. Create workspace_invitations table
CREATE TABLE IF NOT EXISTS workspace_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL,
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invited_by      TEXT NOT NULL,
  permissions     JSONB NOT NULL DEFAULT '["dashboard", "connect-store", "connect-odoo", "mapping-center", "transfers", "tickets"]'::jsonb,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','expired','revoked')),
  clerk_invite_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_invitations_email ON workspace_invitations(email);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_status ON workspace_invitations(status);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_workspace ON workspace_invitations(workspace_id);
