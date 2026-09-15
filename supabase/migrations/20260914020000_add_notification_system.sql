-- Notification preferences table
-- Stores user preferences for email notifications by event type and ticker
create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email_enabled boolean not null default true,
  news_enabled boolean not null default true,
  sec_enabled boolean not null default true,
  ratings_enabled boolean not null default true,
  insider_trades_enabled boolean not null default true,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_preferences_user_id_idx
  on public.notification_preferences (user_id);

-- Notification sent log table
-- Tracks sent notifications to prevent duplicates and for audit trail
create table if not exists public.notification_sent_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  event_type text not null, -- 'news' | 'sec' | 'rating' | 'insider'
  event_id text not null, -- hash or unique identifier of the event
  recipient_email text not null,
  subject text not null,
  status text not null default 'sent', -- 'pending' | 'sending' | 'sent' | 'failed'
  attempts int not null default 1,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

-- Unique key to prevent duplicate notifications from the moment the event is first inserted.
-- This blocks concurrent pending/sending/sent rows for the same user-event pair.
create unique index if not exists notification_sent_log_dedup_idx
  on public.notification_sent_log (user_id, ticker, event_type, event_id)
  where status in ('pending', 'sending', 'sent');

create index if not exists notification_sent_log_user_id_idx
  on public.notification_sent_log (user_id);

create index if not exists notification_sent_log_status_idx
  on public.notification_sent_log (status);

create index if not exists notification_sent_log_created_at_idx
  on public.notification_sent_log (created_at desc);

-- Enable RLS
alter table public.notification_preferences enable row level security;
alter table public.notification_sent_log enable row level security;

-- RLS Policies for notification_preferences
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notification_preferences'
      and policyname = 'Users can read their own notification preferences'
  ) then
    create policy "Users can read their own notification preferences"
      on public.notification_preferences
      for select
      to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notification_preferences'
      and policyname = 'Users can create their own notification preferences'
  ) then
    create policy "Users can create their own notification preferences"
      on public.notification_preferences
      for insert
      to authenticated
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notification_preferences'
      and policyname = 'Users can update their own notification preferences'
  ) then
    create policy "Users can update their own notification preferences"
      on public.notification_preferences
      for update
      to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
end
$$;

-- RLS Policies for notification_sent_log (read-only for users, insert for service_role)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notification_sent_log'
      and policyname = 'Users can read their own notification log'
  ) then
    create policy "Users can read their own notification log"
      on public.notification_sent_log
      for select
      to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end
$$;

-- Trigger for updated_at
create or replace function public.set_notification_preferences_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_notification_preferences_updated_at on public.notification_preferences;
create trigger set_notification_preferences_updated_at
before update on public.notification_preferences
for each row
execute function public.set_notification_preferences_updated_at();
