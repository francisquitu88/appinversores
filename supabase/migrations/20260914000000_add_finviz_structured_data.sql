create table if not exists public.finviz_analyst_ratings (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  source_id uuid not null references public.sources(id),
  rating_date date not null,
  action text not null default '',
  analyst text not null default '',
  rating_change text not null default '',
  price_target_change text not null default '',
  created_at timestamptz not null default now(),
  scraped_at timestamptz not null,
  content_hash text not null,
  constraint finviz_analyst_ratings_hash_key unique (source_id, ticker, content_hash)
);

create index if not exists finviz_analyst_ratings_ticker_date_idx
  on public.finviz_analyst_ratings (ticker, rating_date desc);

create table if not exists public.finviz_insider_trades (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  source_id uuid not null references public.sources(id),
  insider_name text not null default '',
  relationship text not null default '',
  transaction_date date not null,
  transaction text not null default '',
  cost text not null default '',
  shares text not null default '',
  value text not null default '',
  shares_total text not null default '',
  sec_form4_url text not null default '',
  form4_display_timestamp text,
  created_at timestamptz not null default now(),
  scraped_at timestamptz not null,
  content_hash text not null,
  constraint finviz_insider_trades_hash_key unique (source_id, ticker, content_hash)
);

create index if not exists finviz_insider_trades_ticker_date_idx
  on public.finviz_insider_trades (ticker, transaction_date desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.finviz_analyst_ratings'::regclass
      and conname = 'finviz_analyst_ratings_content_hash_nonempty'
  ) then
    alter table public.finviz_analyst_ratings
      add constraint finviz_analyst_ratings_content_hash_nonempty
      check (length(btrim(content_hash)) > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.finviz_insider_trades'::regclass
      and conname = 'finviz_insider_trades_content_hash_nonempty'
  ) then
    alter table public.finviz_insider_trades
      add constraint finviz_insider_trades_content_hash_nonempty
      check (length(btrim(content_hash)) > 0);
  end if;
end
$$;

alter table public.finviz_analyst_ratings enable row level security;
alter table public.finviz_insider_trades enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'finviz_analyst_ratings'
      and policyname = 'authenticated users can read Finviz analyst ratings'
  ) then
    create policy "authenticated users can read Finviz analyst ratings"
      on public.finviz_analyst_ratings
      for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'finviz_insider_trades'
      and policyname = 'authenticated users can read Finviz insider trades'
  ) then
    create policy "authenticated users can read Finviz insider trades"
      on public.finviz_insider_trades
      for select
      to authenticated
      using (true);
  end if;
end
$$;
