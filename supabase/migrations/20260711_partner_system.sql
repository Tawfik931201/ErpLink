-- =============================================================
-- Migration: Partner system (profiles, invitations, agreements, commissions, payouts, audit)
-- =============================================================
-- Adds tables for the partner program:
--   partner_profiles            : partner accounts, tiers, status
--   partner_tier_history        : audit trail for tier/rate changes
--   partner_onboarding_invitations : one-time tokens given to clients
--   partner_agreements          : contracts signed between partner and client
--   partner_commissions         : per-invoice commission records (USD)
--   payout_requests             : cash-out flows
--   audit_logs                  : security/operational audit trail
-- Adds workspace columns for partner linkage.
-- All amounts are stored as numeric USD with explicit precision.
-- =============================================================

-- 1. partner_profiles
CREATE TABLE IF NOT EXISTS partner_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','suspended','rejected')),
  tier            TEXT NOT NULL DEFAULT 'starter'
                    CHECK (tier IN ('starter','growth','gold')),
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0.15,
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  notes           TEXT,
  rejection_reason TEXT,
  suspended_at    TIMESTAMPTZ,
  suspended_by    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_profiles_status ON partner_profiles(status);
CREATE INDEX IF NOT EXISTS idx_partner_profiles_tier   ON partner_profiles(tier);

-- 2. partner_tier_history
CREATE TABLE IF NOT EXISTS partner_tier_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  UUID NOT NULL REFERENCES partner_profiles(id) ON DELETE CASCADE,
  old_tier    TEXT,
  new_tier    TEXT NOT NULL,
  old_rate    NUMERIC(5,2),
  new_rate    NUMERIC(5,2),
  changed_by  TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason      TEXT
);

CREATE INDEX IF NOT EXISTS idx_partner_tier_history_partner ON partner_tier_history(partner_id);

