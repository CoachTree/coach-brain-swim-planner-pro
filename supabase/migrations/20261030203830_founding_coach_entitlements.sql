-- REVIEW ONLY: additive migration for the audited production schema.
-- Apply only after explicit production approval. Never rewrites coach_access.
begin;

create schema if not exists coach_private;
revoke all on schema coach_private from public, anon, authenticated;
grant usage on schema coach_private to service_role;

create table public.founding_coach_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  approval_reference text not null check (length(btrim(approval_reference)) between 1 and 500),
  granted_by text not null default current_user,
  revoked_at timestamptz,
  revoke_reason text,
  revoked_by text,
  constraint founding_exactly_90_days check (isfinite(starts_at) and isfinite(expires_at) and expires_at = starts_at + interval '2160 hours'),
  constraint founding_revocation_record check (
    (revoked_at is null and revoke_reason is null and revoked_by is null) or
    (revoked_at is not null and isfinite(revoked_at) and revoke_reason is not null
      and length(btrim(revoke_reason)) between 1 and 500 and revoked_by is not null)
  )
);
alter table public.founding_coach_grants enable row level security;
revoke all on public.founding_coach_grants from public, anon, authenticated, service_role;
grant select (user_id, starts_at, expires_at, revoked_at) on public.founding_coach_grants to authenticated;
grant select, insert, update on public.founding_coach_grants to service_role;
create policy "Read own founding invitation" on public.founding_coach_grants
for select to authenticated using ((select auth.uid()) = user_id);

-- Guard against accidental extension/re-activation by privileged maintenance.
create function coach_private.keep_founding_grant_immutable() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.revoked_at is not null or new.revoke_reason is not null or new.revoked_by is not null then
      raise exception 'A new invitation cannot contain a revocation' using errcode = '22023';
    end if;
    new.starts_at := statement_timestamp();
    new.expires_at := statement_timestamp() + interval '2160 hours';
    new.granted_by := current_user;
    return new;
  end if;
  if new.user_id is distinct from old.user_id
    or new.starts_at is distinct from old.starts_at
    or new.expires_at is distinct from old.expires_at
    or new.approval_reference is distinct from old.approval_reference
    or new.granted_by is distinct from old.granted_by
    or (old.revoked_at is not null and
      (new.revoked_at is distinct from old.revoked_at or new.revoke_reason is distinct from old.revoke_reason
       or new.revoked_by is distinct from old.revoked_by)) then
    raise exception 'Founding invitation history is immutable' using errcode = '22023';
  end if;
  if old.revoked_at is null and new.revoked_at is not null then
    new.revoked_at := statement_timestamp();
    new.revoked_by := current_user;
  end if;
  return new;
end;
$$;
revoke all on function coach_private.keep_founding_grant_immutable() from public, anon, authenticated;
create trigger founding_grant_immutable before insert or update on public.founding_coach_grants
for each row execute function coach_private.keep_founding_grant_immutable();

-- Operations-only functions: no self-service endpoint, email matching, or token.
-- Retries return the original grant; expired/revoked grants never restart.
create function coach_private.grant_founding_coach(p_user_id uuid, p_approval_reference text)
returns public.founding_coach_grants language plpgsql security invoker set search_path = '' as $$
declare result public.founding_coach_grants;
begin
  if p_user_id is null or p_approval_reference is null
    or length(btrim(p_approval_reference)) not between 1 and 500 then
    raise exception 'Verified user and approval reference are required' using errcode = '22023';
  end if;
  insert into public.founding_coach_grants (user_id, starts_at, expires_at, approval_reference)
  values (p_user_id, statement_timestamp(), statement_timestamp() + interval '2160 hours', btrim(p_approval_reference))
  on conflict (user_id) do nothing;
  select * into strict result from public.founding_coach_grants where user_id = p_user_id;
  return result;
end;
$$;
create function coach_private.revoke_founding_coach(p_user_id uuid, p_reason text)
returns public.founding_coach_grants language plpgsql security invoker set search_path = '' as $$
declare result public.founding_coach_grants;
begin
  if p_user_id is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'User and revocation reason are required' using errcode = '22023';
  end if;
  update public.founding_coach_grants
    set revoked_at = statement_timestamp(), revoke_reason = btrim(p_reason), revoked_by = current_user
    where user_id = p_user_id and revoked_at is null;
  select * into strict result from public.founding_coach_grants where user_id = p_user_id;
  return result;
end;
$$;
revoke all on function coach_private.grant_founding_coach(uuid, text) from public, anon, authenticated;
revoke all on function coach_private.revoke_founding_coach(uuid, text) from public, anon, authenticated;
grant execute on function coach_private.grant_founding_coach(uuid, text) to service_role;
grant execute on function coach_private.revoke_founding_coach(uuid, text) to service_role;

-- Stable per-statement server time. No caller-supplied user ID or current time.
create function public.has_coach_pro_access() returns boolean
language sql stable security invoker set search_path = '' as $$
  select (select auth.uid()) is not null and (
    exists (select 1 from public.coach_access
      where user_id = (select auth.uid()) and plan = 'pro' and status = 'active')
    or exists (select 1 from public.founding_coach_grants
      where user_id = (select auth.uid()) and revoked_at is null
        and starts_at <= statement_timestamp() and expires_at > statement_timestamp())
  );
$$;
create function public.get_coach_entitlements() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  checked timestamptz := statement_timestamp();
  paid boolean;
  invitation record;
  invitation_status text := 'none';
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select exists (select 1 from public.coach_access
    where user_id = uid and plan = 'pro' and status = 'active') into paid;
  select starts_at, expires_at, revoked_at into invitation from public.founding_coach_grants where user_id = uid;
  if found then
    invitation_status := case when invitation.revoked_at is not null then 'revoked'
      when invitation.starts_at <= checked and invitation.expires_at > checked then 'active'
      else 'expired' end;
  end if;
  return jsonb_build_object('user_id', uid, 'checked_at', checked, 'paid_active', paid,
    'founding_active', invitation_status = 'active', 'founding_status', invitation_status,
    'founding_expires_at', invitation.expires_at, 'is_pro', paid or invitation_status = 'active');
end;
$$;
revoke all on function public.has_coach_pro_access() from public, anon;
revoke all on function public.get_coach_entitlements() from public, anon;
grant execute on function public.has_coach_pro_access() to authenticated;
grant execute on function public.get_coach_entitlements() to authenticated;

-- Preserve ownership SELECT and stored data after expiry. Restrictive write
-- policies AND with existing ownership policies, including any future permissive
-- policies. An expired trial cannot write via REST even with a stale UI/JWT.
do $$
declare target text;
begin
  foreach target in array array['athletes', 'saved_sessions', 'favourites', 'test_sets', 'journal_entries'] loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', target);
    execute format('create policy "Pro required for insert" on public.%I as restrictive for insert to authenticated with check ((select public.has_coach_pro_access()))', target);
    execute format('create policy "Pro required for update" on public.%I as restrictive for update to authenticated using ((select public.has_coach_pro_access())) with check ((select public.has_coach_pro_access()))', target);
    execute format('create policy "Pro required for delete" on public.%I as restrictive for delete to authenticated using ((select public.has_coach_pro_access()))', target);
  end loop;
end;
$$;
-- No data updates, scheduled deletion, payment mutations, or live grants.
commit;
