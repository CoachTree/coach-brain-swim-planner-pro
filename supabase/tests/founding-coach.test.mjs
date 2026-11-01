import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL SQL/RLS/ACL execution in local WASM. No URLs, tokens or remote
// database are accepted by this harness. Auth users and claims are synthetic.
const tables = ['athletes', 'saved_sessions', 'favourites', 'test_sets', 'journal_entries'];
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const users = { paid: id(1), paidRevoked: id(2), free: id(3), active: id(4), expired: id(5), future: id(6), revoked: id(7), bothExpired: id(8), bothRevoked: id(9), noGrant: id(10) };
const entryId = (tableIndex, userIndex) => id(1000 + tableIndex * 100 + userIndex);
let db, paidBefore, dataBefore;
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const scalar = async (sql, params = []) => Object.values((await rows(sql, params))[0])[0];
async function as(role, uid, run) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || '']);
    return await run();
  } finally { await db.exec('rollback'); }
}
async function denied(sql, params = [], code = '42501') {
  await db.exec('savepoint expected_denial');
  let error;
  try { await db.query(sql, params); } catch (caught) { error = caught; }
  await db.exec('rollback to savepoint expected_denial');
  await db.exec('release savepoint expected_denial');
  assert.ok(error, `Expected rejection: ${sql}`);
  assert.equal(error.code, code, `Unexpected SQL error for ${sql}: ${error.message}`);
}
const entitlement = async () => scalar('select public.get_coach_entitlements()');
const safeGrantColumns = 'user_id, starts_at, expires_at, revoked_at';

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
  `);
  await db.exec(await readFile(new URL('../schema.sql', import.meta.url), 'utf8'));
  // Reproduce the audited production ACL differences from schema.sql. RLS
  // does not protect TRUNCATE, so the migration must remove these privileges.
  for (const table of tables) await db.exec(`grant truncate, references, trigger on public.${table} to authenticated, service_role`);
  for (const uid of Object.values(users)) await db.query('insert into auth.users (id) values ($1)', [uid]);
  for (const uid of [users.paid, users.bothExpired, users.bothRevoked]) {
    await db.query("insert into coach_access (user_id,plan,status,gumroad_sale_id) values ($1,'pro','active',$2)", [uid, `synthetic-sale-${uid}`]);
  }
  await db.query("insert into coach_access(user_id,plan,status) values ($1,'pro','revoked'),($2,'free','active')", [users.paidRevoked, users.free]);
  for (let ti = 0; ti < tables.length; ti++) {
    for (let ui = 1; ui <= Object.keys(users).length; ui++) {
      await db.query(`insert into ${tables[ti]} (id,user_id,data) values ($1,$2,$3)`, [entryId(ti, ui), id(ui), { fixture: true, owner: ui }]);
    }
  }
  paidBefore = await rows('select * from coach_access order by user_id');
  dataBefore = await rows('select * from athletes order by id');
  await db.exec(await readFile(new URL('../migrations/20261030203830_founding_coach_entitlements.sql', import.meta.url), 'utf8'));
  // Fixture-only superuser override: represent past/future/revoked histories
  // without waiting 90 days. Production roles cannot disable this trigger.
  await db.exec('alter table founding_coach_grants disable trigger founding_grant_immutable');
  for (const key of ['active', 'expired', 'future', 'revoked', 'bothExpired', 'bothRevoked']) {
    const offset = key.toLowerCase().includes('expired') ? '-91 days' : key === 'future' ? '1 day' : '-1 day';
    const revoked = key.toLowerCase().includes('revoked');
    await db.query(`insert into founding_coach_grants
      (user_id, starts_at, expires_at, approval_reference, revoked_at, revoke_reason, revoked_by)
      values ($1, statement_timestamp() + $2::interval, statement_timestamp() + $2::interval + interval '2160 hours',
        'private approval notes', ${revoked ? "statement_timestamp(), 'private revoke notes', 'operator'" : 'null, null, null'})`, [users[key], offset]);
  }
  await db.exec('alter table founding_coach_grants enable trigger founding_grant_immutable');
});
after(async () => { if (db) await db.close(); });

test('migration preserves every paid row and pre-existing data unchanged', async () => {
  assert.deepEqual(await rows('select * from coach_access order by user_id'), paidBefore);
  assert.deepEqual(await rows('select * from athletes order by id'), dataBefore);
});

test('all new functions use invoker security and an empty search path', async () => {
  const functions = await rows(`select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='coach_private' or (n.nspname='public' and p.proname in ('has_coach_pro_access','get_coach_entitlements'))`);
  assert.equal(functions.length, 5);
  for (const fn of functions) { assert.equal(fn.prosecdef, false, fn.proname); assert.ok(fn.proconfig.includes('search_path=""'), fn.proname); }
});

for (const [key, expectedPaid, expectedFounding, expectedStatus] of [
  ['paid', true, false, 'none'], ['paidRevoked', false, false, 'none'], ['free', false, false, 'none'],
  ['active', false, true, 'active'], ['expired', false, false, 'expired'], ['future', false, false, 'expired'],
  ['revoked', false, false, 'revoked'], ['bothExpired', true, false, 'expired'], ['bothRevoked', true, false, 'revoked'],
  ['noGrant', false, false, 'none'],
]) {
  test(`entitlement ${key}: paid and invitation sources remain separate`, async () => as('authenticated', users[key], async () => {
    const value = await entitlement();
    assert.equal(value.user_id, users[key]); assert.equal(value.paid_active, expectedPaid);
    assert.equal(value.founding_active, expectedFounding); assert.equal(value.founding_status, expectedStatus);
    assert.equal(value.is_pro, expectedPaid || expectedFounding);
    assert.equal(await scalar('select has_coach_pro_access()'), value.is_pro);
    assert.ok(Number.isFinite(Date.parse(value.checked_at)));
    assert.equal(Object.hasOwn(value, 'approval_reference'), false); assert.equal(Object.hasOwn(value, 'revoke_reason'), false);
  }));
}

test('anonymous callers cannot read invitations, paid rows, user data or call entitlement/operations functions', async () => as('anon', null, async () => {
  for (const table of ['coach_access', 'founding_coach_grants', ...tables]) {
    await denied(`select * from ${table}`); await denied(`truncate ${table}`);
  }
  await denied('select public.get_coach_entitlements()'); await denied('select public.has_coach_pro_access()');
  await denied('select coach_private.grant_founding_coach($1,$2)', [users.free, 'forged approval']);
  await denied('select coach_private.revoke_founding_coach($1,$2)', [users.active, 'forged revoke']);
}));

test('authenticated role with no user cannot gain access or call entitlement RPC', async () => as('authenticated', null, async () => {
  assert.equal(await scalar('select has_coach_pro_access()'), false);
  await denied('select get_coach_entitlements()');
  assert.deepEqual(await rows(`select ${safeGrantColumns} from founding_coach_grants`), []);
}));

test('authenticated sees own safe invitation columns only, never other grants or operator notes', async () => as('authenticated', users.active, async () => {
  const own = await rows(`select ${safeGrantColumns} from founding_coach_grants`);
  assert.equal(own.length, 1); assert.equal(own[0].user_id, users.active);
  assert.deepEqual(await rows(`select ${safeGrantColumns} from founding_coach_grants where user_id=$1`, [users.revoked]), []);
  for (const column of ['*', 'approval_reference', 'granted_by', 'revoke_reason', 'revoked_by']) await denied(`select ${column} from founding_coach_grants`);
}));

for (const role of ['anon', 'authenticated']) {
  test(`${role} cannot self-grant, extend, revoke, delete or truncate invitations or paid access`, async () => as(role, users.active, async () => {
    await denied("insert into founding_coach_grants(user_id,starts_at,expires_at,approval_reference) values ($1,now(),now()+interval '2160 hours','self')", [users.free]);
    await denied("update founding_coach_grants set expires_at=expires_at+interval '2160 hours' where user_id=$1", [users.active]);
    await denied("update founding_coach_grants set revoked_at=now(),revoke_reason='self',revoked_by='self' where user_id=$1", [users.active]);
    await denied('delete from founding_coach_grants where user_id=$1', [users.active]); await denied('truncate founding_coach_grants');
    await denied("insert into coach_access(user_id,plan) values ($1,'pro')", [users.noGrant]);
    await denied("update coach_access set plan='pro',status='active' where user_id=$1", [users.free]);
    await denied('delete from coach_access where user_id=$1', [users.paid]); await denied('truncate coach_access');
    await denied('select coach_private.grant_founding_coach($1,$2)', [users.free, 'self']);
    await denied('select coach_private.revoke_founding_coach($1,$2)', [users.active, 'self']);
  }));
}

test('user-editable metadata cannot grant Pro and RPC accepts no forged user or timestamp', async () => as('postgres', users.free, async () => {
  await db.query(`update auth.users set raw_user_meta_data='{"is_pro":true,"plan":"pro","founding_active":true}' where id=$1`, [users.free]);
  await db.exec('set local role authenticated');
  assert.equal((await entitlement()).is_pro, false);
  await denied('select get_coach_entitlements($1)', [users.paid], '42883');
  await denied("select has_coach_pro_access('2099-01-01'::timestamptz)", [], '42883');
}));

test('service grant is server-timed for exactly 2160 hours and retries cannot extend or rewrite approval', async () => as('service_role', null, async () => {
  await db.exec("set local timezone='America/New_York'");
  const [{ grant, checked }] = await rows('select to_jsonb(coach_private.grant_founding_coach($1,$2)) as grant, statement_timestamp() as checked', [users.noGrant, ' approval-123 ']);
  assert.equal(Date.parse(grant.starts_at), checked.getTime());
  assert.equal(Date.parse(grant.expires_at) - Date.parse(grant.starts_at), 90 * 24 * 60 * 60 * 1000);
  assert.equal(grant.approval_reference, 'approval-123'); assert.equal(grant.granted_by, 'service_role');
  const retry = await scalar('select to_jsonb(coach_private.grant_founding_coach($1,$2))', [users.noGrant, 'different-reference']);
  assert.deepEqual(retry, grant);
}));

test('service revoke is idempotent; re-inviting revoked/expired users never renews them', async () => as('service_role', null, async () => {
  const before = (await rows('select * from founding_coach_grants where user_id=$1', [users.active]))[0];
  const first = await scalar('select to_jsonb(coach_private.revoke_founding_coach($1,$2))', [users.active, 'reviewed cancellation']);
  assert.equal(first.revoked_by, 'service_role'); assert.equal(first.revoke_reason, 'reviewed cancellation');
  assert.equal(Date.parse(first.expires_at), before.expires_at.getTime());
  const retry = await scalar('select to_jsonb(coach_private.revoke_founding_coach($1,$2))', [users.active, 'changed reason']); assert.deepEqual(retry, first);
  const reinvite = await scalar('select to_jsonb(coach_private.grant_founding_coach($1,$2))', [users.active, 'new-approval']); assert.deepEqual(reinvite, first);
  const expiredBefore = (await rows('select to_jsonb(g) as value from founding_coach_grants g where user_id=$1', [users.expired]))[0].value;
  assert.deepEqual(await scalar('select to_jsonb(coach_private.grant_founding_coach($1,$2))', [users.expired, 'retry']), expiredBefore);
}));

test('privileged grant maintenance cannot change history, renew, reactivate, delete or truncate', async () => as('service_role', null, async () => {
  for (const assignment of ["user_id='00000000-0000-4000-8000-000000000010'", "starts_at=starts_at+interval '1 hour'", "expires_at=expires_at+interval '1 hour'", "approval_reference='replacement'", "granted_by='replacement'"]) {
    await denied(`update founding_coach_grants set ${assignment} where user_id=$1`, [users.active], '22023');
  }
  for (const assignment of ["revoked_at=null,revoke_reason=null,revoked_by=null", "revoked_at=revoked_at+interval '1 hour'", "revoke_reason='replacement'", "revoked_by='replacement'"]) {
    await denied(`update founding_coach_grants set ${assignment} where user_id=$1`, [users.revoked], '22023');
  }
  await denied('delete from founding_coach_grants where user_id=$1', [users.active]); await denied('truncate founding_coach_grants');
}));

test('incomplete revocation and invalid operation arguments are rejected', async () => as('service_role', null, async () => {
  await denied("update founding_coach_grants set revoked_at=now(),revoke_reason=null,revoked_by='operator' where user_id=$1", [users.active], '23514');
  for (const ref of [null, '', '   ', 'x'.repeat(501)]) {
    await denied('select coach_private.grant_founding_coach($1,$2)', [users.noGrant, ref], '22023');
    await denied('select coach_private.revoke_founding_coach($1,$2)', [users.active, ref], '22023');
  }
  await denied('select coach_private.grant_founding_coach($1,$2)', [null, 'ref'], '22023');
  await denied('select coach_private.grant_founding_coach($1,$2)', [id(99999), 'ref'], '23503');
}));

test('direct service inserts cannot backdate, extend, forge grant author or bypass server timing', async () => as('service_role', null, async () => {
  const [{ grant, checked }] = await rows(`with inserted as (
    insert into founding_coach_grants(user_id,starts_at,expires_at,approval_reference,granted_by)
    values ($1,'2000-01-01','infinity','direct-insert','forged-author') returning *)
    select to_jsonb(inserted) as grant, statement_timestamp() as checked from inserted`, [users.noGrant]);
  assert.equal(Date.parse(grant.starts_at), checked.getTime());
  assert.equal(Date.parse(grant.expires_at) - Date.parse(grant.starts_at), 90 * 24 * 60 * 60 * 1000);
  assert.equal(grant.granted_by, 'service_role');
  await denied('alter table founding_coach_grants disable trigger founding_grant_immutable');
}));

test('new invitations cannot begin revoked, and first cancellation time/author are server-controlled', async () => as('service_role', null, async () => {
  await denied(`insert into founding_coach_grants(user_id,starts_at,expires_at,approval_reference,revoked_at,revoke_reason,revoked_by)
    values ($1,now(),now()+interval '2160 hours','ref',now(),'cancel','operator')`, [users.noGrant], '22023');
  const [{ grant, checked }] = await rows(`with revoked as (
    update founding_coach_grants set revoked_at='2000-01-01',revoke_reason='reviewed',revoked_by='forged-author'
    where user_id=$1 returning *) select to_jsonb(revoked) as grant, statement_timestamp() as checked from revoked`, [users.active]);
  assert.equal(Date.parse(grant.revoked_at), checked.getTime()); assert.equal(grant.revoked_by, 'service_role');
}));

test('database constraints also reject wrong duration and nonfinite dates when only the fixture trigger is disabled', async () => as('postgres', null, async () => {
  await db.exec('alter table founding_coach_grants disable trigger founding_grant_immutable');
  await denied("insert into founding_coach_grants(user_id,starts_at,expires_at,approval_reference) values ($1,now(),now()+interval '90 hours','ref')", [users.noGrant], '23514');
  await denied("insert into founding_coach_grants(user_id,starts_at,expires_at,approval_reference) values ($1,'infinity','infinity','ref')", [users.noGrant], '23514');
  await db.exec('alter table founding_coach_grants enable trigger founding_grant_immutable');
}));

for (const [boundary, offset, expected] of [['expiry', "-interval '2160 hours'", false], ['start', "interval '0 hours'", true]]) {
  test(`exact server ${boundary} boundary uses inclusive start and exclusive expiry`, async () => as('postgres', users.noGrant, async () => {
    // A single DO statement supplies one statement_timestamp to the insert and
    // RPC, avoiding an imprecise client clock or timing-sensitive sleep.
    await db.exec(`do $$ declare checked timestamptz := statement_timestamp(); value jsonb; begin
      alter table founding_coach_grants disable trigger founding_grant_immutable;
      insert into founding_coach_grants(user_id,starts_at,expires_at,approval_reference)
      values ('${users.noGrant}', checked + ${offset}, checked + ${offset} + interval '2160 hours', 'boundary');
      alter table founding_coach_grants enable trigger founding_grant_immutable;
      execute 'set local role authenticated';
      value := public.get_coach_entitlements();
      if (value->>'checked_at')::timestamptz <> checked then raise exception 'Not the exact boundary'; end if;
      if (value->>'is_pro')::boolean <> ${expected} then raise exception 'Boundary authorized incorrectly: %', value; end if;
    end $$`);
  }));
}

for (let ti = 0; ti < tables.length; ti++) {
  const table = tables[ti];
  for (const [key, allowed] of [['paid', true], ['active', true], ['bothExpired', true], ['bothRevoked', true], ['paidRevoked', false], ['free', false], ['expired', false], ['future', false], ['revoked', false]]) {
    test(`${table}: ${key} retains own reads; writes ${allowed ? 'allowed' : 'denied'}`, async () => as('authenticated', users[key], async () => {
      const original = await rows(`select * from ${table}`); assert.equal(original.length, 1); assert.equal(original[0].user_id, users[key]);
      const newId = id(90000 + ti);
      const insert = `insert into ${table}(id,user_id,data) values ($1,$2,'{"new":true}') returning id`;
      if (allowed) {
        assert.equal((await rows(insert, [newId, users[key]])).length, 1);
        assert.equal((await rows(`update ${table} set data='{"edited":true}' where id=$1 returning id`, [newId])).length, 1);
        assert.equal((await rows(`delete from ${table} where id=$1 returning id`, [newId])).length, 1);
      } else {
        await denied(insert, [newId, users[key]]);
        assert.deepEqual(await rows(`update ${table} set data='{"edited":true}' where id=$1 returning id`, [original[0].id]), []);
        assert.deepEqual(await rows(`delete from ${table} where id=$1 returning id`, [original[0].id]), []);
      }
      assert.deepEqual(await rows(`select * from ${table}`), original);
    }));
  }
  test(`${table}: Pro cannot see, modify, delete, insert or reassign another account's records`, async () => as('authenticated', users.paid, async () => {
    const otherId = entryId(ti, 4), ownId = entryId(ti, 1);
    assert.deepEqual(await rows(`select * from ${table} where id=$1`, [otherId]), []);
    assert.deepEqual(await rows(`update ${table} set data='{}' where id=$1 returning id`, [otherId]), []);
    assert.deepEqual(await rows(`delete from ${table} where id=$1 returning id`, [otherId]), []);
    await denied(`insert into ${table}(id,user_id) values ($1,$2)`, [id(98000 + ti), users.active]);
    await denied(`update ${table} set user_id=$1 where id=$2`, [users.active, ownId]);
    await denied(`truncate ${table}`);
  }));
}

