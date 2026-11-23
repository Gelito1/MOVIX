-- Movix Push Notifications Schema (Supabase / PostgreSQL)
-- Stores FCM device subscriptions, category preferences, and campaign history

create extension if not exists "pgcrypto";

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  fcm_token text not null unique,
  device_info text not null default 'Web Browser',
  welcome_sent boolean not null default false,
  prefs jsonb not null default '{
    "new_movies": true,
    "new_seasons": true,
    "app_updates": true,
    "recommendations": true
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions (user_id);

create index if not exists idx_push_subscriptions_prefs
  on public.push_subscriptions using gin (prefs);

create table if not exists public.push_notification_history (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  image_url text not null default '',
  target_url text not null default '#/',
  category text not null check (category in ('welcome', 'new_movies', 'new_seasons', 'app_updates', 'recommendations')),
  status text not null default 'sent' check (status in ('sent', 'scheduled', 'failed')),
  scheduled_for timestamptz null,
  sent_at timestamptz null,
  targeted_count integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  cleaned_tokens_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
alter table public.push_notification_history enable row level security;

-- Allow visitors and authenticated users to register or update their own subscription token via service/RPC
create policy "Users can view their own push subscriptions"
  on public.push_subscriptions
  for select
  using (auth.uid() = user_id);

create policy "Users can update their own push preferences"
  on public.push_subscriptions
  for update
  using (auth.uid() = user_id);
