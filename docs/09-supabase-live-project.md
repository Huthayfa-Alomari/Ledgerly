# Ledgerly live security status — 2026-10-20

## Live Supabase project
- Project ref: `delvbdvjdmcblqiqaxsd`
- The role-by-table RLS migration `ledgerly_role_by_table_rls` has been applied.
- All 44 public base tables have RLS enabled.
- The database currently has zero firms, users, role assignments, and invitations.
- Browser clients cannot read the local PIN verifier column `app_user.auth_secret`.
- Browser DELETE/TRUNCATE is revoked from tenant-owned tables; immutable event-chain writes remain server-only.
- The invitation table remains denied to browser roles and the Edge Function still requires the separate invitation feature flag.

## Verification and remaining gates
- GitHub CI passed for PR #17 before merge (unit/regression tests and production bundle build).
- Supabase Security Advisor currently reports no-policy informational findings for child/immutable tables and a warning that leaked-password protection is disabled. The child-table follow-up migration adds explicit scope policies for those tables; then rerun Security Advisor.
- CI tests are static regression tests, not a substitute for authenticated PostgREST integration tests.
- Before enabling invitations or cloud sync, test with two firms and multiple roles, including unassigned engagement reads/writes, professional approval separation, and append-only records.
- Do not set `LEDGERLY_INVITATIONS_ENABLED=true` yet.
- Set the Edge Function secret `LEDGERLY_BOOTSTRAP_EMAIL` to the confirmed owner email before using first-firm bootstrap. Do not place the email in frontend environment variables or Git.

## Current product boundary
The application remains local-first. Cloud synchronization and private evidence upload are not enabled. Do not describe the system as production-ready for multi-user cloud auditing until authenticated tenant-isolation tests, restore/backup validation, and evidence-storage controls pass.
