# Security hardening overlay (partially deployed)

This overlay addresses a critical weakness in the initial draft: its broad `FOR ALL` firm-isolation policies allow any member who can reach the Data API to attempt writes across the firm, including self-provisioning users or role assignments.

## Before use

1. Create a dedicated test Supabase project for this audit platform. Do not reuse another app's database.
2. Create a formal migration with the installed Supabase CLI (`supabase migration new security_hardening`) and move/review this SQL into that generated migration file.
3. Confirm the initial schema migration has been reviewed and applied to that test project.
4. Apply the overlay in the test project only after a backup and peer review.
5. Test with at least two firms and users representing an ordinary member, firm admin, and engagement-scoped user. Confirm cross-firm reads/writes fail and ordinary members cannot insert/update/delete `app_user`, `role_assignment`, or `firm` rows.
6. Run Supabase security and performance advisors after applying.

## Important limits

- This is an intermediate hardening step, not a complete external-audit-office authorization model. The generic write policy accepts any firm-scoped role for all business tables; it does not yet enforce role-specific permissions or engagement-scoped role assignments. Replace it with per-table and per-action policies before production.
- The initial schema stores IDs as `TEXT`; bootstrap must ensure `app_user.id = auth.users.id::text`.
- `SECURITY DEFINER` is used only for membership/role lookups to avoid RLS recursion; it is in the non-exposed `private` schema, has an empty search path, and explicit execute grants.
- The current audit-write-guard migration rejects mismatched `actor_id` values and server-stamps `occurred_at`. Browser-submitted action/entity/payload details are still not a tamper-proof audit trail; sensitive/significant events should be emitted through trusted server-side functions.
- Applied to the dedicated Supabase project `delvbdvjdmcblqiqaxsd`: the `move_membership_helper_private` migration moved the membership predicate into `private`, rewrote all 157 dependent public RLS policies, and revoked direct browser-role execution of the public helper. Post-deployment checks confirmed 0 policies still reference the public helper and all 43 public tables retain RLS.
- The broader overlay in `202610190002_security_hardening.sql` is an archived intermediate draft and has **not** been applied. Do not apply it manually to the current schema: its generic policies have been superseded by role-by-table RLS. Any DDL intended for deployment must be reviewed into `db/supabase/migrations` and applied through the migration workflow to avoid schema/history drift.
