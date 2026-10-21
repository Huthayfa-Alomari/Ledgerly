# Supabase migration history reconciliation

Checked against live project `delvbdvjdmcblqiqaxsd` on 2026-10-21.

## Canonical migration map

The live migration history contains 19 versions. The repository now carries a version-prefixed SQL file for each of those entries:

| Live version | Migration name | Local file |
|---|---|---|
| 20261019130942 | brp_initial_audit_core | 20261019130942_brp_initial_audit_core.sql |
| 20261019131031 | brp_extended_audit_suite | 20261019131031_brp_extended_audit_suite.sql |
| 20261019132425 | enable_rls_schema_version | 20261019132425_enable_rls_schema_version.sql |
| 20261019133936 | split_role_write_policies | 20261019133936_split_role_write_policies.sql |
| 20261020012402 | restrict_schema_version_access | 20261020012402_restrict_schema_version_access.sql |
| 20261020081921 | move_membership_helper_private | 20261020081921_move_membership_helper_private.sql |
| 20261020082131 | explicit_schema_version_deny_policy | 20261020082131_explicit_schema_version_deny_policy.sql |
| 20261020085003 | core_tenant_query_indexes | 20261020085003_core_tenant_query_indexes.sql |
| 20261020102654 | ledgerly_secure_first_firm_bootstrap | 20261020102654_ledgerly_secure_first_firm_bootstrap.sql |
| 20261020102903 | ledgerly_bootstrap_service_role_only | 20261020102903_ledgerly_bootstrap_service_role_only.sql |
| 20261020103837 | ledgerly_secure_member_invitations | 20261020103837_ledgerly_secure_member_invitations.sql |
| 20261020103921 | ledgerly_invitation_schema_alignment | 20261020103921_ledgerly_invitation_schema_alignment.sql |
| 20261020104019 | ledgerly_invitation_explicit_deny_policy | 20261020104019_ledgerly_invitation_explicit_deny_policy.sql |
| 20261020104150 | ledgerly_expire_stale_invitations | 20261020104150_ledgerly_expire_stale_invitations.sql |
| 20261020104503 | ledgerly_interim_firm_admin_write_gate | 20261020104503_ledgerly_interim_firm_admin_write_gate.sql |
| 20261020140459 | ledgerly_role_by_table_rls | 20261020140459_ledgerly_role_by_table_rls.sql |
| 20261020140900 | ledgerly_scoped_child_table_rls | 20261020140900_ledgerly_scoped_child_table_rls.sql |
| 20261020141128 | ledgerly_firm_policy_cleanup | 20261020141128_ledgerly_firm_policy_cleanup.sql |
| 20261021040529 | ledgerly_cloud_sync_private_evidence | 20261021040529_ledgerly_cloud_sync_private_evidence.sql |

## Historical-source limitation

Two SQL sources were absent from the repository and could not be recovered byte-for-byte from the database's migration ledger. Their current files are **explicitly reconstructed equivalents**, not a claim that the exact original statements were recovered:

- `20261019133936_split_role_write_policies.sql`: splits the prior generic write policy into INSERT, UPDATE and DELETE policies. The later role-by-table RLS migration supersedes these transitional policies.
- `20261020104150_ledgerly_expire_stale_invitations.sql`: idempotently marks already-expired pending invitations as expired. The current invite path also performs stale-invitation cleanup.

The schema-version RLS entry is represented by an explicit, idempotent `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. All old timestamp aliases from the repository have been removed.

Because two original SQL sources were reconstructed, this file alignment is **not a substitute for a fresh-database replay and schema diff**. Before declaring a clean reproducible migration chain, run all migrations against a disposable Supabase project and compare its tables, constraints, triggers, policies, grants, indexes and functions with the live schema. Do not use `supabase db push` as a way to validate this against production.

## Not yet applied to live Supabase

- `20261021110000_ledgerly_audit_log_and_workpaper_review_guard.sql` remains pending. Test it in a disposable/ staging project with authenticated users and the current RLS matrix first.
- The foreign-key index migration is under review in PR #33. It has not been applied to the live project.
- The historical overlay `docs/archive/202610190002_security_hardening.sql` is not a migration and must never be applied manually. It was removed from `db/supabase/security` to prevent accidental execution.

## Verified checks

- There are no duplicate migration version prefixes.
- All 19 live migration versions have same-version local file names.
- The archive directory is separated from the executable migration folder.
- CI enforces these checks. A successful static test does not itself prove the reconstructed history replays to a schema identical to production.
