-- P1-2 of the season plan: new Telegram chat subscriptions default to
-- failure-only notifications (the recommended mode). Existing rows are NOT
-- touched — only the column default changes. Arrival alerts remain an explicit
-- opt-in stored inside mapping_filter JSON (see parseArrivalFilter).
ALTER TABLE telegram_bot_chats
  ALTER COLUMN notify_mode SET DEFAULT 'failure';
