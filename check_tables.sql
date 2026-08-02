SELECT tablename FROM pg_tables WHERE schemaname='public' 
AND (tablename LIKE 'telegram%' OR tablename LIKE 'notification_preferences');
