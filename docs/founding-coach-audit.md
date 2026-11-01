# Founding Coach Program: production audit

Audited on **2026-10-31 (Australia/Brisbane)** against GitHub/current local base
`6e3bfc727d5da7766d0fe4d842fd0bc1644e5bdd` (`6e3bfc7`) and Supabase project
`ehxtkotraoabyirtgiww` (`coach-brain`). Production checks were read-only: catalog
metadata, effective privilege checks, migration/function listings, and Security
Advisor. No customer rows, identities, credentials, or secret values were read.
No production changes or invitation grants were made.

## Current production contract

| Area | Verified state |
| --- | --- |
| Database | PostgreSQL 17.6; database timezone UTC |
| Public tables | `coach_access`, `athletes`, `saved_sessions`, `favourites`, `test_sets`, `journal_entries`; all have RLS enabled |
| Paid entitlement | `coach_access.plan` is `free` or `pro`; `status` is `active` or `revoked`; current Pro predicate is `plan = 'pro' AND status = 'active'` |
| Paid identity | `user_id` UUID primary key, referencing `auth.users(id)`; nullable unique `gumroad_sale_id`; `granted_at` and `updated_at` default to database `now()` |
| Paid RLS/grants | `authenticated` can SELECT only its own row. No ordinary-client mutation grants or policies. `anon` has no table access |
| Data RLS | The other five tables permit authenticated CRUD only where `auth.uid() = user_id`, with ownership checked on the new row as well. No entitlement predicate exists |
| Data shape | UUID `id` primary key; UUID `user_id` FK; JSONB object `data`; created/updated timestamps; `user_id` indexes |
| Functions/triggers | No user-defined functions in `public`; no non-internal triggers on these tables |
| Managed history | Supabase reports zero migration records and zero deployed Edge Functions |

The existing schema protects paid rows from self-assignment. Current data RLS
protects account boundaries but does **not** enforce the frontend Pro gate:
an authenticated free/revoked user can currently modify their own records through
the Data API. The proposed restrictive write policies address that gap while
retaining ownership policies and read access.

Effective privileges were checked with `has_table_privilege`, not inferred from
RLS. `authenticated` currently also has `TRUNCATE`, `REFERENCES`, and `TRIGGER` on
the five data tables. Removing these unnecessary privileges is justified;
`TRUNCATE` is not row-filtered by RLS. No public SQL-execution function or normal
REST truncate endpoint was found, so this is not a claim of a demonstrated REST
truncate exploit.

`service_role` currently has **no SELECT/INSERT/UPDATE/DELETE privileges** on any
of the six public tables. BYPASSRLS does not replace table grants. This is a
constraint for any future Gumroad service-role writer. The invitation migration
does not alter paid grants or silently repair a separate payment integration.

## Gumroad evidence and limits

The current frontend links to the public purchase page
[Coach Brain Pro](https://coachtree.gumroad.com/l/coach-brain-pro).
The repository stores a unique optional `gumroad_sale_id` but contains no Gumroad
webhook/verification implementation. Supabase reports no deployed Edge Functions,
so no live Gumroad function exists in this project's function inventory.

The web tool could not retrieve the public page; a subsequent read-only browser
inspection succeeded on 2026-10-31. The page title is “Coach Brain Pro · Founding
Coach Lifetime”. Its description offers **US$19, one payment, no subscription,
lifetime access, first 10 Founding Coaches**. The detected AUD display was A$27.01
and the page displayed “10 left”; these are observations, not a sales audit.
The frontend still advertises **US$39, first 25, regular US$59**. This discrepancy
is recorded only; no price, product terms, coupon, or frontend offer copy was
changed. Existing paid/Lifetime rights remain independent of the trial.

The actual post-purchase activation flow, refund handling, 50% coupon configuration
and external automations remain **unverified**. No Gumroad account, customer list,
payment settings, checkout, or purchase operation was used.
An external integration outside this repository/project may exist; the empty
function listing does not prove that it does not.

## Proposed migration review

Reviewed `supabase/migrations/20261030203830_founding_coach_entitlements.sql`
against the metadata above. No production-schema compatibility blocker was found
in static review; isolated database execution and regression tests are reported
separately.

- `founding_coach_grants` is separate from `coach_access`. Invitation expiry or
  revocation cannot overwrite a paid plan, sale ID, or status.
- A grant lasts exactly 2160 hours (90 days). The operations helper stamps both
  endpoints using database statement time, accepts no client time, and leaves an
  existing grant unchanged on retries. An update trigger prevents extension or
  reactivation. Boundary checks are `starts_at <= server_now < expires_at`.
- Normal users can read only the safe columns of their own invitation. They
  cannot insert, update, delete, or invoke the private grant/revoke functions.
- Public entitlement functions use `SECURITY INVOKER`, an empty `search_path`,
  and `auth.uid()` without caller-supplied user/time arguments. Explicit execution
  grants and existing RLS retain the caller's boundary.
- Restrictive write policies are ANDed with ownership policies. Own-data reads
  remain available after expiry/revocation. No cleanup, expiry deletion, payment
  mutation, or initial live invitation is included.
- The operations role is trusted and has direct INSERT/UPDATE privileges on the
  invitation table. Review identified a possible operator backdating mistake;
  the implementation now uses a BEFORE INSERT trigger to force database start
  time and 2160-hour duration even for direct privileged inserts. Revocation is
  also server-stamped. The immutable-update guard prevents extension/reactivation.

## Production approval items and pre-existing findings

1. Review and approve the migration and release sequence. Existing production
   objects lack managed migration history, so do not replay `schema.sql` or reset
   production. Recheck metadata/drift and take the agreed backup before applying.
2. Approve individual invitations and their recorded approval references; no
   invitation is created by the migration. Grant/revoke is an operations action,
   not a public signup flow.
3. Confirm live Gumroad activation/refund handling before relying on automated
   paid grants. Any payment-integration change needs separate approval.
4. Security Advisor reports **Leaked Password Protection Disabled**, with no
   other security advisories returned. Enabling it is a separate Auth setting
   change: [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
5. The project reports PostgreSQL 17.6. Supabase announced a newer security patch;
   review upgrade timing separately: [PostgreSQL 15.19 / 17.11](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).

Current documentation confirms RLS and grants are separate controls. From
2026-10-30 all projects require explicit opt-in grants for newly created public
tables; this migration supplies explicit least-privilege grants.
See [Data API grants change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), and
[database functions](https://supabase.com/docs/guides/database/functions).
