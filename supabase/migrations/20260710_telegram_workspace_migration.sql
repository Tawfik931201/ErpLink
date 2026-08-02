-- =============================================================
-- Migration: Telegram tables → workspace-based multi-bot schema
-- =============================================================
-- Creates the new tables: telegram_bots, telegram_bot_chats, telegram_bot_codes
-- Drops old single-user tables: telegram_links, telegram_link_codes, notification_preferences
-- All Telegram data is now scoped to workspace_id, not user_id.
-- =============================================================

-- 1. telegram_bots — one workspace can have many bot tokens
CREATE TABLE IF NOT EXISTS telegram_bots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bot_token  TEXT NOT NULL,
  bot_username TEXT,
  label      TEXT,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','linked','invalid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_at  TIMESTAMPTZ,
  UNIQUE(workspace_id, bot_token)
);

CREATE INDEX IF NOT EXISTS idx_telegram_bots_workspace ON telegram_bots(workspace_id);

-- 2. telegram_bot_chats — one bot can have many linked chats
CREATE TABLE IF NOT EXISTS telegram_bot_chats (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id           UUID NOT NULL REFERENCES telegram_bots(id) ON DELETE CASCADE,
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chat_id          TEXT NOT NULL,
  chat_label       TEXT,
  language         TEXT NOT NULL DEFAULT 'ar' CHECK (language IN ('ar','en')),
  notify_mode      TEXT NOT NULL DEFAULT 'both' CHECK (notify_mode IN ('success','failure','both')),
  enabled          BOOLEAN NOT NULL DEFAULT true,
  workspace_filter JSONB DEFAULT '[]'::jsonb,
  mapping_filter   JSONB DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(bot_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_bot_chats_bot ON telegram_bot_chats(bot_id);
CREATE INDEX IF NOT EXISTS idx_telegram_bot_chats_workspace ON telegram_bot_chats(workspace_id);

-- 3. telegram_bot_codes — short-lived link codes for /start confirmation
CREATE TABLE IF NOT EXISTS telegram_bot_codes (
  code         TEXT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bot_id       UUID REFERENCES telegram_bots(id) ON DELETE CASCADE,
  chat_id      TEXT,  -- stores chat_label temporarily before subscription is created
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_bot_codes_workspace ON telegram_bot_codes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_telegram_bot_codes_bot ON telegram_bot_codes(bot_id);
CREATE INDEX IF NOT EXISTS idx_telegram_bot_codes_expires ON telegram_bot_codes(expires_at);

-- 4. Drop old single-user tables (if they exist)
DROP TABLE IF EXISTS telegram_links CASCADE;
DROP TABLE IF EXISTS telegram_link_codes CASCADE;
DROP TABLE IF EXISTS notification_preferences CASCADE;
