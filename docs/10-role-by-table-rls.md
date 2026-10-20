# Ledgerly role-by-table RLS rollout

## Purpose
The migration `20261020120000_ledgerly_role_by_table_rls.sql` replaces the interim generic write policy with explicit policies by table and action. Authorization uses active `app_user` rows and trusted `role_assignment` records. Engagement-scoped assignments are only valid for the matching `engagement_id`; user-editable JWT metadata is not used.

## Conservative boundaries
- Browser clients cannot create or edit `firm`, `app_user`, or `role_assignment` rows. Provisioning remains in trusted Edge Functions.
- Invitations remain denied to browser roles. Do not set `LEDGERLY_INVITATIONS_ENABLED=true`.
- Browser DELETE/TRUNCATE is revoked for tenant tables; use tombstones/versioning.
- `change_log` is append-only for browser roles. `immutable_event_chain` is server-write-only.
- Tables without a direct engagement key are conservative/read-only for non-firm-scoped roles until parent-scope checks are implemented.
- This migration is not a claim of complete production authorization: row-level scope tests require at least two test firms and multiple users/roles, followed by live authenticated API tests.

## Required verification before invitations or cloud sync
1. Apply the migration to a dedicated test project first, then inspect every policy in `pg_policies`.
2. Create two test firms and accounts for firm admin, managing partner, engagement partner, manager, senior, staff, reviewer, and EQCR.
3. Verify cross-firm reads/writes fail for every business table.
4. Verify an engagement-scoped user cannot access an unassigned engagement, including child records and client/fiscal-year references.
5. Verify firm_admin cannot perform professional writes/sign-off, staff cannot approve reviews, and no user can physically delete audit records.
6. Run the automated test suite, Security Advisor, and authenticated PostgREST tests.
7. Only after all checks pass, configure the HTTPS invitation redirect, production SMTP, and the invitation feature flag.

## Current live project boundary
The live database has no firms, users, or invitations. The Security Advisor has returned no findings, but this is not equivalent to role-by-role integration testing. Do not enable invitations or cloud synchronization based on static tests alone.
