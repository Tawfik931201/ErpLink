-- =============================================================
-- Migration: Affiliate client invites (Clerk)
-- =============================================================
-- When an affiliate registers a client who does not yet have an
-- account in the system, we send the client a Clerk invitation to
-- sign up. This table tracks those pending invitations so that once
-- the client accepts (Clerk `user.created` webhook), the workspace
-- the affiliate registered is auto-created and attributed to the
-- affiliate (partner_id), while the workspace owner stays the client.
-- =============================================================

CREATE TABLE IF NOT EXISTS affiliate_client_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      UUID NOT NULL REFERENCES partner_profiles(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  workspace_name  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','completed','expired')),
  clerk_invite_id TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_affiliate_invites_partner ON affiliate_client_invites(partner_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_invites_email    ON affiliate_client_invites(email);
CREATE INDEX IF NOT EXISTS idx_affiliate_invites_status   ON affiliate_client_invites(status);
