# Complimentary Founding Coach Program — review candidate

Status: isolated implementation, not deployed. Production migration, rollout,
individual entitlement grants, pricing/discount changes, and outreach each require
the owner's explicit final approval. A merge to `main` triggers production Pages,
so **do not merge this PR as an ordinary code-only action**.

## Access contract

`coach_access` remains the existing paid/manual Pro source, with its current
`plan = 'pro' AND status = 'active'` semantics. No paid rows are changed, copied,
expired, or inferred from a Gumroad coupon. The new `founding_coach_grants` table
contains at most one complimentary grant per verified auth user.

- Access is paid Pro **OR** an active complimentary grant.
- The 90 days begin when the operator explicitly grants access, after registration
  and user-ID verification; they do not begin on first use. Duration is exactly
  2,160 hours, unaffected by daylight saving changes.
- Database `statement_timestamp()` determines start, expiry, revocation, and access.
  Start is inclusive; expiry is exclusive. The browser cannot supply the user ID,
  clock, duration, or expiry to the entitlement query.
  A trigger also stamps direct privileged inserts/revocations with server time,
  preventing accidental backdating or custom-duration grants outside the helper.
- Retrying a grant returns the original record and never extends/restarts it.
  Revocation is terminal. A later new trial needs a separately reviewed policy
  change, not deletion/recreation of the original record.
- Approval reference and revocation reason are mandatory internal audit fields.
  Client column grants hide these fields. The user can read only their own timing
  and revocation state. Clients cannot insert/update/delete/truncate grants or
  call the private operator functions. No user-editable metadata is trusted.
- All functions use `SECURITY INVOKER` and a fixed empty search path. Administrative
  functions live in `coach_private`, with access only for `service_role`/DB owner.
  Keep this schema out of the exposed Data API schemas. No service key belongs in
  the frontend; this work adds no administrative web endpoint.

## Server enforcement and data preservation

The migration adds restrictive INSERT/UPDATE/DELETE policies to the five existing
cloud-data tables. These combine with the current ownership policies; an active
entitlement never authorizes access to another user's data. DB writes stop on the
first statement after expiry/revocation even if a browser still has an old token or
Pro display. Authenticated TRUNCATE/REFERENCES/TRIGGER privileges are removed.

Existing ownership SELECT policies remain. Expiry/revocation performs **no data
deletion**, no account deletion, and no paid-row update. The app currently gates
its Pro data screens after confirmed loss of access; preserving DB SELECT allows
future read-only export/recovery without recovering Pro first. Account deletion
retains the existing auth-user cascade semantics and is outside this program.

Client code uses the server RPC, rechecks every 30 seconds, and clears unverifiable
access on request errors (10-second timeout), offline, foreground transitions,
or an identity boundary. A successful UI permission has a maximum 60-second lease;
the invitation timer is shortened by the measured request round trip. No local
wall-clock change can extend it. The server remains authoritative for cloud writes.
After a missing-RPC error only, the old paid table can preserve existing paid Pro
during staged rollout; there is no fallback for invitation access or arbitrary
network/permission errors.

Account switches clear in-memory drafts/forms/queued UI actions. Same-account
rechecks/expiry/network errors preserve drafts and mounted forms while suspending
Pro actions. Cloud operations bind the originating user; account data never
silently falls back into browser-local storage. A failed explicit sign-out stays
locked pending an explicit retry.

## Existing limits

Planning computation, PDF/export code, and some features are shipped in a static
React bundle. A user who modifies that bundle can run local computation; UI gates
are not DRM. The security boundary verified here is server records and cloud writes.
Existing Journal/TestSets/backup data use shared device-local storage. They are not
private per-login cloud data, and this change does not migrate or namespace them.
Use separate browser profiles for device-local data that must remain separated.

Gumroad purchases continue through the existing purchase/manual verification path.
No webhook, sale import, recurring charge, 50% discount, or coupon configuration is
introduced. Public app copy currently mentions a paid “Founding Coach” offer; that
legacy name must not be mistaken for the new complimentary invitation program.
The public Gumroad page observed on 2026-10-31 advertises US$19 lifetime access for
the first 10 coaches, while the app still advertises US$39/25 coaches. Resolve
this discrepancy only under a separately approved commercial-copy/price decision;
this implementation changes neither offer.

## Approval and rollout runbook

1. Review the production audit, SQL, test results, and the change that signed-in
   free/expired users can read but cannot modify existing cloud records. Confirm
   the 90-day start rule and the one-invitation-per-account rule.
2. Obtain explicit approval for the production DB change. Re-read current schema,
   grants and RLS immediately before execution; check for drift and take a normal
   DB backup. The project previously had no migration history; reconcile the
   baseline before using CLI migration-history commands. Do not run the entire
   legacy `schema.sql` as a production migration.
3. Apply only `20261030203830_founding_coach_entitlements.sql` transactionally.
   The migration creates **zero live invitations**. Validate advisors, own-row
   visibility, paid Pro and DB write checks on an explicitly approved test account.
4. Obtain production frontend deployment/merge approval separately. Deploy, then
   check sign-in, paid access and account switching. A review branch/PR does not
   trigger the repository's Pages deployment workflow.
5. Before the first invitation, independently verify the registered auth user ID,
   recipient, approval reference and communicated end date. Obtain explicit
   individual grant approval. Use the private function from a trusted DB operator
   session, with bound parameters; do not use the legacy paid activation query:

   ```sql
   select coach_private.grant_founding_coach(:verified_user_id, :approval_reference);
   ```

   Inspect the returned start/expiry. A retry is safe; it does not restart 90 days.
   A separately approved cancellation uses:

   ```sql
   select coach_private.revoke_founding_coach(:verified_user_id, :reason);
   ```

6. DM/invitation delivery, pricing and discount changes remain separate approval
   steps. No recipient has been selected or contacted by this implementation.

## Rollback

Prefer leaving the additive table and immutable audit history intact. The old
frontend ignores invitations but continues to recognize paid Pro. Do not drop
grants, overwrite `coach_access`, extend trials, or delete saved data to roll back.
Removing restrictive policies would restore the old permissive cloud-write model
and requires an explicit security decision. Handle an affected invitation through
an approved operator revocation, never a bulk paid-rights reset.

## Local verification

The frontend lockfile is unchanged. Install/test/build using the commands in
`CLAUDE.md`. DB tests use a separate, exact-version PGlite dependency (PostgreSQL
running locally in WASM), synthetic users/roles and the audited baseline SQL:

```sh
npm --prefix supabase/tests ci --ignore-scripts --no-audit --no-fund
node --test supabase/tests/*.test.mjs
CI=true npm --prefix frontend test -- --watchAll=false --runInBand
CI=true PUBLIC_URL=. npm --prefix frontend run build
node --test scripts/automation/*.test.mjs
```

This executes real PostgreSQL SQL/RLS; it is not a hosted Supabase/PostgREST/Auth
integration test. The hosted Data API and browser end-to-end rollout checks still
belong to the approved staging/production rollout. No production credentials or
user data are used for the local tests.
