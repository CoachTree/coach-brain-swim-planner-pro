# Founding Coach validation — 2026-10-31

Base: `CoachTree/coach-brain-swim-planner-pro` main
`6e3bfc727d5da7766d0fe4d842fd0bc1644e5bdd`. Work performed in a new isolated
checkout; the user's pre-existing working copy and uncommitted changes were left
untouched. Production Supabase access was limited to schema/catalog/advisor reads.

| Check | Result |
| --- | --- |
| Full frontend regression suite | **918 passed**, 28 suites |
| Database security/RLS suite, actual PostgreSQL in local PGlite | **80 passed** |
| Existing automation boundary tests | **34 passed** |
| Production frontend build, no production configuration | **Passed**; main bundle 370.88 kB gzip |
| Diff/whitespace check | Passed |
| Independent frontend/security and production-schema review | Completed; findings fixed or bounded below |

Total local automated tests: **1,032 passed**. The local runtime was Node 24.16.0;
repository CI targets Node 22. The PR adds the isolated DB suite to CI with no
production credentials. Existing Browserslist/deprecation notices remain; the
frontend dependency manifest and lockfiles are unchanged.

The DB suite creates synthetic auth users and real `anon`, `authenticated`, and
`service_role` roles. It applies the repository baseline, reproduces the audited
production ACL differences, and executes the proposed migration. Tests verify
own-row/other-row behavior, paid-only/trial-only/both/neither, exact start/expiry,
future/expired/revoked grants, time zones, idempotent retries, private function
permissions, no self-assignment, immutable history, metadata forgery rejection,
all five cloud table write policies, post-expiry reads, and unchanged paid/data
records. Past/future dates use an explicitly documented superuser fixture override,
never a production backdoor. Direct operator inserts/revocations are server-timed.

Frontend regressions cover stale responses, A→B switching, signout, signout network
failure plus reconnect/reload/retry, lease/expiry timers, revoked invitations,
paid/trial precedence, missing-RPC rollout fallback, malformed server responses,
request timeout, offline/online/foreground recovery, wrong device wall clock,
preserved same-account drafts/forms, and prevention of implicit local fallback.

## Boundaries not claimed as tested

- Hosted Supabase Auth/PostgREST and live-browser end-to-end authorization were not
  exercised. The DB suite executes PostgreSQL locally; it does not replace an
  approved hosted staging smoke test.
- No production migration, live invitation/revocation, price/coupon update, deploy,
  checkout, email, or DM was executed. No production customer records were copied.
- The Gumroad public page was inspected read-only: US$19 lifetime/first 10. Actual
  payment activation/refund/coupon settings and external automation remain
  unverified. The app's US$39/first-25 copy differs and was deliberately not changed.
- Shared device-local Journal/TestSets/backup storage remains shared. Static local
  computation is not secured by server RLS. See the program runbook for limits.
- Production Auth's leaked-password setting and DB patch version are pre-existing
  findings requiring separate operational decisions, not changes in this PR.

See [program and approval runbook](founding-coach-program.md) and
[current production audit](founding-coach-audit.md) for rollout order and remaining
approvals. Merging `main` triggers production Pages and therefore requires explicit
deployment approval.
