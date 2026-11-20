-- Minimal server state: browser holds notification history in IndexedDB.
-- The server MUST retain push subscriptions + delivery cursor while browser is closed.
create table if not exists public.browser_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_scanned_at timestamptz not null default now(),
  last_receipt_id uuid null
);
create index if not exists browser_push_subscriptions_workspace_idx
  on public.browser_push_subscriptions(workspace_id);
create index if not exists browser_push_subscriptions_user_idx
  on public.browser_push_subscriptions(user_id);
alter table public.browser_push_subscriptions enable row level security;
-- No anon/authenticated Data API access: server-only service_role queries after Clerk verification.
revoke all on public.browser_push_subscriptions from anon, authenticated;
comment on table public.browser_push_subscriptions is
  'Minimal endpoint state for browser Web Push. Notification history lives in IndexedDB, source events remain in webhook_inbox.';