-- 3. workspaces additions (partner linkage)
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS partner_id                     UUID REFERENCES partner_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_status                 TEXT DEFAULT 'pending'
                                                          CHECK (partner_status IS NULL OR partner_status IN ('pending','active','rejected')),
  ADD COLUMN IF NOT EXISTS partner_linked_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS partner_link_requested_by      TEXT,
  ADD COLUMN IF NOT EXISTS partner_approved_by_admin      TEXT,
  ADD COLUMN IF NOT EXISTS partner_approved_admin_at      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_workspaces_partner        ON workspaces(partner_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_partner_status ON workspaces(partner_status);

-- 4. partner_onboarding_invitations
CREATE TABLE IF NOT EXISTS partner_onboarding_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      UUID NOT NULL REFERENCES partner_profiles(id) ON DELETE CASCADE,
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  email           TEXT NOT NULL,
  client_name     TEXT NOT NULL,
  token           TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','linked','expired','revoked')),
  expires_at      TIMESTAMPTZ,
  accepted_at     TIMESTAMPTZ,
  created_user_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_inv_partner     ON partner_onboarding_invitations(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_inv_workspace   ON partner_onboarding_invitations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_partner_inv_status      ON partner_onboarding_invitations(status);
CREATE INDEX IF NOT EXISTS idx_partner_inv_expires     ON partner_onboarding_invitations(expires_at);

-- 5. partner_agreements
CREATE TABLE IF NOT EXISTS partner_agreements (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id                  UUID NOT NULL REFERENCES partner_profiles(id) ON DELETE CASCADE,
  workspace_id                UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workspace_owner_user_id     TEXT NOT NULL,
  pdf_url                     TEXT,
  pdf_hash                    TEXT,
  pdf_filename                TEXT,
  pdf_size                    INTEGER,
  signed_text                 TEXT,
  signed_by_partner_user_id   TEXT,
  signed_by_client_user_id    TEXT,
  signed_by_partner_at        TIMESTAMPTZ,
  signed_by_client_at         TIMESTAMPTZ,
  status                      TEXT NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft','pending_signatures','active','terminated')),
  terminated_at               TIMESTAMPTZ,
  terminated_reason           TEXT,
  agreement_version           INTEGER NOT NULL DEFAULT 1,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_agreements_partner          ON partner_agreements(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_agreements_workspace        ON partner_agreements(workspace_id);
CREATE INDEX IF NOT EXISTS idx_partner_agreements_workspace_owner  ON partner_agreements(workspace_owner_user_id);

-- 6. partner_commissions
CREATE TABLE IF NOT EXISTS partner_commissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id        UUID NOT NULL REFERENCES partner_profiles(id) ON DELETE CASCADE,
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_user_id    TEXT NOT NULL,
  gross_amount      NUMERIC(12,2) NOT NULL,
  commission_rate   NUMERIC(5,2)  NOT NULL,
  commission_amount NUMERIC(12,2) NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',
  status            TEXT NOT NULL DEFAULT 'approved'
                      CHECK (status IN ('approved','void')),
  source            TEXT NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('manual','stripe')),
  invoice_ref       TEXT,
  stripe_invoice_id TEXT UNIQUE,
  period_start      TIMESTAMPTZ NOT NULL,
  period_end        TIMESTAMPTZ NOT NULL,
  note              TEXT,
  paid_in_payout_id UUID,
  void_reason       TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_commissions_partner    ON partner_commissions(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_commissions_workspace  ON partner_commissions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_partner_commissions_client     ON partner_commissions(client_user_id);
CREATE INDEX IF NOT EXISTS idx_partner_commissions_status     ON partner_commissions(status);

-- 7. payout_requests
CREATE TABLE IF NOT EXISTS payout_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id        UUID NOT NULL REFERENCES partner_profiles(id) ON DELETE CASCADE,
  amount            NUMERIC(12,2) NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',
  period_start      TIMESTAMPTZ NOT NULL,
  period_end        TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','under_review','approved','paid','rejected')),
  commission_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_by      TEXT NOT NULL,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by       TEXT,
  reviewed_at       TIMESTAMPTZ,
  review_note       TEXT,
  approved_by       TEXT,
  approved_at       TIMESTAMPTZ,
  paid_by           TEXT,
  paid_at           TIMESTAMPTZ,
  payment_reference TEXT,
  payment_note      TEXT,
  rejection_reason  TEXT
);

CREATE INDEX IF NOT EXISTS idx_payout_requests_partner ON payout_requests(partner_id);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status  ON payout_requests(status);

-- 8. payout_requests ↔ partner_commissions back-reference (FK for paid_in_payout_id)
ALTER TABLE partner_commissions
  DROP CONSTRAINT IF EXISTS partner_commissions_paid_in_payout_id_fkey;
ALTER TABLE partner_commissions
  ADD CONSTRAINT partner_commissions_paid_in_payout_id_fkey
    FOREIGN KEY (paid_in_payout_id) REFERENCES payout_requests(id) ON DELETE SET NULL;

-- 9. users.app_role
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS app_role TEXT NOT NULL DEFAULT 'user'
    CHECK (app_role IN ('user','partner','admin'));

-- 10. audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    TEXT NOT NULL,
  actor_role  TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor    ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action   ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity   ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created  ON audit_logs(created_at);

-- =============================================================
-- Row Level Security
-- =============================================================
-- All read/write policies below assume auth context is the Clerk user id.
-- Privileged writes (admin operations) must go through Server Actions using
-- the Supabase service-role key, NOT the user's JWT-scoped client.
-- =============================================================

-- partner_profiles
ALTER TABLE partner_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_profiles_self_read" ON partner_profiles;
DROP POLICY IF EXISTS "partner_profiles_all_for_admin" ON partner_profiles;
CREATE POLICY "partner_profiles_self_read" ON partner_profiles
  FOR SELECT USING (user_id = auth.uid()::text);
CREATE POLICY "partner_profiles_all_for_admin" ON partner_profiles
  FOR ALL USING (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  ) WITH CHECK (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );

-- partner_tier_history
ALTER TABLE partner_tier_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_tier_history_self_read" ON partner_tier_history;
CREATE POLICY "partner_tier_history_self_read" ON partner_tier_history
  FOR SELECT USING (
    partner_id IN (SELECT id FROM partner_profiles WHERE user_id = auth.uid()::text)
    OR coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );

-- workspaces partner columns visibility
DROP POLICY IF EXISTS "workspaces_partner_read" ON workspaces;
CREATE POLICY "workspaces_partner_read" ON workspaces
  FOR SELECT USING (
    user_id = auth.uid()::text
    OR partner_id IN (SELECT id FROM partner_profiles WHERE user_id = auth.uid()::text)
    OR coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );

-- partner_onboarding_invitations
ALTER TABLE partner_onboarding_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_inv_partner_read" ON partner_onboarding_invitations;
DROP POLICY IF EXISTS "partner_inv_admin_all" ON partner_onboarding_invitations;
CREATE POLICY "partner_inv_partner_read" ON partner_onboarding_invitations
  FOR SELECT USING (
    partner_id IN (SELECT id FROM partner_profiles WHERE user_id = auth.uid()::text)
  );
CREATE POLICY "partner_inv_admin_all" ON partner_onboarding_invitations
  FOR ALL USING (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  ) WITH CHECK (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );

-- partner_agreements
ALTER TABLE partner_agreements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_agreements_visibility" ON partner_agreements;
CREATE POLICY "partner_agreements_visibility" ON partner_agreements
  FOR SELECT USING (
    partner_id IN (SELECT id FROM partner_profiles WHERE user_id = auth.uid()::text)
    OR workspace_owner_user_id = auth.uid()::text
    OR coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );

-- partner_commissions
ALTER TABLE partner_commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_commissions_partner_read" ON partner_commissions;
DROP POLICY IF EXISTS "partner_commissions_admin_all" ON partner_commissions;
CREATE POLICY "partner_commissions_partner_read" ON partner_commissions
  FOR SELECT USING (
    partner_id IN (SELECT id FROM partner_profiles WHERE user_id = auth.uid()::text)
    OR client_user_id = auth.uid()::text
  );
CREATE POLICY "partner_commissions_admin_all" ON partner_commissions
  FOR ALL USING (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  ) WITH CHECK (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );

-- payout_requests
ALTER TABLE payout_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payout_requests_partner_read" ON payout_requests;
DROP POLICY IF EXISTS "payout_requests_admin_all" ON payout_requests;
CREATE POLICY "payout_requests_partner_read" ON payout_requests
  FOR SELECT USING (
    partner_id IN (SELECT id FROM partner_profiles WHERE user_id = auth.uid()::text)
  );
CREATE POLICY "payout_requests_admin_all" ON payout_requests
  FOR ALL USING (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  ) WITH CHECK (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );

-- audit_logs: admin read only
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_logs_admin_read" ON audit_logs;
CREATE POLICY "audit_logs_admin_read" ON audit_logs
  FOR SELECT USING (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );
