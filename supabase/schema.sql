-- Coach Brain account entitlements
-- Run this once in Supabase Dashboard > SQL Editor.

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

-- Initial Founding Coach activation: run this for each verified buyer.
-- Replace buyer@example.com with their Gumroad purchase email.
-- insert into public.coach_access (user_id, plan, status)
-- select id, 'pro', 'active' from auth.users where email = 'buyer@example.com'
-- on conflict (user_id) do update set plan = 'pro', status = 'active', updated_at = now();