test('a later permissive INSERT policy cannot bypass restrictive Pro requirement', async () => as('postgres', users.free, async () => {
  await db.exec('create policy "synthetic future permission" on athletes for insert to authenticated with check (true)');
  await db.exec('set local role authenticated');
  await denied('insert into athletes(id,user_id) values ($1,$2)', [id(99000), users.free]);
}));

test('revocation deletes no stored data, denies writes immediately, and keeps owner SELECT', async () => as('postgres', users.active, async () => {
  const before = {};
  for (const table of tables) before[table] = await rows(`select * from ${table} where user_id=$1`, [users.active]);
  await db.exec('set local role service_role');
  await db.query('select coach_private.revoke_founding_coach($1,$2)', [users.active, 'cancel after review']);
  await db.exec('set local role authenticated');
  assert.equal((await entitlement()).is_pro, false);
  for (const table of tables) {
    assert.deepEqual(await rows(`select * from ${table}`), before[table]);
    await denied(`insert into ${table}(id,user_id) values ($1,$2)`, [id(99900), users.active]);
  }
}));

test('catalog confirms RLS plus restrictive write policies and no authenticated TRUNCATE/REFERENCES/TRIGGER', async () => {
  for (const table of tables) {
    assert.equal(await scalar('select relrowsecurity from pg_class where oid=$1::regclass', [`public.${table}`]), true);
    const policies = await rows("select cmd, permissive from pg_policies where schemaname='public' and tablename=$1 and policyname like 'Pro required%'", [table]);
    assert.deepEqual(policies.map(p => p.cmd).sort(), ['DELETE', 'INSERT', 'UPDATE']);
    assert.ok(policies.every(p => p.permissive === 'RESTRICTIVE'));
    for (const privilege of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) assert.equal(await scalar('select has_table_privilege($1,$2,$3)', ['authenticated', `public.${table}`, privilege]), false);
  }
});
