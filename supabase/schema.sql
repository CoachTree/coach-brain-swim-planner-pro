
create table if not exists public.coach_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  gumroad_sale_id text unique,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.coach_access enable row level security;

revoke all on table public.coach_access from anon;
revoke all on table public.coach_access from authenticated;
grant select on table public.coach_access to authenticated;

drop policy if exists "Users can read their own Coach Brain access" on public.coach_access;
create policy "Users can read their own Coach Brain access"
on public.coach_access
for select
to authenticated
using ((select auth.uid()) = user_id);

-- Cloud-synced Coach Brain data.
-- The existing localStorage records can be stored unchanged in `data` while
-- the app's cloud repository is introduced in a later step.

create table if not exists public.athletes (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saved_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.favourites (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.test_sets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.journal_entries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists athletes_user_id_idx on public.athletes(user_id);
create index if not exists saved_sessions_user_id_idx on public.saved_sessions(user_id);
create index if not exists favourites_user_id_idx on public.favourites(user_id);
create index if not exists test_sets_user_id_idx on public.test_sets(user_id);
create index if not exists journal_entries_user_id_idx on public.journal_entries(user_id);

alter table public.athletes enable row level security;
alter table public.saved_sessions enable row level security;
alter table public.favourites enable row level security;
alter table public.test_sets enable row level security;
alter table public.journal_entries enable row level security;

revoke all on table public.athletes from anon;
revoke all on table public.saved_sessions from anon;
revoke all on table public.favourites from anon;
revoke all on table public.test_sets from anon;
revoke all on table public.journal_entries from anon;

grant select, insert, update, delete on table public.athletes to authenticated;
grant select, insert, update, delete on table public.saved_sessions to authenticated;
grant select, insert, update, delete on table public.favourites to authenticated;
grant select, insert, update, delete on table public.test_sets to authenticated;
grant select, insert, update, delete on table public.journal_entries to authenticated;

drop policy if exists "Users can manage their own athletes" on public.athletes;
create policy "Users can manage their own athletes"
on public.athletes
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage their own saved sessions" on public.saved_sessions;
create policy "Users can manage their own saved sessions"
on public.saved_sessions
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage their own favourites" on public.favourites;
create policy "Users can manage their own favourites"
on public.favourites
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage their own test sets" on public.test_sets;
create policy "Users can manage their own test sets"
on public.test_sets
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage their own journal entries" on public.journal_entries;
create policy "Users can manage their own journal entries"
on public.journal_entries
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Initial Founding Coach activation: run this for each verified buyer.
-- Replace buyer@example.com with their Gumroad purchase email.
-- insert into public.coach_access (user_id, plan, status)
-- select id, 'pro', 'active' from auth.users where email = 'buyer@example.com'
-- on conflict (user_id) do update set plan = 'pro', status = 'active', updated_at = now();
