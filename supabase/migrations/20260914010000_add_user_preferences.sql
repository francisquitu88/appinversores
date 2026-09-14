create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_language text not null
    check (preferred_language in ('en', 'es')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

revoke all on table public.user_preferences from anon, authenticated;
grant select, insert, update on table public.user_preferences to authenticated;

create policy "Users can read their own language preference"
  on public.user_preferences
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own language preference"
  on public.user_preferences
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own language preference"
  on public.user_preferences
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.set_user_preferences_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_user_preferences_updated_at
before update on public.user_preferences
for each row
execute function public.set_user_preferences_updated_at();
