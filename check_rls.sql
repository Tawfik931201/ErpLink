-- Check if RLS is enabled and what policies exist on telegram tables
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE tablename IN (
  'telegram_bots',
  'telegram_bot_chats',
  'telegram_bot_codes',
  'telegram_links',
  'telegram_link_codes',
  'notification_preferences'
)
AND schemaname = 'public';

SELECT
  tablename,
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename LIKE 'telegram%'
   OR tablename = 'notification_preferences';
