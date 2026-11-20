-- Independent workspace-scoped, durable notifications and browser push subscriptions.
BEGIN;
CREATE TABLE IF NOT EXISTS public.app_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 event_key text NOT NULL,
 event text NOT NULL,
 platform text NOT NULL DEFAULT 'zid',
 title text NOT NULL,
 body text NOT NULL,
 href text NOT NULL DEFAULT '/app/logs',
 status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','success','failed','skipped')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,event_key)
);
CREATE INDEX IF NOT EXISTS app_notifications_workspace_created_idx ON public.app_notifications(workspace_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.browser_push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 user_id text NOT NULL,
 endpoint text NOT NULL,
 p256dh text NOT NULL,
 auth text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,user_id,endpoint)
);
CREATE INDEX IF NOT EXISTS browser_push_subscriptions_workspace_idx ON public.browser_push_subscriptions(workspace_id) WHERE enabled;
CREATE TABLE IF NOT EXISTS public.browser_push_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 notification_id uuid NOT NULL REFERENCES public.app_notifications(id) ON DELETE CASCADE,
 subscription_id uuid NOT NULL REFERENCES public.browser_push_subscriptions(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
 attempts int NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(notification_id,subscription_id)
);
CREATE INDEX IF NOT EXISTS browser_push_deliveries_pending_idx ON public.browser_push_deliveries(next_attempt_at) WHERE status = 'pending';
ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.browser_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.browser_push_deliveries ENABLE ROW LEVEL SECURITY;
-- These tables are only accessed by authenticated server routes using service role,
-- which explicitly enforce workspace membership. Never grant client roles access.
REVOKE ALL ON public.app_notifications, public.browser_push_subscriptions, public.browser_push_deliveries FROM anon, authenticated;
COMMIT;
