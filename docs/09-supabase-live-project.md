# Ledgerly live security status — 2026-10-20

## Live Supabase project
- Project ref: `delvbdvjdmcblqiqaxsd`.
- Applied migrations: `ledgerly_role_by_table_rls` and `ledgerly_scoped_child_table_rls`.
- All 44 public base tables have RLS enabled.
- The database currently has zero firms, users, role assignments, and invitations.
- The live `app_user` table exposes only an explicit allowlist of identity columns to authenticated clients; no PIN-verifier column exists in the current cloud schema.
- Browser DELETE/TRUNCATE is revoked from tenant-owned tables; the immutable event chain is readable only within allowed scope and remains server-write-only.
- Invitations remain denied to browser roles and the Edge Function still requires the separate invitation feature flag.

## Verification and remaining gates
- PR #17 and PR #18 passed GitHub CI (regression tests and production bundle build) before merge.
- Supabase Security Advisor now reports no RLS-no-policy findings. One warning remains: Supabase Auth leaked-password protection is disabled.
- Static regression tests do not replace authenticated PostgREST integration tests.
- Before enabling invitations or cloud sync, test with two firms and multiple roles, including unassigned engagement reads/writes, professional approval separation, and append-only records.
- Do not set `LEDGERLY_INVITATIONS_ENABLED=true` yet.
- Set the Edge Function secret `LEDGERLY_BOOTSTRAP_EMAIL` to the confirmed owner email before using first-firm bootstrap. Do not place the email in frontend environment variables or Git.

## Current product boundary
The application remains local-first. Cloud synchronization and private evidence upload are not enabled. Do not describe the system as production-ready for multi-user cloud auditing until authenticated tenant-isolation tests, restore/backup validation, and evidence-storage controls pass.
